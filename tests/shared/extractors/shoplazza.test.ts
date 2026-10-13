import { describe, it, expect, vi, type Mock, beforeEach } from 'vitest';
import { extractShoplazzaProduct } from '@/shared/extractors/shoplazza';

vi.mock('@/shared/storage', () => ({
  getDebugLogs: () =>
    Promise.resolve({
      enabled: false,
      persist: false,
      maxEntries: 500,
      level: 'info',
      entries: [],
    }),
  appendDebugLog: () => Promise.resolve(),
}));

function createFetchResponse(overrides: {
  ok: boolean;
  status?: number;
  text: string;
  contentType?: string | null;
}) {
  return {
    ok: overrides.ok,
    status: overrides.status ?? (overrides.ok ? 200 : 500),
    statusText: overrides.ok ? 'OK' : 'Internal Server Error',
    text: async () => overrides.text,
    headers: {
      get: () => overrides.contentType ?? null,
    },
  };
}

const PRODUCT_ID = 'f8259edf-b3c2-420c-b445-377bfccc8b23';

const sampleResponse = {
  data: {
    products: [
      {
        id: PRODUCT_ID,
        title: 'Lachry Sneakers',
        handle: 'lachry',
        description: '<p>Comfortable sneakers.</p>',
        vendor: 'Romanticed',
        product_type: 'Shoes',
        tags: ['new', 'sneakers'],
        images: [
          {
            id: 'img-1',
            src: '//img.staticdj.com/abc123.jpg',
            alt: 'Front',
          },
        ],
        options: [
          {
            name: 'Size',
            values: ['US 8', 'US 9'],
          },
        ],
        variants: [
          {
            id: 'var-1',
            title: 'US 8',
            option1: 'US 8',
            sku: 'LACHRY-08',
            price: 59.99,
            compare_at_price: 79.99,
            weight: 0.5,
            weight_unit: 'kg',
          },
        ],
      },
    ],
  },
};

function createDocWithProductJson(productId: string): Document {
  const doc = document.implementation.createHTMLDocument('ShopLazza Product');
  const script = doc.createElement('script');
  script.id = 'product-json';
  script.setAttribute('data-id', productId);
  script.setAttribute('type', 'application/json');
  doc.head.appendChild(script);
  return doc;
}

describe('extractShoplazzaProduct', () => {
  let fetchMock: Mock;

  beforeEach(() => {
    fetchMock = vi.fn();
    global.fetch = fetchMock;
  });

  it('reads product id from <script id="product-json" data-id="..."> and fetches product', async () => {
    const doc = createDocWithProductJson(PRODUCT_ID);
    fetchMock.mockResolvedValueOnce(
      createFetchResponse({
        ok: true,
        text: JSON.stringify(sampleResponse),
        contentType: 'application/json',
      })
    );

    const payload = await extractShoplazzaProduct('https://example.com/products/lachry', doc);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toContain('/api/product/list');
    expect(calledUrl).toContain(`ids%5B%5D=${PRODUCT_ID}`);
    expect(calledUrl).toContain('limit=1');
    expect(calledUrl).toContain('page=1');

    expect(payload.platform).toBe('shoplazza');
    expect(payload.source_product_id).toBe(PRODUCT_ID);
    expect(payload.product.title).toBe('Lachry Sneakers');
    expect(payload.product.handle).toBe('lachry');
    expect(payload.product.vendor).toBe('Romanticed');
    expect(payload.product.product_type).toBe('Shoes');
    expect(payload.product.tags).toEqual(['new', 'sneakers']);
    expect(payload.product.images[0].src).toBe('https://img.staticdj.com/abc123.jpg');
    expect(payload.product.variants).toHaveLength(1);
    expect(payload.product.variants[0].price).toBe('59.99');
    expect(payload.product.variants[0].compare_at_price).toBe('79.99');
    expect(payload.product.variants[0].options).toEqual([{ name: 'Size', value: 'US 8' }]);
  });

  it('throws when <script id="product-json"> is missing', async () => {
    const doc = document.implementation.createHTMLDocument('Empty');
    await expect(
      extractShoplazzaProduct('https://example.com/products/lachry', doc)
    ).rejects.toThrow('页面未找到 <script id="product-json">');
  });

  it('throws when data-id is missing', async () => {
    const doc = document.implementation.createHTMLDocument('ShopLazza Product');
    const script = doc.createElement('script');
    script.id = 'product-json';
    script.setAttribute('type', 'application/json');
    doc.head.appendChild(script);

    await expect(
      extractShoplazzaProduct('https://example.com/products/lachry', doc)
    ).rejects.toThrow('<script id="product-json"> 缺少 data-id 属性');
  });

  it('throws when doc is not provided', async () => {
    await expect(extractShoplazzaProduct('https://example.com/products/lachry')).rejects.toThrow(
      '页面未找到 <script id="product-json">'
    );
  });

  it('throws when API returns empty list', async () => {
    const doc = createDocWithProductJson(PRODUCT_ID);
    fetchMock.mockResolvedValueOnce(
      createFetchResponse({
        ok: true,
        text: JSON.stringify({ data: { products: [] } }),
        contentType: 'application/json',
      })
    );
    await expect(
      extractShoplazzaProduct('https://example.com/products/lachry', doc)
    ).rejects.toThrow('未返回商品数据');
  });
});
