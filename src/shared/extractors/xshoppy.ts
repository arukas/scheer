/**
 * XShopPy 商品抓取器
 *
 * 从商品页 DOM 读取 `input.product-id`，POST `/buyer/product/pop-detail`
 * 取结构化数据，转换为通用 Product。
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
import { createLogger } from '../logger';
import { fetchJson } from '../fetch';
import { formatPrice, formatCompareAtPrice } from '../price';

const log = createLogger('shared/extractors/xshoppy');

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

function asObject(value: unknown): RawObject | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as RawObject)
    : undefined;
}

function parseJsonSafely(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** 读取商品 id：优先文档指定路径，退化到任意 input.product-id */
function readProductId(doc?: Document): string | undefined {
  if (!doc) return undefined;

  const selectors = [
    'body > div.PageContainer.J-PageContainer > input.product-id',
    'input.product-id',
  ];
  for (const selector of selectors) {
    const el = doc.querySelector(selector);
    const id = el?.getAttribute('value')?.trim();
    if (id) {
      log.debug('读取到 product-id', { selector, id });
      return id;
    }
  }
  return undefined;
}

async function fetchPopDetail(url: string, productId: string): Promise<RawObject> {
  const apiUrl = new URL('/buyer/product/pop-detail', url).toString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  try {
    const res = await fetchJson(apiUrl, {
      method: 'POST',
      signal: controller.signal,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ product_id: productId }),
    });
    const root = asObject(res);
    const data = asObject(root?.data);
    if (!data) {
      throw new Error('XShopPy API 返回格式异常');
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

/** 详情 HTML 清洗：data-original 懒加载属性并入 src，协议相对 URL 补 https: */
function cleanDescriptionHtml(doc: Document | undefined, html: string): string {
  if (!doc) return html;

  const container = doc.createElement('div');
  container.innerHTML = html;

  for (const img of Array.from(container.querySelectorAll('img'))) {
    const lazy = img.getAttribute('data-original');
    const src = img.getAttribute('src');
    if (lazy && (!src || src.startsWith('data:'))) {
      img.setAttribute('src', lazy);
    }
    img.removeAttribute('data-original');
  }
  for (const el of Array.from(container.querySelectorAll('[src], [href]'))) {
    for (const attr of ['src', 'href'] as const) {
      const value = el.getAttribute(attr);
      if (value?.startsWith('//')) el.setAttribute(attr, `https:${value}`);
    }
  }
  return container.innerHTML;
}

function convertOptions(attributes: unknown): ProductOption[] {
  if (!Array.isArray(attributes)) return [];
  const options: ProductOption[] = [];
  for (const attr of attributes) {
    const raw = asObject(attr);
    const name = toStringOrUndefined(raw?.specName)?.trim();
    const values = Array.isArray(raw?.specItems)
      ? raw.specItems.map((v) => String(v)).filter((v) => v.trim())
      : [];
    if (!name || values.length === 0) continue;
    options.push({ name, position: options.length + 1, values });
  }
  return options;
}

function convertImages(data: RawObject): ProductImage[] {
  const result: ProductImage[] = [];
  const seen = new Set<string>();

  const push = (raw: unknown) => {
    const img = asObject(raw);
    const src = toStringOrUndefined(img?.file_preview);
    if (!src) return;
    const imageId = toStringOrUndefined(img?.file_id);
    if (imageId && seen.has(imageId)) return;
    if (imageId) seen.add(imageId);
    result.push({
      source_image_id: imageId,
      position: result.length + 1,
      src,
      type: 'image' as const,
    });
  };

  // default_image 兜底放首位；images 里已含同 file_id 时会去重
  push(data.default_image);
  if (Array.isArray(data.images)) {
    for (const img of data.images) push(img);
  }

  return result;
}

function buildVariantOptions(spec: RawObject, productOptions: ProductOption[]): VariantOption[] {
  if (productOptions.length > 0) {
    return productOptions.map((opt) => ({
      name: opt.name,
      value: toStringOrUndefined(spec[opt.name]) ?? '',
    }));
  }

  return Object.entries(spec)
    .map(([name, value]) => ({ name, value: toStringOrUndefined(value) ?? '' }))
    .filter((item) => item.name);
}

function convertVariants(
  skuList: unknown,
  productOptions: ProductOption[],
  images: ProductImage[]
): ProductVariant[] {
  if (!Array.isArray(skuList)) return [];

  return skuList.flatMap((entry, idx) => {
    const sku = asObject(entry);
    if (!sku) return [];

    const price = formatPrice(sku.price);
    const spec = asObject(parseJsonSafely(toStringOrUndefined(sku.spec) ?? '')) ?? {};

    const imageId = toStringOrUndefined(asObject(sku.image)?.file_id ?? sku.image_id);
    const sourceImageId =
      imageId && images.some((img) => img.source_image_id === imageId) ? imageId : undefined;

    return [
      {
        source_variant_id: toStringOrUndefined(sku.id),
        position: idx + 1,
        title: String(sku.title ?? '').trim() || 'Default Title',
        price,
        compare_at_price: formatCompareAtPrice(sku.compare_at_price, price),
        sku: toStringOrUndefined(sku.sku_code),
        barcode: toStringOrUndefined(sku.upc),
        options: buildVariantOptions(spec, productOptions),
        source_image_id: sourceImageId,
        grams: toNumberOrUndefined(sku.grams) ?? 0,
        weight: toNumberOrUndefined(sku.weight) ?? null,
        weight_unit: toStringOrUndefined(sku.weight_unit),
      },
    ];
  });
}

function convertProduct(data: RawObject, doc?: Document): Product {
  const productOptions = convertOptions(data.attribute);
  const images = convertImages(data);
  let variants = convertVariants(data.sku_list, productOptions, images);

  // 无 sku_list 时，用商品级价格生成一个默认 variant
  if (variants.length === 0) {
    const price = formatPrice(data.price);
    variants = [
      {
        position: 1,
        title: String(data.title ?? 'Default Title'),
        price,
        compare_at_price: formatCompareAtPrice(data.compare_at_price, price),
        options: [{ name: 'Title', value: 'Default Title' }],
        grams: 0,
        weight: null,
        weight_unit: null,
      },
    ];
  }

  // 单 variant 且没有有效 option 时，强制 Default Title
  if (variants.length === 1 && variants[0].options.length === 0) {
    variants[0].options = [{ name: 'Title', value: 'Default Title' }];
  }

  const bodyHtml = toStringOrUndefined(data.body_html);

  return {
    title: String(data.title ?? ''),
    handle: toStringOrUndefined(data.handler),
    description_html: bodyHtml ? cleanDescriptionHtml(doc, bodyHtml) : undefined,
    vendor: undefined,
    product_type: undefined,
    tags: undefined,
    options: productOptions,
    published_scope: undefined,
    variants,
    images,
  };
}

export async function extractXshoppyProduct(
  url: string,
  doc?: Document
): Promise<CreateProductPayload> {
  const productId = readProductId(doc);
  if (!productId) {
    throw new Error('页面未找到 input.product-id，无法确定 XShopPy 商品 id');
  }

  const data = await fetchPopDetail(url, productId);
  if (!data.id && !data.title) {
    throw new Error('XShopPy API 返回中未找到商品数据');
  }

  log.debug('XShopPy pop-detail 解析成功', { productId });

  const platform: PlatformCode = 'xshoppy';
  return {
    platform,
    source_url: url,
    source_product_id: toStringOrUndefined(data.id),
    product: convertProduct(data, doc),
  };
}
