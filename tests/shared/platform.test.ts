import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import {
  extractHandle,
  detectPlatformByUrl,
  detectPlatformByApi,
  detectPlatformByHtml,
  detectPlatform,
  getPageStatus,
  isAllowedProductUrl,
  extractAmazonAsinFromUrl,
} from '@/shared/platform';

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

function createApiResponse(overrides: { ok: boolean; status?: number; json?: unknown }) {
  return {
    ok: overrides.ok,
    status: overrides.status ?? (overrides.ok ? 200 : 404),
    statusText: overrides.ok ? 'OK' : 'Not Found',
    json: async () => overrides.json ?? null,
    headers: { get: () => null },
  };
}

describe('extractHandle', () => {
  it('extracts handle from /products/<handle>', () => {
    const result = extractHandle('https://example.com/products/sample-product');
    expect(result.host).toBe('example.com');
    expect(result.handle).toBe('sample-product');
  });

  it('extracts handle from /product/<handle>', () => {
    const result = extractHandle('https://example.com/product/sample-product');
    expect(result.handle).toBe('sample-product');
  });

  it('does not extract handle from /p/<handle>', () => {
    const result = extractHandle('https://example.com/p/sample-product');
    expect(result.handle).toBeNull();
  });

  it('returns null handle for non-product URLs', () => {
    const result = extractHandle('https://example.com/collections/all');
    expect(result.handle).toBeNull();
  });
});

describe('isAllowedProductUrl', () => {
  it('allows https product pages', () => {
    expect(isAllowedProductUrl('https://example.com/products/sample')).toBe(true);
    expect(isAllowedProductUrl('https://example.com/product/sample')).toBe(true);
  });

  it('rejects non-https pages', () => {
    expect(isAllowedProductUrl('http://example.com/products/sample')).toBe(false);
  });

  it('rejects pages without product path', () => {
    expect(isAllowedProductUrl('https://example.com/collections/all')).toBe(false);
    expect(isAllowedProductUrl('https://example.com/p/sample')).toBe(false);
  });

  it('exempts tiktok hosts from product path check', () => {
    expect(isAllowedProductUrl('https://shop.tiktok.com/view/product/123')).toBe(true);
    expect(isAllowedProductUrl('https://www.tiktok.com/tiktok-shop/something')).toBe(true);
    expect(isAllowedProductUrl('https://item.tk/123')).toBe(true);
  });

  it('allows amazon product pages with ASIN in path', () => {
    expect(isAllowedProductUrl('https://www.amazon.com/dp/B0GRK1N94H')).toBe(true);
    expect(
      isAllowedProductUrl('https://www.amazon.com/Oura-Ring-Smallest/dp/B0GRK1N94H?th=1')
    ).toBe(true);
    expect(isAllowedProductUrl('https://www.amazon.co.uk/gp/product/B0GRK1N94H')).toBe(true);
    expect(isAllowedProductUrl('https://amazon.de/dp/0735211299')).toBe(true);
  });

  it('rejects amazon non-product pages and lookalike hosts', () => {
    expect(isAllowedProductUrl('https://www.amazon.com/s?k=smart+ring')).toBe(false);
    expect(isAllowedProductUrl('https://www.amazon.com/gp/help/customer')).toBe(false);
    expect(isAllowedProductUrl('https://amazon.evil.com/dp/B0GRK1N94H')).toBe(false);
    expect(isAllowedProductUrl('https://notamazon.com/dp/B0GRK1N94H')).toBe(false);
  });

  it('allows 1688 offer pages with numeric offerId', () => {
    expect(isAllowedProductUrl('https://detail.1688.com/offer/987833987148.html')).toBe(true);
    expect(
      isAllowedProductUrl('https://detail.1688.com/offer/987833987148.html?spm=a26352.13672862')
    ).toBe(true);
  });

  it('rejects 1688 non-offer pages and lookalike hosts', () => {
    expect(isAllowedProductUrl('https://detail.1688.com/offer/abc.html')).toBe(false);
    expect(isAllowedProductUrl('https://www.1688.com/')).toBe(false);
    expect(isAllowedProductUrl('https://1688.com.evil.com/offer/123.html')).toBe(false);
  });
});

describe('detectPlatformByUrl', () => {
  it('detects tiktok shop', () => {
    expect(detectPlatformByUrl('https://shop.tiktok.com/view/product/123')).toBe('tiktok');
  });

  it('detects myshopify.com as shopify', () => {
    expect(detectPlatformByUrl('https://example.myshopify.com/products/test')).toBe('shopify');
  });

  it('detects amazon product pages including international sites', () => {
    expect(detectPlatformByUrl('https://www.amazon.com/dp/B0GRK1N94H')).toBe('amazon');
    expect(detectPlatformByUrl('https://www.amazon.co.uk/gp/product/B0GRK1N94H')).toBe('amazon');
    expect(detectPlatformByUrl('https://smile.amazon.com/Oura-Ring/dp/B0GRK1N94H')).toBe('amazon');
  });

  it('returns null for amazon non-product pages', () => {
    expect(detectPlatformByUrl('https://www.amazon.com/s?k=ring')).toBeNull();
  });

  it('detects 1688 offer pages with query params', () => {
    expect(detectPlatformByUrl('https://detail.1688.com/offer/987833987148.html')).toBe(
      'alibaba1688'
    );
    expect(detectPlatformByUrl('https://detail.1688.com/offer/123.html?spm=a26352&foo=bar')).toBe(
      'alibaba1688'
    );
    expect(detectPlatformByUrl('https://detail.1688.com/')).toBeNull();
  });

  it('returns null for unknown custom domain', () => {
    expect(detectPlatformByUrl('https://example.com/products/test')).toBeNull();
  });
});

describe('detectPlatformByApi', () => {
  let fetchMock: Mock;

  beforeEach(() => {
    fetchMock = vi.fn();
    global.fetch = fetchMock;
  });

  it('detects shopify when .json returns product', async () => {
    fetchMock.mockResolvedValueOnce(
      createApiResponse({ ok: true, json: { product: { id: 1, title: 'Test' } } })
    );
    fetchMock.mockResolvedValueOnce(createApiResponse({ ok: false, status: 404 }));

    const result = await detectPlatformByApi('https://example.com/products/test');
    expect(result).toBe('shopify');
  });

  it('detects newshop when api returns ID', async () => {
    fetchMock.mockResolvedValueOnce(createApiResponse({ ok: false, status: 404 }));
    fetchMock.mockResolvedValueOnce(
      createApiResponse({ ok: true, json: { ID: 123, title: 'Test' } })
    );

    const result = await detectPlatformByApi('https://example.com/products/test');
    expect(result).toBe('newshop');
  });

  it('returns null when neither API matches', async () => {
    fetchMock.mockResolvedValue(createApiResponse({ ok: false, status: 404 }));

    const result = await detectPlatformByApi('https://example.com/products/test');
    expect(result).toBeNull();
  });

  it('returns null when fetch throws', async () => {
    fetchMock.mockRejectedValue(new Error('network error'));

    const result = await detectPlatformByApi('https://example.com/products/test');
    expect(result).toBeNull();
  });
});

describe('detectPlatformByHtml', () => {
  it('detects ShopLine by myshopline.com script host', () => {
    const html =
      '<html><head><script src="https://img-va.myshopline.com/image/store/1747279131125/foo.js"></script></head></html>';
    expect(detectPlatformByHtml(html)).toBe('shopline');
  });

  it('detects NewShop by techcloudclub.com script host', () => {
    const html =
      '<html><head><script src="https://cdn.techcloudclub.com/static/app.js"></script></head></html>';
    expect(detectPlatformByHtml(html)).toBe('newshop');
  });

  it('detects NewShop by cloudfastin.top script host', () => {
    const html =
      '<html><head><script src="https://cdn.cloudfastin.top/static/app.js"></script></head></html>';
    expect(detectPlatformByHtml(html)).toBe('newshop');
  });

  it('detects NewShop by newfastcdn.com script host', () => {
    const html =
      '<html><head><script src="https://cdn.newfastcdn.com/static/app.js"></script></head></html>';
    expect(detectPlatformByHtml(html)).toBe('newshop');
  });

  it('detects Shopify by cdn/shopifycloud script path', () => {
    const html =
      '<html><head><script src="https://example.com/cdn/shopifycloud/bar.js"></script></head></html>';
    expect(detectPlatformByHtml(html)).toBe('shopify');
  });

  it('detects Shopify by cdn.shopify.com script host', () => {
    const html =
      '<html><head><script src="https://cdn.shopify.com/s/files/1/0000/0000/0000/files/foo.js"></script></head></html>';
    expect(detectPlatformByHtml(html)).toBe('shopify');
  });

  it('detects Shopify by /cdn/shop/ script path on custom domain', () => {
    const html =
      '<html><head><script src="https://noomoriey.com/cdn/shop/t/4/assets/secondary.js"></script></head></html>';
    expect(detectPlatformByHtml(html)).toBe('shopify');
  });

  it('detects WordPress by wp-content in head link href', () => {
    const html =
      '<html><head><link rel="stylesheet" href="/wp-content/plugins/elementor/assets/css/frontend.css"/></head></html>';
    expect(detectPlatformByHtml(html)).toBe('wordpress');
  });

  it('detects ShadowShop by storedfilezone.com script host', () => {
    const html =
      '<html><head><script src="https://cdn.storedfilezone.com/static/app.js"></script></head></html>';
    expect(detectPlatformByHtml(html)).toBe('shadowshop');
  });

  it('detects ShadowShop by plfaib.com script host', () => {
    const html =
      '<html><head><script src="https://cdn.plfaib.com/static/app.js"></script></head></html>';
    expect(detectPlatformByHtml(html)).toBe('shadowshop');
  });

  it('detects ShopBase by thesitebase.net script host', () => {
    const html =
      '<html><head><script src="https://cdn.thesitebase.net/static/app.js"></script></head></html>';
    expect(detectPlatformByHtml(html)).toBe('shopbase');
  });

  it('detects ShopLazza by staticdj.com script host', () => {
    const html =
      '<html><head><script src="https://static.staticdj.com/static/app.js"></script></head></html>';
    expect(detectPlatformByHtml(html)).toBe('shoplazza');
  });

  it('detects XShopPy by self-hosted /liquid/buyer/ script path', () => {
    const html =
      '<html><head><script src="https://www.berrky.com/liquid/buyer/public/js/plug/vendor.min.js"></script></head></html>';
    expect(detectPlatformByHtml(html)).toBe('xshoppy');
  });

  it('does not detect ShopLazza by C_SETTINGS alone', () => {
    const html = '<html><head><script>window.C_SETTINGS = {};</script></head></html>';
    expect(detectPlatformByHtml(html)).toBeNull();
  });

  it('returns null when no known script marker', () => {
    const html = '<html><head><script src="https://example.com/app.js"></script></head></html>';
    expect(detectPlatformByHtml(html)).toBeNull();
  });

  it('detects Amazon by CDN resource markers', () => {
    const html =
      '<html><head><link rel="stylesheet" href="https://images-na.ssl-images-amazon.com/images/G/01/AUIClients/AmazonUI-xxx.css"></head></html>';
    expect(detectPlatformByHtml(html)).toBe('amazon');
    const imgHtml =
      '<html><body><img src="https://m.media-amazon.com/images/I/abc.jpg"></body></html>';
    expect(detectPlatformByHtml(imgHtml)).toBe('amazon');
  });
});

describe('extractAmazonAsinFromUrl', () => {
  it('extracts ASIN from /dp/ and /gp/product/ paths', () => {
    expect(extractAmazonAsinFromUrl('https://www.amazon.com/dp/B0GRK1N94H')).toBe('B0GRK1N94H');
    expect(extractAmazonAsinFromUrl('https://www.amazon.com/Oura-Ring/dp/B0GRK1N94H?th=1')).toBe(
      'B0GRK1N94H'
    );
    expect(extractAmazonAsinFromUrl('https://www.amazon.de/gp/product/0735211299')).toBe(
      '0735211299'
    );
  });

  it('returns null for invalid or missing ASIN', () => {
    expect(extractAmazonAsinFromUrl('https://www.amazon.com/dp/SHORT')).toBeNull();
    expect(extractAmazonAsinFromUrl('https://www.amazon.com/s?k=ring')).toBeNull();
    expect(extractAmazonAsinFromUrl('not a url')).toBeNull();
  });
});

describe('detectPlatform', () => {
  let fetchMock: Mock;

  beforeEach(() => {
    fetchMock = vi.fn();
    global.fetch = fetchMock;
  });

  it('uses URL detection first', async () => {
    const result = await detectPlatform('https://example.myshopify.com/products/test');
    expect(result).toBe('shopify');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not call API for custom domains without HTML markers', async () => {
    const result = await detectPlatform('https://example.com/products/test');
    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('getPageStatus', () => {
  let fetchMock: Mock;

  beforeEach(() => {
    fetchMock = vi.fn();
    global.fetch = fetchMock;
  });

  it('returns platform and canExtract true for Shopify by script marker', async () => {
    const html =
      '<html><head><script src="https://cdn.shopify.com/s/files/1/0000/0000/0000/files/foo.js"></script></head></html>';

    const status = await getPageStatus('https://example.com/products/test', html);
    expect(status.platform).toBe('shopify');
    expect(status.canExtract).toBe(true);
  });

  it('returns unknown for unsupported URLs', async () => {
    const status = await getPageStatus('https://example.com/about');
    expect(status.platform).toBeNull();
    expect(status.canExtract).toBe(false);
  });
});
