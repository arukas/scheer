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

export interface PageStatus {
  url: string;
  platform: PlatformKey | null;
  canExtract: boolean;
  reason: string;
}

const API_TIMEOUT_MS = 5000;

export function extractHandle(url: string): { host: string; handle: string | null } {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    const paths = u.pathname.split('/').filter(Boolean);
    const idx = paths.indexOf('products');
    const handle = idx >= 0 ? paths[idx + 1] ?? null : null;
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
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
      credentials: 'same-origin',
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function detectPlatformByApi(url: string): Promise<PlatformKey | null> {
  const { host, handle } = extractHandle(url);
  if (!host || !handle) return null;

  const base = `https://${host}`;
  const shopifyUrl = `${base}/products/${handle}.json`;
  const newShopUrl = `${base}/api/store/products/${handle}`;

  const [shopifyData, newShopData] = await Promise.all([
    fetchJson(shopifyUrl),
    fetchJson(newShopUrl),
  ]);

  // Shopify 返回 { product: ... }
  if (shopifyData && typeof shopifyData === 'object' && (shopifyData as Record<string, unknown>).product) {
    return 'shopify';
  }

  // NewShop / wshop 返回包含 ID 的对象
  if (newShopData && typeof newShopData === 'object' && (newShopData as Record<string, unknown>).ID) {
    return 'newshop';
  }

  return null;
}

export function detectPlatformByHtml(html: string): PlatformKey | null {
  const text = html.toLowerCase();

  // ShopLine：主世界注水对象、Shopline 全局变量、ShopLine CDN / section
  if (
    text.includes('__preload_state__') ||
    text.includes('window.shopline') ||
    text.includes('myshopline.com') ||
    text.includes('shopline-section-')
  ) {
    return 'shopline';
  }

  // ShopBase
  if (text.includes('__initial_state__')) {
    return 'shopbase';
  }

  // ShopLazza
  if (text.includes('shoplazza') || text.includes('name="product_id"')) {
    return 'shoplazza';
  }

  // XShopPy
  if (text.includes('input.product-id') || text.includes('pagecontainer.j-pagecontainer')) {
    return 'xshoppy';
  }

  return null;
}

export async function detectPlatform(url: string, html?: string): Promise<PlatformKey | null> {
  // 1. 先按 URL 规则快速判断
  const byUrl = detectPlatformByUrl(url);
  if (byUrl) return byUrl;

  // 2. 有 HTML 时优先做 HTML 指纹探测，避免把 ShopLine 误判去请求 Shopify .json
  if (html) {
    const byHtml = detectPlatformByHtml(html);
    if (byHtml) return byHtml;
  }

  // 3. 对 /products/<handle> 页面用 API 探测（Shopify / NewShop）
  const { handle } = extractHandle(url);
  if (handle) {
    const byApi = await detectPlatformByApi(url);
    if (byApi) return byApi;
  }

  return null;
}

export async function checkCanExtract(
  platform: PlatformKey | null,
  _url: string
): Promise<{ canExtract: boolean; reason: string }> {
  if (!platform) {
    return { canExtract: false, reason: '未识别到受支持的平台' };
  }
  // 占位：默认认为可抓，后续由具体抓取器探测 DOM/API/注水对象
  return { canExtract: true, reason: '平台已识别，等待用户触发采集' };
}

export async function getPageStatus(url: string, html?: string): Promise<PageStatus> {
  const platform = await detectPlatform(url, html);
  const { canExtract, reason } = await checkCanExtract(platform, url);
  return { url, platform, canExtract, reason };
}
