/**
 * ShadowShop 商品抓取器
 *
 * ShadowShop 基于 Vue Storefront，商品数据以 `window.__INITIAL_STATE__`
 * 的形式注入页面。本抓取器优先读取页面全局对象，其次从 <script> 标签
 * 中反序列化该对象，最后转换为通用 Product。
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

const log = createLogger('shared/extractors/shadowshop');

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

function joinImageUrl(baseUrl: string | undefined, path: string): string {
  if (!baseUrl) return normalizeSrc(path);
  const base = baseUrl.replace(/\/+$/, '');
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${base}${normalizedPath}`;
}

function parseJsonSafely(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * 从 script 标签文本中提取 window.__INITIAL_STATE__ 的 JSON 内容。
 * 由于 JSON 体积可能很大，这里先定位赋值语句，再按平衡括号原则
 * 取出完整对象（Vue Storefront 通常直接序列化一个根对象）。
 */
function extractInitialStateFromScript(text: string): unknown {
  const marker = 'window.__INITIAL_STATE__';
  const idx = text.indexOf(marker);
  if (idx < 0) return undefined;

  // 跳过 marker 和赋值符号
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

function readInitialStateFromWindow(): unknown {
  const win = typeof window !== 'undefined' ? (window as unknown as RawObject) : undefined;
  return win?.__INITIAL_STATE__;
}

function readInitialStateFromDoc(doc: Document): unknown {
  const scripts = doc.querySelectorAll('script');
  for (const script of scripts) {
    const text = script.textContent ?? '';
    const state = extractInitialStateFromScript(text);
    if (state !== undefined) return state;
  }
  return undefined;
}

function getInitialState(doc?: Document): RawObject {
  const fromWindow = readInitialStateFromWindow();
  if (fromWindow && typeof fromWindow === 'object') {
    log.debug('从 window.__INITIAL_STATE__ 读取到数据');
    return fromWindow as RawObject;
  }

  if (doc) {
    const fromDoc = readInitialStateFromDoc(doc);
    if (fromDoc && typeof fromDoc === 'object') {
      log.debug('从 <script> 标签解析到 window.__INITIAL_STATE__');
      return fromDoc as RawObject;
    }
  }

  throw new Error('页面未找到 window.__INITIAL_STATE__');
}

function getImageBaseUrl(state: RawObject): string | undefined {
  const config = (state.config ?? {}) as RawObject;
  const images = (config.images ?? {}) as RawObject;
  return toStringOrUndefined(images.baseUrl);
}

function convertImages(mediaGallery: RawObject[], baseUrl: string | undefined): ProductImage[] {
  if (!Array.isArray(mediaGallery)) return [];

  const result: ProductImage[] = [];
  for (let idx = 0; idx < mediaGallery.length; idx++) {
    const item = mediaGallery[idx];
    if (!item || typeof item !== 'object') continue;

    const rawPath = toStringOrUndefined(item.image ?? item.src ?? item.baseSrc);
    if (!rawPath) continue;

    const src = joinImageUrl(baseUrl, rawPath);
    const type = toStringOrUndefined(item.typ ?? item.type) ?? 'image';

    result.push({
      source_image_id: item.vid != null ? String(item.vid) : String(idx + 1),
      position: typeof item.pos === 'number' ? item.pos : idx + 1,
      src,
      alt: toStringOrUndefined(item.lab ?? item.alt),
      type: type === 'video' ? 'video' : 'image',
    });
  }
  return result;
}

function convertTags(tags: unknown, categories: unknown): string[] | undefined {
  const result = new Set<string>();

  if (Array.isArray(tags)) {
    tags.forEach((t) => result.add(String(t)));
  } else if (typeof tags === 'string') {
    tags
      .trim()
      .split(',')
      .map((t) => t.trim())
      .forEach((t) => {
        if (t) result.add(t);
      });
  }

  if (Array.isArray(categories)) {
    categories.forEach((cat) => {
      if (cat && typeof cat === 'object') {
        const name = toStringOrUndefined((cat as RawObject).name);
        if (name) result.add(name);
      }
    });
  }

  return result.size > 0 ? Array.from(result) : undefined;
}

function convertOptions(configurableOptions: RawObject[]): ProductOption[] {
  if (!Array.isArray(configurableOptions)) return [];

  return configurableOptions.map((opt, idx) => {
    const values = Array.isArray(opt.values)
      ? opt.values
          .map((v: unknown) =>
            v && typeof v === 'object' ? toStringOrUndefined((v as RawObject).label) : undefined
          )
          .filter((v): v is string => v !== undefined)
      : [];

    return {
      name: String(opt.label ?? opt.name ?? `Option ${idx + 1}`),
      position: idx + 1,
      values,
    };
  });
}

function findOptionValueLabel(
  option: RawObject,
  valueIndex: number | undefined,
  fallback: string | undefined
): string {
  if (valueIndex === undefined) return fallback ?? '';
  const values = Array.isArray(option.values) ? option.values : [];
  const matched = values.find(
    (v: unknown) => v && typeof v === 'object' && (v as RawObject).value_index === valueIndex
  );
  if (matched && typeof matched === 'object') {
    return toStringOrUndefined((matched as RawObject).label) ?? fallback ?? '';
  }
  return fallback ?? '';
}

function buildVariantOptions(child: RawObject, configurableOptions: RawObject[]): VariantOption[] {
  if (!Array.isArray(configurableOptions)) return [];

  return configurableOptions.map((opt) => {
    const attributeCode = toStringOrUndefined(opt.attribute_code) ?? '';
    const optionName = String(opt.label ?? opt.name ?? attributeCode);
    const rawValue = attributeCode ? child[attributeCode] : undefined;
    const valueIndex = typeof rawValue === 'number' ? rawValue : undefined;
    const fallback = toStringOrUndefined(child.name);
    const value = findOptionValueLabel(opt, valueIndex, fallback);

    return { name: optionName, value };
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

function convertVariants(
  configurableChildren: RawObject[],
  configurableOptions: RawObject[]
): ProductVariant[] {
  if (!Array.isArray(configurableChildren)) return [];

  return configurableChildren.map((child, idx) => {
    const price = formatPrice(child.final_price ?? child.special_price ?? child.price);

    return {
      source_variant_id: toStringOrUndefined(child.id),
      position: idx + 1,
      title: String(child.name ?? `Variant ${idx + 1}`),
      price,
      compare_at_price: formatCompareAtPrice(child.original_price, price),
      sku: toStringOrUndefined(child.sku),
      barcode: toStringOrUndefined(child.barcode),
      options: buildVariantOptions(child, configurableOptions),
      grams: gramsFromWeight(child.weight, child.weight_unit),
      weight: toNumberOrUndefined(child.weight) ?? null,
      weight_unit: toStringOrUndefined(child.weight_unit),
    };
  });
}

function convertProduct(raw: RawObject, state: RawObject, url: string): Product {
  const baseUrl = getImageBaseUrl(state);
  const configurableOptions = Array.isArray(raw.configurable_options)
    ? (raw.configurable_options as RawObject[])
    : [];
  const productOptions = convertOptions(configurableOptions);
  const images = convertImages((raw.media_gallery ?? []) as RawObject[], baseUrl);
  let variants = convertVariants(
    (raw.configurable_children ?? []) as RawObject[],
    configurableOptions
  );

  // 无变体时，用商品级价格兜底
  if (variants.length === 0) {
    const price = formatPrice(raw.final_price ?? raw.special_price ?? raw.price);
    variants = [
      {
        position: 1,
        title: 'Default Title',
        price,
        compare_at_price: formatCompareAtPrice(raw.original_price, price),
        sku: toStringOrUndefined(raw.sku),
        barcode: toStringOrUndefined(raw.barcode),
        options: [{ name: 'Title', value: 'Default Title' }],
        grams: gramsFromWeight(raw.weight, raw.weight_unit),
        weight: toNumberOrUndefined(raw.weight) ?? null,
        weight_unit: toStringOrUndefined(raw.weight_unit),
      },
    ];
  }

  // 单 variant 且没有有效 option 时，强制 Default Title
  if (variants.length === 1 && variants[0].options.length === 0) {
    variants[0].options = [{ name: 'Title', value: 'Default Title' }];
  }

  const vendor = toStringOrUndefined(raw.vendor);
  const productType = toStringOrUndefined(raw.productType ?? raw.type_id);

  return {
    title: String(raw.name ?? raw.title ?? ''),
    handle: toStringOrUndefined(raw.slug) ?? extractHandle(url).handle ?? undefined,
    description_html: toStringOrUndefined(raw.description),
    vendor: vendor || undefined,
    product_type: productType || undefined,
    tags: convertTags(raw.tags, raw.category),
    options: productOptions,
    published_scope: undefined,
    variants,
    images,
  };
}

export async function extractShadowshopProduct(
  url: string,
  doc?: Document
): Promise<CreateProductPayload> {
  const state = getInitialState(doc);
  const productState = (state.product ?? {}) as RawObject;
  const current = (productState.current ?? {}) as RawObject;

  if (!current.id && !current.name) {
    throw new Error('window.__INITIAL_STATE__ 中未找到商品数据');
  }

  const platform: PlatformCode = 'shadowshop';
  return {
    platform,
    source_url: url,
    source_product_id: toStringOrUndefined(current.id),
    product: convertProduct(current, state, url),
  };
}
