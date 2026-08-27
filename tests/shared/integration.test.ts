import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  IMPORT_PROTOCOL,
  IMPORT_PROTOCOL_VERSION,
  IMPORT_REQUEST_MAX_AGE_MS,
  ImportError,
  clearPendingImport,
  flattenImportedConfig,
  getConfigValueByPath,
  getPendingImport,
  isHttpOrigin,
  maskSecret,
  sanitizeImportedConfig,
  setPendingImport,
  shouldBlockImport,
  validateImportRequest,
} from '@/shared/integration';
import type { PendingImport } from '@/shared/integration';
import { clearTokenStatus, getTokenStatus, setTokenStatus } from '@/shared/storage';
import { DEFAULT_CONFIG } from '@/shared/schema';

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
      removeValue: async () => {
        delete mockValues[key];
      },
    }),
    getItem: async (key: string) => mockValues[key],
    setItem: async (key: string, value: unknown) => {
      mockValues[key] = value;
    },
  },
}));

function validRequest(config: unknown = { server: { secret: 'sk-123' } }) {
  return {
    protocol: IMPORT_PROTOCOL,
    version: IMPORT_PROTOCOL_VERSION,
    type: 'REQUEST_CONFIG_IMPORT',
    requestId: 'd5fb54a2-4ef8-4e67-a93a-7d1ed06e2489',
    timestamp: Date.now(),
    config,
  };
}

function expectImportError(fn: () => unknown, code: string) {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(ImportError);
    expect((err as ImportError).code).toBe(code);
    return;
  }
  throw new Error(`expected ImportError(${code})`);
}

describe('integration', () => {
  beforeEach(() => {
    Object.keys(mockValues).forEach((k) => delete mockValues[k]);
  });

  describe('validateImportRequest', () => {
    it('accepts a valid request', () => {
      const req = validateImportRequest(validRequest());
      expect(req.requestId).toBe('d5fb54a2-4ef8-4e67-a93a-7d1ed06e2489');
    });

    it('rejects non-object messages', () => {
      expectImportError(() => validateImportRequest(null), 'INVALID_MESSAGE');
      expectImportError(() => validateImportRequest('x'), 'INVALID_MESSAGE');
      expectImportError(() => validateImportRequest([]), 'INVALID_MESSAGE');
    });

    it('rejects wrong protocol / version / type', () => {
      expectImportError(
        () => validateImportRequest({ ...validRequest(), protocol: 'other' }),
        'INVALID_MESSAGE'
      );
      expectImportError(
        () => validateImportRequest({ ...validRequest(), version: 2 }),
        'INVALID_MESSAGE'
      );
      expectImportError(
        () => validateImportRequest({ ...validRequest(), type: 'GET_CONFIG' }),
        'INVALID_MESSAGE'
      );
    });

    it('rejects missing or invalid requestId', () => {
      const noId: Record<string, unknown> = validRequest();
      delete noId.requestId;
      expectImportError(() => validateImportRequest(noId), 'INVALID_REQUEST_ID');
      expectImportError(
        () => validateImportRequest({ ...validRequest(), requestId: '' }),
        'INVALID_REQUEST_ID'
      );
      expectImportError(
        () => validateImportRequest({ ...validRequest(), requestId: 123 }),
        'INVALID_REQUEST_ID'
      );
      expectImportError(
        () => validateImportRequest({ ...validRequest(), requestId: 'x'.repeat(129) }),
        'INVALID_REQUEST_ID'
      );
    });

    it('rejects stale or future timestamps', () => {
      const now = Date.now();
      expectImportError(
        () =>
          validateImportRequest(
            { ...validRequest(), timestamp: now - IMPORT_REQUEST_MAX_AGE_MS - 1 },
            now
          ),
        'REQUEST_EXPIRED'
      );
      expectImportError(
        () =>
          validateImportRequest(
            { ...validRequest(), timestamp: now + IMPORT_REQUEST_MAX_AGE_MS + 1 },
            now
          ),
        'REQUEST_EXPIRED'
      );
      expectImportError(
        () => validateImportRequest({ ...validRequest(), timestamp: Number.NaN }, now),
        'REQUEST_EXPIRED'
      );
    });
  });

  describe('sanitizeImportedConfig', () => {
    it('passes a full valid config through', () => {
      const result = sanitizeImportedConfig({
        server: {
          base: 'https://api.example.com',
          create_product_endpoint: '/scheer/products',
          current_user_endpoint: 'https://api.example.com/scheer/me',
          method: 'POST',
          secret: 'sk-secret',
          secret_header: 'X-Api-Key',
          secret_prefix: '',
          headers: { 'X-Foo': 'bar' },
          timeout_ms: 60000,
        },
        crawl: {
          product_mode: 'manual',
          extract_reviews: false,
          review_strategy: 'visible',
          review_max_pages: 3,
          confirm_before_submit: false,
        },
        debug: { enabled: true, persist: true, maxEntries: 100, level: 'debug' },
        platforms: { shopify: true, amazon: false },
        retry: { max_attempts: 3, backoff_base_ms: 500, retryable_status: [429, 500] },
        ui: { notify_success: true, notify_failure: false },
        storage: { keep_history_days: 7, product_dedup_key: 'source_url' },
      });

      expect(result.server?.base).toBe('https://api.example.com');
      expect(result.server?.headers).toEqual({ 'X-Foo': 'bar' });
      expect(result.crawl?.confirm_before_submit).toBe(false);
      expect(result.debug?.level).toBe('debug');
      expect(result.platforms).toEqual({ shopify: true, amazon: false });
      expect(result.retry?.retryable_status).toEqual([429, 500]);
      expect(result.storage?.keep_history_days).toBe(7);
    });

    it('rejects non-object config', () => {
      expectImportError(() => sanitizeImportedConfig(null), 'INVALID_CONFIG');
      expectImportError(() => sanitizeImportedConfig([]), 'INVALID_CONFIG');
      expectImportError(() => sanitizeImportedConfig('str'), 'INVALID_CONFIG');
    });

    it('rejects non-object sections', () => {
      expectImportError(() => sanitizeImportedConfig({ server: 'x' }), 'INVALID_CONFIG');
      expectImportError(() => sanitizeImportedConfig({ debug: [1] }), 'INVALID_CONFIG');
    });

    it('drops unknown fields and reports EMPTY_CONFIG when nothing importable', () => {
      expectImportError(() => sanitizeImportedConfig({}), 'EMPTY_CONFIG');
      expectImportError(() => sanitizeImportedConfig({ evil: true }), 'EMPTY_CONFIG');
      expectImportError(() => sanitizeImportedConfig({ server: { backdoor: 1 } }), 'EMPTY_CONFIG');

      const result = sanitizeImportedConfig({
        server: { secret: 'sk-1', backdoor: 1 },
        evil: 'x',
      });
      expect(result).toEqual({ server: { secret: 'sk-1' } });
    });

    it('enforces https for server.base, allowing http on localhost', () => {
      expect(
        sanitizeImportedConfig({ server: { base: 'https://api.example.com' } }).server?.base
      ).toBe('https://api.example.com');
      expect(
        sanitizeImportedConfig({ server: { base: 'http://localhost:3000' } }).server?.base
      ).toBe('http://localhost:3000');
      expectImportError(
        () => sanitizeImportedConfig({ server: { base: 'http://evil.example.com' } }),
        'INVALID_FIELD'
      );
      expectImportError(
        () => sanitizeImportedConfig({ server: { base: 'not-a-url' } }),
        'INVALID_FIELD'
      );
    });

    it('validates endpoints as relative path or secure URL', () => {
      const ok = sanitizeImportedConfig({
        server: { create_product_endpoint: '/a/b', current_user_endpoint: 'https://x.com/me' },
      });
      expect(ok.server?.create_product_endpoint).toBe('/a/b');
      expectImportError(
        () => sanitizeImportedConfig({ server: { create_product_endpoint: 'http://x.com/a' } }),
        'INVALID_FIELD'
      );
      expectImportError(
        () => sanitizeImportedConfig({ server: { create_product_endpoint: '' } }),
        'INVALID_FIELD'
      );
    });

    it('rejects empty / oversized / non-string secrets', () => {
      expectImportError(() => sanitizeImportedConfig({ server: { secret: '' } }), 'INVALID_FIELD');
      expectImportError(
        () => sanitizeImportedConfig({ server: { secret: 'x'.repeat(4097) } }),
        'INVALID_FIELD'
      );
      expectImportError(() => sanitizeImportedConfig({ server: { secret: 1 } }), 'INVALID_FIELD');
    });

    it('locks literal-typed fields to their only valid values', () => {
      expectImportError(
        () => sanitizeImportedConfig({ crawl: { product_mode: 'auto' } }),
        'INVALID_FIELD'
      );
      expectImportError(
        () => sanitizeImportedConfig({ crawl: { extract_reviews: true } }),
        'INVALID_FIELD'
      );
      expectImportError(
        () => sanitizeImportedConfig({ crawl: { review_strategy: 'all' } }),
        'INVALID_FIELD'
      );
      expectImportError(
        () => sanitizeImportedConfig({ server: { method: 'GET' } }),
        'INVALID_FIELD'
      );
    });

    it('enforces numeric ranges', () => {
      expectImportError(
        () => sanitizeImportedConfig({ server: { timeout_ms: 10 } }),
        'INVALID_FIELD'
      );
      expectImportError(
        () => sanitizeImportedConfig({ server: { timeout_ms: 1.5 } }),
        'INVALID_FIELD'
      );
      expectImportError(
        () => sanitizeImportedConfig({ debug: { maxEntries: 100000 } }),
        'INVALID_FIELD'
      );
      expectImportError(
        () => sanitizeImportedConfig({ debug: { level: 'verbose' } }),
        'INVALID_FIELD'
      );
      expectImportError(
        () => sanitizeImportedConfig({ retry: { retryable_status: [999] } }),
        'INVALID_FIELD'
      );
      expectImportError(
        () => sanitizeImportedConfig({ retry: { retryable_status: '500' } }),
        'INVALID_FIELD'
      );
    });

    it('caps headers size and validates types', () => {
      expectImportError(
        () => sanitizeImportedConfig({ server: { headers: 'x' } }),
        'INVALID_FIELD'
      );
      expectImportError(
        () => sanitizeImportedConfig({ server: { headers: { 'X-A': 1 } } }),
        'INVALID_FIELD'
      );
      const tooMany = Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`X-K${i}`, 'v']));
      expectImportError(
        () => sanitizeImportedConfig({ server: { headers: tooMany } }),
        'INVALID_FIELD'
      );
    });

    it('drops unknown platform keys but rejects non-boolean values', () => {
      const result = sanitizeImportedConfig({
        platforms: { shopify: true, madeup: false },
      });
      expect(result.platforms).toEqual({ shopify: true });
      expectImportError(
        () => sanitizeImportedConfig({ platforms: { shopify: 'yes' } }),
        'INVALID_FIELD'
      );
    });

    it('keeps XSS-looking strings as inert text (rendering uses safe DOM APIs)', () => {
      const xss = '<img src=x onerror=alert(1)>';
      const result = sanitizeImportedConfig({ server: { secret: xss } });
      expect(result.server?.secret).toBe(xss);
    });
  });

  describe('isHttpOrigin', () => {
    it('accepts http/https origins only', () => {
      expect(isHttpOrigin('https://example.com')).toBe(true);
      expect(isHttpOrigin('http://localhost:8000')).toBe(true);
      expect(isHttpOrigin('chrome-extension://abc')).toBe(false);
      expect(isHttpOrigin('file:///x')).toBe(false);
      expect(isHttpOrigin('not an origin')).toBe(false);
    });
  });

  describe('maskSecret', () => {
    it('fully masks short secrets', () => {
      expect(maskSecret('short')).toBe('••••••••');
      expect(maskSecret('12345678')).toBe('••••••••');
    });

    it('keeps only the first and last 4 chars of long secrets', () => {
      expect(maskSecret('sk-abcdefgh-12345')).toBe('sk-a••••••••2345');
    });

    it('handles empty input', () => {
      expect(maskSecret('')).toBe('');
    });
  });

  describe('shouldBlockImport', () => {
    const base: PendingImport = {
      requestId: 'r1',
      sourceOrigin: 'https://a.com',
      receivedAt: 0,
      expiresAt: 1000,
      config: {},
    };

    it('blocks only when pending is unexpired and its window is alive', () => {
      expect(shouldBlockImport(null, 500, false)).toBe(false);
      expect(shouldBlockImport(undefined, 500, true)).toBe(false);
      // 已过期
      expect(shouldBlockImport(base, 1000, true)).toBe(false);
      // 未过期但窗口已关闭 → 允许覆盖
      expect(shouldBlockImport(base, 500, false)).toBe(false);
      // 未过期且窗口存活 → BUSY
      expect(shouldBlockImport(base, 500, true)).toBe(true);
    });
  });

  describe('flattenImportedConfig / getConfigValueByPath', () => {
    it('flattens sections in stable order and marks sensitive fields', () => {
      const rows = flattenImportedConfig({
        debug: { enabled: true },
        server: { secret: 'sk-1', base: 'https://a.com', headers: { 'X-A': 'b' } },
      });
      expect(rows.map((r) => r.path)).toEqual([
        'server.base',
        'server.headers',
        'server.secret',
        'debug.enabled',
      ]);
      expect(rows.find((r) => r.path === 'server.secret')?.sensitive).toBe(true);
      expect(rows.find((r) => r.path === 'server.headers')?.sensitive).toBe(true);
      expect(rows.find((r) => r.path === 'server.base')?.sensitive).toBe(false);
    });

    it('reads values by dotted path', () => {
      expect(getConfigValueByPath(DEFAULT_CONFIG, 'server.timeout_ms')).toBe(30000);
      expect(getConfigValueByPath(DEFAULT_CONFIG, 'debug.level')).toBe('info');
      expect(getConfigValueByPath(DEFAULT_CONFIG, 'server.nope')).toBeUndefined();
      expect(getConfigValueByPath(DEFAULT_CONFIG, 'nope.nope')).toBeUndefined();
    });
  });

  describe('pending import session storage', () => {
    it('set / get / clear roundtrip', async () => {
      expect(await getPendingImport()).toBeNull();

      const pending: PendingImport = {
        requestId: 'r1',
        sourceOrigin: 'https://a.com',
        receivedAt: 1,
        expiresAt: 2,
        windowId: 42,
        config: { server: { secret: 'sk-1' } },
      };
      await setPendingImport(pending);
      expect(await getPendingImport()).toEqual(pending);

      await clearPendingImport();
      expect(await getPendingImport()).toBeNull();
    });
  });

  describe('clearTokenStatus', () => {
    it('removes cached token status', async () => {
      await setTokenStatus({ expires_at: null, checked_at: new Date().toISOString() });
      expect(await getTokenStatus()).not.toBeNull();
      await clearTokenStatus();
      expect(await getTokenStatus()).toBeNull();
    });
  });
});
