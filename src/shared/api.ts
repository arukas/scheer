/**
 * 后端请求工具
 *
 * - 支持 domain + URI 拼接与完整 URL 直接请求
 * - 用于创建商品、获取当前用户等接口
 */

import type {
  CreateProductPayload,
  CreateProductSuccessResponse,
  CreateProductErrorResponse,
  ServerConfig,
} from './schema';

const ABSOLUTE_URL_RE = /^([a-z][a-z0-9+.-]*:)?\/\//i;

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

  try {
    const res = await fetch(url, {
      method: server.method ?? 'POST',
      headers: {
        Authorization: `Bearer ${server.secret}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (res.ok) {
      const data = (await res.json()) as Partial<CreateProductSuccessResponse>;
      if (!data.product_id || !data.log_id) {
        throw new Error('后端返回格式异常');
      }
      return {
        product_id: data.product_id,
        log_id: data.log_id,
        user: data.user ?? { id: '', name: '' },
        message: data.message,
      };
    }

    const errorData = (await res.json().catch(() => ({}))) as Partial<CreateProductErrorResponse>;
    throw new Error(errorData.message ?? `请求失败：${res.status}`);
  } finally {
    clearTimeout(timer);
  }
}
