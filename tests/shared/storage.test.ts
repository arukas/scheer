import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getConfig,
  setConfig,
  getDebugLogs,
  setDebugLogs,
  appendDebugLog,
  clearDebugLogs,
  exportDebugLogs,
} from '@/shared/storage';
import { DEFAULT_CONFIG, DEFAULT_DEBUG_LOGS } from '@/shared/schema';

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
});
