import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getConfig,
  setConfig,
  getDebugLogs,
  setDebugLogs,
  appendDebugLog,
  clearDebugLogs,
  exportDebugLogs,
  mergeWithDefaultConfig,
  mergeImportedConfig,
} from '@/shared/storage';
import { DEFAULT_CONFIG, DEFAULT_DEBUG_LOGS } from '@/shared/schema';
import type { Config } from '@/shared/schema';

const mockValues: Record<string, unknown> = {};

vi.mock('wxt/storage', () => ({
  storage: {
    defineItem: <T>(key: string, opts?: { fallback?: T }) => ({
      getValue: async (): Promise<T> => {
        const value = mockValues[key] as T | undefined;
        if (value === undefined && opts?.fallback !== undefined) {
          return opts.fallback;
        }
        return value as T;
      },
      setValue: async (value: T) => {
        mockValues[key] = value;
      },
    }),
    getItem: async (key: string) => mockValues[key],
    setItem: async (key: string, value: unknown) => {
      mockValues[key] = value;
    },
  },
}));

describe('storage', () => {
  beforeEach(() => {
    Object.keys(mockValues).forEach((k) => delete mockValues[k]);
  });

  it('returns default config when not set', async () => {
    const cfg = await getConfig();
    expect(cfg).toEqual(DEFAULT_CONFIG);
  });

  it('saves and reads config', async () => {
    const cfg = { ...DEFAULT_CONFIG, server: { ...DEFAULT_CONFIG.server, secret: 'test-secret' } };
    await setConfig(cfg);
    const read = await getConfig();
    expect(read.server.secret).toBe('test-secret');
  });

  it('returns default debug logs when not set', async () => {
    const logs = await getDebugLogs();
    expect(logs).toEqual(DEFAULT_DEBUG_LOGS);
  });

  it('appends debug log', async () => {
    await setDebugLogs(DEFAULT_DEBUG_LOGS);
    const entry = {
      timestamp: '2026-06-24T05:01:03.744Z',
      level: 'info' as const,
      context: 'test',
      message: 'hello',
    };
    await appendDebugLog(entry);
    const logs = await getDebugLogs();
    expect(logs.entries).toHaveLength(1);
    expect(logs.entries[0].message).toBe('hello');
  });

  it('truncates old entries when maxEntries exceeded', async () => {
    await setDebugLogs({ ...DEFAULT_DEBUG_LOGS, maxEntries: 2 });
    await appendDebugLog({ timestamp: '1', level: 'info', context: 'test', message: '1' });
    await appendDebugLog({ timestamp: '2', level: 'info', context: 'test', message: '2' });
    await appendDebugLog({ timestamp: '3', level: 'info', context: 'test', message: '3' });
    const logs = await getDebugLogs();
    expect(logs.entries).toHaveLength(2);
    expect(logs.entries[0].message).toBe('2');
    expect(logs.entries[1].message).toBe('3');
  });

  it('clears debug logs', async () => {
    await setDebugLogs({
      ...DEFAULT_DEBUG_LOGS,
      entries: [{ timestamp: '1', level: 'info', context: 'test', message: 'x' }],
    });
    await clearDebugLogs();
    const logs = await getDebugLogs();
    expect(logs.entries).toHaveLength(0);
    expect(logs.enabled).toBe(DEFAULT_DEBUG_LOGS.enabled);
  });

  it('exports debug logs as NDJSON with metadata header and one entry per line', async () => {
    const entry = {
      timestamp: '2026-06-24T05:01:03.744Z',
      level: 'info' as const,
      context: 'test',
      message: 'hello',
    };
    await setDebugLogs({ ...DEFAULT_DEBUG_LOGS, entries: [entry] });
    const text = exportDebugLogs(await getDebugLogs());
    const lines = text.split('\n');
    expect(lines.length).toBe(2);
    const meta = JSON.parse(lines[0]);
    expect(meta.type).toBe('scheer-debug-logs');
    expect(meta.count).toBe(1);
    expect(JSON.parse(lines[1])).toEqual(entry);
  });

  it('mergeWithDefaultConfig fills missing nested fields with defaults', () => {
    const partial = { ...DEFAULT_CONFIG, server: { ...DEFAULT_CONFIG.server, secret: 'test' } };
    delete (partial.server as Partial<typeof partial.server>).create_product_endpoint;
    const merged = mergeWithDefaultConfig(partial as Config);
    expect(merged.server.create_product_endpoint).toBe('/scheer/products');
    expect(merged.server.secret).toBe('test');
  });

  it('mergeImportedConfig fully overrides current config', () => {
    const current: Config = {
      ...DEFAULT_CONFIG,
      server: { ...DEFAULT_CONFIG.server, base: 'https://old.example.com', secret: 'old-secret' },
      debug: { ...DEFAULT_CONFIG.debug, enabled: false },
    };
    const imported: Partial<Config> = {
      server: {
        base: 'https://new.example.com',
        create_product_endpoint: '/new/products',
        current_user_endpoint: '/new/me',
        secret: 'new-secret',
      },
      debug: { enabled: true, persist: true, maxEntries: 100, level: 'debug' },
    };
    const merged = mergeImportedConfig(current, imported);
    expect(merged.server.base).toBe('https://new.example.com');
    expect(merged.server.secret).toBe('new-secret');
    expect(merged.server.create_product_endpoint).toBe('/new/products');
    expect(merged.debug.enabled).toBe(true);
    expect(merged.debug.level).toBe('debug');
  });

  it('mergeImportedConfig keeps current values for omitted fields', () => {
    const current: Config = {
      ...DEFAULT_CONFIG,
      server: { ...DEFAULT_CONFIG.server, secret: 'current-secret', timeout_ms: 60000 },
      debug: { ...DEFAULT_CONFIG.debug, enabled: true, level: 'warn' },
    };
    const imported = {
      server: { base: 'https://partial.example.com' },
    } as Partial<Config>;
    const merged = mergeImportedConfig(current, imported);
    expect(merged.server.base).toBe('https://partial.example.com');
    expect(merged.server.secret).toBe('current-secret');
    expect(merged.server.timeout_ms).toBe(60000);
    expect(merged.debug.enabled).toBe(true);
    expect(merged.debug.level).toBe('warn');
  });

  it('mergeImportedConfig does not affect unrelated debug fields', () => {
    const current: Config = {
      ...DEFAULT_CONFIG,
      debug: { ...DEFAULT_CONFIG.debug, persist: true, maxEntries: 2000 },
    };
    const imported = {
      debug: { enabled: false },
    } as Partial<Config>;
    const merged = mergeImportedConfig(current, imported);
    expect(merged.debug.enabled).toBe(false);
    expect(merged.debug.persist).toBe(true);
    expect(merged.debug.maxEntries).toBe(2000);
    expect(merged.debug.level).toBe(DEFAULT_CONFIG.debug.level);
  });
});
