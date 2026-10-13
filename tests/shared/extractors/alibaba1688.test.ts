import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { extractAlibaba1688Product } from '@/shared/extractors/alibaba1688';

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

const OFFER_URL =
  'https://detail.1688.com/offer/987833987148.html?spm=a26352.13672862.searchofferinput';
const DETAIL_URL = 'https://itemcdn.tmall.com/1688offer/icoss-test';

/**
 * 构造与真实页面一致的 window.context 内联脚本。
 * 注意 skuFeatures 使用未加引号的数字键，模拟真实页面的非严格 JSON 字面量。
 */
function buildContextScript(): string {
  return `window.context=(function(b,d){var c=d.module||{};return d})(window.contextPath,{
  "result": {
    "data": {
      "productPackInfo": {"fields": {"unitWeight": 0.100}},
      "productTitle": {"fields": {"title": "t", "shopInfo": {"companyName": "佛山市凯贝利服饰有限公司"}}},
      "description": {"fields": {"detailUrl": "${DETAIL_URL}"}},
      "gallery": {"fields": {"offerImgList": ["https://cbu01.alicdn.com/img/ibank/fallback.jpg"]}},
      "Root": {"fields": {"dataJson": {"skuModel": {
        "skuProps": [],
        "skuFeatures": {5953855396376: {"cbu_hot_type": "skuprice_v1"}},
        "skuInfoMap": {
          "specid-1": {"specId": "specid-1", "skuId": 5953855396373, "discountPrice": "19.90", "price": "19.90", "specAttrs": "粉色&gt;80cm", "canBookCount": 0},
          "specid-2": {"specId": "specid-2", "skuId": 5953855396382, "discountPrice": "19.90", "price": "29.90", "specAttrs": "花灰色&gt;90cm", "canBookCount": 23}
        }
      }}}}
    },
    "global": {"globalData": {"model": {
      "offerDetail": {
        "offerId": 987833987148,
        "subject": "女童裤子2026秋季新款儿童喇叭裤",
        "leafCategoryName": "童裤",
        "featureAttributes": [
          {"name": "品牌", "value": "贝淘芽", "values": ["贝淘芽"]},
          {"name": "货号", "value": "D25233", "values": ["D25233"]},
          {"name": "适合季节", "value": "春秋,春季,秋季", "values": ["春秋", "春季", "秋季"]},
          {"name": "颜色", "value": "杏色,粉色", "values": ["杏色", "粉色"]},
          {"name": "适合身高", "value": "80cm,90cm", "values": ["80cm", "90cm"]}
        ],
        "mainImageList": [
          {"fullPathImageURI": "https://cbu01.alicdn.com/img/ibank/main1.jpg"},
          {"fullPathImageURI": "https://cbu01.alicdn.com/img/ibank/main2.jpg"}
        ],
        "skuProps": [
          {"fid": 3216, "prop": "颜色", "value": [
            {"name": "杏色", "imageUrl": "https://cbu01.alicdn.com/img/ibank/main1.jpg"},
            {"name": "粉色"},
            {"name": "花灰色"}
          ]},
          {"fid": 100019113, "prop": "适合身高", "value": [{"name": "80cm"}, {"name": "90cm"}]}
        ]
      },
      "tradeModel": {
        "minPrice": "19.90",
        "maxPrice": "29.90",
        "offerPriceModel": {"currentPrices": [{"beginAmount": 2, "price": "19.90"}]}
      }
    }}}
  }
});`;
}

function createDocWithContext(scriptText: string): Document {
  const doc = document.implementation.createHTMLDocument('1688 Offer');
  const script = doc.createElement('script');
  script.textContent = scriptText;
  doc.head.appendChild(script);
  return doc;
}

function mockDetailFetch(content?: string): Mock {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    text: async () => `var offer_details={"content":${JSON.stringify(content ?? '')}}`,
  });
  global.fetch = fetchMock;
  return fetchMock;
}

describe('extractAlibaba1688Product', () => {
  beforeEach(() => {
    mockDetailFetch('<div><img data-src="//cbu01.alicdn.com/img/ibank/detail1.jpg"/></div>');
  });

  it('extracts full product from window.context inline script', async () => {
    const doc = createDocWithContext(buildContextScript());

    const payload = await extractAlibaba1688Product(OFFER_URL, doc);

    expect(payload.platform).toBe('alibaba1688');
    expect(payload.source_url).toBe(OFFER_URL);
    // offerId 优先从 URL 提取
    expect(payload.source_product_id).toBe('987833987148');

    const { product } = payload;
    expect(product.title).toBe('女童裤子2026秋季新款儿童喇叭裤');
    expect(product.vendor).toBe('佛山市凯贝利服饰有限公司');
    expect(product.product_type).toBe('童裤');

    expect(product.options).toEqual([
      { name: '颜色', position: 1, values: ['杏色', '粉色', '花灰色'] },
      { name: '适合身高', position: 2, values: ['80cm', '90cm'] },
    ]);

    expect(product.images).toHaveLength(2);
    expect(product.images[0]).toMatchObject({
      source_image_id: '1',
      position: 1,
      src: 'https://cbu01.alicdn.com/img/ibank/main1.jpg',
      type: 'image',
    });

    expect(product.variants).toHaveLength(2);

    const v1 = product.variants[0];
    expect(v1.source_variant_id).toBe('5953855396373');
    expect(v1.sku).toBe('5953855396373');
    expect(v1.title).toBe('粉色 / 80cm');
    expect(v1.price).toBe('19.90');
    // price 与 discountPrice 相同，不输出划线价
    expect(v1.compare_at_price).toBeUndefined();
    expect(v1.options).toEqual([
      { name: '颜色', value: '粉色' },
      { name: '适合身高', value: '80cm' },
    ]);
    expect(v1.grams).toBe(100);
    expect(v1.weight).toBe(0.1);
    expect(v1.weight_unit).toBe('kg');

    const v2 = product.variants[1];
    expect(v2.price).toBe('19.90');
    // price 29.90 > discountPrice 19.90，输出划线价
    expect(v2.compare_at_price).toBe('29.90');
  });

  it('links variant to sku image when 色卡图 matches a main image', async () => {
    const doc = createDocWithContext(buildContextScript());
    // 让第一个 SKU 的颜色值带色卡图
    const script = buildContextScript().replace(
      '"specAttrs": "粉色&gt;80cm"',
      '"specAttrs": "杏色&gt;80cm"'
    );
    doc.head.removeChild(doc.querySelector('script')!);
    const s2 = doc.createElement('script');
    s2.textContent = script;
    doc.head.appendChild(s2);

    const payload = await extractAlibaba1688Product(OFFER_URL, doc);

    expect(payload.product.variants[0].source_image_id).toBe('1');
    expect(payload.product.variants[1].source_image_id).toBeUndefined();
  });

  it('fetches and cleans detail html from itemcdn detailUrl', async () => {
    const doc = createDocWithContext(buildContextScript());

    const payload = await extractAlibaba1688Product(OFFER_URL, doc);

    expect(global.fetch).toHaveBeenCalledWith(DETAIL_URL, expect.anything());
    // 属性表在前，详情图在后；与规格同名的 颜色/适合身高 不进入属性表
    expect(payload.product.description_html).toBe(
      '<table><tbody>' +
        '<tr><th>品牌</th><td>贝淘芽</td></tr>' +
        '<tr><th>货号</th><td>D25233</td></tr>' +
        '<tr><th>适合季节</th><td>春秋,春季,秋季</td></tr>' +
        '</tbody></table>' +
        '<div><img src="https://cbu01.alicdn.com/img/ibank/detail1.jpg"></div>'
    );
  });

  it('keeps attributes table as description when detail fetch fails', async () => {
    const doc = createDocWithContext(buildContextScript());
    global.fetch = vi.fn().mockRejectedValue(new Error('network error'));

    const payload = await extractAlibaba1688Product(OFFER_URL, doc);

    expect(payload.product.title).toBe('女童裤子2026秋季新款儿童喇叭裤');
    expect(payload.product.description_html).toBe(
      '<table><tbody>' +
        '<tr><th>品牌</th><td>贝淘芽</td></tr>' +
        '<tr><th>货号</th><td>D25233</td></tr>' +
        '<tr><th>适合季节</th><td>春秋,春季,秋季</td></tr>' +
        '</tbody></table>'
    );
  });

  it('falls back to default variant with first tier price when skuInfoMap is empty', async () => {
    const fixed = buildContextScript().replace(
      /"specid-1": \{[^}]+\},\s*"specid-2": \{[^}]+\}/,
      ''
    );
    const doc = createDocWithContext(fixed);

    const payload = await extractAlibaba1688Product(OFFER_URL, doc);

    expect(payload.product.variants).toHaveLength(1);
    expect(payload.product.variants[0].title).toBe('Default Title');
    expect(payload.product.variants[0].price).toBe('19.90');
    expect(payload.product.variants[0].options).toEqual([
      { name: 'Title', value: 'Default Title' },
    ]);
  });

  it('throws when window.context script is missing', async () => {
    const doc = document.implementation.createHTMLDocument('Empty');
    await expect(extractAlibaba1688Product(OFFER_URL, doc)).rejects.toThrow(
      '页面未找到 window.context 注水脚本'
    );
  });

  it('throws when subject is missing', async () => {
    const script = buildContextScript().replace('"subject": "女童裤子2026秋季新款儿童喇叭裤",', '');
    const doc = createDocWithContext(script);
    await expect(extractAlibaba1688Product(OFFER_URL, doc)).rejects.toThrow(
      'window.context 中未找到商品标题'
    );
  });
});
