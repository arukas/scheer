/**
 * Shopify 商品抓取器
 *
 * 通过 `/products/<handle>.json` 取结构化数据，转换为通用 Product。
 */

import type { CreateProductPayload, PlatformCode, Product, ProductImage, ProductOption, ProductVariant } from '../schema';
import { extractHandle } from '../platform';
import { fetchJson } from '../fetch';

type RawObject = Record<string, unknown>;

const API_TIMEOUT_MS = 10000;

async function fetchShopifyProductJson(url: string): Promise<unknown> {
  const { handle } = extractHandle(url);
  if (!handle) throw new Error('无法从 URL 提取商品 handle');

  const apiUrl = new URL(`/products/${handle}.json`, url).toString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  try {
    return await fetchJson(apiUrl, {
      signal: controller.signal,
      credentials: 'same-origin',
    });
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
  if (Array.isArray(tags)) return tags.join(', ');
  if (typeof tags === 'string') return tags;
  return undefined;
}

function convertOptions(options: RawObject[]): ProductOption[] {
  if (!Array.isArray(options)) return [];
  return options.map((opt, idx) => ({
    name: String(opt.name ?? ''),
    position: Number(opt.position ?? idx + 1),
    values: Array.isArray(opt.values) ? opt.values.map(String) : [],
  }));
}

function convertImages(images: RawObject[]): ProductImage[] {
  if (!Array.isArray(images)) return [];
  return images.map((img, idx) => ({
    source_image_id: img.id != null ? String(img.id) : undefined,
    position: Number(img.position ?? idx + 1),
    src: normalizeSrc(String(img.src ?? '')),
    alt: toStringOrUndefined(img.alt),
    categories: 1,
  }));
}

function convertVariants(variants: RawObject[], images: ProductImage[]): ProductVariant[] {
  if (!Array.isArray(variants)) return [];
  return variants.map((v, idx) => {
    const sku = toStringOrUndefined(v.sku);
    const imageId = v.image_id != null ? String(v.image_id) : undefined;
    const sourceImageId = imageId && images.some((img) => img.source_image_id === imageId) ? imageId : undefined;

    return {
      source_variant_id: v.id != null ? String(v.id) : undefined,
      position: Number(v.position ?? idx + 1),
      title: String(v.title ?? ''),
      main_sku: computeMainSku(sku),
      option1: toStringOrUndefined(v.option1) ?? '',
      option2: toStringOrUndefined(v.option2),
      option3: toStringOrUndefined(v.option3),
      price: String(v.price ?? '0'),
      compare_at_price: toStringOrUndefined(v.compare_at_price),
      sku,
      barcode: toStringOrUndefined(v.barcode),
      source_image_id: sourceImageId,
      grams: Number(v.grams ?? 0),
      weight: v.weight != null ? Number(v.weight) : null,
      weight_unit: toStringOrUndefined(v.weight_unit),
      taxable: v.taxable ? 1 : 0,
      tax_code: toStringOrUndefined(v.tax_code),
      presentment_prices: Array.isArray(v.presentment_prices) ? v.presentment_prices : undefined,
    };
  });
}

function convertProduct(raw: RawObject): Product {
  const images = convertImages((raw.images ?? []) as RawObject[]);
  return {
    title: String(raw.title ?? ''),
    handle: toStringOrUndefined(raw.handle),
    body_html: toStringOrUndefined(raw.body_html),
    vendor: toStringOrUndefined(raw.vendor),
    product_type: toStringOrUndefined(raw.product_type),
    tags: convertTags(raw.tags),
    options: convertOptions((raw.options ?? []) as RawObject[]),
    published_scope: toStringOrUndefined(raw.published_scope),
    variants: convertVariants((raw.variants ?? []) as RawObject[], images),
    images,
  };
}

export async function extractShopifyProduct(url: string): Promise<CreateProductPayload> {
  const data = (await fetchShopifyProductJson(url)) as Record<string, unknown>;
  const rawProduct = data.product as Record<string, unknown>;
  if (!rawProduct) throw new Error('Shopify API 返回格式异常');

  const platform: PlatformCode = 'shopify';
  return {
    platform,
    source_url: url,
    source_product_id: rawProduct.id != null ? String(rawProduct.id) : undefined,
    product: convertProduct(rawProduct),
  };
}
