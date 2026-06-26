/**
 * ShopLazza 商品抓取器
 *
 * 1. 从页面读取 window.C_SETTINGS（或从 <script> 标签解析）。
 * 2. 取 meta.page.resource_id 作为商品 ID。
 * 3. 请求 /api/product/list?ids[]=RESOURCE_ID&limit=1&page=1 取商品数据。
 * 4. 转换为通用 Product。
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
import { extractHandle } from '../platform';
import { fetchJson } from '../fetch';
import { createLogger } from '../logger';

const log = createLogger('shared/extractors/shoplazza');

const API_TIMEOUT_MS = 10000;

type RawObject = Record<string, unknown>;

function toStringOrUndefined(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  return String(value);
}

function toNumberOrUndefined(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'number') return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeSrc(src: string): string {
  if (src.startsWith('http:') || src.startsWith('https:')) return src;
  if (src.startsWith('//')) return `https:${src}`;
  return src;
}

function parseJsonSafely(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function readCSettingsFromWindow(): unknown {
  const win = typeof window !== 'undefined' ? (window as unknown as RawObject) : undefined;
  return win?.C_SETTINGS;
}

/**
 * 从 <script> 标签文本中解析 window.C_SETTINGS。
 * 这里用平衡括号找到赋值后的对象字面量。
 */
function extractCSettingsFromScript(text: string): unknown {
  const marker = 'window.C_SETTINGS';
  let idx = text.indexOf(marker);
  if (idx < 0) idx = text.toLowerCase().indexOf('window.c_settings');
  if (idx < 0) return undefined;

  let cursor = idx + marker.length;
  const end = text.length;
  while (cursor < end && /\s|=/.test(text[cursor])) cursor++;
  if (cursor >= end || text[cursor] !== '{') return undefined;

  let depth = 0;
  let inString = false;
  let stringChar = '';
  let escape = false;
  const start = cursor;

  for (; cursor < end; cursor++) {
    const ch = text[cursor];
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === '\\') {
        escape = true;
        continue;
      }
      if (ch === stringChar) {
        inString = false;
      }
      continue;
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      inString = true;
      stringChar = ch;
      continue;
    }

    if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        cursor++;
        break;
      }
    }
  }

  const jsonText = text.slice(start, cursor);
  return parseJsonSafely(jsonText);
}

function readCSettingsFromDoc(doc?: Document): unknown {
  if (!doc) return undefined;
  const scripts = doc.querySelectorAll('script');
  for (const script of scripts) {
    const text = script.textContent ?? '';
    const settings = extractCSettingsFromScript(text);
    if (settings !== undefined) return settings;
  }
  return undefined;
}

function getCSettings(doc?: Document): RawObject {
  // 页面初始化后 window.C_SETTINGS 可能被删除，优先从 <script> 标签解析
  const fromDoc = readCSettingsFromDoc(doc);
  if (fromDoc && typeof fromDoc === 'object') {
    log.debug('从 <script> 标签解析到 window.C_SETTINGS');
    return fromDoc as RawObject;
  }

  const fromWindow = readCSettingsFromWindow();
  if (fromWindow && typeof fromWindow === 'object') {
    log.debug('从 window.C_SETTINGS 读取到数据');
    return fromWindow as RawObject;
  }

  throw new Error('页面未找到 window.C_SETTINGS');
}

function extractResourceId(settings: RawObject): string {
  const meta = (settings.meta ?? {}) as RawObject;
  const page = (meta.page ?? {}) as RawObject;
  const resourceId = toStringOrUndefined(page.resource_id);
  if (!resourceId) {
    throw new Error('window.C_SETTINGS 中未找到 meta.page.resource_id');
  }
  return resourceId;
}

async function fetchShoplazzaProduct(url: string, resourceId: string): Promise<unknown> {
  const apiUrl = new URL('/api/product/list', url);
  apiUrl.searchParams.append('ids[]', resourceId);
  apiUrl.searchParams.set('limit', '1');
  apiUrl.searchParams.set('page', '1');

  log.debug('请求 ShopLazza 商品 API', { url: apiUrl.toString() });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  try {
    return await fetchJson(apiUrl.toString(), {
      signal: controller.signal,
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
  } finally {
    clearTimeout(timer);
  }
}

function findProductList(data: unknown): RawObject[] {
  if (!data || typeof data !== 'object') return [];
  const root = data as RawObject;

  // 常见包装：{ data: { products: [...] } } 或 { data: { list: [...] } } 或 { data: [...] }
  const candidates: unknown[] = [
    root.data,
    (root.data as RawObject)?.products,
    (root.data as RawObject)?.list,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate) && candidate.length > 0) {
      return candidate as RawObject[];
    }
    if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
      // 尝试取对象里第一个数组
      for (const value of Object.values(candidate as RawObject)) {
        if (Array.isArray(value) && value.length > 0) {
          return value as RawObject[];
        }
      }
    }
  }

  return [];
}

function convertTags(tags: unknown): string[] | undefined {
  if (Array.isArray(tags)) return tags.map(String);
  if (typeof tags === 'string') {
    const trimmed = tags.trim();
    return trimmed ? trimmed.split(',').map((t) => t.trim()) : [];
  }
  return undefined;
}

function convertOptions(options: RawObject[]): ProductOption[] {
  if (!Array.isArray(options)) return [];
  return options.map((opt, idx) => ({
    name: String(opt.name ?? `Option ${idx + 1}`),
    position: idx + 1,
    values: Array.isArray(opt.values) ? opt.values.map(String) : [],
  }));
}

function buildVariantOptions(v: RawObject, productOptions: ProductOption[]): VariantOption[] {
  const rawKeys = ['option1', 'option2', 'option3'] as const;

  if (productOptions.length > 0) {
    return productOptions.map((opt, idx) => {
      const rawValue = v[rawKeys[idx]] as unknown;
      return {
        name: opt.name,
        value: toStringOrUndefined(rawValue) ?? '',
      };
    });
  }

  return rawKeys
    .map((key, idx) => {
      const value = toStringOrUndefined(v[key]);
      if (value == null) return null;
      return { name: `Option ${idx + 1}`, value };
    })
    .filter((item): item is VariantOption => item !== null);
}

function gramsFromWeight(weight: unknown, unit: unknown): number {
  const num = toNumberOrUndefined(weight);
  if (num === undefined) return 0;
  const u = String(unit ?? '').toLowerCase();
  if (u === 'kg') return Math.round(num * 1000);
  if (u === 'g') return Math.round(num);
  if (u === 'lb') return Math.round(num * 453.59237);
  if (u === 'oz') return Math.round(num * 28.3495);
  return 0;
}

function convertImages(rawImages: unknown[]): ProductImage[] {
  if (!Array.isArray(rawImages)) return [];

  const result: ProductImage[] = [];
  for (let idx = 0; idx < rawImages.length; idx++) {
    const item = rawImages[idx];
    if (!item || typeof item !== 'object') continue;
    const img = item as RawObject;
    const src = toStringOrUndefined(img.src ?? img.url ?? img.image);
    if (!src) continue;

    result.push({
      source_image_id: img.id != null ? String(img.id) : String(idx + 1),
      position: idx + 1,
      src: normalizeSrc(src),
      alt: toStringOrUndefined(img.alt),
      type: img.type === 'video' ? ('video' as const) : ('image' as const),
    });
  }
  return result;
}

function convertVariants(variants: RawObject[], productOptions: ProductOption[]): ProductVariant[] {
  if (!Array.isArray(variants)) return [];
  return variants.map((v, idx) => ({
    source_variant_id: v.id != null ? String(v.id) : undefined,
    position: idx + 1,
    title: String(v.title ?? `Variant ${idx + 1}`),
    price: (toNumberOrUndefined(v.price) ?? 0).toFixed(2),
    compare_at_price:
      v.compare_at_price != null
        ? (toNumberOrUndefined(v.compare_at_price) ?? 0).toFixed(2)
        : undefined,
    sku: toStringOrUndefined(v.sku),
    barcode: toStringOrUndefined(v.barcode),
    options: buildVariantOptions(v, productOptions),
    grams: gramsFromWeight(v.weight, v.weight_unit),
    weight: toNumberOrUndefined(v.weight) ?? null,
    weight_unit: toStringOrUndefined(v.weight_unit),
  }));
}

function convertProduct(raw: RawObject, url: string): Product {
  const productOptions = convertOptions((raw.options ?? []) as RawObject[]);
  const images = convertImages((raw.images ?? []) as unknown[]);
  let variants = convertVariants((raw.variants ?? []) as RawObject[], productOptions);

  // 无变体时兜底
  if (variants.length === 0) {
    variants = [
      {
        position: 1,
        title: 'Default Title',
        price: (toNumberOrUndefined(raw.price) ?? 0).toFixed(2),
        compare_at_price:
          raw.compare_at_price != null
            ? (toNumberOrUndefined(raw.compare_at_price) ?? 0).toFixed(2)
            : undefined,
        sku: toStringOrUndefined(raw.sku),
        barcode: toStringOrUndefined(raw.barcode),
        options: [{ name: 'Title', value: 'Default Title' }],
        grams: gramsFromWeight(raw.weight, raw.weight_unit),
        weight: toNumberOrUndefined(raw.weight) ?? null,
        weight_unit: toStringOrUndefined(raw.weight_unit),
      },
    ];
  }

  // 单 variant 且无有效 option 时强制 Default Title
  if (variants.length === 1 && variants[0].options.length === 0) {
    variants[0].options = [{ name: 'Title', value: 'Default Title' }];
  }

  return {
    title: String(raw.title ?? raw.name ?? ''),
    handle: toStringOrUndefined(raw.handle) ?? extractHandle(url).handle ?? undefined,
    description_html: toStringOrUndefined(raw.description ?? raw.body_html),
    vendor: toStringOrUndefined(raw.vendor) || undefined,
    product_type: toStringOrUndefined(raw.product_type ?? raw.type),
    tags: convertTags(raw.tags),
    options: productOptions,
    published_scope: undefined,
    variants,
    images,
  };
}

export async function extractShoplazzaProduct(
  url: string,
  doc?: Document
): Promise<CreateProductPayload> {
  const settings = getCSettings(doc);
  const resourceId = extractResourceId(settings);
  const data = await fetchShoplazzaProduct(url, resourceId);

  const products = findProductList(data);
  if (products.length === 0) {
    throw new Error('ShopLazza API 未返回商品数据');
  }

  const rawProduct = products[0];
  const platform: PlatformCode = 'shoplazza';

  return {
    platform,
    source_url: url,
    source_product_id: toStringOrUndefined(rawProduct.id) ?? resourceId,
    product: convertProduct(rawProduct, url),
  };
}
