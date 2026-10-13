import { describe, it, expect, vi, type Mock, beforeEach } from 'vitest';
import { extractShopifyProduct } from '@/shared/extractors/shopify';

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

const sampleResponse = {
  product: {
    id: 123456789,
    title: 'IPod Nano - 8GB',
    handle: 'ipod-nano-8gb',
    body_html: '<p>It is the small iPod with a big idea.</p>',
    vendor: 'Apple',
    product_type: 'Electronics',
    tags: ['Emotive', 'Flash Memory', 'MP3'],
    published_scope: 'global',
    options: [{ name: 'Color', position: 1, values: ['Pink'] }],
    images: [
      { id: 1, position: 1, src: '//cdn.shopify.com/front.jpg', alt: 'Front' },
      { id: 2, position: 2, src: 'https://cdn.shopify.com/back.jpg', alt: 'Back' },
    ],
    variants: [
      {
        id: 101,
        position: 1,
        title: 'Pink',
        price: '199.00',
        compare_at_price: '249.00',
        option1: 'Pink',
        sku: 'IPOD2008PINK',
        barcode: '123456789',
        grams: 100,
        weight: 0.1,
        weight_unit: 'kg',
        image_id: 1,
      },
    ],
  },
};

describe('extractShopifyProduct', () => {
  let fetchMock: Mock;

  beforeEach(() => {
    fetchMock = vi.fn();
    global.fetch = fetchMock;
  });

  it('converts Shopify .json API response to CreateProductPayload', async () => {
    fetchMock.mockResolvedValueOnce(
      createFetchResponse({
        ok: true,
        text: JSON.stringify(sampleResponse),
        contentType: 'application/json',
      })
    );

    const payload = await extractShopifyProduct(
      'https://example.myshopify.com/products/ipod-nano-8gb'
    );

    expect(payload.platform).toBe('shopify');
    expect(payload.source_product_id).toBe('123456789');
    expect(payload.source_url).toBe('https://example.myshopify.com/products/ipod-nano-8gb');
    expect(payload.product.title).toBe('IPod Nano - 8GB');
    expect(payload.product.handle).toBe('ipod-nano-8gb');
    expect(payload.product.vendor).toBe('Apple');
    expect(payload.product.tags).toEqual(['Emotive', 'Flash Memory', 'MP3']);

    expect(payload.product.options).toEqual([{ name: 'Color', position: 1, values: ['Pink'] }]);

    expect(payload.product.images).toHaveLength(2);
    expect(payload.product.images[0].src).toBe('https://cdn.shopify.com/front.jpg');
    expect(payload.product.images[1].src).toBe('https://cdn.shopify.com/back.jpg');

    expect(payload.product.variants).toHaveLength(1);
    expect(payload.product.variants[0].price).toBe('199.00');
    expect(payload.product.variants[0].compare_at_price).toBe('249.00');
    expect(payload.product.variants[0].options).toEqual([{ name: 'Color', value: 'Pink' }]);
    expect(payload.product.variants[0].grams).toBe(100);
  });

  it('formats integer prices to two decimals', async () => {
    fetchMock.mockResolvedValueOnce(
      createFetchResponse({
        ok: true,
        text: JSON.stringify({
          product: {
            id: 1,
            title: 'Simple',
            variants: [{ id: 1, title: 'Default Title', price: 10 }],
            images: [],
            options: [],
          },
        }),
        contentType: 'application/json',
      })
    );

    const payload = await extractShopifyProduct('https://shop.example.com/products/simple');
    expect(payload.product.variants[0].price).toBe('10.00');
  });

  it('throws when product data is missing', async () => {
    fetchMock.mockResolvedValueOnce(
      createFetchResponse({ ok: true, text: JSON.stringify({}), contentType: 'application/json' })
    );

    await expect(
      extractShopifyProduct('https://example.myshopify.com/products/missing')
    ).rejects.toThrow('Shopify API 返回格式异常');
  });

  it('throws when handle cannot be extracted', async () => {
    await expect(
      extractShopifyProduct('https://example.myshopify.com/collections/all')
    ).rejects.toThrow('无法从 URL 提取商品 handle');
  });
});
