import { defineContentScript } from 'wxt/sandbox';
import { createLogger } from '../src/shared/logger';
import { getPageStatus } from '../src/shared/platform';
import { onMessage } from '../src/shared/messaging';
import { extractProduct } from '../src/shared/extract';

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  async main() {
    const log = createLogger('content/main');
    const status = await getPageStatus(location.href, document.documentElement.outerHTML);

    log.debug('Content script 注入', { url: location.href });
    log.info('页面状态', status);

    onMessage(async (message, _sender, sendResponse) => {
      if (typeof message !== 'object' || !message.type) return;

      if (message.type === 'GET_PAGE_STATUS') {
        const current = await getPageStatus(location.href, document.documentElement.outerHTML);
        log.debug('响应 GET_PAGE_STATUS', current);
        sendResponse(current);
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
          const { platform } = message.payload;
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
  },
});
