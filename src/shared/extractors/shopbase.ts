/**
 * ShopBase 商品抓取器
 *
 * 1. 从 <script id="__INITIAL_STATE__" type="application/json"> 读取 JSON。
 * 2. 取 state.product.product 作为商品原始数据。
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
import { createLogger } from '../logger';
import { formatPrice, formatCompareAtPrice } from '../price';

const log = createLogger('shared/extractors/shopbase');

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

function readInitialState(doc?: Document): RawObject {
  if (!doc) {
    throw new Error('页面未找到 <script id="__INITIAL_STATE__">');
  }

  const script = doc.querySelector('script#__INITIAL_STATE__');
  if (!script) {
    throw new Error('页面未找到 <script id="__INITIAL_STATE__">');
  }

  const text = script.textContent ?? '';
  const state = parseJsonSafely(text);
  if (!state || typeof state !== 'object') {
    throw new Error('<script id="__INITIAL_STATE__"> 内容不是有效 JSON');
  }

  log.debug('从 <script id="__INITIAL_STATE__"> 读取到数据');
  return state as RawObject;
}

function getRawProduct(state: RawObject): RawObject {
  const productState = (state.product ?? {}) as RawObject;
  if (!('product' in productState)) {
    throw new Error('__INITIAL_STATE__ 中未找到 product.product');
  }

  const rawProduct = productState.product;
  if (!rawProduct || typeof rawProduct !== 'object') {
    throw new Error('__INITIAL_STATE__ 中未找到 product.product');
  }

  const product = rawProduct as RawObject;
  if (!product.id && !product.title) {
    throw new Error('__INITIAL_STATE__.product.product 中未找到有效商品数据');
  }

  return product;
}

function convertTags(tags: unknown): string[] | undefined {
  if (typeof tags === 'string') {
    return tags
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
  }
  if (Array.isArray(tags)) return tags.map(String);
  return undefined;
}

function convertOptions(options: RawObject[]): ProductOption[] {
  if (!Array.isArray(options)) return [];

  return options.map((opt, idx) => {
    const values = Array.isArray(opt.values)
      ? opt.values
          .map((v: unknown) =>
            v && typeof v === 'object' ? toStringOrUndefined((v as RawObject).name) : undefined
          )
          .filter((v): v is string => v !== undefined)
      : [];

    return {
      name: String(opt.name ?? `Option ${idx + 1}`),
      position: idx + 1,
      values,
    };
  });
}

function findOptionValueName(rawOptions: RawObject[], optionIdx: number, valueId: number): string {
  const rawOpt = rawOptions[optionIdx];
  if (!rawOpt) return '';
  const values = Array.isArray(rawOpt.values) ? (rawOpt.values as RawObject[]) : [];
  const matched = values.find((v) => v && typeof v === 'object' && v.id === valueId);
  return matched ? String(matched.name ?? '') : '';
}

function buildVariantOptions(
  variant: RawObject,
  options: ProductOption[],
  rawOptions: RawObject[]
): VariantOption[] {
  const optionKeys = ['option1', 'option2', 'option3'] as const;

  return options.map((opt, idx) => {
    const valueId = toNumberOrUndefined(variant[optionKeys[idx]]);
    const value = valueId && valueId > 0 ? findOptionValueName(rawOptions, idx, valueId) : '';
    return { name: opt.name, value };
  });
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

function convertImages(rawImages: unknown[], mainImage: unknown): ProductImage[] {
  const result: ProductImage[] = [];

  const addImage = (item: unknown, idx: number) => {
    if (!item || typeof item !== 'object') return;
    const img = item as RawObject;
    const src = toStringOrUndefined(img.src ?? img.url ?? img.image);
    if (!src) return;
    result.push({
      source_image_id: img.id != null ? String(img.id) : String(idx + 1),
      position: idx + 1,
      src: normalizeSrc(src),
      alt: toStringOrUndefined(img.alt),
      type: img.type === 'video' ? ('video' as const) : ('image' as const),
    });
  };

  if (Array.isArray(rawImages)) {
    rawImages.forEach((img, idx) => addImage(img, idx));
  }

  if (result.length === 0 && mainImage && typeof mainImage === 'object') {
    addImage(mainImage, 0);
  }

  return result;
}

function convertVariants(
  variants: RawObject[],
  options: ProductOption[],
  rawOptions: RawObject[]
): ProductVariant[] {
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
      options: buildVariantOptions(v, options, rawOptions),
      grams: gramsFromWeight(v.weight, v.weight_unit),
      weight: toNumberOrUndefined(v.weight) ?? null,
      weight_unit: toStringOrUndefined(v.weight_unit) ?? 'g',
    };
  });
}

function convertProduct(raw: RawObject, url: string): Product {
  const rawOptions = Array.isArray(raw.options) ? (raw.options as RawObject[]) : [];
  const options = convertOptions(rawOptions);
  const images = convertImages((raw.images ?? []) as unknown[], raw.image);
  let variants = convertVariants((raw.variants ?? []) as RawObject[], options, rawOptions);

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
        weight_unit: toStringOrUndefined(raw.weight_unit) ?? 'g',
      },
    ];
  }

  // 单 variant 且没有有效 option 时，强制 Default Title
  if (variants.length === 1 && variants[0].options.length === 0) {
    variants[0].options = [{ name: 'Title', value: 'Default Title' }];
  }

  const vendor = toStringOrUndefined(raw.vendor);
  const productType = toStringOrUndefined(raw.product_type);

  return {
    title: String(raw.title ?? raw.name ?? ''),
    handle: toStringOrUndefined(raw.handle) ?? extractHandle(url).handle ?? undefined,
    description_html: toStringOrUndefined(raw.description),
    vendor: vendor || undefined,
    product_type: productType || undefined,
    tags: convertTags(raw.tags),
    options,
    published_scope: undefined,
    variants,
    images,
  };
}

export function extractShopbaseProduct(url: string, doc: Document): CreateProductPayload {
  const state = readInitialState(doc);
  const rawProduct = getRawProduct(state);
  const platform: PlatformCode = 'shopbase';

  return {
    platform,
    source_url: url,
    source_product_id: toStringOrUndefined(rawProduct.id),
    product: convertProduct(rawProduct, url),
  };
}
