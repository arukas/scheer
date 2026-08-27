/**
 * 外部配置导入 bridge（Web Accessible Resource，唯一暴露给网页的入口）
 *
 * 能力严格限制为"创建待确认导入请求"：
 * 校验 → 写 chrome.storage.session → 弹扩展自己的确认窗口。
 * 不提供任何读取正式配置/密钥的接口，也不直接写正式配置。
 */

import {
  IMPORT_PAGE_PATH,
  IMPORT_PROTOCOL,
  IMPORT_PROTOCOL_VERSION,
  PENDING_IMPORT_TTL_MS,
  ImportError,
  getPendingImport,
  isHttpOrigin,
  sanitizeImportedConfig,
  setPendingImport,
  shouldBlockImport,
  validateImportRequest,
} from '../../src/shared/integration';

// 被第三方页面以隐藏 iframe 加载后，通知父页面：扩展已安装且 bridge 可用。
// 不携带任何敏感信息，targetOrigin 用 '*'。
if (window.parent !== window) {
  window.parent.postMessage(
    {
      protocol: IMPORT_PROTOCOL,
      version: IMPORT_PROTOCOL_VERSION,
      type: 'BRIDGE_READY',
      extensionId: chrome.runtime.id,
      extensionVersion: chrome.runtime.getManifest().version,
    },
    '*'
  );
}

async function isWindowAlive(windowId: number | undefined): Promise<boolean> {
  if (typeof windowId !== 'number') return false;
  try {
    await chrome.windows.get(windowId);
    return true;
  } catch {
    return false;
  }
}

window.addEventListener('message', async (event) => {
  // 只接受直接父页面（隐藏 iframe 场景），且来源必须是 HTTP/HTTPS 网站
  if (event.source !== window.parent) return;
  if (!isHttpOrigin(event.origin)) return;

  const send = (payload: Record<string, unknown>) => {
    (event.source as Window).postMessage(
      { protocol: IMPORT_PROTOCOL, version: IMPORT_PROTOCOL_VERSION, ...payload },
      event.origin
    );
  };

  // 尽力提取 requestId，保证错误回复也能关联请求
  const rawRequestId =
    typeof event.data === 'object' && event.data !== null
      ? (event.data as { requestId?: unknown }).requestId
      : undefined;
  const requestId = typeof rawRequestId === 'string' ? rawRequestId : undefined;

  try {
    const msg = validateImportRequest(event.data);
    const config = sanitizeImportedConfig(msg.config);

    const pending = await getPendingImport();
    const windowAlive = pending ? await isWindowAlive(pending.windowId) : false;
    if (shouldBlockImport(pending, Date.now(), windowAlive)) {
      throw new ImportError('IMPORT_BUSY');
    }

    // 先开确认窗口再写 pending；写失败则关掉窗口，避免留下无数据的确认页
    const win = await chrome.windows.create({
      url: chrome.runtime.getURL(IMPORT_PAGE_PATH),
      type: 'popup',
      width: 520,
      height: 680,
      focused: true,
    });

    try {
      await setPendingImport({
        requestId: msg.requestId,
        sourceOrigin: event.origin,
        receivedAt: Date.now(),
        expiresAt: Date.now() + PENDING_IMPORT_TTL_MS,
        windowId: win?.id,
        config,
      });
    } catch (err) {
      if (win?.id !== undefined) {
        await chrome.windows.remove(win.id).catch(() => {});
      }
      throw err;
    }

    send({ type: 'IMPORT_REQUEST_ACCEPTED', requestId: msg.requestId });
  } catch (err) {
    send({
      type: 'ERROR',
      requestId,
      code: err instanceof ImportError ? err.code : 'UNKNOWN_ERROR',
      message: err instanceof Error ? err.message : String(err),
    });
  }
});
