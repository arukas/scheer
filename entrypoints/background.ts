import { defineBackground } from 'wxt/sandbox';
import { storage } from 'wxt/storage';
import { DEFAULT_DEBUG_LOGS, DEFAULT_CONFIG } from '../src/shared/schema';
import type { Config, CreateProductPayload, HistoryItem, TokenStatus } from '../src/shared/schema';
import {
  getConfig,
  setConfig,
  getDebugLogs,
  clearDebugLogs,
  exportDebugLogs,
  appendHistory,
  getTokenStatus,
  setTokenStatus,
} from '../src/shared/storage';
import { createLogger } from '../src/shared/logger';
import { onMessage } from '../src/shared/messaging';
import { getPageStatus } from '../src/shared/platform';
import type { PageStatus } from '../src/shared/platform';
import { submitCreateProduct, testBackendConnection } from '../src/shared/api';
import { extractTokenExpiresAt } from '../src/shared/token-status';
import { t } from '../src/shared/i18n';

export default defineBackground(() => {
  const log = createLogger('background/main');

  // 安装/更新时初始化 storage 默认值
  storage
    .getItem<Record<string, unknown>>('local:debug_logs')
    .then((existing) => {
      if (!existing) {
        return storage.setItem('local:debug_logs', DEFAULT_DEBUG_LOGS);
      }
    })
    .catch((err) => console.error('[background] init debug_logs failed', err));

  storage
    .getItem<Record<string, unknown>>('local:config')
    .then((existing) => {
      if (!existing) {
        return storage.setItem('local:config', DEFAULT_CONFIG);
      }
    })
    .catch((err) => console.error('[background] init config failed', err));

  log.debug('Service Worker 已启动');

  // 消息中转
  onMessage(async (message, _sender, sendResponse) => {
    if (typeof message !== 'object' || !message.type) return;

    switch (message.type) {
      case 'GET_PAGE_STATUS': {
        try {
          const result = await getActivePageStatus();
          if (!result) {
            sendResponse({
              url: '',
              platform: null,
              canExtract: false,
              reason: t('activeTabFailed'),
            });
            break;
          }
          const { source } = result;
          log.debug(`GET_PAGE_STATUS (from ${source})`, result.status);
          sendResponse(result.status);
        } catch (err) {
          log.error('GET_PAGE_STATUS 失败', { error: (err as Error).message });
          sendResponse({
            url: '',
            platform: null,
            canExtract: false,
            reason: t('activeTabFailed'),
          });
        }
        break;
      }

      case 'GET_CONFIG': {
        const config = await getConfig();
        sendResponse(config);
        break;
      }

      case 'SET_CONFIG': {
        const { config } = (
          message as { payload: { config: import('../src/shared/schema').Config } }
        ).payload;
        await setConfig(config);
        // 同步更新 debug_logs 的 enabled / persist / maxEntries / level
        const logs = await getDebugLogs();
        logs.enabled = config.debug.enabled;
        logs.persist = config.debug.persist;
        logs.maxEntries = config.debug.maxEntries;
        logs.level = config.debug.level;
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
          const active = await getActivePageStatus();
          if (!active) {
            throw new Error('没有活跃标签页');
          }
          const { tab, status: pageStatus } = active;
          if (!tab.id) {
            throw new Error('没有活跃标签页');
          }
          if (!pageStatus.canExtract || !pageStatus.platform) {
            throw new Error(pageStatus.reason || '当前页面不可采集');
          }

          log.info('请求内容脚本采集商品', { url: pageStatus.url, platform: pageStatus.platform });
          const extractResponse = await sendToContentScript<
            { success: true; payload: CreateProductPayload } | { success: false; error: string }
          >(tab.id, {
            type: 'EXTRACT_PRODUCT',
            payload: { platform: pageStatus.platform },
          });

          if (!extractResponse.success) {
            throw new Error(extractResponse.error || '内容脚本采集失败');
          }

          const payload = extractResponse.payload;
          const storedConfig = await getConfig();
          const injectedConfig = await getInjectedConfig(tab.id);
          const config = mergeWithInjectedConfig(storedConfig, injectedConfig);
          if (!config.server.secret) {
            throw new Error('后端密钥未配置');
          }

          log.info('向后端提交创建商品', {
            url: payload.source_url,
            source: injectedConfig ? 'injected' : 'storage',
          });
          const result = await submitCreateProduct(payload, config.server);

          await recordHistory({
            status: 'success',
            source_url: payload.source_url,
            platform: payload.platform,
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
            const active = await getActivePageStatus();
            if (active?.status.platform) {
              await recordHistory({
                status: 'failed',
                source_url: active.status.url,
                platform: active.status.platform,
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

      case 'TEST_CONFIG': {
        try {
          const { config: baseConfig } = (
            message as { payload: { config: import('../src/shared/schema').Config } }
          ).payload;

          const mergedConfig = await resolveActiveTabConfig(baseConfig);

          if (!mergedConfig.server.secret) {
            throw new Error('后端密钥未配置');
          }
          const data = await testBackendConnection(mergedConfig.server);
          await saveTokenStatus(data);
          sendResponse({ success: true, data });
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          log.error('TEST_CONFIG 失败', { error });
          sendResponse({ success: false, error });
        }
        break;
      }

      case 'GET_TOKEN_STATUS': {
        sendResponse(await getTokenStatus());
        break;
      }

      case 'REFRESH_TOKEN_STATUS': {
        try {
          const storedConfig = await getConfig();
          const mergedConfig = await resolveActiveTabConfig(storedConfig);

          if (!mergedConfig.server.secret) {
            throw new Error('后端密钥未配置');
          }
          const data = await testBackendConnection(mergedConfig.server);
          const status = await saveTokenStatus(data);
          sendResponse({ success: true, data: status });
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          log.error('REFRESH_TOKEN_STATUS 失败', { error });
          sendResponse({ success: false, error });
        }
        break;
      }

      default:
        return;
    }
  });

  async function sendToContentScript<T>(tabId: number, message: unknown): Promise<T> {
    const CONTENT_SCRIPT_PATH = 'content-scripts/content.js';
    const POLL_INTERVAL_MS = 100;
    const MAX_WAIT_MS = 2000;

    async function trySend(): Promise<T> {
      return (await chrome.tabs.sendMessage(tabId, message)) as T;
    }

    async function waitForContentScript(): Promise<void> {
      const start = Date.now();
      while (Date.now() - start < MAX_WAIT_MS) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        try {
          await chrome.tabs.sendMessage(tabId, { type: 'PING' });
          return;
        } catch (pollErr) {
          const msg = pollErr instanceof Error ? pollErr.message : String(pollErr);
          if (!msg.includes('Receiving end does not exist')) return;
        }
      }
    }

    try {
      return await trySend();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      if (!errorMessage.includes('Receiving end does not exist')) {
        throw new Error(errorMessage, { cause: err });
      }

      log.warn('内容脚本未响应，尝试重新注入', { tabId, error: errorMessage });
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: [CONTENT_SCRIPT_PATH],
        });
      } catch (injectErr) {
        const injectError = injectErr instanceof Error ? injectErr.message : String(injectErr);
        throw new Error(`内容脚本重新注入失败：${injectError}`, { cause: injectErr });
      }

      await waitForContentScript();

      try {
        return await trySend();
      } catch (retryErr) {
        const retryError = retryErr instanceof Error ? retryErr.message : String(retryErr);
        throw new Error(`内容脚本重新注入后仍无法通信：${retryError}`, { cause: retryErr });
      }
    }
  }

  async function getTabHtml(tabId: number): Promise<string | null> {
    try {
      const [result] = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => document.documentElement?.outerHTML ?? '',
      });
      const html = result?.result;
      return typeof html === 'string' && html.length > 0 ? html : null;
    } catch {
      return null;
    }
  }

  async function getActivePageStatus(): Promise<{
    tab: chrome.tabs.Tab;
    status: PageStatus;
    source: 'content' | 'scripting' | 'url';
  } | null> {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return null;
    const url = tab.url ?? '';

    // 1. 优先让内容脚本做 DOM 指纹探测
    if (tab.id) {
      try {
        const status = await sendToContentScript<PageStatus>(tab.id, {
          type: 'GET_PAGE_STATUS',
        });
        return { tab, status, source: 'content' };
      } catch {
        // 内容脚本未注入或出错时继续 fallback
      }
    }

    // 2. Fallback：通过 scripting.executeScript 直接读取页面 HTML 做探测
    if (tab.id) {
      const html = await getTabHtml(tab.id);
      if (html) {
        const status = await getPageStatus(url, html);
        return { tab, status, source: 'scripting' };
      }
    }

    // 3. 最后只能按 URL 规则兜底
    const status = await getPageStatus(url);
    return { tab, status, source: 'url' };
  }

  async function getInjectedConfig(tabId: number): Promise<Partial<Config> | null> {
    try {
      const response = await sendToContentScript<{ config: Partial<Config> | null }>(tabId, {
        type: 'GET_INJECTED_CONFIG',
      });
      return response?.config ?? null;
    } catch {
      return null;
    }
  }

  /** 在传入配置之上合并当前标签页的页面注入配置（如有） */
  async function resolveActiveTabConfig(base: Config): Promise<Config> {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!activeTab?.id) return base;
    const injectedConfig = await getInjectedConfig(activeTab.id);
    log.debug('合并页面注入配置', { hasInjected: !!injectedConfig });
    return mergeWithInjectedConfig(base, injectedConfig);
  }

  /**
   * 从当前用户信息接口响应中解析 token_expires_at 并缓存。
   * 字段缺失或无法解析时按永久有效（expires_at 为 null）处理。
   */
  async function saveTokenStatus(meResponse: unknown): Promise<TokenStatus> {
    const status: TokenStatus = {
      expires_at: extractTokenExpiresAt(meResponse),
      checked_at: new Date().toISOString(),
    };
    try {
      await setTokenStatus(status);
    } catch (err) {
      log.warn('缓存 Token 有效期状态失败', { error: (err as Error).message });
    }
    return status;
  }

  function mergeWithInjectedConfig(stored: Config, injected: Partial<Config> | null): Config {
    if (!injected) return stored;

    return {
      ...stored,
      ...injected,
      server: {
        ...stored.server,
        ...injected.server,
        headers: {
          ...stored.server.headers,
          ...injected.server?.headers,
        },
      },
      crawl: { ...stored.crawl, ...injected.crawl },
      debug: { ...stored.debug, ...injected.debug },
    };
  }

  async function recordHistory(
    partial: Omit<HistoryItem, 'id' | 'created_at' | 'updated_at'>
  ): Promise<void> {
    const now = new Date().toISOString();
    const id =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
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
});
