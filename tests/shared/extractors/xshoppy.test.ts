import { describe, it, expect, vi, type Mock, beforeEach } from 'vitest';
import { extractXshoppyProduct } from '@/shared/extractors/xshoppy';

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

function createDoc(productId?: string): Document {
  const doc = document.implementation.createHTMLDocument('XShopPy Product');
  if (productId) {
    const container = doc.createElement('div');
    container.className = 'PageContainer J-PageContainer';
    const input = doc.createElement('input');
    input.type = 'hidden';
    input.className = 'product-id';
    input.setAttribute('value', productId);
    container.appendChild(input);
    doc.body.appendChild(container);
  }
  return doc;
}

const sampleResponse = {
  code: 0,
  data: {
    id: '12389',
    title: 'Comfort Gnome Figurine with Keepsake Blessing Card',
    handler: 'comfort-gnome-figurine-with-keepsake-blessing-card',
    price: '14.99',
    compare_at_price: '24.99',
    body_html:
      '<p><img data-original="//img.example.com/a.jpg" src="data:image/gif;base64,xxx" /></p>',
    attribute: [
      {
        specName: 'color',
        specItems: ['🍀 Lucky Gnome (Green)', 'set of 4'],
        specCodes: ['code-1', 'code-2'],
      },
    ],
    default_image: {
      file_id: '116570',
      file_preview: 'https://cdn.example.com/default.jpg',
    },
    images: [
      { file_id: '116564', file_preview: 'https://cdn.example.com/b.jpg' },
      { file_id: '116563', file_preview: 'https://cdn.example.com/c.jpg' },
    ],
    sku_list: [
      {
        id: '87984',
        title: '🍀 Lucky Gnome (Green)',
        price: '14.99',
        compare_at_price: '24.99',
        sku_code: 'DT810SZZR1',
        upc: '',
        grams: '0',
        weight: '0.00',
        weight_unit: 'g',
        image_id: '116564',
        image: { file_id: '116564', file_preview: 'https://cdn.example.com/b.jpg' },
        spec: '{"color":"🍀 Lucky Gnome (Green)"}',
        sort: '0',
      },
      {
        id: '87988',
        title: 'set of 4',
        price: '50.96',
        compare_at_price: '99.96',
        sku_code: 'DT810SZZR1+DT810SZZR2',
        upc: '123456789012',
        grams: '500',
        weight: '500.00',
        weight_unit: 'g',
        image_id: '116570',
        image: { file_id: '116570', file_preview: 'https://cdn.example.com/default.jpg' },
        spec: '{"color":"set of 4"}',
        sort: '4',
      },
    ],
  },
};

describe('extractXshoppyProduct', () => {
  let fetchMock: Mock;

  beforeEach(() => {
    fetchMock = vi.fn();
    global.fetch = fetchMock;
  });

  it('reads product-id from DOM and converts pop-detail response', async () => {
    fetchMock.mockResolvedValueOnce(
      createFetchResponse({
        ok: true,
        text: JSON.stringify(sampleResponse),
        contentType: 'application/json',
      })
    );

    const url =
      'https://www.berrky.com/products/comfort-gnome-figurine-with-keepsake-blessing-card';
    const payload = await extractXshoppyProduct(url, createDoc('12389'));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [fetchUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(fetchUrl).toBe('https://www.berrky.com/buyer/product/pop-detail');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ product_id: '12389' });
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');

    expect(payload.platform).toBe('xshoppy');
    expect(payload.source_url).toBe(url);
    expect(payload.source_product_id).toBe('12389');
    expect(payload.product.title).toBe('Comfort Gnome Figurine with Keepsake Blessing Card');
    expect(payload.product.handle).toBe('comfort-gnome-figurine-with-keepsake-blessing-card');

    // options 来自 attribute：name=specName，values=specItems
    expect(payload.product.options).toEqual([
      { name: 'color', position: 1, values: ['🍀 Lucky Gnome (Green)', 'set of 4'] },
    ]);

    // default_image 在首位，images 去重后 position 重排
    expect(payload.product.images.map((img) => img.src)).toEqual([
      'https://cdn.example.com/default.jpg',
      'https://cdn.example.com/b.jpg',
      'https://cdn.example.com/c.jpg',
    ]);
    expect(payload.product.images.map((img) => img.position)).toEqual([1, 2, 3]);

    // variants 来自 sku_list：spec JSON 按 option name 对齐
    expect(payload.product.variants).toHaveLength(2);
    const first = payload.product.variants[0];
    expect(first.source_variant_id).toBe('87984');
    expect(first.price).toBe('14.99');
    expect(first.compare_at_price).toBe('24.99');
    expect(first.sku).toBe('DT810SZZR1');
    expect(first.options).toEqual([{ name: 'color', value: '🍀 Lucky Gnome (Green)' }]);
    expect(first.source_image_id).toBe('116564');

    const second = payload.product.variants[1];
    expect(second.price).toBe('50.96');
    expect(second.compare_at_price).toBe('99.96');
    expect(second.barcode).toBe('123456789012');
    expect(second.grams).toBe(500);
    expect(second.source_image_id).toBe('116570');
  });

  it('cleans lazy-load data-original in description html', async () => {
    fetchMock.mockResolvedValueOnce(
      createFetchResponse({
        ok: true,
        text: JSON.stringify(sampleResponse),
        contentType: 'application/json',
      })
    );

    const payload = await extractXshoppyProduct(
      'https://example.com/products/sample',
      createDoc('12389')
    );

    expect(payload.product.description_html).toContain('src="https://img.example.com/a.jpg"');
    expect(payload.product.description_html).not.toContain('data-original');
    expect(payload.product.description_html).not.toContain('src="data:');
  });

  it('creates default variant when sku_list is empty', async () => {
    fetchMock.mockResolvedValueOnce(
      createFetchResponse({
        ok: true,
        text: JSON.stringify({
          code: 0,
          data: {
            id: '1',
            title: 'Simple Product',
            handler: 'simple-product',
            price: '9.99',
            compare_at_price: '19.99',
            body_html: '<p>desc</p>',
            attribute: [],
            images: [],
            sku_list: [],
          },
        }),
        contentType: 'application/json',
      })
    );

    const payload = await extractXshoppyProduct(
      'https://example.com/products/simple',
      createDoc('1')
    );

    expect(payload.product.variants).toHaveLength(1);
    expect(payload.product.variants[0].price).toBe('9.99');
    expect(payload.product.variants[0].options).toEqual([
      { name: 'Title', value: 'Default Title' },
    ]);
    expect(payload.product.images).toEqual([]);
  });

  it('throws when input.product-id is missing', async () => {
    await expect(
      extractXshoppyProduct('https://example.com/products/no-id', createDoc())
    ).rejects.toThrow('product-id');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws when API returns non-200', async () => {
    fetchMock.mockResolvedValueOnce(createFetchResponse({ ok: false, status: 404, text: '' }));
    await expect(
      extractXshoppyProduct('https://example.com/products/missing', createDoc('404'))
    ).rejects.toThrow();
  });

  it('throws when API response has no data', async () => {
    fetchMock.mockResolvedValueOnce(
      createFetchResponse({
        ok: true,
        text: JSON.stringify({ code: 1, msg: 'error' }),
        contentType: 'application/json',
      })
    );
    await expect(
      extractXshoppyProduct('https://example.com/products/bad', createDoc('1'))
    ).rejects.toThrow('XShopPy API 返回格式异常');
  });
});
