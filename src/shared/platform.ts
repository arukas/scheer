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

function extractScriptSrcs(html: string): string[] {
  const srcs: string[] = [];
  const regex = /<script[^>]+src\s*=\s*["']([^"']+)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    srcs.push(match[1].toLowerCase());
  }
  return srcs;
}

export function detectPlatformByHtml(html: string): PlatformKey | null {
  const srcs = extractScriptSrcs(html);

  // ShopLine：脚本 host 包含 myshopline.com
  if (srcs.some((src) => src.includes('myshopline.com'))) {
    return 'shopline';
  }

  // NewShop：脚本 host 包含 techcloudclub.com
  if (srcs.some((src) => src.includes('techcloudclub.com'))) {
    return 'newshop';
  }

  // Shopify：脚本 URI 包含 cdn/shopifycloud（或通用 Shopify CDN）
  if (srcs.some((src) => src.includes('cdn/shopifycloud') || src.includes('cdn.shopify.com'))) {
    return 'shopify';
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
