import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  redactSensitive,
  truncateBody,
  sanitizePayload,
  buildLogEntry,
  createLogger,
} from '@/shared/logger';
import type { DebugLogs } from '@/shared/schema';

import type { DebugLogEntry } from '@/shared/schema';

const mockAppendDebugLog = vi.fn((entry: DebugLogEntry) => Promise.resolve(entry));
const mockGetDebugLogs = vi.fn(() => Promise.resolve({} as import('@/shared/schema').DebugLogs));

vi.mock('@/shared/storage', () => ({
  appendDebugLog: (entry: DebugLogEntry) => mockAppendDebugLog(entry),
  getDebugLogs: () => mockGetDebugLogs(),
}));

describe('logger helpers', () => {
  it('redacts Authorization header', () => {
    const payload = {
      url: 'https://api.example.com/v1/products',
      headers: { Authorization: 'Bearer sk-1234567890' },
    };
    expect(redactSensitive(payload)).toEqual({
      url: 'https://api.example.com/v1/products',
      headers: { Authorization: '<redacted>' },
    });
  });

  it('redacts secret and token fields case-insensitively', () => {
    const payload = {
      apiKey: 'abc',
      API_KEY: 'def',
      secretValue: 'ghi',
      token: 'jkl',
      password: 'mno',
    };
    const result = redactSensitive(payload);
    expect(result.apiKey).toBe('<redacted>');
    expect(result.API_KEY).toBe('<redacted>');
    expect(result.secretValue).toBe('<redacted>');
    expect(result.token).toBe('<redacted>');
    expect(result.password).toBe('<redacted>');
  });

  it('redacts nested objects and arrays', () => {
    const payload = {
      items: [{ secret: 'x' }, { token: 'y' }],
      nested: { apiKey: 'z' },
    };
    const result = redactSensitive(payload);
    expect(result.items).toEqual([{ secret: '<redacted>' }, { token: '<redacted>' }]);
    expect(result.nested).toEqual({ apiKey: '<redacted>' });
  });

  it('truncates long body and responseText', () => {
    const long = 'a'.repeat(3000);
    const payload = { body: long, responseText: long };
    const result = truncateBody(payload);
    expect((result.body as string).length).toBeLessThan(3000);
    expect(result.body).toContain('[truncated]');
    expect(result.responseText).toContain('[truncated]');
  });

  it('sanitizePayload applies both redaction and truncation', () => {
    const payload = {
      secret: 'x',
      body: 'a'.repeat(3000),
    };
    const result = sanitizePayload(payload);
    expect(result?.secret).toBe('<redacted>');
    expect(result?.body).toContain('[truncated]');
  });

  it('buildLogEntry includes timestamp and sanitized payload', () => {
    const entry = buildLogEntry('test', 'info', 'hello', { secret: 'x' });
    expect(entry.context).toBe('test');
    expect(entry.level).toBe('info');
    expect(entry.message).toBe('hello');
    expect(entry.payload?.secret).toBe('<redacted>');
    expect(entry.timestamp).toMatch(/^\d{4}-/);
  });
});

describe('createLogger', () => {
  beforeEach(() => {
    mockAppendDebugLog.mockClear();
    mockGetDebugLogs.mockClear();
  });

  it('writes debug log to storage when enabled and persist are true', async () => {
    mockGetDebugLogs.mockResolvedValue({
      enabled: true,
      persist: true,
      maxEntries: 500,
      level: 'debug',
      entries: [],
    } as DebugLogs);

    const log = createLogger('test');
    log.debug('debug message');

    // wait for async getDebugLogs
    await new Promise((r) => setTimeout(r, 10));
    expect(mockAppendDebugLog).toHaveBeenCalledTimes(1);
    expect(mockAppendDebugLog.mock.calls[0]?.[0].message).toBe('debug message');
  });

  it('does not persist debug log when persist is false', async () => {
    mockGetDebugLogs.mockResolvedValue({
      enabled: true,
      persist: false,
      maxEntries: 500,
      level: 'debug',
      entries: [],
    } as DebugLogs);

    const log = createLogger('test');
    log.debug('debug message');

    await new Promise((r) => setTimeout(r, 10));
    expect(mockAppendDebugLog).not.toHaveBeenCalled();
  });

  it('does not persist debug log when enabled is false', async () => {
    mockGetDebugLogs.mockResolvedValue({
      enabled: false,
      persist: true,
      maxEntries: 500,
      level: 'debug',
      entries: [],
    } as DebugLogs);

    const log = createLogger('test');
    log.debug('debug message');

    await new Promise((r) => setTimeout(r, 10));
    expect(mockAppendDebugLog).not.toHaveBeenCalled();
  });

  it('always persists info/warn/error when enabled and persist are true', async () => {
    mockGetDebugLogs.mockResolvedValue({
      enabled: true,
      persist: true,
      maxEntries: 500,
      level: 'info',
      entries: [],
    } as DebugLogs);

    const log = createLogger('test');
    log.info('info');
    log.warn('warn');
    log.error('error');

    await new Promise((r) => setTimeout(r, 10));
    expect(mockAppendDebugLog).toHaveBeenCalledTimes(3);
  });
});
