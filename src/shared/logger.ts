/**
 * Logger 实现
 *
 * - 按 debug_logs.enabled 过滤 debug 级别
 * - 按 debug_logs.persist 决定是否写入 chrome.storage.local
 * - 自动脱敏 secret / token / Authorization / body 等敏感信息
 */

import type { Logger, DebugLogEntry, DebugLogLevel } from './schema';
import { appendDebugLog, getDebugLogs } from './storage';

const SENSITIVE_KEY_RE = /secret|authorization|token|password|cookie|api[-_]?key/i;
const BEARER_RE = /^Bearer\s+/i;
const MAX_BODY_LENGTH = 2048;

export function redactSensitive(payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (SENSITIVE_KEY_RE.test(key)) {
      out[key] = '<redacted>';
    } else if (typeof value === 'string' && BEARER_RE.test(value)) {
      out[key] = '<redacted>';
    } else if (Array.isArray(value)) {
      out[key] = value.map((item) =>
        typeof item === 'object' && item !== null
          ? redactSensitive(item as Record<string, unknown>)
          : item
      );
    } else if (typeof value === 'object' && value !== null) {
      out[key] = redactSensitive(value as Record<string, unknown>);
    } else {
      out[key] = value;
    }
  }
  return out;
}

export function truncateBody(payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...payload };
  for (const key of ['body', 'responseText']) {
    const value = out[key];
    if (typeof value === 'string' && value.length > MAX_BODY_LENGTH) {
      out[key] = value.slice(0, MAX_BODY_LENGTH) + ' ... [truncated]';
    }
  }
  return out;
}

function normalizePayload(payload: unknown): Record<string, unknown> | undefined {
  if (payload === undefined || payload === null) return undefined;
  if (typeof payload === 'object' && !Array.isArray(payload)) {
    return { ...(payload as Record<string, unknown>) };
  }
  return { value: payload };
}

export function sanitizePayload(
  payload?: unknown
): Record<string, unknown> | undefined {
  return truncateBody(redactSensitive(normalizePayload(payload) ?? {}));
}

export function buildLogEntry(
  context: string,
  level: DebugLogLevel,
  message: string,
  payload?: unknown
): DebugLogEntry {
  return {
    timestamp: new Date().toISOString(),
    level,
    context,
    message,
    payload: sanitizePayload(payload),
  };
}

export function createLogger(context: string): Logger {
  return {
    debug(message: string, payload?: unknown) {
      log(context, 'debug', message, payload);
    },
    info(message: string, payload?: unknown) {
      log(context, 'info', message, payload);
    },
    warn(message: string, payload?: unknown) {
      log(context, 'warn', message, payload);
    },
    error(message: string, payload?: unknown) {
      log(context, 'error', message, payload);
    },
  };
}

function log(
  context: string,
  level: DebugLogLevel,
  message: string,
  payload?: unknown
): void {
  // 异步读取配置，不阻塞业务
  getDebugLogs()
    .then((logs) => {
      const entry = buildLogEntry(context, level, message, payload);

      // console 输出规则：debug 仅在 enabled 时输出
      if (level !== 'debug' || logs.enabled) {
        const consoleMethod = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
        consoleMethod(`[${context}] ${message}`, entry.payload ?? '');
      }

      // storage 写入规则：enabled && persist
      if (logs.enabled && logs.persist) {
        appendDebugLog(entry).catch((err) => {
          console.error('[logger] failed to persist debug log', err);
        });
      }
    })
    .catch((err) => {
      console.error('[logger] failed to read debug logs config', err);
    });
}
