/**
 * TikTok Shop 商品抓取器
 *
 * 1. 从 <script id="__MODERN_ROUTER_DATA__"> 读取 JSON。
 * 2. 在 loaderData 中找到 page_config.components_map 节点，再取
 *    component_name === "product_info" 的 component_data.product_info.product_model。
 * 3. 转换为通用 Product。
 *
 * 参考：docs/design.md §2.4 / §7.2
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
import { formatPrice } from '../price';

const log = createLogger('shared/extractors/tiktok');

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

function parseJsonSafely(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function readModernRouterData(doc?: Document): RawObject {
  if (!doc) {
    throw new Error('页面未找到 <script id="__MODERN_ROUTER_DATA__">');
  }

  const script = doc.querySelector('script#__MODERN_ROUTER_DATA__');
  if (!script) {
    throw new Error('页面未找到 <script id="__MODERN_ROUTER_DATA__">，可能未加载完整或被风控');
  }

  const text = script.textContent ?? '';
  const data = parseJsonSafely(text);
  if (!data || typeof data !== 'object') {
    throw new Error('<script id="__MODERN_ROUTER_DATA__"> 内容不是有效 JSON');
  }

  log.debug('从 <script id="__MODERN_ROUTER_DATA__"> 读取到数据');
  return data as RawObject;
}

function findLoaderDataItems(data: RawObject): unknown[] {
  if (Array.isArray(data.loaderData)) return data.loaderData;
  if (data.loaderData && typeof data.loaderData === 'object') {
    return Object.values(data.loaderData);
  }
  return [];
}

function findProductInfoComponent(data: RawObject): RawObject | null {
  const items = findLoaderDataItems(data);

  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const pageConfig = (item as RawObject).page_config as RawObject | undefined;
    if (!pageConfig || typeof pageConfig !== 'object') continue;

    const componentsMap = pageConfig.components_map as RawObject | undefined;
    if (!componentsMap || typeof componentsMap !== 'object') continue;

    for (const component of Object.values(componentsMap)) {
      if (!component || typeof component !== 'object') continue;
      const comp = component as RawObject;
      if (comp.component_name !== 'product_info') continue;

      const componentData = comp.component_data as RawObject | undefined;
      if (!componentData || typeof componentData !== 'object') continue;

      // 错误码检查
      const errorCode = toStringOrUndefined(componentData.error_code);
      const errorMessage = toStringOrUndefined(componentData.error_message);
      if (
        errorCode === '23002002' ||
        errorMessage?.toLowerCase().includes('get product detail not exist') ||
        errorMessage?.toLowerCase().includes('product not available in this country or region')
      ) {
        throw new Error('TikTok 商品不可访问（下架或区域限制）');
      }

      const productInfo = componentData.product_info as RawObject | undefined;
      if (productInfo && typeof productInfo === 'object') {
        return productInfo;
      }
    }
  }

  return null;
}

function getProductModel(data: RawObject): RawObject {
  const productInfo = findProductInfoComponent(data);
  if (!productInfo) {
    throw new Error('未在 __MODERN_ROUTER_DATA__ 中找到 product_info 组件');
  }

  const productModel = productInfo.product_model as RawObject | undefined;
  if (!productModel || typeof productModel !== 'object') {
    throw new Error('product_info 中未找到 product_model');
  }

  return productModel;
}

function extractHandle(url: string, title: string): string | undefined {
  try {
    const u = new URL(url);
    const path = u.pathname;
    const match = path.match(/\/(?:product|products|pdp)\/([^/]+)/);
    if (match) {
      const segment = match[1];
      // 18-20 位纯数字用 title slug
      if (/^\d{18,20}$/.test(segment)) {
        return slugify(title);
      }
      return segment;
    }
  } catch {
    // ignore
  }
  return undefined;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

function stripQuery(src: string): string {
  try {
    const u = new URL(src);
    return `${u.origin}${u.pathname}`;
  } catch {
    return src;
  }
}

function buildDescriptionHtml(productModel: RawObject): string | undefined {
  const blocks: string[] = [];

  // product_properties 表格
  const properties = productModel.product_properties as RawObject[] | undefined;
  if (Array.isArray(properties) && properties.length > 0) {
    const rows = properties
      .map((p) => {
        const name = toStringOrUndefined(p.name) ?? '';
        const value = toStringOrUndefined(p.value) ?? '';
        return `<tr><td>${escapeHtml(name)}</td><td>${escapeHtml(value)}</td></tr>`;
      })
      .join('');
    blocks.push(`<table>${rows}</table>`);
  }

  // description block
  const description = toStringOrUndefined(productModel.description);
  if (description) {
    blocks.push(description);
  }

  return blocks.length > 0 ? blocks.join('') : undefined;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function convertOptions(saleProperties: RawObject[]): ProductOption[] {
  if (!Array.isArray(saleProperties)) return [];

  return saleProperties.map((prop, idx) => {
    const values = Array.isArray(prop.property_values)
      ? prop.property_values
          .map((v: unknown) =>
            v && typeof v === 'object'
              ? toStringOrUndefined((v as RawObject).property_value_name)
              : undefined
          )
          .filter((v): v is string => v !== undefined)
      : [];

    return {
      name: String(prop.property_name ?? `Option ${idx + 1}`),
      position: idx + 1,
      values,
    };
  });
}

function buildVariantOptions(sku: RawObject, options: ProductOption[]): VariantOption[] {
  const propertyPairs = Array.isArray(sku.property_pairs)
    ? (sku.property_pairs as RawObject[])
    : [];

  if (propertyPairs.length === 0) {
    return options.map((opt) => ({ name: opt.name, value: '' }));
  }

  return propertyPairs.map((pair, idx) => {
    const name =
      toStringOrUndefined(pair.sku_property_name) ?? options[idx]?.name ?? `Option ${idx + 1}`;
    const value = toStringOrUndefined(pair.sku_property_value_name) ?? '';
    return { name, value };
  });
}

function buildVariantTitle(variantOptions: VariantOption[]): string {
  const values = variantOptions.map((o) => o.value).filter(Boolean);
  return values.length > 0 ? values.join(' / ') : 'Default Title';
}

function convertImages(images: unknown[]): ProductImage[] {
  if (!Array.isArray(images)) return [];

  const result: ProductImage[] = [];
  for (let idx = 0; idx < images.length; idx++) {
    const item = images[idx];
    if (!item || typeof item !== 'object') continue;
    const img = item as RawObject;
    const urlList = Array.isArray(img.url_list) ? img.url_list : [];
    const src = urlList.length > 0 ? String(urlList[0]) : toStringOrUndefined(img.url);
    if (!src) continue;

    result.push({
      source_image_id: img.id != null ? String(img.id) : String(idx + 1),
      position: idx + 1,
      src: stripQuery(src),
      alt: toStringOrUndefined(img.alt),
      type: 'image' as const,
    });
  }
  return result;
}

function convertVariants(
  skus: RawObject[],
  options: ProductOption[],
  promotionModel: RawObject | undefined
): ProductVariant[] {
  if (!Array.isArray(skus)) return [];

  const priceMap = new Map<string, number>();
  const promotionProductPrice = promotionModel?.promotion_product_price as RawObject | undefined;
  const skusPrice = promotionProductPrice?.skus_price as RawObject | undefined;
  if (skusPrice && typeof skusPrice === 'object') {
    for (const [key, val] of Object.entries(skusPrice)) {
      if (val && typeof val === 'object') {
        const sellerSubtotal = toNumberOrUndefined((val as RawObject).seller_subtotal_deduction);
        if (sellerSubtotal !== undefined) {
          priceMap.set(key, sellerSubtotal);
        }
      }
    }
  }

  return skus.map((sku, idx) => {
    const skuName = toStringOrUndefined(sku.sku_name) ?? '';
    const variantOptions = buildVariantOptions(sku, options);
    const title = buildVariantTitle(variantOptions);

    const priceValue =
      skuName && priceMap.has(skuName) ? priceMap.get(skuName) : toNumberOrUndefined(sku.price);
    const price = formatPrice(priceValue);
    const numericPrice = Number(price);

    const discountDecimal = toNumberOrUndefined(promotionModel?.discount_decimal);
    const compareAtPrice =
      discountDecimal && discountDecimal > 0 ? numericPrice / discountDecimal : undefined;

    return {
      source_variant_id: sku.id != null ? String(sku.id) : undefined,
      position: idx + 1,
      title,
      price,
      compare_at_price:
        compareAtPrice !== undefined && compareAtPrice > numericPrice
          ? compareAtPrice.toFixed(2)
          : undefined,
      sku: skuName || undefined,
      barcode: toStringOrUndefined(sku.sku_id),
      options: variantOptions,
      grams: 0,
      weight: 0,
      weight_unit: 'g',
    };
  });
}

function convertProduct(raw: RawObject, url: string): Product {
  const saleProperties = Array.isArray(raw.sale_properties)
    ? (raw.sale_properties as RawObject[])
    : [];
  const options = convertOptions(saleProperties);
  const images = convertImages((raw.images ?? []) as unknown[]);
  let variants = convertVariants(
    (raw.skus ?? []) as RawObject[],
    options,
    (raw.promotion_model ?? {}) as RawObject | undefined
  );

  if (variants.length === 0) {
    variants = [
      {
        position: 1,
        title: 'Default Title',
        price: '0.00',
        sku: undefined,
        barcode: undefined,
        options: [{ name: 'Title', value: 'Default Title' }],
        grams: 0,
        weight: 0,
        weight_unit: 'g',
      },
    ];
  }

  if (variants.length === 1 && variants[0].options.length === 0) {
    variants[0].options = [{ name: 'Title', value: 'Default Title' }];
  }

  return {
    title: String(raw.name ?? ''),
    handle: extractHandle(url, String(raw.name ?? '')),
    description_html: buildDescriptionHtml(raw),
    vendor: undefined,
    product_type: undefined,
    tags: undefined,
    options,
    published_scope: undefined,
    variants,
    images,
  };
}

export function extractTiktokProduct(url: string, doc: Document): CreateProductPayload {
  const data = readModernRouterData(doc);
  const productModel = getProductModel(data);
  const platform: PlatformCode = 'tiktok';

  return {
    platform,
    source_url: url,
    source_product_id: toStringOrUndefined(productModel.product_id ?? productModel.id),
    product: convertProduct(productModel, url),
  };
}
