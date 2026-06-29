import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import {
  extractHandle,
  detectPlatformByUrl,
  detectPlatformByApi,
  detectPlatformByHtml,
  detectPlatform,
  getPageStatus,
  isAllowedProductUrl,
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
});

describe('detectPlatformByUrl', () => {
  it('detects tiktok shop', () => {
    expect(detectPlatformByUrl('https://shop.tiktok.com/view/product/123')).toBe('tiktok');
  });

  it('detects myshopify.com as shopify', () => {
    expect(detectPlatformByUrl('https://example.myshopify.com/products/test')).toBe('shopify');
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

  it('does not detect ShopLazza by C_SETTINGS alone', () => {
    const html = '<html><head><script>window.C_SETTINGS = {};</script></head></html>';
    expect(detectPlatformByHtml(html)).toBeNull();
  });

  it('returns null when no known script marker', () => {
    const html = '<html><head><script src="https://example.com/app.js"></script></head></html>';
    expect(detectPlatformByHtml(html)).toBeNull();
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
