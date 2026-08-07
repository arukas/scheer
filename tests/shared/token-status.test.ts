import { describe, it, expect } from 'vitest';
import {
  extractTokenExpiresAt,
  classifyTokenStatus,
  TOKEN_EXPIRY_WARNING_MS,
} from '@/shared/token-status';

describe('extractTokenExpiresAt', () => {
  it('parses ISO 8601 strings and normalizes them', () => {
    expect(extractTokenExpiresAt({ token_expires_at: '2026-09-01T00:00:00Z' })).toBe(
      '2026-09-01T00:00:00.000Z'
    );
  });

  it('accepts other parsable date strings', () => {
    expect(extractTokenExpiresAt({ token_expires_at: '2026-09-01' })).toBe(
      '2026-09-01T00:00:00.000Z'
    );
  });

  it('returns null when the field is missing, null or empty', () => {
    expect(extractTokenExpiresAt({ id: 'u1' })).toBeNull();
    expect(extractTokenExpiresAt({ token_expires_at: null })).toBeNull();
    expect(extractTokenExpiresAt({ token_expires_at: '' })).toBeNull();
    expect(extractTokenExpiresAt({ token_expires_at: '   ' })).toBeNull();
  });

  it('returns null for non-string or unparsable values', () => {
    expect(extractTokenExpiresAt({ token_expires_at: 1767225600 })).toBeNull();
    expect(extractTokenExpiresAt({ token_expires_at: 'not-a-date' })).toBeNull();
  });

  it('returns null for non-object responses', () => {
    expect(extractTokenExpiresAt(null)).toBeNull();
    expect(extractTokenExpiresAt(undefined)).toBeNull();
    expect(extractTokenExpiresAt('2026-09-01T00:00:00Z')).toBeNull();
  });
});

describe('classifyTokenStatus', () => {
  const now = Date.parse('2026-08-06T00:00:00Z');

  it('treats null expires_at as permanent', () => {
    const view = classifyTokenStatus({ expires_at: null, checked_at: '' }, now);
    expect(view.level).toBe('permanent');
    expect(view.expiresAt).toBeNull();
  });

  it('marks past expiry as expired', () => {
    const view = classifyTokenStatus({ expires_at: '2026-08-05T23:59:59Z', checked_at: '' }, now);
    expect(view.level).toBe('expired');
    expect(view.remainingDays).toBe(0);
    expect(view.remainingHours).toBe(0);
  });

  it('marks less than 3 days remaining as warning', () => {
    const expires = new Date(now + TOKEN_EXPIRY_WARNING_MS - 1).toISOString();
    const view = classifyTokenStatus({ expires_at: expires, checked_at: '' }, now);
    expect(view.level).toBe('warning');
    expect(view.remainingDays).toBe(2);
  });

  it('marks exactly 3 days or more as valid', () => {
    const expires = new Date(now + TOKEN_EXPIRY_WARNING_MS).toISOString();
    const view = classifyTokenStatus({ expires_at: expires, checked_at: '' }, now);
    expect(view.level).toBe('valid');
    expect(view.remainingDays).toBe(3);
  });

  it('computes remaining hours for sub-day expiry', () => {
    const expires = new Date(now + 5 * 60 * 60 * 1000).toISOString();
    const view = classifyTokenStatus({ expires_at: expires, checked_at: '' }, now);
    expect(view.level).toBe('warning');
    expect(view.remainingDays).toBe(0);
    expect(view.remainingHours).toBe(5);
  });
});
