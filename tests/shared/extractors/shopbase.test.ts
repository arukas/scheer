import { describe, it, expect, vi } from 'vitest';
import { extractShopbaseProduct } from '@/shared/extractors/shopbase';

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

const initialState = {
  product: {
    product: {
      id: 1000000268289182,
      title: 'IPod Nano - 8GB',
      handle: 'ipod-nano-8gb-test-1',
      description: "<p>It's the small iPod with a big idea: Video.</p>",
      vendor: 'Apple',
      product_type: 'Electronics',
      tags: 'Emotive,Flash Memory,MP3,Music',
      options: [
        {
          id: 668059037,
          name: 'color',
          values: [{ id: 3525242058, name: 'IPOD2008PINK' }],
        },
      ],
      images: [
        { id: 123, src: '//img.staticdj.com/front.jpg', alt: 'Front' },
        { id: 124, src: 'https://img.staticdj.com/back.jpg', alt: 'Back' },
      ],
      variants: [
        {
          id: 1000006486982963,
          title: 'IPOD2008PINK',
          option1: 3525242058,
          option2: 0,
          option3: 0,
          sku: '',
          barcode: '9 788073 400972',
          price: 100,
          compare_at_price: 200,
          weight: 0,
          weight_unit: 'g',
          image_id: 123,
        },
      ],
    },
  },
};

function createDocWithState(state: unknown): Document {
  const doc = document.implementation.createHTMLDocument('ShopBase Product');
  const script = doc.createElement('script');
  script.id = '__INITIAL_STATE__';
  script.setAttribute('type', 'application/json');
  script.textContent = JSON.stringify(state);
  doc.head.appendChild(script);
  return doc;
}

describe('extractShopbaseProduct', () => {
  it('reads product from <script id="__INITIAL_STATE__">', () => {
    const doc = createDocWithState(initialState);

    const payload = extractShopbaseProduct(
      'https://hakuryuu.onshopbase.com/products/ipod-nano-8gb-test-1',
      doc
    );

    expect(payload.platform).toBe('shopbase');
    expect(payload.source_product_id).toBe('1000000268289182');
    expect(payload.product.title).toBe('IPod Nano - 8GB');
    expect(payload.product.handle).toBe('ipod-nano-8gb-test-1');
    expect(payload.product.description_html).toBe(
      "<p>It's the small iPod with a big idea: Video.</p>"
    );
    expect(payload.product.vendor).toBe('Apple');
    expect(payload.product.product_type).toBe('Electronics');
    expect(payload.product.tags).toEqual(['Emotive', 'Flash Memory', 'MP3', 'Music']);

    expect(payload.product.options).toEqual([
      { name: 'color', position: 1, values: ['IPOD2008PINK'] },
    ]);

    expect(payload.product.images).toHaveLength(2);
    expect(payload.product.images[0].src).toBe('https://img.staticdj.com/front.jpg');
    expect(payload.product.images[1].src).toBe('https://img.staticdj.com/back.jpg');

    expect(payload.product.variants).toHaveLength(1);
    expect(payload.product.variants[0].price).toBe('100.00');
    expect(payload.product.variants[0].compare_at_price).toBe('200.00');
    expect(payload.product.variants[0].barcode).toBe('9 788073 400972');
    expect(payload.product.variants[0].options).toEqual([{ name: 'color', value: 'IPOD2008PINK' }]);
    expect(payload.product.variants[0].weight_unit).toBe('g');
  });

  it('throws when <script id="__INITIAL_STATE__"> is missing', () => {
    const doc = document.implementation.createHTMLDocument('Empty');
    expect(() => extractShopbaseProduct('https://example.com/products/test', doc)).toThrow(
      '页面未找到 <script id="__INITIAL_STATE__">'
    );
  });

  it('throws when product.product is missing', () => {
    const doc = createDocWithState({ product: {} });
    expect(() => extractShopbaseProduct('https://example.com/products/test', doc)).toThrow(
      '__INITIAL_STATE__ 中未找到 product.product'
    );
  });

  it('creates default variant when variants is empty', () => {
    const state = JSON.parse(JSON.stringify(initialState));
    state.product.product.variants = [];
    state.product.product.options = [];
    const doc = createDocWithState(state);

    const payload = extractShopbaseProduct('https://example.com/products/test', doc);

    expect(payload.product.variants).toHaveLength(1);
    expect(payload.product.variants[0].title).toBe('Default Title');
    expect(payload.product.variants[0].options).toEqual([
      { name: 'Title', value: 'Default Title' },
    ]);
  });
});
