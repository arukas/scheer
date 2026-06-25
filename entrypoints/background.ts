import { defineBackground } from 'wxt/sandbox';
import { storage } from 'wxt/storage';
import { DEFAULT_DEBUG_LOGS, DEFAULT_CONFIG } from '../src/shared/schema';
import type { CreateProductPayload, HistoryItem } from '../src/shared/schema';
import {
  getConfig,
  setConfig,
  getDebugLogs,
  clearDebugLogs,
  exportDebugLogs,
  appendHistory,
} from '../src/shared/storage';
import { createLogger } from '../src/shared/logger';
import { onMessage } from '../src/shared/messaging';
import { getPageStatus } from '../src/shared/platform';
import { submitCreateProduct } from '../src/shared/api';

export default defineBackground(() => {
  const log = createLogger('background/main');

  // 安装/更新时初始化 storage 默认值
  storage.getItem<Record<string, unknown>>('local:debug_logs').then((existing) => {
    if (!existing) {
      return storage.setItem('local:debug_logs', DEFAULT_DEBUG_LOGS);
    }
  }).catch((err) => console.error('[background] init debug_logs failed', err));

  storage.getItem<Record<string, unknown>>('local:config').then((existing) => {
    if (!existing) {
      return storage.setItem('local:config', DEFAULT_CONFIG);
    }
  }).catch((err) => console.error('[background] init config failed', err));

  log.debug('Service Worker 已启动');

  // 消息中转
  onMessage(async (message, _sender, sendResponse) => {
    if (typeof message !== 'object' || !message.type) return;

    switch (message.type) {
      case 'GET_PAGE_STATUS': {
        try {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          const url = tab?.url ?? '';

          // 优先让内容脚本做 DOM 指纹探测（ShopLine / ShopBase / ShopLazza / XShopPy）
          if (tab?.id) {
            try {
              const status = (await chrome.tabs.sendMessage(tab.id, { type: 'GET_PAGE_STATUS' })) as {
                url: string;
                platform: import('../src/shared/schema').PlatformKey | null;
                canExtract: boolean;
                reason: string;
              };
              log.debug('GET_PAGE_STATUS (from content)', status);
              sendResponse(status);
              break;
            } catch {
              // 内容脚本未注入或出错时回退到后台探测
            }
          }

          const status = await getPageStatus(url);
          log.debug('GET_PAGE_STATUS', status);
          sendResponse(status);
        } catch (err) {
          log.error('GET_PAGE_STATUS 失败', { error: (err as Error).message });
          sendResponse({ url: '', platform: null, canExtract: false, reason: '获取当前标签页失败' });
        }
        break;
      }

      case 'GET_CONFIG': {
        const config = await getConfig();
        sendResponse(config);
        break;
      }

      case 'SET_CONFIG': {
        const { config } = (message as { payload: { config: import('../src/shared/schema').Config } }).payload;
        await setConfig(config);
        // 同步更新 debug_logs 的 enabled / persist / maxEntries
        const logs = await getDebugLogs();
        logs.enabled = config.debug.enabled;
        logs.persist = config.debug.persist;
        logs.maxEntries = config.debug.maxEntries;
        await storage.setItem('local:debug_logs', logs);
        sendResponse({ success: true });
        break;
      }

      case 'GET_DEBUG_LOGS': {
        const logs = await getDebugLogs();
        sendResponse(logs);
        break;
      }

      case 'CLEAR_DEBUG_LOGS': {
        await clearDebugLogs();
        sendResponse({ success: true });
        break;
      }

      case 'EXPORT_DEBUG_LOGS': {
        const logs = await getDebugLogs();
        sendResponse(exportDebugLogs(logs));
        break;
      }

      case 'CREATE_PRODUCT': {
        try {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          const url = tab?.url ?? '';
          if (!tab?.id) {
            throw new Error('没有活跃标签页');
          }

          const pageStatus = await getPageStatus(url);
          if (!pageStatus.canExtract || !pageStatus.platform) {
            throw new Error(pageStatus.reason || '当前页面不可采集');
          }

          log.info('请求内容脚本采集商品', { url, platform: pageStatus.platform });
          const extractResponse = (await chrome.tabs.sendMessage(tab.id, {
            type: 'EXTRACT_PRODUCT',
            payload: { platform: pageStatus.platform },
          })) as { success: true; payload: CreateProductPayload } | { success: false; error: string };

          if (!extractResponse.success) {
            throw new Error(extractResponse.error || '内容脚本采集失败');
          }

          const payload = extractResponse.payload;
          const config = await getConfig();
          if (!config.server.secret) {
            throw new Error('后端密钥未配置');
          }

          log.info('向后端提交创建商品', { url: payload.source_url });
          const result = await submitCreateProduct(payload, config.server);

          await recordHistory({
            status: 'success',
            source_url: payload.source_url,
            platform: payload.platform as HistoryItem['platform'],
            product_id: result.product_id,
            log_id: result.log_id,
            user: result.user,
          });

          log.info('创建商品成功', { product_id: result.product_id });
          sendResponse({ success: true, data: result });
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          log.error('CREATE_PRODUCT 失败', { error });

          try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            const url = tab?.url ?? '';
            const pageStatus = await getPageStatus(url);
            if (pageStatus.platform) {
              await recordHistory({
                status: 'failed',
                source_url: url,
                platform: pageStatus.platform,
                error: { message: error },
              });
            }
          } catch {
            // history 记录失败不影响主流程反馈
          }

          sendResponse({ success: false, error });
        }
        break;
      }

      default:
        return;
    }
  });
});

async function recordHistory(
  partial: Omit<HistoryItem, 'id' | 'created_at' | 'updated_at'>
): Promise<void> {
  const now = new Date().toISOString();
  const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const item: HistoryItem = {
    ...partial,
    id,
    created_at: now,
    updated_at: now,
  } as HistoryItem;

  await appendHistory(item);
}
