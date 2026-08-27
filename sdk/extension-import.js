/**
 * Scheer Extension Import SDK（接入方用）
 *
 * 用法：
 *   import { requestExtensionConfigImport } from './extension-import.js';
 *   await requestExtensionConfigImport({
 *     extensionId: '你的扩展 ID',
 *     config: { server: { base: 'https://api.example.com', secret: 'sk-xxx' } },
 *   });
 *
 * 说明：
 * - 通过隐藏 iframe 加载扩展的 bridge.html，以 BRIDGE_READY 作为安装/可用握手信号；
 * - resolve 仅表示"扩展已接收请求并弹出确认窗口"，不代表用户已确认导入；
 * - 未安装扩展 / Extension ID 错误 / CSP 拦截 iframe 时，统一在 timeout 后 reject。
 * - config 字段为 Scheer 扩展配置（Config）的子集，未提供的字段保持用户当前值。
 */

const PROTOCOL = 'scheer-config-import';
const VERSION = 1;
const BRIDGE_PAGE_PATH = 'bridge.html';

export async function requestExtensionConfigImport({ extensionId, config, timeout = 2000 }) {
  if (!extensionId) {
    throw new Error('extensionId is required');
  }

  const extensionOrigin = `chrome-extension://${extensionId}`;
  const bridgeUrl = `${extensionOrigin}/${BRIDGE_PAGE_PATH}`;
  const requestId = crypto.randomUUID();

  const iframe = document.createElement('iframe');
  iframe.src = bridgeUrl;
  iframe.hidden = true;
  iframe.setAttribute('aria-hidden', 'true');
  document.body.appendChild(iframe);

  return await new Promise((resolve, reject) => {
    let ready = false;

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Extension not installed or bridge unavailable'));
    }, timeout);

    function cleanup() {
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      iframe.remove();
    }

    function onMessage(event) {
      // 必须确认消息来自刚创建的 iframe
      if (event.source !== iframe.contentWindow) return;
      if (event.origin !== extensionOrigin) return;

      const msg = event.data;
      if (!msg || msg.protocol !== PROTOCOL || msg.version !== VERSION) return;

      if (msg.type === 'BRIDGE_READY' && !ready) {
        ready = true;

        iframe.contentWindow.postMessage(
          {
            protocol: PROTOCOL,
            version: VERSION,
            type: 'REQUEST_CONFIG_IMPORT',
            requestId,
            timestamp: Date.now(),
            config,
          },
          extensionOrigin
        );

        return;
      }

      if (msg.requestId !== requestId) return;

      if (msg.type === 'IMPORT_REQUEST_ACCEPTED') {
        cleanup();
        resolve({ requestId, accepted: true });
        return;
      }

      if (msg.type === 'ERROR') {
        cleanup();
        reject(new Error(msg.message || msg.code || 'Extension import failed'));
      }
    }

    window.addEventListener('message', onMessage);
  });
}
