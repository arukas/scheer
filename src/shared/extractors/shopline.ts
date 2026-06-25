/**
 * ShopLine 商品抓取器（ storefront Ajax API 优先）
 *
 * 请求 `/api/product/products.json?handle=<handle>`，失败时由调用方回退到 JSON-LD。
 */

import type { CreateProductPayload, PlatformCode, Product, ProductImage, ProductOption, ProductVariant } from '../schema';
import { extractHandle } from '../platform';

const API_TIMEOUT_MS = 10000;

type RawObject = Record<string, unknown>;

async function fetchShoplineProduct(url: string): Promise<unknown> {
  const { handle } = extractHandle(url);
  if (!handle) throw new Error('无法从 URL 提取商品 handle');

  const apiUrl = new URL('/api/product/products.json', url);
  apiUrl.searchParams.set('handle', handle);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  try {
    const res = await fetch(apiUrl.toString(), {
      signal: controller.signal,
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`ShopLine API 返回 ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function normalizeSrc(src: string): string {
  if (src.startsWith('http:') || src.startsWith('https:')) return src;
  if (src.startsWith('//')) return `https:${src}`;
  return src;
}

function computeMainSku(sku?: string | null): string {
  if (!sku) return '';
  const idx = sku.indexOf('-');
  return idx >= 0 ? sku.slice(0, idx) : sku;
}

function toStringOrUndefined(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  return String(value);
}

function convertTags(tags: unknown): string | undefined {
  if (Array.isArray(tags)) return tags.map(String).join(', ');
  if (typeof tags === 'string') return tags;
  return undefined;
}

function convertPrice(value: unknown): string {
  if (typeof value !== 'number') return String(value ?? '0');
  // ShopLine 价格单位为最小货币单位，需除以 100
  return (value / 100).toFixed(2);
}

function convertImages(rawImages: unknown[], medias: RawObject[]): ProductImage[] {
  const result: ProductImage[] = [];

  for (let idx = 0; idx < rawImages.length; idx++) {
    const item = rawImages[idx];
    if (typeof item === 'string') {
      result.push({ position: idx + 1, src: normalizeSrc(item), categories: 1 });
    } else if (item && typeof item === 'object') {
      const obj = item as RawObject;
      const src = toStringOrUndefined(obj.src ?? obj.resource ?? obj.cover);
      if (src) {
        result.push({
          source_image_id: obj.id != null ? String(obj.id) : undefined,
          position: idx + 1,
          src: normalizeSrc(src),
          alt: toStringOrUndefined(obj.alt),
          categories: 1,
        });
      }
    }
  }

  // 若 images 为空，尝试 medias
  if (result.length === 0) {
    for (let idx = 0; idx < medias.length; idx++) {
      const media = medias[idx];
      const src = toStringOrUndefined(media.resource ?? media.cover);
      if (src) {
        result.push({
          source_image_id: media.id != null ? String(media.id) : undefined,
          position: idx + 1,
          src: normalizeSrc(src),
          alt: toStringOrUndefined(media.alt),
          categories: media.type === 'video' ? 2 : 1,
        });
      }
    }
  }

  return result;
}

function convertOptions(options: RawObject[]): ProductOption[] {
  if (!Array.isArray(options)) return [];
  return options.map((opt, idx) => ({
    name: String(opt.name ?? ''),
    position: idx + 1,
    values: Array.isArray(opt.values) ? opt.values.map(String) : [],
  }));
}

function gramsFromWeight(weight: unknown, unit: unknown): number {
  if (typeof weight !== 'number') return 0;
  const u = String(unit ?? '').toLowerCase();
  if (u === 'kg') return Math.round(weight * 1000);
  if (u === 'g') return Math.round(weight);
  if (u === 'lb') return Math.round(weight * 453.59237);
  if (u === 'oz') return Math.round(weight * 28.3495);
  return 0;
}

function convertVariants(variants: RawObject[]): ProductVariant[] {
  if (!Array.isArray(variants)) return [];
  return variants.map((v, idx) => ({
    source_variant_id: v.id != null ? String(v.id) : undefined,
    position: idx + 1,
    title: String(v.title ?? ''),
    main_sku: computeMainSku(toStringOrUndefined(v.sku)),
    option1: toStringOrUndefined(v.option1) ?? '',
    option2: toStringOrUndefined(v.option2),
    option3: toStringOrUndefined(v.option3),
    price: convertPrice(v.price),
    compare_at_price: v.compare_at_price != null ? convertPrice(v.compare_at_price) : undefined,
    sku: toStringOrUndefined(v.sku),
    barcode: toStringOrUndefined(v.barcode),
    grams: gramsFromWeight(v.weight, v.weight_unit),
    weight: typeof v.weight === 'number' ? v.weight : null,
    weight_unit: toStringOrUndefined(v.weight_unit),
    taxable: 1 as const,
  }));
}

function convertProduct(raw: RawObject, url: string): Product {
  const images = convertImages((raw.images ?? []) as unknown[], (raw.medias ?? []) as RawObject[]);
  const variants = convertVariants((raw.variants ?? []) as RawObject[]);

  // 单 variant 且没有有效 option1 时，强制使用 Shopify 风格的 Default Title
  if (variants.length === 1 && !variants[0].option1) {
    variants[0].option1 = 'Default Title';
  }

  return {
    title: String(raw.title ?? ''),
    handle: toStringOrUndefined(raw.handle) ?? extractHandle(url).handle ?? undefined,
    body_html: toStringOrUndefined(raw.description),
    vendor: toStringOrUndefined(raw.brand),
    product_type: undefined,
    tags: convertTags(raw.tags),
    options: convertOptions((raw.options ?? []) as RawObject[]),
    published_scope: undefined,
    variants,
    images,
  };
}

export async function extractShoplineProduct(url: string): Promise<CreateProductPayload> {
  const data = (await fetchShoplineProduct(url)) as RawObject;

  if (data.message && !data.products) {
    throw new Error(String(data.message));
  }

  const products = Array.isArray(data.products) ? (data.products as RawObject[]) : [];
  if (products.length === 0) {
    throw new Error('ShopLine API 未返回商品数据');
  }

  const rawProduct = products[0];
  const platform: PlatformCode = 'shopline';

  return {
    platform,
    source_url: url,
    source_product_id: rawProduct.id != null ? String(rawProduct.id) : undefined,
    product: convertProduct(rawProduct, url),
  };
}
