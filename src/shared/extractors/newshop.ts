/**
 * NewShop / wshop 商品抓取器
 *
 * 请求 `/api/store/products/<handle>` 取结构化数据，转换为通用 Product。
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

const API_TIMEOUT_MS = 10000;

type RawObject = Record<string, unknown>;

async function fetchNewshopProduct(url: string): Promise<unknown> {
  const { handle } = extractHandle(url);
  if (!handle) {
    throw new Error('当前页面暂时无法支持，待后续支持（无法从 URL 提取商品 handle）');
  }

  const apiUrl = new URL(`/api/store/products/${handle}`, url).toString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  try {
    return await fetchJson(apiUrl, {
      signal: controller.signal,
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
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
  return options.map((opt, idx) => {
    // NewShop API 中 position 可能是 0-based，统一转成 1-based
    const rawPosition = Number(opt.position ?? idx);
    return {
      name: String(opt.name ?? ''),
      position: rawPosition >= 1 ? rawPosition : rawPosition + 1,
      values: Array.isArray(opt.value) ? opt.value.map(String) : [],
    };
  });
}

function convertImages(gallery: RawObject[], featureImage?: RawObject | null): ProductImage[] {
  const result: ProductImage[] = [];

  if (featureImage && typeof featureImage === 'object') {
    const src = toStringOrUndefined(featureImage.url);
    if (src) {
      result.push({
        source_image_id: featureImage.ID != null ? String(featureImage.ID) : undefined,
        position: 1,
        src: normalizeSrc(src),
        alt: toStringOrUndefined(featureImage.alt),
        type: featureImage.media_content_type === 'video' ? ('video' as const) : ('image' as const),
      });
    }
  }

  if (!Array.isArray(gallery)) return result;

  for (let idx = 0; idx < gallery.length; idx++) {
    const img = gallery[idx];
    const src = toStringOrUndefined(img.url);
    if (!src) continue;

    const imageId = img.ID != null ? String(img.ID) : undefined;
    // feature_image 已作为 position 1，跳过同一张图
    if (result.length > 0 && result[0].source_image_id === imageId) continue;

    result.push({
      source_image_id: imageId,
      position: result.length + 1,
      src: normalizeSrc(src),
      alt: toStringOrUndefined(img.alt),
      type: img.media_content_type === 'video' ? ('video' as const) : ('image' as const),
    });
  }

  return result;
}

function buildVariantOptions(attrs: RawObject[], productOptions: ProductOption[]): VariantOption[] {
  if (!Array.isArray(attrs)) return [];

  // 优先按 productOptions 的顺序和 name 对齐
  if (productOptions.length > 0) {
    return productOptions.map((opt) => {
      const matched = attrs.find((a) => String(a.name ?? '') === opt.name);
      return {
        name: opt.name,
        value: toStringOrUndefined(matched?.value) ?? '',
      };
    });
  }

  // 退化：直接取 attrs
  return attrs
    .map((a) => {
      const name = toStringOrUndefined(a.name);
      const value = toStringOrUndefined(a.value);
      if (!name || value == null) return null;
      return { name, value };
    })
    .filter((item): item is VariantOption => item !== null);
}

function convertVariants(
  variants: RawObject[],
  productOptions: ProductOption[],
  images: ProductImage[]
): ProductVariant[] {
  if (!Array.isArray(variants)) return [];

  return variants.map((v, idx) => {
    const sku = toStringOrUndefined(v.sku);
    const imageId = v.image_id != null ? String(v.image_id) : undefined;
    const sourceImageId =
      imageId && images.some((img) => img.source_image_id === imageId) ? imageId : undefined;

    const priceNum = typeof v.price === 'number' ? v.price : Number(v.price ?? 0);
    const compareNum = v.regular_price != null ? Number(v.regular_price) : undefined;

    return {
      source_variant_id: v.ID != null ? String(v.ID) : undefined,
      position: idx + 1,
      title: String(v.title ?? ''),
      price: priceNum.toFixed(2),
      compare_at_price:
        compareNum != null && compareNum > priceNum ? compareNum.toFixed(2) : undefined,
      sku,
      barcode: toStringOrUndefined(v.bar_code),
      options: buildVariantOptions((v.attrs ?? []) as RawObject[], productOptions),
      source_image_id: sourceImageId,
      grams: 0,
      weight: v.weight_local != null ? Number(v.weight_local) : null,
      weight_unit: toStringOrUndefined(v.weight_unit),
    };
  });
}

function convertProduct(raw: RawObject): Product {
  const productOptions = convertOptions((raw.variant_attrs ?? []) as RawObject[]);
  const images = convertImages(
    (raw.gallery ?? []) as RawObject[],
    (raw.feature_image ?? null) as RawObject | null
  );

  let variants = convertVariants((raw.variants ?? []) as RawObject[], productOptions, images);

  // 无 variants 时，用商品级价格生成一个默认 variant
  if (variants.length === 0) {
    const priceNum = typeof raw.price === 'number' ? raw.price : Number(raw.price ?? 0);
    const compareNum = raw.regular_price != null ? Number(raw.regular_price) : undefined;
    variants = [
      {
        position: 1,
        title: String(raw.title ?? 'Default Title'),
        price: priceNum.toFixed(2),
        compare_at_price:
          compareNum != null && compareNum > priceNum ? compareNum.toFixed(2) : undefined,
        sku: toStringOrUndefined(raw.sku),
        options: [{ name: 'Title', value: 'Default Title' }],
        grams: 0,
        weight: raw.weight_local != null ? Number(raw.weight_local) : null,
        weight_unit: toStringOrUndefined(raw.weight_unit),
      },
    ];
  }

  // 单 variant 且没有有效 option 时，强制 Default Title
  if (variants.length === 1 && variants[0].options.length === 0) {
    variants[0].options = [{ name: 'Title', value: 'Default Title' }];
  }

  return {
    title: String(raw.title ?? ''),
    handle: toStringOrUndefined(raw.slug),
    description_html:
      toStringOrUndefined(raw.post_content) ?? toStringOrUndefined(raw.short_content),
    vendor: toStringOrUndefined(raw.supplier),
    product_type: undefined,
    tags: convertTags(raw.categories),
    options: productOptions,
    published_scope: undefined,
    variants,
    images,
  };
}

export async function extractNewshopProduct(url: string): Promise<CreateProductPayload> {
  const data = (await fetchNewshopProduct(url)) as RawObject;
  if (!data || typeof data !== 'object') {
    throw new Error('NewShop API 返回格式异常');
  }

  const platform: PlatformCode = 'newshop';
  return {
    platform,
    source_url: url,
    source_product_id: data.ID != null ? String(data.ID) : undefined,
    product: convertProduct(data),
  };
}
