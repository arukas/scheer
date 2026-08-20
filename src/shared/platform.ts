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
import { t } from './i18n';

export interface PageStatus {
  url: string;
  platform: PlatformKey | null;
  canExtract: boolean;
  reason: string;
}

const log = createLogger('shared/platform');

const API_TIMEOUT_MS = 5000;

const PRODUCT_PATH_SEGMENTS = ['products', 'product'];

/** Amazon ASIN：10 位字母数字（书籍为 10 位 ISBN） */
const AMAZON_ASIN_RE = /^[A-Z0-9]{10}$/;

/** 1688 商品详情页路径：/offer/<数字 offerId>.html */
const ALIBABA1688_OFFER_RE = /^\/offer\/(\d+)\.html$/i;

/**
 * 判断是否为 1688 商品详情站 host。
 * 目前仅支持 detail.1688.com（PC 详情页），m.1688.com 等移动端页面结构不同，暂不支持。
 */
export function isAlibaba1688Host(host: string): boolean {
  return host.toLowerCase() === 'detail.1688.com';
}

/**
 * 从 1688 URL 提取 offerId。形态：/offer/<offerId>.html（query 参数不影响）。
 * 未命中返回 null。
 */
export function extractAlibaba1688OfferIdFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (!isAlibaba1688Host(u.hostname)) return null;
    const match = u.pathname.match(ALIBABA1688_OFFER_RE);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

function isTikTokHost(host: string): boolean {
  const h = host.toLowerCase();
  return h.includes('tiktok') || h.includes('.tk');
}

/**
 * Amazon 站点域名白名单（含国际站；amazon.co.uk 形态的双段后缀无法用
 * 正则与 amazon.evil.com 之类的仿冒域名区分，故显式枚举）。
 */
const AMAZON_DOMAINS = [
  'amazon.com',
  'amazon.ca',
  'amazon.com.mx',
  'amazon.com.br',
  'amazon.co.uk',
  'amazon.de',
  'amazon.fr',
  'amazon.it',
  'amazon.es',
  'amazon.nl',
  'amazon.se',
  'amazon.pl',
  'amazon.com.be',
  'amazon.ie',
  'amazon.com.tr',
  'amazon.ae',
  'amazon.sa',
  'amazon.eg',
  'amazon.in',
  'amazon.co.jp',
  'amazon.sg',
  'amazon.com.au',
  'amazon.co.za',
  'amazon.cn',
];

/**
 * 判断是否为 Amazon 站点 host（含 www./smile./m. 等各级子域名）。
 */
export function isAmazonHost(host: string): boolean {
  const h = host.toLowerCase();
  return AMAZON_DOMAINS.some((domain) => h === domain || h.endsWith(`.${domain}`));
}

/**
 * 从 Amazon URL 提取 ASIN。支持形态：
 * - /dp/<ASIN>
 * - /gp/product/<ASIN>
 * - /<slug>/dp/<ASIN>
 * 未命中返回 null。
 */
export function extractAmazonAsinFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const paths = u.pathname.split('/').filter(Boolean);
    for (let i = 0; i < paths.length - 1; i++) {
      const segment = paths[i].toLowerCase();
      const isAsinSlot =
        segment === 'dp' || (segment === 'gp' && paths[i + 1]?.toLowerCase() === 'product');
      if (!isAsinSlot) continue;
      const candidate = segment === 'dp' ? paths[i + 1] : paths[i + 2];
      if (candidate && AMAZON_ASIN_RE.test(candidate)) return candidate;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 判断 URL 是否处于扩展支持的采集范围。
 * - 仅允许 https 页面
 * - 路径需包含 /products/ 或 /product/
 * - TikTok 相关域名（host 含 tiktok 或 .tk）豁免路径检查
 * - Amazon 站点（含国际站）要求 /dp/<ASIN> 或 /gp/product/<ASIN>
 * - 1688（detail.1688.com）要求 /offer/<offerId>.html
 */
export function isAllowedProductUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;

    const host = u.hostname.toLowerCase();
    if (isTikTokHost(host)) return true;
    if (isAmazonHost(host)) return extractAmazonAsinFromUrl(url) !== null;
    if (isAlibaba1688Host(host)) return extractAlibaba1688OfferIdFromUrl(url) !== null;

    const path = u.pathname.toLowerCase();
    return path.includes('/products/') || path.includes('/product/');
  } catch {
    return false;
  }
}

export function extractHandle(url: string): { host: string; handle: string | null } {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    const paths = u.pathname.split('/').filter(Boolean);

    for (const segment of PRODUCT_PATH_SEGMENTS) {
      const idx = paths.indexOf(segment);
      if (idx >= 0) {
        const handle = paths[idx + 1] ?? null;
        if (handle) return { host, handle };
      }
    }

    return { host, handle: null };
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

    // Amazon（含国际站），需为商品详情页
    if (isAmazonHost(host) && extractAmazonAsinFromUrl(url) !== null) {
      return 'amazon';
    }

    // 1688 商品详情页 /offer/<offerId>.html
    if (isAlibaba1688Host(host) && extractAlibaba1688OfferIdFromUrl(url) !== null) {
      return 'alibaba1688';
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

/**
 * @deprecated 当前平台探测主流程不再主动调用店铺 API，避免在未知站点上产生多余请求。
 * 保留此函数仅用于历史兼容与单元测试，后续如重新启用需评估隐私与性能影响。
 */
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

  // ShopLazza：脚本 host 包含 staticdj.com
  if (srcs.some((src) => src.includes('staticdj.com'))) {
    return 'shoplazza';
  }

  // ShopBase：脚本 host 包含 thesitebase.net
  if (srcs.some((src) => src.includes('thesitebase.net'))) {
    return 'shopbase';
  }

  // Amazon：页面引用其 CDN 资源或 UI 框架（放在最后，避免抢占其它平台指纹）
  if (
    html.includes('images-na.ssl-images-amazon.com') ||
    html.includes('m.media-amazon.com') ||
    html.includes('AmazonUI')
  ) {
    return 'amazon';
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
    return { canExtract: false, reason: t('unsupportedPlatform') };
  }
  // 占位：默认认为可抓，后续由具体抓取器探测 DOM/API/注水对象
  return { canExtract: true, reason: t('platformRecognized') };
}

export async function getPageStatus(url: string, html?: string): Promise<PageStatus> {
  if (!isAllowedProductUrl(url)) {
    return {
      url,
      platform: null,
      canExtract: false,
      reason: t('pageOutOfScope'),
    };
  }

  const platform = await detectPlatform(url, html);
  const { canExtract, reason } = await checkCanExtract(platform);
  return { url, platform, canExtract, reason };
}
