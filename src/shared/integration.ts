/**
 * 外部配置导入协议（Scheer Extension Import Protocol v1）
 *
 * 任意 HTTP/HTTPS 网站可通过 Web Accessible 的 bridge.html 发起配置导入请求：
 * - bridge 校验请求后把待导入配置写入 chrome.storage.session（带 TTL）
 * - 扩展弹出 import.html 确认页，用户确认后才写入正式配置（local:config）
 *
 * 安全边界：外部页面只能"提出导入请求"，不能读取或直接修改正式配置。
 * 本文件只放协议常量与纯函数，chrome API 调用在 bridge/import 入口中。
 */

import { storage } from 'wxt/storage';
import { DEBUG_LOG_LEVELS, PLATFORM_KEYS } from './schema';
import type { Config, DebugLogLevel, ImportedConfig, PlatformKey } from './schema';

// ============================================================================
// 协议常量
// ============================================================================

export const IMPORT_PROTOCOL = 'scheer-config-import';
export const IMPORT_PROTOCOL_VERSION = 1;

/** 请求 timestamp 与本地时间允许的最大偏差（同一浏览器内，理论上无时钟偏差） */
export const IMPORT_REQUEST_MAX_AGE_MS = 30_000;

/** 待确认导入请求在 chrome.storage.session 中的存活时间 */
export const PENDING_IMPORT_TTL_MS = 5 * 60_000;

/** bridge 页（Web Accessible Resource）在构建产物中的路径 */
export const BRIDGE_PAGE_PATH = 'bridge.html';

/** 确认页（扩展内部页面，不对外暴露）在构建产物中的路径 */
export const IMPORT_PAGE_PATH = 'import.html';

// ============================================================================
// 协议消息类型
// ============================================================================

export interface ConfigImportRequest {
  protocol: typeof IMPORT_PROTOCOL;
  version: typeof IMPORT_PROTOCOL_VERSION;
  type: 'REQUEST_CONFIG_IMPORT';
  requestId: string;
  timestamp: number;
  /** 未校验的原始 config，需经 sanitizeImportedConfig 清洗 */
  config: unknown;
}

/** 写入 chrome.storage.session 的待确认导入请求 */
export interface PendingImport {
  requestId: string;
  sourceOrigin: string;
  receivedAt: number;
  expiresAt: number;
  /** 确认窗口 id，用于判断旧 pending 的窗口是否仍存活 */
  windowId?: number;
  config: ImportedConfig;
}

export type ImportErrorCode =
  | 'INVALID_MESSAGE'
  | 'INVALID_REQUEST_ID'
  | 'REQUEST_EXPIRED'
  | 'INVALID_CONFIG'
  | 'INVALID_FIELD'
  | 'EMPTY_CONFIG'
  | 'IMPORT_BUSY'
  | 'UNKNOWN_ERROR';

export class ImportError extends Error {
  constructor(
    public code: ImportErrorCode,
    message?: string
  ) {
    super(message ?? code);
    this.name = 'ImportError';
  }
}

// ============================================================================
// 通用校验辅助
// ============================================================================

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fail(message: string): never {
  throw new ImportError('INVALID_FIELD', message);
}

function asString(value: unknown, field: string, maxLen: number, allowEmpty: boolean): string {
  if (typeof value !== 'string') fail(`${field}: expected string`);
  if (value.length > maxLen) fail(`${field}: exceeds max length ${maxLen}`);
  if (!allowEmpty && value.trim() === '') fail(`${field}: must not be empty`);
  return value;
}

function asBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') fail(`${field}: expected boolean`);
  return value;
}

function asInt(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) fail(`${field}: expected integer`);
  if (value < min || value > max) fail(`${field}: out of range [${min}, ${max}]`);
  return value;
}

function asLiteral<T extends string | boolean>(
  value: unknown,
  field: string,
  allowed: readonly T[]
): T {
  if (!allowed.includes(value as T)) fail(`${field}: expected ${allowed.join(' | ')}`);
  return value as T;
}

function isLocalHostname(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

/** 校验为 https URL；localhost/127.0.0.1 允许 http（本地开发后端场景） */
function asSecureUrl(value: unknown, field: string, maxLen = 2048): string {
  const raw = asString(value, field, maxLen, false);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    fail(`${field}: invalid URL`);
  }
  const allowed =
    url.protocol === 'https:' || (url.protocol === 'http:' && isLocalHostname(url.hostname));
  if (!allowed) fail(`${field}: only https URLs are allowed (http allowed on localhost)`);
  return raw;
}

/** 接口地址：相对路径（/ 开头）或完整 URL */
function asEndpoint(value: unknown, field: string): string {
  const raw = asString(value, field, 512, false);
  if (raw.startsWith('/')) return raw;
  return asSecureUrl(raw, field, 512);
}

// ============================================================================
// config 字段白名单清洗
// ============================================================================
//
// 规则与 options 页"粘贴导入"一致：白名单之外的字段直接丢弃；
// 白名单之内但值非法时抛 ImportError（调用方可获得具体字段错误）。

type ServerConfig = Config['server'];
type CrawlConfig = Config['crawl'];
type DebugConfig = Config['debug'];

function sanitizeServer(input: Record<string, unknown>): Partial<ServerConfig> {
  const out: Partial<ServerConfig> = {};
  for (const [key, value] of Object.entries(input)) {
    switch (key) {
      case 'base':
        out.base = asSecureUrl(value, 'server.base');
        break;
      case 'create_product_endpoint':
        out.create_product_endpoint = asEndpoint(value, 'server.create_product_endpoint');
        break;
      case 'current_user_endpoint':
        out.current_user_endpoint = asEndpoint(value, 'server.current_user_endpoint');
        break;
      case 'method':
        out.method = asLiteral(value, 'server.method', ['POST'] as const);
        break;
      case 'secret':
        // 不允许通过导入清空密钥；不想修改时应省略该字段
        out.secret = asString(value, 'server.secret', 4096, false);
        break;
      case 'secret_header':
        out.secret_header = asString(value, 'server.secret_header', 128, false);
        break;
      case 'secret_prefix':
        // 允许空字符串：不需要前缀的场景
        out.secret_prefix = asString(value, 'server.secret_prefix', 64, true);
        break;
      case 'headers': {
        if (!isPlainObject(value)) fail('server.headers: expected object');
        const entries = Object.entries(value);
        if (entries.length > 20) fail('server.headers: too many entries (max 20)');
        const headers: Record<string, string> = {};
        for (const [hKey, hValue] of entries) {
          if (!hKey || hKey.length > 128) fail('server.headers: invalid header name');
          headers[hKey] = asString(hValue, `server.headers.${hKey}`, 1024, true);
        }
        out.headers = headers;
        break;
      }
      case 'timeout_ms':
        out.timeout_ms = asInt(value, 'server.timeout_ms', 1000, 120000);
        break;
      default:
        // 未知字段丢弃
        break;
    }
  }
  return out;
}

function sanitizeCrawl(input: Record<string, unknown>): Partial<CrawlConfig> {
  const out: Partial<CrawlConfig> = {};
  for (const [key, value] of Object.entries(input)) {
    switch (key) {
      case 'product_mode':
        out.product_mode = asLiteral(value, 'crawl.product_mode', ['manual'] as const);
        break;
      case 'extract_reviews':
        out.extract_reviews = asLiteral(value, 'crawl.extract_reviews', [false] as const);
        break;
      case 'review_strategy':
        out.review_strategy = asLiteral(value, 'crawl.review_strategy', ['visible'] as const);
        break;
      case 'review_max_pages':
        out.review_max_pages = asInt(value, 'crawl.review_max_pages', 1, 100);
        break;
      case 'confirm_before_submit':
        out.confirm_before_submit = asBoolean(value, 'crawl.confirm_before_submit');
        break;
      default:
        break;
    }
  }
  return out;
}

function sanitizeDebug(input: Record<string, unknown>): Partial<DebugConfig> {
  const out: Partial<DebugConfig> = {};
  for (const [key, value] of Object.entries(input)) {
    switch (key) {
      case 'enabled':
        out.enabled = asBoolean(value, 'debug.enabled');
        break;
      case 'persist':
        out.persist = asBoolean(value, 'debug.persist');
        break;
      case 'maxEntries':
        // 与 options 页一致的取值范围
        out.maxEntries = asInt(value, 'debug.maxEntries', 50, 5000);
        break;
      case 'level':
        out.level = asLiteral(value, 'debug.level', DEBUG_LOG_LEVELS) as DebugLogLevel;
        break;
      default:
        break;
    }
  }
  return out;
}

function sanitizePlatforms(input: Record<string, unknown>): Partial<Record<PlatformKey, boolean>> {
  const out: Partial<Record<PlatformKey, boolean>> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!(PLATFORM_KEYS as readonly string[]).includes(key)) continue; // 未知平台 key 丢弃
    out[key as PlatformKey] = asBoolean(value, `platforms.${key}`);
  }
  return out;
}

function sanitizeRetry(input: Record<string, unknown>): Partial<NonNullable<Config['retry']>> {
  const out: Partial<NonNullable<Config['retry']>> = {};
  for (const [key, value] of Object.entries(input)) {
    switch (key) {
      case 'max_attempts':
        out.max_attempts = asInt(value, 'retry.max_attempts', 0, 10);
        break;
      case 'backoff_base_ms':
        out.backoff_base_ms = asInt(value, 'retry.backoff_base_ms', 0, 60000);
        break;
      case 'retryable_status': {
        if (!Array.isArray(value) || value.length > 20) {
          fail('retry.retryable_status: expected array of up to 20 HTTP status codes');
        }
        out.retryable_status = value.map((item, i) =>
          asInt(item, `retry.retryable_status[${i}]`, 100, 599)
        );
        break;
      }
      default:
        break;
    }
  }
  return out;
}

function sanitizeUi(input: Record<string, unknown>): Partial<NonNullable<Config['ui']>> {
  const out: Partial<NonNullable<Config['ui']>> = {};
  for (const [key, value] of Object.entries(input)) {
    switch (key) {
      case 'notify_success':
        out.notify_success = asBoolean(value, 'ui.notify_success');
        break;
      case 'notify_failure':
        out.notify_failure = asBoolean(value, 'ui.notify_failure');
        break;
      default:
        break;
    }
  }
  return out;
}

function sanitizeStorage(input: Record<string, unknown>): Partial<NonNullable<Config['storage']>> {
  const out: Partial<NonNullable<Config['storage']>> = {};
  for (const [key, value] of Object.entries(input)) {
    switch (key) {
      case 'keep_history_days':
        out.keep_history_days = asInt(value, 'storage.keep_history_days', 0, 3650);
        break;
      case 'product_dedup_key':
        out.product_dedup_key = asString(value, 'storage.product_dedup_key', 128, false);
        break;
      case 'review_dedup_key':
        out.review_dedup_key = asString(value, 'storage.review_dedup_key', 128, false);
        break;
      default:
        break;
    }
  }
  return out;
}

function pickSection(
  input: Record<string, unknown>,
  key: string,
  sanitize: (section: Record<string, unknown>) => Record<string, unknown>
): Record<string, unknown> | undefined {
  const raw = input[key];
  if (raw === undefined) return undefined;
  if (!isPlainObject(raw)) throw new ImportError('INVALID_CONFIG', `${key} must be an object`);
  const cleaned = sanitize(raw);
  return Object.keys(cleaned).length > 0 ? cleaned : undefined;
}

/**
 * 按白名单清洗外部提交的配置。返回可安全交给 mergeImportedConfig 的 ImportedConfig。
 * 白名单外字段丢弃；白名单内非法值抛 INVALID_FIELD；无有效字段抛 EMPTY_CONFIG。
 */
export function sanitizeImportedConfig(input: unknown): ImportedConfig {
  if (!isPlainObject(input)) {
    throw new ImportError('INVALID_CONFIG', 'config must be a plain object');
  }

  const out: ImportedConfig = {};

  const server = pickSection(input, 'server', sanitizeServer);
  if (server) out.server = server as Partial<ServerConfig>;

  const crawl = pickSection(input, 'crawl', sanitizeCrawl);
  if (crawl) out.crawl = crawl as Partial<CrawlConfig>;

  const debug = pickSection(input, 'debug', sanitizeDebug);
  if (debug) out.debug = debug as Partial<DebugConfig>;

  const platforms = pickSection(input, 'platforms', sanitizePlatforms);
  if (platforms) out.platforms = platforms as Record<PlatformKey, boolean>;

  const retry = pickSection(input, 'retry', sanitizeRetry);
  if (retry) out.retry = retry as ImportedConfig['retry'];

  const ui = pickSection(input, 'ui', sanitizeUi);
  if (ui) out.ui = ui as ImportedConfig['ui'];

  const storageSection = pickSection(input, 'storage', sanitizeStorage);
  if (storageSection) out.storage = storageSection as ImportedConfig['storage'];

  if (Object.keys(out).length === 0) {
    throw new ImportError('EMPTY_CONFIG', 'no importable config fields');
  }
  return out;
}

// ============================================================================
// 协议请求校验
// ============================================================================

export function isHttpOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

/** 校验 postMessage 信封；不校验 config 内容（那是 sanitizeImportedConfig 的职责） */
export function validateImportRequest(
  input: unknown,
  now: number = Date.now()
): ConfigImportRequest {
  if (!isPlainObject(input)) throw new ImportError('INVALID_MESSAGE', 'message must be an object');
  if (input.protocol !== IMPORT_PROTOCOL || input.version !== IMPORT_PROTOCOL_VERSION) {
    throw new ImportError('INVALID_MESSAGE', 'unsupported protocol or version');
  }
  if (input.type !== 'REQUEST_CONFIG_IMPORT') {
    throw new ImportError('INVALID_MESSAGE', 'unsupported message type');
  }
  if (
    typeof input.requestId !== 'string' ||
    input.requestId.length === 0 ||
    input.requestId.length > 128
  ) {
    throw new ImportError('INVALID_REQUEST_ID', 'requestId must be a non-empty string');
  }
  if (
    typeof input.timestamp !== 'number' ||
    !Number.isFinite(input.timestamp) ||
    Math.abs(now - input.timestamp) > IMPORT_REQUEST_MAX_AGE_MS
  ) {
    throw new ImportError('REQUEST_EXPIRED', 'timestamp outside allowed window');
  }
  return input as unknown as ConfigImportRequest;
}

/**
 * 是否应拒绝新的导入请求（BUSY）。
 * 仅当旧 pending 未过期且其确认窗口仍存活时拒绝；
 * 窗口已被用户直接关闭的 pending 允许被覆盖，避免 TTL 内无法再发起导入。
 */
export function shouldBlockImport(
  pending: PendingImport | null | undefined,
  now: number,
  windowAlive: boolean
): boolean {
  return !!pending && pending.expiresAt > now && windowAlive;
}

// ============================================================================
// 确认页展示辅助
// ============================================================================

/** 敏感路径：预览时掩码，且绝不展示旧值 */
const SENSITIVE_PATHS = new Set(['server.secret', 'server.headers']);

export interface ImportPreviewRow {
  /** 点分字段路径，如 server.base */
  path: string;
  value: unknown;
  sensitive: boolean;
}

const SECTION_ORDER = ['server', 'crawl', 'debug', 'platforms', 'retry', 'ui', 'storage'] as const;

/** 把清洗后的 ImportedConfig 展平成预览行（section 固定顺序，section 内按字段名排序），供确认页逐行展示 */
export function flattenImportedConfig(config: ImportedConfig): ImportPreviewRow[] {
  const rows: ImportPreviewRow[] = [];
  for (const section of SECTION_ORDER) {
    const value = config[section];
    if (!isPlainObject(value)) continue;
    const entries = Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
    for (const [key, leaf] of entries) {
      if (leaf === undefined) continue;
      rows.push({
        path: `${section}.${key}`,
        value: leaf,
        sensitive: SENSITIVE_PATHS.has(`${section}.${key}`),
      });
    }
  }
  return rows;
}

/** 按点分路径从 Config 中取值（用于展示当前值） */
export function getConfigValueByPath(source: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (!isPlainObject(acc)) return undefined;
    return acc[key];
  }, source);
}

export function maskSecret(value: string): string {
  if (!value) return '';
  if (value.length <= 8) return '••••••••';
  return `${value.slice(0, 4)}••••••••${value.slice(-4)}`;
}

// ============================================================================
// pending 存储（chrome.storage.session）
// ============================================================================

const pendingImportItem = storage.defineItem<PendingImport | null>(
  'session:pendingExternalConfigImport',
  { fallback: null }
);

export async function getPendingImport(): Promise<PendingImport | null> {
  return pendingImportItem.getValue();
}

export async function setPendingImport(pending: PendingImport): Promise<void> {
  return pendingImportItem.setValue(pending);
}

export async function clearPendingImport(): Promise<void> {
  return pendingImportItem.removeValue();
}
