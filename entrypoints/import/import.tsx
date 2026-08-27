/**
 * 外部配置导入确认页（扩展内部页面，不对外暴露）
 *
 * 只从 chrome.storage.session 读取 bridge 写入的 pendingExternalConfigImport，
 * 不从 URL 接收任何数据。用户确认后复用与 options 页相同的
 * mergeImportedConfig + 校验 + SET_CONFIG 链路写入正式配置。
 */

import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { sendMessage } from '../../src/shared/messaging';
import type { Config } from '../../src/shared/schema';
import {
  clearPendingImport,
  flattenImportedConfig,
  getConfigValueByPath,
  getPendingImport,
  maskSecret,
} from '../../src/shared/integration';
import type { PendingImport } from '../../src/shared/integration';
import { clearTokenStatus, mergeImportedConfig } from '../../src/shared/storage';
import { localizeDocument, t } from '../../src/shared/i18n';
import './style.css';

localizeDocument('importDocumentTitle');

type PageState = 'loading' | 'ready' | 'expired' | 'done';

function formatValue(value: unknown, sensitive: boolean): string {
  if (sensitive) {
    return typeof value === 'string' ? maskSecret(value) : '••••••••';
  }
  if (typeof value === 'object' && value !== null) return JSON.stringify(value);
  return String(value);
}

function isSameValue(a: unknown, b: unknown): boolean {
  if (typeof a === 'object' || typeof b === 'object') {
    return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  }
  return a === b;
}

function ImportPage() {
  const [state, setState] = useState<PageState>('loading');
  const [pending, setPending] = useState<PendingImport | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    const p = await getPendingImport();
    if (!p || p.expiresAt <= Date.now()) {
      await clearPendingImport();
      setState('expired');
      return;
    }
    setPending(p);
    const cfg = await sendMessage<Config>({ type: 'GET_CONFIG' });
    setConfig(cfg);
    setState('ready');
  }

  async function cancel() {
    await clearPendingImport();
    window.close();
  }

  async function confirm() {
    if (!pending || !config) return;
    setBusy(true);
    setStatus('');
    try {
      // 确认时重新读取并校验 pending，防止页面停留期间已过期或被新请求替换
      const latest = await getPendingImport();
      if (!latest || latest.expiresAt <= Date.now() || latest.requestId !== pending.requestId) {
        setState('expired');
        return;
      }

      const merged = mergeImportedConfig(config, latest.config);
      // 与 options 页相同的最终校验
      if (!merged.server.secret.trim()) {
        setStatus(t('serverSecretRequired'));
        return;
      }
      if (!merged.server.base.trim() && !merged.server.create_product_endpoint.trim()) {
        setStatus(t('serverEndpointRequired'));
        return;
      }

      await sendMessage({ type: 'SET_CONFIG', payload: { config: merged } });
      // 旧密钥对应的 Token 有效期缓存对新配置不再可信
      await clearTokenStatus();
      await clearPendingImport();
      setState('done');
      setTimeout(() => window.close(), 700);
    } catch (err) {
      setStatus(t('importFailed', (err as Error).message));
    } finally {
      setBusy(false);
    }
  }

  if (state === 'loading') {
    return <div className="import-loading">{t('loading')}</div>;
  }

  if (state === 'expired') {
    return (
      <main className="import">
        <h1 className="import-title">{t('importExpiredTitle')}</h1>
        <p className="import-hint">{t('importExpiredMessage')}</p>
      </main>
    );
  }

  const rows = pending ? flattenImportedConfig(pending.config) : [];
  const baseWillChange =
    !!pending?.config.server?.base && !!config && pending.config.server.base !== config.server.base;

  return (
    <main className="import">
      <h1 className="import-title">{t('importRequestTitle')}</h1>
      <p className="import-hint">{t('importRequestHint')}</p>

      <section className="import-section">
        <div className="import-label">{t('importSourceOrigin')}</div>
        <div className="import-value import-origin">{pending?.sourceOrigin}</div>
      </section>

      {baseWillChange && <p className="import-warning">{t('importBaseChangeWarning')}</p>}

      <section className="import-section">
        <div className="import-label">{t('importChangesTitle')}</div>
        {rows.map((row) => {
          const newText = formatValue(row.value, row.sensitive);
          const oldValue = config ? getConfigValueByPath(config, row.path) : undefined;
          const showOld =
            !row.sensitive && !isSameValue(oldValue, row.value) && oldValue !== undefined;
          return (
            <div className="import-row" key={row.path}>
              <div className="import-row-path">{row.path}</div>
              <div className="import-row-value">
                {showOld && (
                  <>
                    <span className="import-old">
                      {formatValue(oldValue, false) || t('importEmptyValue')}
                    </span>
                    <span className="import-arrow">→</span>
                  </>
                )}
                <span>{newText || t('importEmptyValue')}</span>
              </div>
            </div>
          );
        })}
      </section>

      <p className="import-hint">{t('importTrustHint')}</p>

      <div className="import-actions">
        <button type="button" className="import-btn secondary" onClick={cancel} disabled={busy}>
          {t('cancel')}
        </button>
        <button type="button" className="import-btn" onClick={confirm} disabled={busy}>
          {t('importConfirm')}
        </button>
      </div>

      {state === 'done' && <div className="import-status">{t('importSaved')}</div>}
      {status && <div className="import-status">{status}</div>}
    </main>
  );
}

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(<ImportPage />);
}
