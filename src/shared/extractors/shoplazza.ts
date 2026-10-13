/**
 * ShopLazza 商品抓取器
 *
 * 1. 从 <script id="product-json" data-id="..."> 读取商品 ID。
 * 2. 请求 /api/product/list?ids[]=ID&limit=1&page=1 取商品数据。
 * 3. 转换为通用 Product。
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
import { formatPrice, formatCompareAtPrice } from '../price';

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

function extractProductIdFromDoc(doc?: Document): string {
  if (!doc) {
    throw new Error('页面未找到 <script id="product-json">');
  }

  const script = doc.querySelector('script#product-json');
  if (!script) {
    throw new Error('页面未找到 <script id="product-json">');
  }

  const dataId = script.getAttribute('data-id');
  if (!dataId) {
    throw new Error('<script id="product-json"> 缺少 data-id 属性');
  }

  return dataId;
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

  return variants.map((v, idx) => {
    const price = formatPrice(v.price);
    return {
      source_variant_id: v.id != null ? String(v.id) : undefined,
      position: idx + 1,
      title: String(v.title ?? `Variant ${idx + 1}`),
      price,
      compare_at_price: formatCompareAtPrice(v.compare_at_price, price),
      sku: toStringOrUndefined(v.sku),
      barcode: toStringOrUndefined(v.barcode),
      options: buildVariantOptions(v, productOptions),
      grams: gramsFromWeight(v.weight, v.weight_unit),
      weight: toNumberOrUndefined(v.weight) ?? null,
      weight_unit: toStringOrUndefined(v.weight_unit),
    };
  });
}

function convertProduct(raw: RawObject, url: string): Product {
  const productOptions = convertOptions((raw.options ?? []) as RawObject[]);
  const images = convertImages((raw.images ?? []) as unknown[]);
  let variants = convertVariants((raw.variants ?? []) as RawObject[], productOptions);

  // 无变体时兜底
  if (variants.length === 0) {
    const price = formatPrice(raw.price);
    variants = [
      {
        position: 1,
        title: 'Default Title',
        price,
        compare_at_price: formatCompareAtPrice(raw.compare_at_price, price),
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
  const productId = extractProductIdFromDoc(doc);
  const data = await fetchShoplazzaProduct(url, productId);

  const products = findProductList(data);
  if (products.length === 0) {
    throw new Error('ShopLazza API 未返回商品数据');
  }

  const rawProduct = products[0];
  const platform: PlatformCode = 'shoplazza';

  return {
    platform,
    source_url: url,
    source_product_id: toStringOrUndefined(rawProduct.id) ?? productId,
    product: convertProduct(rawProduct, url),
  };
}
