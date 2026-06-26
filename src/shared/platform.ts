/**
 * 平台识别
 *
 * 参考 PHP CrawlService.php 的探测流程：
 * 1. URL 规则初筛：TikTok / myshopify.com
 * 2. 对 /products/<handle> 页面，并发尝试 Shopify .json 与 NewShop /api/store/products/<handle>
 * 3. 若 API 都不命中，回退到 HTML 指纹探测（ShopLazza / ShopLine / ShopBase / XShopPy）
 *
 * 当前实现阶段：API 探测已覆盖 Shopify / NewShop；HTML 指纹探测为占位，后续补齐。
 */

import type { PlatformKey } from './schema';
import { createLogger } from './logger';

export interface PageStatus {
  url: string;
  platform: PlatformKey | null;
  canExtract: boolean;
  reason: string;
}

const log = createLogger('shared/platform');

const API_TIMEOUT_MS = 5000;

export function extractHandle(url: string): { host: string; handle: string | null } {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    const paths = u.pathname.split('/').filter(Boolean);
    const idx = paths.indexOf('products');
    const handle = idx >= 0 ? (paths[idx + 1] ?? null) : null;
    return { host, handle };
  } catch {
    return { host: '', handle: null };
  }
}

export function detectPlatformByUrl(url: string): PlatformKey | null {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    const path = u.pathname.toLowerCase();

    // TikTok Shop
    if (host.includes('tiktok.com') && path.includes('/view/product/')) {
      return 'tiktok';
    }
    if (host.includes('shop.tiktok.com')) {
      return 'tiktok';
    }

    // Shopify 官方托管域名
    if (host.endsWith('myshopify.com')) {
      return 'shopify';
    }

    return null;
  } catch {
    return null;
  }
}

async function fetchJson(url: string, options?: RequestInit): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    log.debug('平台 API 探测请求', { url });
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
      credentials: 'same-origin',
    });
    log.debug('平台 API 探测响应', { url, status: res.status, ok: res.ok });
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log.debug('平台 API 探测异常', { url, error });
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function detectPlatformByApi(url: string): Promise<PlatformKey | null> {
  const { host, handle } = extractHandle(url);
  if (!host || !handle) {
    log.debug('无法从 URL 提取 host/handle，跳过 API 探测', { url });
    return null;
  }

  const base = `https://${host}`;
  const shopifyUrl = `${base}/products/${handle}.json`;
  const newShopUrl = `${base}/api/store/products/${handle}`;

  log.debug('开始平台 API 探测', { url, shopifyUrl, newShopUrl });

  const [shopifyData, newShopData] = await Promise.all([
    fetchJson(shopifyUrl),
    fetchJson(newShopUrl),
  ]);

  // Shopify 返回 { product: ... }
  if (
    shopifyData &&
    typeof shopifyData === 'object' &&
    (shopifyData as Record<string, unknown>).product
  ) {
    log.info('API 探测命中 Shopify', { url, shopifyUrl });
    return 'shopify';
  }

  // NewShop / wshop 返回包含 ID 的对象
  if (
    newShopData &&
    typeof newShopData === 'object' &&
    (newShopData as Record<string, unknown>).ID
  ) {
    log.info('API 探测命中 NewShop', { url, newShopUrl });
    return 'newshop';
  }

  log.debug('API 探测未命中', { url, shopifyUrl, newShopUrl });
  return null;
}

function extractScriptSrcs(html: string): string[] {
  const srcs: string[] = [];
  const regex = /<script[^>]+src\s*=\s*["']([^"']+)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    srcs.push(match[1].toLowerCase());
  }
  return srcs;
}

function extractLinkHrefs(html: string): string[] {
  const hrefs: string[] = [];
  const regex = /<link[^>]+href\s*=\s*["']([^"']+)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    hrefs.push(match[1].toLowerCase());
  }
  return hrefs;
}

export function detectPlatformByHtml(html: string): PlatformKey | null {
  const srcs = extractScriptSrcs(html);

  // ShopLine：脚本 host 包含 myshopline.com
  if (srcs.some((src) => src.includes('myshopline.com'))) {
    return 'shopline';
  }

  // NewShop：脚本 host 包含 techcloudclub.com / cloudfastin.top / newfastcdn.com
  if (
    srcs.some(
      (src) =>
        src.includes('techcloudclub.com') ||
        src.includes('cloudfastin.top') ||
        src.includes('newfastcdn.com')
    )
  ) {
    return 'newshop';
  }

  // Shopify：脚本 URI 包含 cdn/shopifycloud、cdn.shopify.com 或 /cdn/shop/
  if (
    srcs.some(
      (src) =>
        src.includes('cdn/shopifycloud') ||
        src.includes('cdn.shopify.com') ||
        src.includes('/cdn/shop/')
    )
  ) {
    return 'shopify';
  }

  // WordPress：head 中 link href 包含 wp-content（主题/插件资源路径）
  const linkHrefs = extractLinkHrefs(html);
  if (linkHrefs.some((href) => href.includes('wp-content'))) {
    return 'wordpress';
  }

  // ShadowShop：脚本 host 包含 storedfilezone.com 或 plfaib.com
  if (srcs.some((src) => src.includes('storedfilezone.com') || src.includes('plfaib.com'))) {
    return 'shadowshop';
  }

  // ShopLazza：脚本 host 包含 shoplazza.com / staticdj.com，或页面存在 window.C_SETTINGS
  if (
    srcs.some((src) => src.includes('shoplazza.com') || src.includes('staticdj.com')) ||
    html.toLowerCase().includes('window.c_settings')
  ) {
    return 'shoplazza';
  }

  return null;
}

export async function detectPlatform(url: string, html?: string): Promise<PlatformKey | null> {
  // 1. 先按 URL 规则快速判断
  const byUrl = detectPlatformByUrl(url);
  if (byUrl) return byUrl;

  // 2. 通过页面引用的脚本 host / path 判断平台，不再主动调 API 探测
  if (html) {
    const byHtml = detectPlatformByHtml(html);
    if (byHtml) return byHtml;
  }

  return null;
}

export async function checkCanExtract(
  platform: PlatformKey | null
): Promise<{ canExtract: boolean; reason: string }> {
  if (!platform) {
    return { canExtract: false, reason: '未识别到受支持的平台' };
  }
  // 占位：默认认为可抓，后续由具体抓取器探测 DOM/API/注水对象
  return { canExtract: true, reason: '平台已识别，等待用户触发采集' };
}

export async function getPageStatus(url: string, html?: string): Promise<PageStatus> {
  const platform = await detectPlatform(url, html);
  const { canExtract, reason } = await checkCanExtract(platform);
  return { url, platform, canExtract, reason };
}
