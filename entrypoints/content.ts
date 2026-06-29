import { defineContentScript } from 'wxt/sandbox';
import { createLogger } from '../src/shared/logger';
import { getPageStatus } from '../src/shared/platform';
import { onMessage } from '../src/shared/messaging';
import { extractProduct } from '../src/shared/extract';

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  async main() {
    // 防止重复初始化：扩展重新注入 content script 时避免重复注册监听器
    const win = window as unknown as Record<string, unknown>;
    if (win.__SCHEER_CONTENT_INITIALIZED__) {
      return;
    }
    win.__SCHEER_CONTENT_INITIALIZED__ = true;

    const log = createLogger('content/main');

    // 先注册消息监听，确保即使后面的异步探测失败，popup/background 也能与本脚本通信
    onMessage(async (message, _sender, sendResponse) => {
      if (typeof message !== 'object' || !message.type) return;

      if (message.type === 'PING') {
        sendResponse({ ok: true });
        return;
      }

      if (message.type === 'GET_PAGE_STATUS') {
        try {
          const current = await getPageStatus(location.href, document.documentElement.outerHTML);
          log.debug('响应 GET_PAGE_STATUS', current);
          sendResponse(current);
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          log.error('GET_PAGE_STATUS 失败', { error });
          sendResponse({
            url: location.href,
            platform: null,
            canExtract: false,
            reason: `探测失败：${error}`,
          });
        }
        return;
      }

      if (message.type === 'GET_PAGE_HTML') {
        try {
          const html = document.documentElement.outerHTML;
          const maxLength = 1_000_000;
          const truncated = html.length > maxLength;
          sendResponse({
            url: location.href,
            title: document.title,
            html: truncated ? html.slice(0, maxLength) : html,
            truncated,
            originalLength: html.length,
          });
        } catch (err) {
          sendResponse({
            url: location.href,
            title: document.title,
            html: '',
            error: err instanceof Error ? err.message : String(err),
          });
        }
        return;
      }

      if (message.type === 'EXTRACT_PRODUCT') {
        try {
          const platform = message.payload?.platform;
          if (!platform) {
            throw new Error('消息缺少 platform 参数');
          }
          log.info('开始采集商品', { platform, url: location.href });
          const payload = await extractProduct(location.href, platform, document);
          log.info('采集完成', { platform, source_product_id: payload.source_product_id });
          sendResponse({ success: true, payload });
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          log.error('采集失败', { error });
          sendResponse({ success: false, error });
        }
        return;
      }
    });

    try {
      const status = await getPageStatus(location.href, document.documentElement.outerHTML);
      log.debug('Content script 注入', { url: location.href });
      log.info('页面状态', status);
    } catch (err) {
      log.error('Content script 初始化探测失败', {
        url: location.href,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
});
