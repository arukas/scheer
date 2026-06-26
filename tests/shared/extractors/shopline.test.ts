import { describe, it, expect, vi, type Mock, beforeEach } from 'vitest';
import { extractShoplineProduct } from '@/shared/extractors/shopline';

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
  products: [
    {
      id: '16054505410172913613383867',
      title: 'Loose high waist sequined wide-leg pants',
      handle: 'loose-high-waist-sequined-wide-leg-pants-2',
      description: 'product description',
      brand: 'Test Brand',
      tags: ['pants', 'sequin'],
      images: ['https://img.myshopline.com/image/official/e46e6189dd5641a3b179444cacdcdd2a.png'],
      options: [
        { name: 'Color', values: ['Silver', 'White'] },
        { name: 'Size', values: ['S', 'M', 'L'] },
      ],
      variants: [
        {
          id: '18054505410177275688963867',
          barcode: 'barcode-1',
          title: 'Silver · S',
          option1: 'Silver',
          option2: 'S',
          sku: '80353SilverS-96',
          price: 1379400,
          compare_at_price: 3298,
          weight: 0.2,
          weight_unit: 'kg',
        },
      ],
    },
  ],
};

describe('extractShoplineProduct', () => {
  let fetchMock: Mock;

  beforeEach(() => {
    fetchMock = vi.fn();
    global.fetch = fetchMock;
  });

  it('converts storefront API response to CreateProductPayload', async () => {
    fetchMock.mockResolvedValueOnce(
      createFetchResponse({
        ok: true,
        text: JSON.stringify(sampleResponse),
        contentType: 'application/json',
      })
    );

    const payload = await extractShoplineProduct(
      'https://shoplinedemo.myshopline.com/products/loose-high-waist-sequined-wide-leg-pants-2'
    );

    expect(payload.platform).toBe('shopline');
    expect(payload.source_product_id).toBe('16054505410172913613383867');
    expect(payload.product.title).toBe('Loose high waist sequined wide-leg pants');
    expect(payload.product.variants).toHaveLength(1);
    expect(payload.product.variants[0].price).toBe('13794.00');
    expect(payload.product.variants[0].compare_at_price).toBe('32.98');
    expect(payload.product.variants[0].grams).toBe(200);
    expect(payload.product.variants[0].options).toEqual([
      { name: 'Color', value: 'Silver' },
      { name: 'Size', value: 'S' },
    ]);
    expect(payload.product.images).toHaveLength(1);
    expect(payload.product.options).toHaveLength(2);
  });

  it('throws when API returns message without products', async () => {
    fetchMock.mockResolvedValueOnce(
      createFetchResponse({
        ok: true,
        text: JSON.stringify({ message: 'Not found' }),
        contentType: 'application/json',
      })
    );

    await expect(
      extractShoplineProduct('https://shoplinedemo.myshopline.com/products/missing')
    ).rejects.toThrow('Not found');
  });

  it('throws when fetch fails', async () => {
    fetchMock.mockResolvedValueOnce(createFetchResponse({ ok: false, status: 500, text: '' }));

    await expect(
      extractShoplineProduct('https://shoplinedemo.myshopline.com/products/test')
    ).rejects.toThrow('500');
  });
});
