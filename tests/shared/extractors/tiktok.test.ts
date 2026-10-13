import { describe, it, expect, vi } from 'vitest';
import { extractTiktokProduct } from '@/shared/extractors/tiktok';

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

function createModernRouterData(
  productInfoOverrides?: Record<string, unknown>
): Record<string, unknown> {
  const productModel = {
    product_id: '1729473612345678901',
    name: 'TikTok USB LED Strip',
    description: '<p>Cool LED strip for your room.</p>',
    product_properties: [
      { name: 'Material', value: 'PVC' },
      { name: 'Length', value: '5m' },
    ],
    sale_properties: [
      {
        property_name: 'Color',
        property_values: [
          { property_value_name: 'Warm White' },
          { property_value_name: 'Cool White' },
        ],
      },
    ],
    images: [
      { id: 'img-1', url_list: ['https://example.com/a.jpg?x=1'] },
      { id: 'img-2', url_list: ['https://example.com/b.jpg?y=2'] },
    ],
    skus: [
      {
        id: 'sku-1',
        sku_name: 'Warm White',
        sku_id: 'SKU001',
        property_pairs: [{ sku_property_name: 'Color', sku_property_value_name: 'Warm White' }],
      },
      {
        id: 'sku-2',
        sku_name: 'Cool White',
        sku_id: 'SKU002',
        property_pairs: [{ sku_property_name: 'Color', sku_property_value_name: 'Cool White' }],
      },
    ],
    promotion_model: {
      discount_decimal: 0.8,
      promotion_product_price: {
        skus_price: {
          'Warm White': { seller_subtotal_deduction: 9.99 },
          'Cool White': { seller_subtotal_deduction: 11.99 },
        },
      },
    },
    ...productInfoOverrides,
  };

  return {
    loaderData: [
      {
        page_config: {
          components_map: {
            product_info_component: {
              component_name: 'product_info',
              component_data: {
                product_info: {
                  product_model: productModel,
                },
              },
            },
          },
        },
      },
    ],
  };
}

function createDocWithData(data: unknown): Document {
  const doc = document.implementation.createHTMLDocument('TikTok Product');
  const script = doc.createElement('script');
  script.id = '__MODERN_ROUTER_DATA__';
  script.setAttribute('type', 'application/json');
  script.textContent = JSON.stringify(data);
  doc.head.appendChild(script);
  return doc;
}

describe('extractTiktokProduct', () => {
  it('reads product from <script id="__MODERN_ROUTER_DATA__">', () => {
    const doc = createDocWithData(createModernRouterData());

    const payload = extractTiktokProduct(
      'https://shop.tiktok.com/view/product/tiktok-usb-led-strip',
      doc
    );

    expect(payload.platform).toBe('tiktok');
    expect(payload.source_product_id).toBe('1729473612345678901');
    expect(payload.product.title).toBe('TikTok USB LED Strip');
    expect(payload.product.handle).toBe('tiktok-usb-led-strip');
    expect(payload.product.description_html).toContain('<table>');
    expect(payload.product.description_html).toContain('Cool LED strip for your room.');

    expect(payload.product.options).toEqual([
      { name: 'Color', position: 1, values: ['Warm White', 'Cool White'] },
    ]);

    expect(payload.product.images).toHaveLength(2);
    expect(payload.product.images[0].src).toBe('https://example.com/a.jpg');
    expect(payload.product.images[1].src).toBe('https://example.com/b.jpg');

    expect(payload.product.variants).toHaveLength(2);
    expect(payload.product.variants[0].title).toBe('Warm White');
    expect(payload.product.variants[0].price).toBe('9.99');
    expect(payload.product.variants[0].compare_at_price).toBe('12.49');
    expect(payload.product.variants[0].options).toEqual([{ name: 'Color', value: 'Warm White' }]);
    expect(payload.product.variants[1].title).toBe('Cool White');
    expect(payload.product.variants[1].price).toBe('11.99');
  });

  it('uses title slug when URL segment is numeric id', () => {
    const doc = createDocWithData(createModernRouterData());

    const payload = extractTiktokProduct(
      'https://shop.tiktok.com/view/product/1729473612345678901',
      doc
    );

    expect(payload.product.handle).toBe('tiktok-usb-led-strip');
  });

  it('throws when script is missing', () => {
    const doc = document.implementation.createHTMLDocument('Empty');
    expect(() => extractTiktokProduct('https://shop.tiktok.com/view/product/x', doc)).toThrow(
      '页面未找到 <script id="__MODERN_ROUTER_DATA__">'
    );
  });

  it('throws when product_info component is missing', () => {
    const doc = createDocWithData({ loaderData: [{ page_config: { components_map: {} } }] });
    expect(() => extractTiktokProduct('https://shop.tiktok.com/view/product/x', doc)).toThrow(
      '未在 __MODERN_ROUTER_DATA__ 中找到 product_info 组件'
    );
  });

  it('throws on region restricted error', () => {
    const data = createModernRouterData();
    const component = (data.loaderData as Record<string, unknown>[])[0].page_config as Record<
      string,
      unknown
    >;
    const map = component.components_map as Record<string, unknown>;
    const info = map.product_info_component as Record<string, unknown>;
    (info.component_data as Record<string, unknown>).error_code = '23002002';

    const doc = createDocWithData(data);
    expect(() => extractTiktokProduct('https://shop.tiktok.com/view/product/x', doc)).toThrow(
      'TikTok 商品不可访问（下架或区域限制）'
    );
  });
});
