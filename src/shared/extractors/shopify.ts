/**
 * Shopify 商品抓取器
 *
 * 通过 `/products/<handle>.json` 取结构化数据，转换为通用 Product。
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
import { formatPrice, formatCompareAtPrice } from '../price';

type RawObject = Record<string, unknown>;

const API_TIMEOUT_MS = 10000;

async function fetchShopifyProductJson(url: string): Promise<unknown> {
  const { handle } = extractHandle(url);
  if (!handle) {
    throw new Error('当前页面暂时无法支持，待后续支持（无法从 URL 提取商品 handle）');
  }

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

function toStringOrUndefined(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  return String(value);
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
    type: 'image' as const,
  }));
}

function buildVariantOptions(v: RawObject, productOptions: ProductOption[]): VariantOption[] {
  const rawKeys = ['option1', 'option2', 'option3'] as const;

  // 优先用 product.options 的 name 作为维度名
  if (productOptions.length > 0) {
    return productOptions.map((opt, idx) => {
      const rawValue = v[rawKeys[idx]] as unknown;
      return {
        name: opt.name,
        value: toStringOrUndefined(rawValue) ?? '',
      };
    });
  }

  // 退化：没有 product.options 时，用 option1/2/3 自身生成 name
  return rawKeys
    .map((key, idx) => {
      const value = toStringOrUndefined(v[key]);
      if (value == null) return null;
      return { name: `Option ${idx + 1}`, value };
    })
    .filter((item): item is VariantOption => item !== null);
}

function convertVariants(
  variants: RawObject[],
  images: ProductImage[],
  productOptions: ProductOption[]
): ProductVariant[] {
  if (!Array.isArray(variants)) return [];
  return variants.map((v, idx) => {
    const sku = toStringOrUndefined(v.sku);
    const imageId = v.image_id != null ? String(v.image_id) : undefined;
    const sourceImageId =
      imageId && images.some((img) => img.source_image_id === imageId) ? imageId : undefined;

    return {
      source_variant_id: v.id != null ? String(v.id) : undefined,
      position: Number(v.position ?? idx + 1),
      title: String(v.title ?? ''),
      price: formatPrice(v.price),
      compare_at_price: formatCompareAtPrice(v.compare_at_price, formatPrice(v.price)),
      sku,
      barcode: toStringOrUndefined(v.barcode),
      options: buildVariantOptions(v, productOptions),
      source_image_id: sourceImageId,
      grams: Number(v.grams ?? 0),
      weight: v.weight != null ? Number(v.weight) : null,
      weight_unit: toStringOrUndefined(v.weight_unit),
    };
  });
}

function convertProduct(raw: RawObject): Product {
  const images = convertImages((raw.images ?? []) as RawObject[]);
  const productOptions = convertOptions((raw.options ?? []) as RawObject[]);
  return {
    title: String(raw.title ?? ''),
    handle: toStringOrUndefined(raw.handle),
    description_html: toStringOrUndefined(raw.body_html),
    vendor: toStringOrUndefined(raw.vendor),
    product_type: toStringOrUndefined(raw.product_type),
    tags: convertTags(raw.tags),
    options: productOptions,
    published_scope: toStringOrUndefined(raw.published_scope),
    variants: convertVariants((raw.variants ?? []) as RawObject[], images, productOptions),
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
