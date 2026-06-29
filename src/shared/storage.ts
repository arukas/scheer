/**
 * Storage API 封装
 *
 * 使用 WXT 的 storage 模块（wxt/storage）操作 chrome.storage.local。
 * Storage key 约定：
 * - config: Config
 * - debug_logs: DebugLogs
 * - history: HistoryItem[]
 */

import { storage } from 'wxt/storage';
import type { Config, DebugLogs, DebugLogEntry, HistoryItem } from './schema';
import { DEFAULT_CONFIG, DEFAULT_DEBUG_LOGS } from './schema';

// ============================================================================
// Config
// ============================================================================

const configItem = storage.defineItem<Config>('local:config', {
  fallback: DEFAULT_CONFIG,
});

export async function getConfig(): Promise<Config> {
  const stored = await configItem.getValue();
  return mergeConfig(stored);
}

function mergeConfig(stored: Config): Config {
  return {
    ...DEFAULT_CONFIG,
    ...stored,
    server: { ...DEFAULT_CONFIG.server, ...stored.server },
    crawl: { ...DEFAULT_CONFIG.crawl, ...stored.crawl },
    debug: { ...DEFAULT_CONFIG.debug, ...stored.debug },
  };
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
