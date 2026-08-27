/**
 * Storage API 封装
 *
 * 使用 WXT 的 storage 模块（wxt/storage）操作 chrome.storage.local。
 * Storage key 约定：
 * - config: Config
 * - debug_logs: DebugLogs
 * - history: HistoryItem[]
 * - token_status: TokenStatus | null
 */

import { storage } from 'wxt/storage';
import type {
  Config,
  DebugLogs,
  DebugLogEntry,
  HistoryItem,
  ImportedConfig,
  TokenStatus,
} from './schema';
import { DEFAULT_CONFIG, DEFAULT_DEBUG_LOGS } from './schema';

// ============================================================================
// Config
// ============================================================================

const configItem = storage.defineItem<Config>('local:config', {
  fallback: DEFAULT_CONFIG,
});

export async function getConfig(): Promise<Config> {
  const stored = await configItem.getValue();
  return mergeWithDefaultConfig(stored);
}

/**
 * 把存储的配置与默认值做兜底合并，确保嵌套字段不缺省。
 */
export function mergeWithDefaultConfig(stored: Config): Config {
  return {
    ...DEFAULT_CONFIG,
    ...stored,
    server: { ...DEFAULT_CONFIG.server, ...stored.server },
    crawl: { ...DEFAULT_CONFIG.crawl, ...stored.crawl },
    debug: { ...DEFAULT_CONFIG.debug, ...stored.debug },
  };
}

function mergeOptionalNested<T extends object>(
  current: T | undefined,
  imported: Partial<T> | undefined
): T | undefined {
  if (!imported) return current;
  return { ...(current ?? ({} as T)), ...imported } as T;
}

/**
 * 把粘贴导入的配置合并到当前配置之上。
 * imported 提供的字段覆盖 current，未提供的字段保持 current 的值。
 * 最后用默认值兜底，防止导入的嵌套对象缺字段。
 */
export function mergeImportedConfig(current: Config, imported: ImportedConfig): Config {
  const merged: Config = {
    ...current,
    ...imported,
    server: { ...current.server, ...imported.server },
    crawl: { ...current.crawl, ...imported.crawl },
    debug: { ...current.debug, ...imported.debug },
    platforms: imported.platforms ?? current.platforms,
    retry: mergeOptionalNested(current.retry, imported.retry),
    ui: mergeOptionalNested(current.ui, imported.ui),
    storage: mergeOptionalNested(current.storage, imported.storage),
  };
  return mergeWithDefaultConfig(merged);
}

export async function setConfig(config: Config): Promise<void> {
  return configItem.setValue(config);
}

// ============================================================================
// Debug Logs
// ============================================================================

const debugLogsItem = storage.defineItem<DebugLogs>('local:debug_logs', {
  fallback: DEFAULT_DEBUG_LOGS,
});

export async function getDebugLogs(): Promise<DebugLogs> {
  return debugLogsItem.getValue();
}

export async function setDebugLogs(logs: DebugLogs): Promise<void> {
  return debugLogsItem.setValue(logs);
}

export async function appendDebugLog(entry: DebugLogEntry): Promise<void> {
  const logs = await getDebugLogs();
  logs.entries.push(entry);
  if (logs.entries.length > logs.maxEntries) {
    logs.entries = logs.entries.slice(logs.entries.length - logs.maxEntries);
  }
  await setDebugLogs(logs);
}

export async function clearDebugLogs(): Promise<void> {
  const logs = await getDebugLogs();
  logs.entries = [];
  await setDebugLogs(logs);
}

/**
 * 导出日志为 NDJSON（Newline Delimited JSON）格式，文件后缀建议 .log。
 * 第一行为元数据，之后每一行是一个 DebugLogEntry JSON 对象。
 */
export function exportDebugLogs(logs: DebugLogs): string {
  const meta = {
    type: 'scheer-debug-logs',
    exported_at: new Date().toISOString(),
    enabled: logs.enabled,
    persist: logs.persist,
    maxEntries: logs.maxEntries,
    count: logs.entries.length,
  };
  return [JSON.stringify(meta), ...logs.entries.map((entry) => JSON.stringify(entry))].join('\n');
}

// ============================================================================
// Token Status
// ============================================================================

const tokenStatusItem = storage.defineItem<TokenStatus | null>('local:token_status', {
  fallback: null,
});

/** 读取缓存的 Token 有效期状态；从未查询过时返回 null */
export async function getTokenStatus(): Promise<TokenStatus | null> {
  return tokenStatusItem.getValue();
}

export async function setTokenStatus(status: TokenStatus): Promise<void> {
  return tokenStatusItem.setValue(status);
}

/** 清除缓存的 Token 有效期状态（配置变更后旧状态不再可信） */
export async function clearTokenStatus(): Promise<void> {
  return tokenStatusItem.removeValue();
}

// ============================================================================
// History
// ============================================================================

const historyItem = storage.defineItem<HistoryItem[]>('local:history', {
  fallback: [],
});

export async function getHistory(): Promise<HistoryItem[]> {
  return historyItem.getValue();
}

function isHistoryItemExpired(item: HistoryItem, keepDays: number): boolean {
  if (keepDays <= 0) return false;
  const cutoff = Date.now() - keepDays * 24 * 60 * 60 * 1000;
  const itemTime = new Date(item.created_at).getTime();
  return Number.isFinite(itemTime) && itemTime < cutoff;
}

export async function appendHistory(item: HistoryItem): Promise<void> {
  const config = await getConfig();
  const keepDays = config.storage?.keep_history_days ?? 30;

  const history = await getHistory();
  history.unshift(item);

  // 清理过期记录，避免 storage 无限增长
  const filtered =
    keepDays > 0 ? history.filter((h) => !isHistoryItemExpired(h, keepDays)) : history;
  await historyItem.setValue(filtered);
}
