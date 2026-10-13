import { describe, it, expect, vi, type Mock, beforeEach } from 'vitest';
import { extractNewshopProduct } from '@/shared/extractors/newshop';

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
  ID: 20014772,
  title: 'Sample NewShop Product',
  slug: 'sample-newshop-product',
  post_content: '<p>Product description.</p>',
  supplier: 'Test Supplier',
  categories: ['new', 'summer'],
  variant_attrs: [
    {
      name: 'Color',
      value: ['Black', 'White'],
      position: 0,
      uuid: 'uuid-1',
    },
  ],
  feature_image: {
    ID: 20044198,
    url: 'https://cdn.example.com/feature.jpg',
    alt: 'Feature',
    media_content_type: 'image',
  },
  gallery: [
    {
      ID: 20044199,
      url: 'https://cdn.example.com/gallery.jpg',
      alt: 'Gallery',
      media_content_type: 'image',
    },
  ],
  variants: [
    {
      ID: 20014773,
      title: 'Sample NewShop Product - Black',
      sku: 'SKU-BLK',
      price: 22.97,
      regular_price: 44.99,
      weight_local: '0.000',
      weight_unit: 'kg',
      attrs: [{ name: 'Color', value: 'Black' }],
    },
  ],
};

describe('extractNewshopProduct', () => {
  let fetchMock: Mock;

  beforeEach(() => {
    fetchMock = vi.fn();
    global.fetch = fetchMock;
  });

  it('converts NewShop API response to CreateProductPayload', async () => {
    fetchMock.mockResolvedValueOnce(
      createFetchResponse({
        ok: true,
        text: JSON.stringify(sampleResponse),
        contentType: 'application/json',
      })
    );

    const payload = await extractNewshopProduct(
      'https://example.com/products/sample-newshop-product'
    );

    expect(payload.platform).toBe('newshop');
    expect(payload.source_url).toBe('https://example.com/products/sample-newshop-product');
    expect(payload.source_product_id).toBe('20014772');
    expect(payload.product.title).toBe('Sample NewShop Product');
    expect(payload.product.handle).toBe('sample-newshop-product');
    expect(payload.product.description_html).toBe('<p>Product description.</p>');
    expect(payload.product.vendor).toBe('Test Supplier');
    expect(payload.product.tags).toEqual(['new', 'summer']);
    expect(payload.product.options).toEqual([
      { name: 'Color', position: 1, values: ['Black', 'White'] },
    ]);
    expect(payload.product.images).toHaveLength(2);
    expect(payload.product.images[0].type).toBe('image');
    expect(payload.product.variants).toHaveLength(1);
    expect(payload.product.variants[0].price).toBe('22.97');
    expect(payload.product.variants[0].compare_at_price).toBe('44.99');
    expect(payload.product.variants[0].options).toEqual([{ name: 'Color', value: 'Black' }]);
  });

  it('falls back to default variant when variants are empty', async () => {
    fetchMock.mockResolvedValueOnce(
      createFetchResponse({
        ok: true,
        text: JSON.stringify({
          ID: 1,
          title: 'Simple Product',
          slug: 'simple-product',
          price: 9.99,
          regular_price: 19.99,
          weight_local: '0.100',
          weight_unit: 'kg',
          feature_image: {
            ID: 1,
            url: 'https://cdn.example.com/img.jpg',
            media_content_type: 'image',
          },
          gallery: [],
          variants: [],
        }),
        contentType: 'application/json',
      })
    );

    const payload = await extractNewshopProduct('https://example.com/products/simple-product');

    expect(payload.product.variants).toHaveLength(1);
    expect(payload.product.variants[0].price).toBe('9.99');
    expect(payload.product.variants[0].options).toEqual([
      { name: 'Title', value: 'Default Title' },
    ]);
  });

  it('throws when API returns non-200', async () => {
    fetchMock.mockResolvedValueOnce(createFetchResponse({ ok: false, status: 404, text: '' }));
    await expect(extractNewshopProduct('https://example.com/products/missing')).rejects.toThrow();
  });
});
