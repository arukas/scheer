import { describe, it, expect, vi } from 'vitest';
import { isAbsoluteUrl, resolveEndpoint, buildCurl } from '@/shared/api';

vi.mock('@/shared/storage', () => ({
  getDebugLogs: () =>
    Promise.resolve({ enabled: false, persist: false, maxEntries: 500, entries: [] }),
  appendDebugLog: () => Promise.resolve(),
}));

describe('isAbsoluteUrl', () => {
  it('returns true for full http/https URLs', () => {
    expect(isAbsoluteUrl('https://api.example.com/scheer/products')).toBe(true);
    expect(isAbsoluteUrl('http://api.example.com/scheer/me')).toBe(true);
  });

  it('returns true for protocol-relative URLs', () => {
    expect(isAbsoluteUrl('//api.example.com/scheer/products')).toBe(true);
  });

  it('returns false for relative URIs', () => {
    expect(isAbsoluteUrl('/scheer/products')).toBe(false);
    expect(isAbsoluteUrl('scheer/me')).toBe(false);
  });
});

describe('resolveEndpoint', () => {
  it('joins relative URI with base', () => {
    expect(resolveEndpoint('https://api.example.com', '/scheer/products')).toBe(
      'https://api.example.com/scheer/products'
    );
    expect(resolveEndpoint('https://api.example.com/', '/scheer/me')).toBe(
      'https://api.example.com/scheer/me'
    );
  });

  it('joins URI without leading slash', () => {
    expect(resolveEndpoint('https://api.example.com', 'scheer/products')).toBe(
      'https://api.example.com/scheer/products'
    );
  });

  it('uses absolute endpoint directly', () => {
    expect(resolveEndpoint('https://api.example.com', 'https://other.example.com/products')).toBe(
      'https://other.example.com/products'
    );
    expect(resolveEndpoint('', '//other.example.com/me')).toBe('//other.example.com/me');
  });

  it('trims whitespace from base and endpoint', () => {
    expect(resolveEndpoint('  https://api.example.com/  ', '  /scheer/products  ')).toBe(
      'https://api.example.com/scheer/products'
    );
  });

  it('returns empty string for empty endpoint', () => {
    expect(resolveEndpoint('https://api.example.com', '')).toBe('');
  });

  it('returns endpoint as-is when base is empty and endpoint is relative', () => {
    expect(resolveEndpoint('', '/scheer/products')).toBe('/scheer/products');
  });
});

describe('buildCurl', () => {
  it('builds a POST curl with headers and body', () => {
    const curl = buildCurl('https://api.example.com/scheer/products', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Test' }),
    });
    expect(curl).toContain('curl -X POST');
    expect(curl).toContain("-H 'Content-Type: application/json'");
    expect(curl).toContain('--data-raw \'{"title":"Test"}\'');
    expect(curl).toContain("'https://api.example.com/scheer/products'");
  });

  it('omits -X for GET requests', () => {
    const curl = buildCurl('https://api.example.com/scheer/me', {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    expect(curl).not.toContain('-X');
    expect(curl).toContain("-H 'Accept: application/json'");
  });

  it('redacts Authorization header value', () => {
    const curl = buildCurl('https://api.example.com/scheer/me', {
      headers: { Authorization: 'Bearer sk-1234567890' },
    });
    expect(curl).toContain("-H 'Authorization: <redacted>'");
    expect(curl).not.toContain('sk-1234567890');
  });

  it('truncates long body in curl', () => {
    const longBody = JSON.stringify({ title: 'a'.repeat(3000) });
    const curl = buildCurl('https://api.example.com/scheer/products', {
      method: 'POST',
      body: longBody,
    });
    expect(curl).toContain(' ... [truncated]');
    expect(curl.length).toBeLessThan(longBody.length + 200);
  });

  it('escapes single quotes in body and url', () => {
    const curl = buildCurl("https://api.example.com/o'clock", {
      method: 'POST',
      body: "it's a test",
    });
    expect(curl).toContain("o'\\''clock");
    expect(curl).toContain("it'\\''s a test");
  });
});
