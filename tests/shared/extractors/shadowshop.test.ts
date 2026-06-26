import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { extractShadowshopProduct } from '@/shared/extractors/shadowshop';

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

const sampleState = {
  config: {
    images: {
      baseUrl: 'https://minio.storedfilezone.com/img/',
    },
  },
  route: {
    params: { handle: 'airflow-jaw-strap' },
  },
  product: {
    current: {
      id: '69aea1847772815db585af6f',
      sku: '69aea1847772815db585af6f',
      slug: 'airflow-jaw-strap',
      name: ' 💥AirFlow Jaw Strap💥',
      description: '<p>Product description.</p>',
      price: 29.99,
      original_price: 59.99,
      final_price: 29.99,
      special_price: 29.99,
      weight_unit: 'lb',
      tags: ['sleep', 'apnea'],
      media_gallery: [
        {
          vid: null,
          image: '/69aea180a76e13000a437ccd/2026/03/09/product-img-69aea42a7772815db585c2ca.webp',
          pos: 1,
          typ: 'image',
          lab: 'image',
        },
      ],
      configurable_options: [
        {
          label: '🛒BUY MORE SALE MORE🛒',
          attribute_code: '🛒buy more sale more🛒',
          values: [
            { value_index: 1, label: '✨ BUY 1  ✨' },
            { value_index: 2, label: '✨ BUY 2 SAVE $15 - ONLY TODAY✨' },
          ],
        },
      ],
      configurable_children: [
        {
          id: '69aea1847772815db585af6f',
          sku: '69aea1847772815db585af6f',
          name: '✨ BUY 1  ✨',
          price: 29.99,
          original_price: 59.99,
          final_price: 29.99,
          special_price: 29.99,
          weight_unit: 'lb',
          '🛒buy more sale more🛒': 1,
        },
        {
          id: '69aea1847772815db585af70',
          sku: '69aea1847772815db585af70',
          name: '✨ BUY 2 SAVE $15 - ONLY TODAY✨',
          price: 44.98,
          original_price: 119.99,
          final_price: 44.98,
          special_price: 44.98,
          weight_unit: 'lb',
          '🛒buy more sale more🛒': 2,
        },
      ],
    },
  },
};

function createDocWithInitialState(state: unknown): Document {
  const doc = document.implementation.createHTMLDocument('ShadowShop Product');
  const script = doc.createElement('script');
  script.textContent = `window.__INITIAL_STATE__ = ${JSON.stringify(state)};`;
  doc.head.appendChild(script);
  return doc;
}

describe('extractShadowshopProduct', () => {
  let originalInitialState: unknown;

  beforeEach(() => {
    originalInitialState = (window as unknown as Record<string, unknown>).__INITIAL_STATE__;
    delete (window as unknown as Record<string, unknown>).__INITIAL_STATE__;
  });

  afterEach(() => {
    if (originalInitialState !== undefined) {
      (window as unknown as Record<string, unknown>).__INITIAL_STATE__ = originalInitialState;
    } else {
      delete (window as unknown as Record<string, unknown>).__INITIAL_STATE__;
    }
  });

  it('reads from window.__INITIAL_STATE__ and converts product', async () => {
    (window as unknown as Record<string, unknown>).__INITIAL_STATE__ = JSON.parse(
      JSON.stringify(sampleState)
    );

    const payload = await extractShadowshopProduct(
      'https://www.meloceo.shop/products/airflow-jaw-strap'
    );

    expect(payload.platform).toBe('shadowshop');
    expect(payload.source_url).toBe('https://www.meloceo.shop/products/airflow-jaw-strap');
    expect(payload.source_product_id).toBe('69aea1847772815db585af6f');
    expect(payload.product.title).toBe(' 💥AirFlow Jaw Strap💥');
    expect(payload.product.handle).toBe('airflow-jaw-strap');
    expect(payload.product.description_html).toBe('<p>Product description.</p>');
    expect(payload.product.tags).toEqual(['sleep', 'apnea']);

    expect(payload.product.images).toHaveLength(1);
    expect(payload.product.images[0].src).toBe(
      'https://minio.storedfilezone.com/img/69aea180a76e13000a437ccd/2026/03/09/product-img-69aea42a7772815db585c2ca.webp'
    );

    expect(payload.product.options).toEqual([
      {
        name: '🛒BUY MORE SALE MORE🛒',
        position: 1,
        values: ['✨ BUY 1  ✨', '✨ BUY 2 SAVE $15 - ONLY TODAY✨'],
      },
    ]);

    expect(payload.product.variants).toHaveLength(2);
    expect(payload.product.variants[0].price).toBe('29.99');
    expect(payload.product.variants[0].compare_at_price).toBe('59.99');
    expect(payload.product.variants[0].options).toEqual([
      { name: '🛒BUY MORE SALE MORE🛒', value: '✨ BUY 1  ✨' },
    ]);
    expect(payload.product.variants[1].price).toBe('44.98');
    expect(payload.product.variants[1].compare_at_price).toBe('119.99');
  });

  it('falls back to parsing script tag when window object is absent', async () => {
    const doc = createDocWithInitialState(sampleState);

    const payload = await extractShadowshopProduct(
      'https://www.meloceo.shop/products/airflow-jaw-strap',
      doc
    );

    expect(payload.product.title).toBe(' 💥AirFlow Jaw Strap💥');
    expect(payload.product.variants).toHaveLength(2);
  });

  it('creates default variant when configurable_children is empty', async () => {
    const state = JSON.parse(JSON.stringify(sampleState));
    state.product.current.configurable_children = [];

    const doc = createDocWithInitialState(state);
    const payload = await extractShadowshopProduct(
      'https://www.meloceo.shop/products/airflow-jaw-strap',
      doc
    );

    expect(payload.product.variants).toHaveLength(1);
    expect(payload.product.variants[0].title).toBe('Default Title');
    expect(payload.product.variants[0].price).toBe('29.99');
    expect(payload.product.variants[0].options).toEqual([
      { name: 'Title', value: 'Default Title' },
    ]);
  });

  it('throws when initial state is missing', async () => {
    const doc = document.implementation.createHTMLDocument('Empty');
    await expect(
      extractShadowshopProduct('https://www.meloceo.shop/products/missing', doc)
    ).rejects.toThrow('页面未找到 window.__INITIAL_STATE__');
  });

  it('throws when current product is missing', async () => {
    const doc = createDocWithInitialState({ config: {}, product: {} });
    await expect(
      extractShadowshopProduct('https://www.meloceo.shop/products/missing', doc)
    ).rejects.toThrow('window.__INITIAL_STATE__ 中未找到商品数据');
  });
});
