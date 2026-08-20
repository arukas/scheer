/**
 * 1688（detail.1688.com）商品抓取器
 *
 * 1. 数据入口：内联 script `window.context=(function...)(window.contextPath, { ... })`，
 *    第二个实参即注水数据（result.data.* / result.global.globalData.model.*）。
 *    该对象是 JS 字面量而非严格 JSON（含未加引号的数字键，如 {5953855396376: {...}}），
 *    采用字符串感知平衡括号扫描截取后，数字键补引号再 JSON.parse（与 Amazon twister 同思路）。
 * 2. 详情 HTML：result.data.description.fields.detailUrl 指向 itemcdn.tmall.com，
 *    响应为 `var offer_details={"content":"..."}`；该 CDN 返回 CORS *，content script 可直接 fetch。
 * 3. 价格：1688 为批发阶梯价（skuPriceScale 如 "19.90-29.90"），SKU 级取
 *    skuInfoMap[].discountPrice ?? price；划线价仅在原始 price 更高时输出。
 */

import type {
  CreateProductPayload,
  PlatformCode,
  Product,
  ProductImage,
  ProductOption,
  ProductVariant,
  VariantOption,
} from '../schema';
import { extractAlibaba1688OfferIdFromUrl } from '../platform';
import { createLogger } from '../logger';
import { formatPrice } from '../price';

const log = createLogger('shared/extractors/alibaba1688');

type RawObject = Record<string, unknown>;

const CONTEXT_MARKER = 'window.context=';
const CONTEXT_ANCHOR = 'contextPath,';
const DETAIL_PREFIX_RE = /^[^=]*=\s*/;

// ============================================================================
// 基础工具
// ============================================================================

function parseJsonSafely(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function toStringOrUndefined(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  return String(value);
}

function toNumberOrUndefined(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeSrc(src: string): string {
  if (src.startsWith('http:') || src.startsWith('https:')) return src;
  if (src.startsWith('//')) return `https:${src}`;
  return src;
}

function asObject(value: unknown): RawObject | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as RawObject)
    : undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** 按路径逐层取值，任一环节缺失返回 undefined */
function getPath(obj: unknown, ...path: string[]): unknown {
  let current: unknown = obj;
  for (const key of path) {
    current = asObject(current)?.[key];
    if (current === undefined) return undefined;
  }
  return current;
}

/**
 * 字符串感知的平衡括号扫描。
 * 从 text[start]（须为 { 或 [）开始，返回括号配平的子串；失败返回 null。
 */
function scanBalanced(text: string, start: number): string | null {
  const stack: string[] = [];
  let inStr = false;
  let quote = '';
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) inStr = false;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inStr = true;
      quote = ch;
    } else if (ch === '{' || ch === '[') {
      stack.push(ch);
    } else if (ch === '}' || ch === ']') {
      const open = stack.pop();
      if (!open) return null;
      if (stack.length === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

// ============================================================================
// window.context 注水对象解析
// ============================================================================

/**
 * 从内联 script 中提取 window.context 注水对象。
 * 数字键补引号的正则不感知字符串字面量，但实测 blob 中字符串值不含 `{数字:` 形态，可接受。
 */
function readContextObject(doc: Document): RawObject {
  const scripts = doc.querySelectorAll('script');

  for (const script of Array.from(scripts)) {
    const text = script.textContent ?? '';
    const markerIdx = text.indexOf(CONTEXT_MARKER);
    if (markerIdx === -1) continue;

    const anchorIdx = text.indexOf(CONTEXT_ANCHOR, markerIdx);
    if (anchorIdx === -1) continue;

    let i = anchorIdx + CONTEXT_ANCHOR.length;
    while (i < text.length && ' \n\t'.includes(text[i])) i++;
    if (text[i] !== '{') continue;

    const blob = scanBalanced(text, i);
    if (!blob) {
      throw new Error('window.context 注水对象括号扫描失败');
    }

    const fixed = blob.replace(/([{,])(\s*)(\d+):/g, '$1$2"$3":');
    const parsed = parseJsonSafely(fixed);
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('window.context 注水对象不是有效 JSON');
    }

    log.debug('解析 window.context 注水对象成功');
    return parsed as RawObject;
  }

  throw new Error('页面未找到 window.context 注水脚本');
}

// ============================================================================
// 详情 HTML（itemcdn.tmall.com 二次请求）
// ============================================================================

/** 清洗详情 HTML：懒加载属性并入 src，协议相对 URL 补 https: */
function cleanDetailHtml(doc: Document, html: string): string {
  const container = doc.createElement('div');
  container.innerHTML = html;

  for (const img of Array.from(container.querySelectorAll('img'))) {
    const lazy =
      img.getAttribute('data-src') ??
      img.getAttribute('data-original') ??
      img.getAttribute('data-lazy-src');
    const src = img.getAttribute('src');
    if (lazy && (!src || src.startsWith('data:'))) {
      img.setAttribute('src', lazy);
    }
    img.removeAttribute('data-src');
    img.removeAttribute('data-original');
    img.removeAttribute('data-lazy-src');
  }
  for (const el of Array.from(container.querySelectorAll('[src], [href]'))) {
    for (const attr of ['src', 'href'] as const) {
      const value = el.getAttribute(attr);
      if (value?.startsWith('//')) el.setAttribute(attr, `https:${value}`);
    }
  }
  return container.innerHTML;
}

/** 拉取详情 HTML；失败不阻断整体采集，仅告警并返回 undefined */
async function fetchDescriptionHtml(
  detailUrl: string | undefined,
  doc: Document
): Promise<string | undefined> {
  if (!detailUrl) return undefined;

  try {
    const res = await fetch(detailUrl, { credentials: 'omit' });
    if (!res.ok) {
      log.warn('详情请求失败', { detailUrl, status: res.status });
      return undefined;
    }
    const text = await res.text();
    // 响应形如 var offer_details={"content":"..."}，剥掉赋值前缀
    const jsonText = text.replace(DETAIL_PREFIX_RE, '').replace(/;\s*$/, '');
    const parsed = asObject(parseJsonSafely(jsonText));
    const content = toStringOrUndefined(parsed?.content);
    if (!content) {
      log.warn('详情响应中未找到 content 字段', { detailUrl });
      return undefined;
    }
    return cleanDetailHtml(doc, content);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log.warn('详情获取异常', { detailUrl, error });
    return undefined;
  }
}

// ============================================================================
// 字段转换
// ============================================================================

/** specAttrs 形如 "粉色&gt;80cm"，需解码 HTML 实体后按 > 拆分 */
function splitSpecAttrs(specAttrs: unknown): string[] {
  const raw = toStringOrUndefined(specAttrs);
  if (!raw) return [];
  const decoded = raw.replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&');
  return decoded.split('>').map((s) => s.trim());
}

interface SkuPropValue {
  name: string;
  imageUrl?: string;
}

interface SkuProp {
  name: string;
  values: SkuPropValue[];
}

function readSkuProps(offerDetail: RawObject | undefined): SkuProp[] {
  const result: SkuProp[] = [];
  for (const raw of asArray(offerDetail?.skuProps)) {
    const prop = asObject(raw);
    const name = toStringOrUndefined(prop?.prop);
    if (!name) continue;
    const values: SkuPropValue[] = [];
    for (const v of asArray(prop?.value)) {
      const value = asObject(v);
      const valueName = toStringOrUndefined(value?.name);
      if (!valueName) continue;
      values.push({ name: valueName, imageUrl: toStringOrUndefined(value?.imageUrl) });
    }
    result.push({ name, values });
  }
  return result;
}

function convertOptions(skuProps: SkuProp[]): ProductOption[] {
  return skuProps.map((prop, idx) => ({
    name: prop.name,
    position: idx + 1,
    values: prop.values.map((v) => v.name),
  }));
}

function convertImages(
  offerDetail: RawObject | undefined,
  data: RawObject | undefined
): ProductImage[] {
  const srcs: string[] = [];

  // 优先 imageList（主图 + SKU 图全集，主图在前；实测 = mainImageList 5 张 + 色卡图 7 张），
  // 回退 mainImageList（仅主图），再回退 gallery.offerImgList（字符串数组）
  const lists = [offerDetail?.imageList, offerDetail?.mainImageList];
  for (const list of lists) {
    for (const item of asArray(list)) {
      const src = toStringOrUndefined(asObject(item)?.fullPathImageURI);
      if (src) srcs.push(normalizeSrc(src));
    }
    if (srcs.length > 0) break;
  }
  if (srcs.length === 0) {
    for (const item of asArray(getPath(data, 'gallery', 'fields', 'offerImgList'))) {
      const src = toStringOrUndefined(item);
      if (src) srcs.push(normalizeSrc(src));
    }
  }

  // 去重保持顺序
  const seen = new Set<string>();
  return srcs
    .filter((src) => (seen.has(src) ? false : (seen.add(src), true)))
    .map((src, idx) => ({
      source_image_id: String(idx + 1),
      position: idx + 1,
      src,
      type: 'image' as const,
    }));
}

function convertVariants(
  skuModel: RawObject | undefined,
  options: ProductOption[],
  skuProps: SkuProp[],
  images: ProductImage[],
  grams: number,
  weight: number | undefined
): ProductVariant[] {
  const skuInfoMap = asObject(skuModel?.skuInfoMap) ?? {};
  const entries = Object.values(skuInfoMap);

  // 第一维度（通常是颜色）色卡图：value 名 → imageUrl → images 中的 source_image_id
  const imageByValueName = new Map<string, string>();
  const firstProp = skuProps[0];
  if (firstProp) {
    for (const v of firstProp.values) {
      if (!v.imageUrl) continue;
      const matched = images.find((img) => img.src === normalizeSrc(v.imageUrl ?? ''));
      if (matched?.source_image_id) imageByValueName.set(v.name, matched.source_image_id);
    }
  }

  return entries
    .map((raw, idx): ProductVariant | null => {
      const entry = asObject(raw);
      if (!entry) return null;

      const values = splitSpecAttrs(entry.specAttrs);
      const variantOptions: VariantOption[] = options.map((opt, optIdx) => ({
        name: opt.name,
        value: values[optIdx] ?? '',
      }));

      const price = formatPrice(entry.discountPrice ?? entry.price);
      const rawPrice = toNumberOrUndefined(entry.price);
      const sellPrice = toNumberOrUndefined(price);
      const compareAt =
        rawPrice !== undefined && sellPrice !== undefined && rawPrice > sellPrice
          ? rawPrice.toFixed(2)
          : undefined;

      const skuId = toStringOrUndefined(entry.skuId);
      const specId = toStringOrUndefined(entry.specId);
      const title = values.filter((v) => v.length > 0).join(' / ') || `Variant ${idx + 1}`;

      return {
        source_variant_id: skuId ?? specId,
        position: idx + 1,
        title,
        price,
        compare_at_price: compareAt,
        sku: skuId,
        options: variantOptions,
        source_image_id: imageByValueName.get(values[0] ?? ''),
        grams,
        weight: weight ?? null,
        weight_unit: weight !== undefined ? 'kg' : null,
      };
    })
    .filter((v): v is ProductVariant => v !== null);
}

/** 无 SKU 商品兜底：取 tradeModel 当前阶梯价首档 */
function buildFallbackVariant(
  model: RawObject | undefined,
  grams: number,
  weight: number | undefined
): ProductVariant {
  const tradeModel = asObject(model?.tradeModel);
  const currentPrices = asArray(getPath(tradeModel, 'offerPriceModel', 'currentPrices'));
  const firstPrice = toStringOrUndefined(asObject(currentPrices[0])?.price);
  const price = formatPrice(firstPrice ?? tradeModel?.minPrice ?? tradeModel?.maxPrice);

  return {
    position: 1,
    title: 'Default Title',
    price,
    options: [{ name: 'Title', value: 'Default Title' }],
    grams,
    weight: weight ?? null,
    weight_unit: weight !== undefined ? 'kg' : null,
  };
}

// ============================================================================
// 主入口
// ============================================================================

export async function extractAlibaba1688Product(
  url: string,
  doc: Document
): Promise<CreateProductPayload> {
  const context = readContextObject(doc);

  const data = asObject(getPath(context, 'result', 'data'));
  const model = asObject(getPath(context, 'result', 'global', 'globalData', 'model'));
  const offerDetail = asObject(model?.offerDetail);

  const title = toStringOrUndefined(offerDetail?.subject);
  if (!title) {
    throw new Error('window.context 中未找到商品标题（offerDetail.subject）');
  }

  const offerId =
    extractAlibaba1688OfferIdFromUrl(url) ?? toStringOrUndefined(offerDetail?.offerId);

  // 件重：productPackInfo.unitWeight 单位为 kg（0.100 → 100g）
  const unitWeight = toNumberOrUndefined(getPath(data, 'productPackInfo', 'fields', 'unitWeight'));
  const grams = unitWeight !== undefined ? Math.round(unitWeight * 1000) : 0;

  const skuProps = readSkuProps(offerDetail);
  const options = convertOptions(skuProps);
  const images = convertImages(offerDetail, data);

  const skuModel = asObject(getPath(data, 'Root', 'fields', 'dataJson', 'skuModel'));
  let variants = convertVariants(skuModel, options, skuProps, images, grams, unitWeight);
  if (variants.length === 0) {
    variants = [buildFallbackVariant(model, grams, unitWeight)];
  }

  const detailUrl = toStringOrUndefined(getPath(data, 'description', 'fields', 'detailUrl'));
  const descriptionHtml = await fetchDescriptionHtml(detailUrl, doc);

  const vendor = toStringOrUndefined(
    getPath(data, 'productTitle', 'fields', 'shopInfo', 'companyName')
  );
  const productType = toStringOrUndefined(offerDetail?.leafCategoryName);

  const platform: PlatformCode = 'alibaba1688';

  const product: Product = {
    title,
    description_html: descriptionHtml,
    vendor: vendor || undefined,
    product_type: productType || undefined,
    options,
    variants,
    images,
  };

  return {
    platform,
    source_url: url,
    source_product_id: offerId,
    product,
  };
}
