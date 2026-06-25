import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import {
  extractHandle,
  detectPlatformByUrl,
  detectPlatformByApi,
  detectPlatform,
  getPageStatus,
} from '@/shared/platform';

describe('extractHandle', () => {
  it('extracts handle from /products/<handle>', () => {
    const result = extractHandle('https://example.com/products/sample-product');
    expect(result.host).toBe('example.com');
    expect(result.handle).toBe('sample-product');
  });

  it('returns null handle for non-product URLs', () => {
    const result = extractHandle('https://example.com/collections/all');
    expect(result.handle).toBeNull();
  });
});

describe('detectPlatformByUrl', () => {
  it('detects tiktok shop', () => {
    expect(
      detectPlatformByUrl('https://shop.tiktok.com/view/product/123')
    ).toBe('tiktok');
  });

  it('detects myshopify.com as shopify', () => {
    expect(
      detectPlatformByUrl('https://example.myshopify.com/products/test')
    ).toBe('shopify');
  });

  it('returns null for unknown custom domain', () => {
    expect(
      detectPlatformByUrl('https://example.com/products/test')
    ).toBeNull();
  });
});

describe('detectPlatformByApi', () => {
  let fetchMock: Mock;

  beforeEach(() => {
    fetchMock = vi.fn();
    global.fetch = fetchMock;
  });

  it('detects shopify when .json returns product', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ product: { id: 1, title: 'Test' } }),
    });
    fetchMock.mockResolvedValueOnce({ ok: false, status: 404 });

    const result = await detectPlatformByApi('https://example.com/products/test');
    expect(result).toBe('shopify');
  });

  it('detects newshop when api returns ID', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 404 });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ID: 123, title: 'Test' }),
    });

    const result = await detectPlatformByApi('https://example.com/products/test');
    expect(result).toBe('newshop');
  });

  it('returns null when neither API matches', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404 });

    const result = await detectPlatformByApi('https://example.com/products/test');
    expect(result).toBeNull();
  });

  it('returns null when fetch throws', async () => {
    fetchMock.mockRejectedValue(new Error('network error'));

    const result = await detectPlatformByApi('https://example.com/products/test');
    expect(result).toBeNull();
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

  it('falls back to API detection for custom domains', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 404 });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ID: 123 }),
    });

    const result = await detectPlatform('https://warming80.hotishop.com/products/55-6');
    expect(result).toBe('newshop');
  });
});

describe('getPageStatus', () => {
  let fetchMock: Mock;

  beforeEach(() => {
    fetchMock = vi.fn();
    global.fetch = fetchMock;
  });

  it('returns platform and canExtract true for known platform', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ product: { id: 1 } }),
    });
    fetchMock.mockResolvedValueOnce({ ok: false, status: 404 });

    const status = await getPageStatus('https://example.com/products/test');
    expect(status.platform).toBe('shopify');
    expect(status.canExtract).toBe(true);
  });

  it('returns unknown for unsupported URLs', async () => {
    const status = await getPageStatus('https://example.com/about');
    expect(status.platform).toBeNull();
    expect(status.canExtract).toBe(false);
  });
});
