/**
 * 后端请求工具
 *
 * - 支持 domain + URI 拼接与完整 URL 直接请求
 * - 用于创建商品、获取当前用户等接口
 * - 自动记录请求/响应日志，并生成可复现的 curl 命令（已脱敏）
 */

import type { CreateProductPayload, CreateProductSuccessResponse, ServerConfig } from './schema';
import { createLogger } from './logger';

const log = createLogger('shared/api');

const ABSOLUTE_URL_RE = /^([a-z][a-z0-9+.-]*:)?\/\//i;
const SENSITIVE_HEADER_RE = /secret|authorization|token|password|cookie|api[-_]?key/i;
const MAX_CURL_BODY_LENGTH = 2048;
const MAX_RESPONSE_PREVIEW = 2048;

function summarizePayload(payload: CreateProductPayload): Record<string, unknown> {
  const { product } = payload;
  return {
    platform: payload.platform,
    source_url: payload.source_url,
    source_product_id: payload.source_product_id,
    title: product.title,
    handle: product.handle,
    description_html_length: product.description_html?.length ?? 0,
    vendor: product.vendor,
    product_type: product.product_type,
    tags: product.tags,
    published_scope: product.published_scope,
    options_count: product.options?.length ?? 0,
    variants_count: product.variants.length,
    images_count: product.images.length,
    first_variant_title: product.variants[0]?.title,
    first_variant_options: product.variants[0]?.options,
    first_image_src: product.images[0]?.src,
    first_image_type: product.images[0]?.type,
  };
}

/**
 * 把字符串转义为 shell 单引号安全形式。
 */
function escapeShell(value: string): string {
  return value.replace(/'/g, "'\\''");
}

function normalizeHeaders(headers: HeadersInit): [string, string][] {
  if (headers instanceof Headers) {
    const out: [string, string][] = [];
    headers.forEach((value, key) => out.push([key, value]));
    return out;
  }
  if (Array.isArray(headers)) {
    return headers.map(([key, value]) => [String(key), String(value)]);
  }
  return Object.entries(headers as Record<string, unknown>).map(([key, value]) => [
    key,
    String(value),
  ]);
}

function redactHeaderValue(key: string, value: string): string {
  return SENSITIVE_HEADER_RE.test(key) ? '<redacted>' : value;
}

/**
 * 根据 fetch 参数生成一条 bash curl 命令，用于复现后端请求。
 * - Authorization 等敏感头自动替换为 <redacted>
 * - body 过长时截断，避免日志条目过大
 */
export function buildCurl(url: string, options: RequestInit, bodySummary?: string): string {
  const parts: string[] = ['curl'];
  const method = options.method ?? 'GET';
  if (method !== 'GET') {
    parts.push('-X', method);
  }

  if (options.headers) {
    for (const [key, value] of normalizeHeaders(options.headers)) {
      const safeValue = redactHeaderValue(key, value);
      parts.push(`-H '${escapeShell(key)}: ${escapeShell(safeValue)}'`);
    }
  }

  if (options.body !== undefined && options.body !== null) {
    const bodyString =
      typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
    if (bodySummary) {
      parts.push(`--data-raw '${escapeShell(bodySummary)}'`);
    } else {
      const truncated =
        bodyString.length > MAX_CURL_BODY_LENGTH
          ? bodyString.slice(0, MAX_CURL_BODY_LENGTH) + ' ... [truncated]'
          : bodyString;
      parts.push(`--data-raw '${escapeShell(truncated)}'`);
    }
  }

  parts.push(`'${escapeShell(url)}'`);
  return parts.join(' ');
}

/**
 * 判断地址是否已包含协议 / 域名
 */
export function isAbsoluteUrl(url: string): boolean {
  return ABSOLUTE_URL_RE.test(url.trim());
}

/**
 * 把 base（域名）与 endpoint（URI 或完整 URL）解析为最终请求地址。
 *
 * 规则：
 * - endpoint 带协议或 `//` 开头时，直接返回 endpoint；
 * - endpoint 为相对 URI 时，与 base 拼接，自动处理两侧斜杠。
 */
export function resolveEndpoint(base: string, endpoint: string): string {
  const trimmedEndpoint = endpoint.trim();
  if (!trimmedEndpoint) return '';

  if (isAbsoluteUrl(trimmedEndpoint)) {
    return trimmedEndpoint;
  }

  const trimmedBase = base.trim().replace(/\/+$/g, '');
  if (!trimmedBase) return trimmedEndpoint;

  const separator = trimmedEndpoint.startsWith('/') ? '' : '/';
  return `${trimmedBase}${separator}${trimmedEndpoint}`;
}

/**
 * 根据 ServerConfig 构造请求头。
 * - Authorization 头可通过 secret_header / secret_prefix 自定义
 * - headers 字段可覆盖默认头
 */
export function buildRequestHeaders(
  server: ServerConfig,
  defaults: Record<string, string>
): Headers {
  const headers = new Headers(defaults);

  const authHeaderName = server.secret_header?.trim() || 'Authorization';
  const authHeaderPrefix = server.secret_prefix?.trim() ?? 'Bearer';
  const authHeaderValue = authHeaderPrefix ? `${authHeaderPrefix} ${server.secret}` : server.secret;
  headers.set(authHeaderName, authHeaderValue);

  if (server.headers) {
    for (const [key, value] of Object.entries(server.headers)) {
      headers.set(key, value);
    }
  }

  return headers;
}

/**
 * 限流响应头（后端可选返回，扩展对每次后端响应做全局检查）
 * - X-RateLimit-Limit：每个限流窗口的总配额
 * - X-RateLimit-Remaining：当前窗口剩余可用次数
 * - X-RateLimit-Reset：配额重置时间（Unix 秒级时间戳）
 */
export const RATE_LIMIT_LIMIT_HEADER = 'X-RateLimit-Limit';
export const RATE_LIMIT_REMAINING_HEADER = 'X-RateLimit-Remaining';
export const RATE_LIMIT_RESET_HEADER = 'X-RateLimit-Reset';

/** 剩余额度不高于该值时记录告警日志 */
export const RATE_LIMIT_LOW_THRESHOLD = 5;

export interface RateLimitInfo {
  limit?: number;
  remaining: number;
  reset?: number;
}

function parseOptionalNumberHeader(headers: Headers, name: string): number | undefined {
  const raw = headers.get(name);
  if (raw === null || !raw.trim()) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

/**
 * 解析限流响应头；未返回 X-RateLimit-Remaining 或值非法时返回 null（不检查）。
 */
export function parseRateLimitHeaders(headers: Headers): RateLimitInfo | null {
  const remaining = parseOptionalNumberHeader(headers, RATE_LIMIT_REMAINING_HEADER);
  if (remaining === undefined) return null;

  const info: RateLimitInfo = { remaining };
  const limit = parseOptionalNumberHeader(headers, RATE_LIMIT_LIMIT_HEADER);
  if (limit !== undefined) info.limit = limit;
  const reset = parseOptionalNumberHeader(headers, RATE_LIMIT_RESET_HEADER);
  if (reset !== undefined) info.reset = reset;
  return info;
}

/**
 * 全局限流检查：所有后端请求的响应都会经过这里。
 * 额度用尽（<= 0）或接近阈值时写 warn 日志，不影响本次请求的结果。
 */
async function checkRateLimitHeaders(headers: Headers, operation: string): Promise<void> {
  const info = parseRateLimitHeaders(headers);
  if (!info) return;

  if (info.remaining <= 0) {
    await log.warn('API 额度已用尽', { operation, ...info });
  } else if (info.remaining <= RATE_LIMIT_LOW_THRESHOLD) {
    await log.warn('API 额度即将用尽', { operation, ...info });
  }
}

/**
 * 向后端创建商品接口提交数据。
 */
export async function submitCreateProduct(
  payload: CreateProductPayload,
  server: ServerConfig
): Promise<CreateProductSuccessResponse> {
  const url = resolveEndpoint(server.base, server.create_product_endpoint);
  if (!url) {
    throw new Error('创建商品接口地址未配置');
  }

  const timeoutMs = server.timeout_ms ?? 30000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const bodyString = JSON.stringify(payload);
  const requestOptions: RequestInit = {
    method: server.method ?? 'POST',
    headers: buildRequestHeaders(server, { 'Content-Type': 'application/json' }),
    body: bodyString,
    signal: controller.signal,
  };

  const bodySummary = JSON.stringify({
    platform: payload.platform,
    source_url: payload.source_url,
    source_product_id: payload.source_product_id,
    product: `...${bodyString.length} bytes`,
  });

  await log.info('发送创建商品请求', {
    url,
    method: requestOptions.method,
    headers: requestOptions.headers,
    payloadSummary: summarizePayload(payload),
    bodyBytes: bodyString.length,
    curl: buildCurl(url, requestOptions, bodySummary),
  });

  try {
    const res = await fetch(url, requestOptions);
    await checkRateLimitHeaders(res.headers, 'create_product');
    const text = await res.text();
    const preview = text.trim().slice(0, MAX_RESPONSE_PREVIEW);

    if (!res.ok) {
      let message = `请求失败：${res.status}`;
      if (preview) {
        try {
          const errorData = JSON.parse(text) as { message?: string };
          if (errorData.message) message = errorData.message;
        } catch {
          message += `（${preview}）`;
        }
      }
      await log.error('创建商品请求失败', {
        status: res.status,
        statusText: res.statusText,
        message,
        preview,
      });
      throw new Error(message);
    }

    if (!text.trim()) {
      throw new Error('后端返回空响应体');
    }

    let data: Partial<CreateProductSuccessResponse>;
    try {
      data = JSON.parse(text) as Partial<CreateProductSuccessResponse>;
    } catch {
      throw new Error(`后端返回不是合法 JSON：${preview}`);
    }

    if (!data.product_id || !data.log_id) {
      await log.error('后端返回格式异常', {
        responsePreview: preview,
        parsedKeys: Object.keys(data),
      });
      throw new Error('后端返回格式异常');
    }

    await log.info('创建商品请求成功', {
      status: res.status,
      product_id: data.product_id,
      log_id: data.log_id,
    });

    return {
      product_id: data.product_id,
      log_id: data.log_id,
      user: data.user ?? { id: '', name: '' },
      message: data.message,
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await log.error('创建商品请求异常', { error });
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 测试后端连接：请求 current_user_endpoint，验证鉴权与连通性。
 */
export async function testBackendConnection(server: ServerConfig): Promise<unknown> {
  const url = resolveEndpoint(server.base, server.current_user_endpoint);
  if (!url) {
    throw new Error('当前用户信息接口地址未配置');
  }

  const timeoutMs = server.timeout_ms ?? 30000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const requestOptions: RequestInit = {
    method: 'GET',
    headers: buildRequestHeaders(server, { Accept: 'application/json' }),
    signal: controller.signal,
  };

  await log.info('发送后端连接测试请求', {
    url,
    method: requestOptions.method,
    headers: requestOptions.headers,
    curl: buildCurl(url, requestOptions),
  });

  try {
    const res = await fetch(url, requestOptions);
    await checkRateLimitHeaders(res.headers, 'current_user');
    const text = await res.text();
    const preview = text.trim().slice(0, MAX_RESPONSE_PREVIEW);

    if (!res.ok) {
      let message = `连接失败：${res.status}`;
      if (preview) {
        try {
          const errorData = JSON.parse(text) as { message?: string };
          if (errorData.message) message = errorData.message;
        } catch {
          message += `（${preview}）`;
        }
      }
      await log.error('后端连接测试失败', {
        status: res.status,
        statusText: res.statusText,
        message,
        preview,
      });
      throw new Error(message);
    }

    if (!text.trim()) {
      throw new Error('后端返回空响应体');
    }

    try {
      const data = JSON.parse(text);
      await log.info('后端连接测试成功', { status: res.status });
      return data;
    } catch {
      throw new Error(`后端返回不是合法 JSON：${preview}`);
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await log.error('后端连接测试异常', { error });
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
