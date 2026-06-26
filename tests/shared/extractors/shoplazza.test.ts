import { describe, it, expect, vi, type Mock, beforeEach, afterEach } from 'vitest';
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

const cSettings = {
  image_domain: '//img.staticdj.com/',
  meta: {
    page: {
      template_name: 'product',
      resource_id: 'f8259edf-b3c2-420c-b445-377bfccc8b23',
    },
  },
  shop: {
    shop_id: '254906',
  },
};

const sampleResponse = {
  data: {
    products: [
      {
        id: 'f8259edf-b3c2-420c-b445-377bfccc8b23',
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

function createDocWithCSettings(settings: unknown): Document {
  const doc = document.implementation.createHTMLDocument('ShopLazza Product');
  const script = doc.createElement('script');
  script.textContent = `window.C_SETTINGS = ${JSON.stringify(settings)};`;
  doc.head.appendChild(script);
  return doc;
}

describe('extractShoplazzaProduct', () => {
  let fetchMock: Mock;
  let originalCSettings: unknown;

  beforeEach(() => {
    fetchMock = vi.fn();
    global.fetch = fetchMock;
    originalCSettings = (window as unknown as Record<string, unknown>).C_SETTINGS;
    delete (window as unknown as Record<string, unknown>).C_SETTINGS;
  });

  afterEach(() => {
    if (originalCSettings !== undefined) {
      (window as unknown as Record<string, unknown>).C_SETTINGS = originalCSettings;
    } else {
      delete (window as unknown as Record<string, unknown>).C_SETTINGS;
    }
  });

  it('reads from window.C_SETTINGS and fetches product by resource_id', async () => {
    (window as unknown as Record<string, unknown>).C_SETTINGS = JSON.parse(
      JSON.stringify(cSettings)
    );
    fetchMock.mockResolvedValueOnce(
      createFetchResponse({
        ok: true,
        text: JSON.stringify(sampleResponse),
        contentType: 'application/json',
      })
    );

    const payload = await extractShoplazzaProduct('https://example.com/products/lachry');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toContain('/api/product/list');
    expect(calledUrl).toContain('ids%5B%5D=f8259edf-b3c2-420c-b445-377bfccc8b23');
    expect(calledUrl).toContain('limit=1');
    expect(calledUrl).toContain('page=1');

    expect(payload.platform).toBe('shoplazza');
    expect(payload.source_product_id).toBe('f8259edf-b3c2-420c-b445-377bfccc8b23');
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

  it('falls back to parsing script tag when window object is absent', async () => {
    const doc = createDocWithCSettings(cSettings);
    fetchMock.mockResolvedValueOnce(
      createFetchResponse({
        ok: true,
        text: JSON.stringify(sampleResponse),
        contentType: 'application/json',
      })
    );

    const payload = await extractShoplazzaProduct('https://example.com/products/lachry', doc);
    expect(payload.product.title).toBe('Lachry Sneakers');
  });

  it('throws when C_SETTINGS is missing', async () => {
    const doc = document.implementation.createHTMLDocument('Empty');
    await expect(
      extractShoplazzaProduct('https://example.com/products/lachry', doc)
    ).rejects.toThrow('页面未找到 window.C_SETTINGS');
  });

  it('throws when resource_id is missing', async () => {
    const badSettings = JSON.parse(JSON.stringify(cSettings));
    delete badSettings.meta.page.resource_id;
    const doc = createDocWithCSettings(badSettings);
    await expect(
      extractShoplazzaProduct('https://example.com/products/lachry', doc)
    ).rejects.toThrow('未找到 meta.page.resource_id');
  });

  it('throws when API returns empty list', async () => {
    const doc = createDocWithCSettings(cSettings);
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
