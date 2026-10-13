import { describe, it, expect, vi } from 'vitest';
import { extractAmazonProduct, parseAmazonPrice } from '@/shared/extractors/amazon';

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

const PAGE_URL = 'https://www.amazon.com/Test-Ring/dp/B0TEST00A2';

// 三维变体 twister 样本（裁剪自真实 Oura 页面结构，含 JS 字符串拼接以验证按键提取）
const TWISTER_SCRIPT = `
  P.register('twister-js-init-dpx-data', function() {
    var dataToReturn = {
      "isTabletWeb" : false,
      "ajaxUrlParams" : "&parentAsin=B0PARENT01" + "&landingAsin=B0TEST00A2",
      "variationValues" : {"size_name":["7","8"],"color_name":["Silver","Gold"],"style_name":["Ring"]},
      "selectedVariationValues" : {"size_name":1,"color_name":0,"style_name":0},
      "num_total_variations" : 3,
      "dimensions" : ["style_name","size_name","color_name"],
      "variationDisplayLabels" : {"size_name":"Size","color_name":"Color","style_name":"Style"},
      "dimensionValuesDisplayData" : {
        "B0TEST00A1":["Ring","7","Silver"],
        "B0TEST00A2":["Ring","8","Silver"],
        "B0TEST00A3":["Ring","7","Gold"]
      },
      "shouldUseDPXTwisterData" : 1,
      "currentAsin" : "B0TEST00A2",
      "landingAsin": "B0TEST00A2",
      "parentAsin" : "B0PARENT01",
      "dimensionToAsinMap" : {"0_0_0":"B0TEST00A1","0_1_0":"B0TEST00A2","0_0_1":"B0TEST00A3"}
    };
  });
`;

const COLOR_IMAGES_SCRIPT = `
  P.now('media-block-initialised').execute(function() {
    var data = {
      'colorImages': { 'initial': [
        {"hiRes":"https://m.media-amazon.com/images/I/aaa._AC_SL1500_.jpg","large":"https://m.media-amazon.com/images/I/aaa._AC_.jpg","variant":"MAIN"},
        {"hiRes":null,"large":"//m.media-amazon.com/images/I/bbb._AC_.jpg","variant":"PT01"}
      ], 'colorToAsin': {} }
    };
  });
`;

interface DomOptions {
  title?: string;
  byline?: string;
  priceHtml?: string;
  bullets?: boolean;
  description?: boolean;
  breadcrumbs?: boolean;
  swatches?: Array<[string, string]>;
}

function buildDoc(dom: DomOptions = {}, scripts: string[] = []): Document {
  const doc = document.implementation.createHTMLDocument('Amazon Product');

  const priceRegion =
    dom.priceHtml !== undefined
      ? `<div id="corePrice_feature_div">${dom.priceHtml}</div>`
      : `<div id="corePrice_feature_div">
          <span class="a-price" data-a-size="xl"><span class="a-offscreen">$399.00</span></span>
        </div>`;

  doc.body.innerHTML = `
    ${dom.title !== undefined ? `<span id="productTitle">${dom.title}</span>` : ''}
    ${dom.byline !== undefined ? `<a id="bylineInfo" href="#">${dom.byline}</a>` : ''}
    ${priceRegion}
    ${
      dom.swatches
        ? dom.swatches
            .map(
              ([alt, src], i) =>
                `<img id="inline-twister-image-${i}" class="swatch-image" alt="${alt}" src="${src}">`
            )
            .join('\n')
        : ''
    }
    ${
      dom.bullets
        ? `<div id="feature-bullets"><ul>
            <li><span class="a-list-item">First feature</span></li>
            <li><span class="a-list-item"><img data-src="//m.media-amazon.com/images/I/icon._AC_.png" src="data:,"></span></li>
          </ul></div>`
        : ''
    }
    ${dom.description ? `<div id="productDescription"><p>Long description here.</p></div>` : ''}
    ${
      dom.breadcrumbs
        ? `<div id="wayfinding-breadcrumbs_feature_div"><ul>
            <li><a href="#">Electronics</a></li>
            <li><a href="#">Smart Rings</a></li>
          </ul></div>`
        : ''
    }
  `;

  for (const text of scripts) {
    const script = doc.createElement('script');
    script.textContent = text;
    doc.body.appendChild(script);
  }
  return doc;
}

function fullProductDoc(overrides: DomOptions = {}): Document {
  return buildDoc(
    {
      title: 'Test Ring - Silver - Size 8 - Smart Ring for Testing',
      byline: '<style>.premium-logo{}</style>Visit the Oura Store',
      bullets: true,
      description: true,
      breadcrumbs: true,
      swatches: [
        ['Silver', 'https://m.media-amazon.com/images/I/silver-sw._SS64_.jpg'],
        ['Gold', '//m.media-amazon.com/images/I/gold-sw._SS64_.jpg'],
      ],
      ...overrides,
    },
    [TWISTER_SCRIPT, COLOR_IMAGES_SCRIPT]
  );
}

describe('parseAmazonPrice', () => {
  it('parses US format', () => {
    expect(parseAmazonPrice('$399.00')).toBe(399);
    expect(parseAmazonPrice('$1,234.56')).toBe(1234.56);
  });

  it('parses European comma decimal and currency codes', () => {
    expect(parseAmazonPrice('412,32USD')).toBe(412.32);
    expect(parseAmazonPrice('20,32 USD')).toBe(20.32);
    expect(parseAmazonPrice('399,00 €')).toBe(399);
    expect(parseAmazonPrice('1.234,56')).toBe(1234.56);
  });

  it('parses prefixed currency code and grouping comma', () => {
    expect(parseAmazonPrice('USD414.85')).toBe(414.85);
    expect(parseAmazonPrice('￥39,900')).toBe(39900);
  });

  it('parses currencies from other Amazon regions', () => {
    expect(parseAmazonPrice('₹1,299.00')).toBe(1299);
    expect(parseAmazonPrice('AED 399.00')).toBe(399);
    expect(parseAmazonPrice('R$ 399,00')).toBe(399);
    expect(parseAmazonPrice('1.299,00 TL')).toBe(1299);
  });

  it('returns null for empty or zero text', () => {
    expect(parseAmazonPrice(null)).toBeNull();
    expect(parseAmazonPrice('   ')).toBeNull();
    expect(parseAmazonPrice('$00')).toBeNull();
  });
});

describe('extractAmazonProduct', () => {
  it('extracts full product with twister variants', () => {
    const payload = extractAmazonProduct(PAGE_URL, fullProductDoc());

    expect(payload.platform).toBe('amazon');
    expect(payload.source_url).toBe(PAGE_URL);
    expect(payload.source_product_id).toBe('B0PARENT01');

    const { product } = payload;
    // 标题清理（保守方案）：删 "Silver" 与 "Size 8" 段，保留 "Test Ring"
    expect(product.title).toBe('Test Ring - Smart Ring for Testing');
    expect(product.handle).toBe('b0parent01');
    expect(product.vendor).toBe('Oura');
    expect(product.product_type).toBe('Smart Rings');

    expect(product.description_html).toContain('First feature');
    expect(product.description_html).toContain('Long description here.');
    // 懒加载 data-src 并入 src 并补 https:
    expect(product.description_html).toContain(
      'src="https://m.media-amazon.com/images/I/icon._AC_.png"'
    );
    expect(product.description_html).not.toContain('data-src');

    expect(product.options).toEqual([
      { name: 'Style', position: 1, values: ['Ring'] },
      { name: 'Size', position: 2, values: ['7', '8'] },
      { name: 'Color', position: 3, values: ['Silver', 'Gold'] },
    ]);

    // 变体按组合索引数值升序：0_0_0 < 0_0_1 < 0_1_0
    expect(product.variants).toHaveLength(3);
    expect(product.variants.map((v) => v.sku)).toEqual(['B0TEST00A1', 'B0TEST00A3', 'B0TEST00A2']);

    const v0 = product.variants[0];
    expect(v0.title).toBe('Ring / 7 / Silver');
    expect(v0.price).toBe('399.00');
    expect(v0.compare_at_price).toBeUndefined();
    expect(v0.source_variant_id).toBe('B0TEST00A1');
    expect(v0.options).toEqual([
      { name: 'Style', value: 'Ring' },
      { name: 'Size', value: '7' },
      { name: 'Color', value: 'Silver' },
    ]);
    expect(v0.grams).toBe(0);

    // 图集：hiRes 优先，hiRes 为 null 时用 large 并补 https:
    expect(product.images).toHaveLength(3);
    expect(product.images[0]).toMatchObject({
      position: 1,
      src: 'https://m.media-amazon.com/images/I/aaa._AC_SL1500_.jpg',
      source_image_id: 'MAIN',
      type: 'image',
    });
    expect(product.images[1].src).toBe('https://m.media-amazon.com/images/I/bbb._AC_.jpg');
    expect(product.images[0].alt).toBe(product.title);

    // 其它颜色追加 swatch 升级大图（当前色 Silver 不重复追加）
    expect(product.images[2]).toMatchObject({
      position: 3,
      src: 'https://m.media-amazon.com/images/I/gold-sw._SL1500_.jpg',
      source_image_id: 'swatch:Gold',
      type: 'image',
    });

    // 变体图片关联：当前色 → MAIN，其余颜色 → 各自 swatch 图
    expect(product.variants.map((v) => [v.sku, v.source_image_id])).toEqual([
      ['B0TEST00A1', 'MAIN'],
      ['B0TEST00A3', 'swatch:Gold'],
      ['B0TEST00A2', 'MAIN'],
    ]);
  });

  it('aligns options with dimensions order for two-dimension products', () => {
    const twister = TWISTER_SCRIPT.replace(
      '"dimensions" : ["style_name","size_name","color_name"]',
      '"dimensions" : ["color_name","size_name"]'
    )
      .replace(
        '"dimensionValuesDisplayData" : {\n        "B0TEST00A1":["Ring","7","Silver"],\n        "B0TEST00A2":["Ring","8","Silver"],\n        "B0TEST00A3":["Ring","7","Gold"]\n      }',
        '"dimensionValuesDisplayData" : {"B0TEST00A1":["Silver","7"],"B0TEST00A2":["Silver","8"]}'
      )
      .replace(
        '"dimensionToAsinMap" : {"0_0_0":"B0TEST00A1","0_1_0":"B0TEST00A2","0_0_1":"B0TEST00A3"}',
        '"dimensionToAsinMap" : {"0_0":"B0TEST00A1","0_1":"B0TEST00A2"}'
      );

    const doc = buildDoc({ title: 'Two Dim Product' }, [twister]);
    const { product } = extractAmazonProduct(PAGE_URL, doc);

    expect(product.options?.map((o) => o.name)).toEqual(['Color', 'Size']);
    expect(product.variants).toHaveLength(2);
    expect(product.variants[0].options).toEqual([
      { name: 'Color', value: 'Silver' },
      { name: 'Size', value: '7' },
    ]);
    // 页面无 swatch 图时不变体图片关联
    expect(product.variants.every((v) => v.source_image_id === undefined)).toBe(true);
  });

  it('collects option values from variants when variationValues is missing', () => {
    const twister = TWISTER_SCRIPT.replace(
      '"variationValues" : {"size_name":["7","8"],"color_name":["Silver","Gold"],"style_name":["Ring"]},',
      '"variationValues" : {"size_name":["7","8"]},'
    );
    const doc = buildDoc({ title: 'Partial Variation Values' }, [twister]);
    const { product } = extractAmazonProduct(PAGE_URL, doc);

    expect(product.options?.find((o) => o.name === 'Size')?.values).toEqual(['7', '8']);
    // color/style 按变体排序后的展示值顺序收集
    expect(product.options?.find((o) => o.name === 'Color')?.values).toEqual(['Silver', 'Gold']);
    expect(product.options?.find((o) => o.name === 'Style')?.values).toEqual(['Ring']);
  });

  it('creates single default variant when twister is absent (book page)', () => {
    const doc = buildDoc(
      { title: 'Atomic Habits', priceHtml: '<span class="a-offscreen"> </span>' },
      []
    );
    // 真实书籍页形态：corePrice 为空，价格落在 tmmSwatches 内（含 \xa0）
    const tmm = doc.createElement('div');
    tmm.id = 'tmmSwatches';
    tmm.innerHTML = '<span class="a-offscreen">20,32 USD</span>';
    doc.body.appendChild(tmm);

    const payload = extractAmazonProduct('https://www.amazon.de/dp/0735211299', doc);

    expect(payload.source_product_id).toBe('0735211299');
    expect(payload.product.options).toEqual([]);
    expect(payload.product.variants).toHaveLength(1);
    expect(payload.product.variants[0]).toMatchObject({
      title: 'Default Title',
      price: '20.32',
      sku: '0735211299',
    });
    expect(payload.product.variants[0].options).toEqual([
      { name: 'Title', value: 'Default Title' },
    ]);
  });

  it('parses vendor byline variants', () => {
    expect(
      extractAmazonProduct(PAGE_URL, fullProductDoc({ byline: 'Brand: Oura' })).product.vendor
    ).toBe('Oura');
    expect(
      extractAmazonProduct(PAGE_URL, fullProductDoc({ byline: 'by James Clear' })).product.vendor
    ).toBe('by James Clear');
    const noByline = fullProductDoc();
    noByline.querySelector('#bylineInfo')?.remove();
    expect(extractAmazonProduct(PAGE_URL, noByline).product.vendor).toBeUndefined();
  });

  it('falls back to premium brand logo byline', () => {
    const doc = fullProductDoc({ byline: '<!-- No content: premium renders via logo -->' });
    const link = doc.createElement('a');
    link.id = 'brandLogoBylineLink';
    link.innerHTML = '<img id="brandLogoHiResByline" alt="OURA" title="Visit the OURA Store">';
    doc.body.appendChild(link);

    expect(extractAmazonProduct(PAGE_URL, doc).product.vendor).toBe('OURA');
  });

  it('reads weight for all variants and barcode only for current variant', () => {
    const doc = fullProductDoc();
    const table = doc.createElement('table');
    table.innerHTML = `
      <tr><th>Item Weight</th><td>3.8 Ounces</td></tr>
      <tr><th>UPC</th><td>841158002436</td></tr>
      <tr><th>Manufacturer</th><td>Oura</td></tr>`;
    doc.body.appendChild(table);

    const { product } = extractAmazonProduct(PAGE_URL, doc);

    // 重量：商品族级近似，全变体填充（3.8 oz ≈ 108 g）
    for (const v of product.variants) {
      expect(v.grams).toBe(108);
      expect(v.weight).toBe(3.8);
      expect(v.weight_unit).toBe('oz');
    }
    // 条码：仅当前变体（currentAsin = B0TEST00A2）
    expect(product.variants.find((v) => v.sku === 'B0TEST00A2')?.barcode).toBe('841158002436');
    for (const v of product.variants.filter((v) => v.sku !== 'B0TEST00A2')) {
      expect(v.barcode).toBeUndefined();
    }
  });

  it('reads barcode and weight from detail bullets with invisible separators', () => {
    const doc = buildDoc(
      { title: 'Atomic Habits', priceHtml: '<span class="a-offscreen">$16.99</span>' },
      []
    );
    const div = doc.createElement('div');
    div.id = 'detailBullets_feature_div';
    // 真实分隔符含 U+200F/U+200E 不可见字符
    div.innerHTML = `
      <li><span class="a-list-item">ISBN-13 ‏ : ‎ 978-0735211292</span></li>
      <li><span class="a-list-item">Item Weight ‏ : ‎ 1.2 pounds</span></li>`;
    doc.body.appendChild(div);

    const { product } = extractAmazonProduct('https://www.amazon.de/dp/0735211299', doc);

    expect(product.variants).toHaveLength(1);
    expect(product.variants[0].barcode).toBe('9780735211292');
    expect(product.variants[0].weight_unit).toBe('lb');
    expect(product.variants[0].grams).toBe(544); // 1.2 lb ≈ 544 g
  });

  it('maps compare_at_price and falls back to price when lower', () => {
    const withCompare = fullProductDoc({
      priceHtml: `
        <span class="a-price"><span class="a-offscreen">$399.00</span></span>
        <span class="a-price a-text-price"><span class="a-offscreen">$499.00</span></span>`,
    });
    expect(extractAmazonProduct(PAGE_URL, withCompare).product.variants[0].compare_at_price).toBe(
      '499.00'
    );

    const lowerCompare = fullProductDoc({
      priceHtml: `
        <span class="a-price"><span class="a-offscreen">$399.00</span></span>
        <span class="a-price a-text-price"><span class="a-offscreen">$299.00</span></span>`,
    });
    expect(extractAmazonProduct(PAGE_URL, lowerCompare).product.variants[0].compare_at_price).toBe(
      '399.00'
    );
  });

  it('reads price from mobile buying-options-price-data carrier', () => {
    const doc = buildDoc({ title: 'Mobile Page', priceHtml: '' }, []);
    const carrier = doc.createElement('div');
    carrier.className = 'a-section aok-hidden twister-plus-buying-options-price-data';
    carrier.textContent =
      '{"mobile_buybox_group_1":[{"displayPrice":"$399.00","priceAmount":399.0,"currencySymbol":"$"}]}';
    doc.body.appendChild(carrier);

    const { product } = extractAmazonProduct(PAGE_URL, doc);
    expect(product.variants[0].price).toBe('399.00');
  });

  it('throws a clear error on captcha pages', () => {
    const doc = document.implementation.createHTMLDocument('Amazon.com');
    doc.body.innerHTML =
      '<form method="get" action="/errors/validateCaptcha"><button>Continue shopping</button></form>';

    expect(() => extractAmazonProduct(PAGE_URL, doc)).toThrow(
      'Amazon 返回了人机验证页，请在浏览器中完成验证后重试'
    );
  });

  it('throws when title is missing', () => {
    const doc = buildDoc({}, []);
    expect(() => extractAmazonProduct(PAGE_URL, doc)).toThrow('未能从页面解析到商品标题');
  });

  it('throws when price cannot be parsed', () => {
    const doc = buildDoc({ title: 'No Price', priceHtml: '' }, []);
    expect(() => extractAmazonProduct(PAGE_URL, doc)).toThrow('未能从页面解析到售价');
  });

  it('falls back to #landingImage when colorImages is absent', () => {
    const doc = buildDoc({ title: 'Landing Only' }, []);
    const img = doc.createElement('img');
    img.id = 'landingImage';
    img.setAttribute('src', '//m.media-amazon.com/images/I/main._AC_SL1500_.jpg');
    doc.body.appendChild(img);

    const { product } = extractAmazonProduct(PAGE_URL, doc);
    expect(product.images).toHaveLength(1);
    expect(product.images[0].src).toBe('https://m.media-amazon.com/images/I/main._AC_SL1500_.jpg');
  });
});
