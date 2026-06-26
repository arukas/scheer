/**
 * 通用 JSON-LD / Schema.org Product 抓取器
 *
 * 作为 ShopLine 等平台的兜底采集方案：
 * 从页面的 `<script type="application/ld+json">` 中读取 Product 结构化数据。
 */

import type {
  CreateProductPayload,
  PlatformCode,
  Product,
  ProductImage,
  ProductVariant,
} from '../schema';
import { extractHandle } from '../platform';

type RawObject = Record<string, unknown>;

function parseLdJsonScripts(doc: Document): RawObject[] {
  const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
  const result: RawObject[] = [];
  scripts.forEach((script) => {
    try {
      const text = script.textContent?.trim() ?? '';
      if (!text) return;
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        result.push(...(parsed as RawObject[]));
      } else {
        result.push(parsed as RawObject);
      }
    } catch {
      // 忽略解析失败的 JSON-LD
    }
  });
  return result;
}

function findProductGraph(nodes: RawObject[]): RawObject | null {
  for (const node of nodes) {
    if (node['@type'] === 'Product') return node;
    const graph = node['@graph'];
    if (Array.isArray(graph)) {
      const found = (graph as RawObject[]).find((item) => item['@type'] === 'Product');
      if (found) return found;
    }
  }
  return null;
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

function extractImages(product: RawObject): ProductImage[] {
  const images: string[] = [];
  const rawImage = product.image;
  if (typeof rawImage === 'string') {
    images.push(rawImage);
  } else if (Array.isArray(rawImage)) {
    rawImage.forEach((item) => {
      if (typeof item === 'string') images.push(item);
      else if (item && typeof item === 'object' && typeof (item as RawObject).url === 'string') {
        images.push(String((item as RawObject).url));
      }
    });
  } else if (
    rawImage &&
    typeof rawImage === 'object' &&
    typeof (rawImage as RawObject).url === 'string'
  ) {
    images.push(String((rawImage as RawObject).url));
  }

  return images.map((src, idx) => ({
    position: idx + 1,
    src: normalizeSrc(src),
    type: 'image' as const,
  }));
}

function extractVariants(product: RawObject): {
  variants: ProductVariant[];
  options: { name: string; values: string[] } | null;
} {
  const offersRaw = product.offers;
  const offers: RawObject[] = [];
  if (Array.isArray(offersRaw)) {
    offers.push(...(offersRaw as RawObject[]));
  } else if (offersRaw && typeof offersRaw === 'object') {
    offers.push(offersRaw as RawObject);
  }

  if (offers.length === 0) {
    // 没有 offers 时退化为一个默认 variant
    return {
      variants: [
        {
          position: 1,
          title: 'Default Title',
          options: [{ name: 'Title', value: 'Default Title' }],
          price: '0',
          grams: 0,
        },
      ],
      options: { name: 'Title', values: ['Default Title'] },
    };
  }

  const variants = offers.map((offer, idx) => {
    const sku = toStringOrUndefined(offer.sku);
    const price =
      typeof offer.price === 'number' ? offer.price.toFixed(2) : String(offer.price ?? '0');
    return {
      source_variant_id: toStringOrUndefined(offer.sku) ?? String(idx + 1),
      position: idx + 1,
      title: toStringOrUndefined(offer.name) ?? 'Default Title',
      options: [{ name: 'Title', value: 'Default Title' }],
      price,
      sku,
      grams: 0,
    };
  });

  return { variants, options: { name: 'Title', values: ['Default Title'] } };
}

function buildProduct(product: RawObject, url: string): Product {
  const { variants, options } = extractVariants(product);
  const images = extractImages(product);

  return {
    title: String(product.name ?? ''),
    handle: extractHandle(url).handle ?? undefined,
    description_html: toStringOrUndefined(product.description),
    vendor: toStringOrUndefined((product.brand as RawObject)?.name),
    product_type: undefined,
    tags: undefined,
    options: options
      ? [
          {
            name: options.name,
            position: 1,
            values: options.values,
          },
        ]
      : undefined,
    published_scope: undefined,
    variants,
    images,
  };
}

export async function extractJsonLdProduct(
  url: string,
  platform: PlatformCode,
  doc: Document
): Promise<CreateProductPayload> {
  const nodes = parseLdJsonScripts(doc);
  const productNode = findProductGraph(nodes);
  if (!productNode) {
    throw new Error('页面未找到 schema.org Product JSON-LD');
  }

  return {
    platform,
    source_url: url,
    source_product_id:
      toStringOrUndefined(productNode.sku) ?? toStringOrUndefined(productNode.productID),
    product: buildProduct(productNode, url),
  };
}
