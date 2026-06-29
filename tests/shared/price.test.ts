import { describe, it, expect } from 'vitest';
import { formatPrice, formatCompareAtPrice } from '@/shared/price';

describe('formatPrice', () => {
  it('formats number to two decimal places', () => {
    expect(formatPrice(19.9)).toBe('19.90');
    expect(formatPrice(20)).toBe('20.00');
    expect(formatPrice(19.99)).toBe('19.99');
  });

  it('formats numeric string to two decimal places', () => {
    expect(formatPrice('19.9')).toBe('19.90');
    expect(formatPrice('20')).toBe('20.00');
    expect(formatPrice('19.99')).toBe('19.99');
  });

  it('strips non-numeric characters from price strings', () => {
    expect(formatPrice('$19.90')).toBe('19.90');
    expect(formatPrice('€ 1,234.56')).toBe('1234.56');
  });

  it('falls back to 0.00 for invalid values', () => {
    expect(formatPrice(null)).toBe('0.00');
    expect(formatPrice(undefined)).toBe('0.00');
    expect(formatPrice('')).toBe('0.00');
    expect(formatPrice('free')).toBe('0.00');
    expect(formatPrice(Number.NaN)).toBe('0.00');
  });
});

describe('formatCompareAtPrice', () => {
  it('returns formatted compare_at_price when greater than or equal to price', () => {
    expect(formatCompareAtPrice(29.99, 19.99)).toBe('29.99');
    expect(formatCompareAtPrice('39.90', '19.90')).toBe('39.90');
    expect(formatCompareAtPrice(19.99, 19.99)).toBe('19.99');
  });

  it('falls back to price when compare_at_price is lower or invalid', () => {
    expect(formatCompareAtPrice(9.99, 19.99)).toBe('19.99');
    expect(formatCompareAtPrice(null, 19.99)).toBe('19.99');
    expect(formatCompareAtPrice(undefined, 19.99)).toBe('19.99');
  });
});
