import { describe, it, expect } from 'vitest';
import { isAbsoluteUrl, resolveEndpoint } from '@/shared/api';

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
