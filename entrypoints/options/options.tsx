import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { sendMessage } from '../../src/shared/messaging';
import type { Config, DebugLogs } from '../../src/shared/schema';
import { DEBUG_LOG_LEVELS } from '../../src/shared/schema';
import { mergeImportedConfig } from '../../src/shared/storage';
import { localizeDocument, t } from '../../src/shared/i18n';
import './style.css';

localizeDocument('optionsDocumentTitle');

function Options() {
  const [config, setConfig] = useState<Config | null>(null);
  const [logs, setLogs] = useState<DebugLogs | null>(null);
  const [status, setStatus] = useState<string>('');
  const [importText, setImportText] = useState<string>('');
  const [showImport, setShowImport] = useState<boolean>(false);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    const cfg = await sendMessage<Config>({ type: 'GET_CONFIG' });
    const l = await sendMessage<DebugLogs>({ type: 'GET_DEBUG_LOGS' });
    setConfig(cfg);
    setLogs(l);
  }

  async function save() {
    if (!config) return;

    if (!config.server.secret.trim()) {
      setStatus(t('serverSecretRequired'));
      return;
    }
    if (!config.server.base.trim() && !config.server.create_product_endpoint.trim()) {
      setStatus(t('serverEndpointRequired'));
      return;
    }

    try {
      await sendMessage({ type: 'SET_CONFIG', payload: { config } });
      setStatus(t('configSaved'));
      await load();
    } catch (err) {
      setStatus(t('saveFailed', (err as Error).message));
    }
  }

  function updateServer(partial: Partial<Config['server']>) {
    setConfig((prev) => (prev ? { ...prev, server: { ...prev.server, ...partial } } : prev));
  }

  function updateDebug(partial: Partial<Config['debug']>) {
    if (partial.maxEntries !== undefined) {
      let value = Number(partial.maxEntries);
      if (Number.isNaN(value)) value = 500;
      value = Math.max(50, Math.min(5000, value));
      partial = { ...partial, maxEntries: value };
    }
    setConfig((prev) => (prev ? { ...prev, debug: { ...prev.debug, ...partial } } : prev));
  }

  async function testConfig() {
    if (!config) return;
    setStatus(t('requestingBackend'));
    try {
      const result = await sendMessage<
        { success: true; data: unknown } | { success: false; error: string }
      >({ type: 'TEST_CONFIG', payload: { config } });
      if (result.success) {
        const preview = JSON.stringify(result.data).slice(0, 240);
        setStatus(t('connectionSuccess', preview));
      } else {
        setStatus(t('connectionFailed', result.error));
      }
    } catch (err) {
      setStatus(t('testFailed', (err as Error).message));
    }
  }

  function decodeBase64(value: string): string {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new TextDecoder().decode(bytes);
  }

  async function importConfig() {
    if (!config) return;
    const raw = importText.trim();
    if (!raw) {
      setStatus(t('pasteConfigRequired'));
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      try {
        const cleaned = raw.replace(/\s/g, '');
        const decoded = decodeBase64(cleaned);
        parsed = JSON.parse(decoded);
      } catch {
        setStatus(t('importInvalidJson'));
        return;
      }
    }

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      setStatus(t('importMustBeObject'));
      return;
    }

    if ((parsed as Partial<Config>).server !== undefined) {
      const server = (parsed as Partial<Config>).server;
      if (typeof server !== 'object' || server === null || Array.isArray(server)) {
        setStatus(t('importServerMustBeObject'));
        return;
      }
    }

    const merged = mergeImportedConfig(config, parsed as Partial<Config>);

    if (!merged.server.secret.trim()) {
      setStatus(t('importSecretRequired'));
      return;
    }
    if (!merged.server.base.trim() && !merged.server.create_product_endpoint.trim()) {
      setStatus(t('importEndpointRequired'));
      return;
    }

    try {
      await sendMessage({ type: 'SET_CONFIG', payload: { config: merged } });
      setStatus(t('importSaved'));
      setImportText('');
      setShowImport(false);
      await load();
    } catch (err) {
      setStatus(t('importFailed', (err as Error).message));
    }
  }

  async function toggleDebugEnabled() {
    if (!config) return;
    const nextConfig: Config = {
      ...config,
      debug: { ...config.debug, enabled: !config.debug.enabled },
    };
    try {
      await sendMessage({ type: 'SET_CONFIG', payload: { config: nextConfig } });
      await load();
      setStatus(t(nextConfig.debug.enabled ? 'debugEnabled' : 'debugDisabled'));
    } catch (err) {
      setStatus(t('debugToggleFailed', (err as Error).message));
    }
  }

  async function clearLogs() {
    await sendMessage({ type: 'CLEAR_DEBUG_LOGS' });
    await load();
    setStatus(t('logsCleared'));
  }

  async function exportLogs() {
    if (!logs) return;
    const text = await sendMessage<string>({ type: 'EXPORT_DEBUG_LOGS' });
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `scheer-debug-logs-${new Date().toISOString()}.log`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function openExtensionManagement() {
    const extensionId = chrome.runtime.id;
    chrome.tabs.create({ url: `chrome://extensions/?id=${extensionId}` });
  }

  if (!config) {
    return <div className="options-loading">{t('loading')}</div>;
  }

  return (
    <div className="options">
      <header className="options-header">
        <h1 className="options-title">{t('optionsTitle')}</h1>
        <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
          <button className="options-btn secondary" onClick={toggleDebugEnabled}>
            {t(config.debug.enabled ? 'disableDebug' : 'enableDebug')}
          </button>
          <button className="options-btn secondary" onClick={openExtensionManagement}>
            {t('extensionManagement')}
          </button>
        </div>
      </header>

      <section className="options-section">
        <h2 className="options-section-title">{t('remoteService')}</h2>
        <div className="options-field">
          <label className="options-label" htmlFor="base">
            {t('backendBase')}
          </label>
          <input
            id="base"
            className="options-input"
            type="url"
            value={config.server.base}
            onChange={(e) => updateServer({ base: e.target.value })}
            placeholder="https://api.example.com"
          />
          <p className="options-hint">{t('backendBaseHint')}</p>
        </div>
        <div className="options-field">
          <label className="options-label" htmlFor="create-product-endpoint">
            {t('createProductEndpoint')}
          </label>
          <input
            id="create-product-endpoint"
            className="options-input"
            type="text"
            value={config.server.create_product_endpoint}
            onChange={(e) => updateServer({ create_product_endpoint: e.target.value })}
            placeholder="/scheer/products"
          />
        </div>
        <div className="options-field">
          <label className="options-label" htmlFor="current-user-endpoint">
            {t('currentUserEndpoint')}
          </label>
          <input
            id="current-user-endpoint"
            className="options-input"
            type="text"
            value={config.server.current_user_endpoint}
            onChange={(e) => updateServer({ current_user_endpoint: e.target.value })}
            placeholder="/scheer/me"
          />
        </div>
        <div className="options-field">
          <label className="options-label" htmlFor="secret">
            {t('backendSecret')}
          </label>
          <input
            id="secret"
            className="options-input"
            type="password"
            value={config.server.secret}
            onChange={(e) => updateServer({ secret: e.target.value })}
            placeholder="Bearer token"
          />
          <p className="options-hint">{t('secretStorageHint')}</p>
        </div>
        <div className="options-field">
          <label className="options-label" htmlFor="secret-header">
            {t('tokenHeader')}
          </label>
          <input
            id="secret-header"
            className="options-input"
            type="text"
            value={config.server.secret_header ?? ''}
            onChange={(e) => updateServer({ secret_header: e.target.value || undefined })}
            placeholder="Authorization"
          />
          <p className="options-hint">{t('tokenHeaderHint')}</p>
        </div>
        <div className="options-field">
          <label className="options-label" htmlFor="secret-prefix">
            {t('tokenPrefix')}
          </label>
          <input
            id="secret-prefix"
            className="options-input"
            type="text"
            value={config.server.secret_prefix ?? ''}
            onChange={(e) => updateServer({ secret_prefix: e.target.value || undefined })}
            placeholder="Bearer"
          />
          <p className="options-hint">{t('tokenPrefixHint')}</p>
        </div>
      </section>

      {config.debug.enabled && (
        <section className="options-section">
          <h2 className="options-section-title">{t('debugLogs')}</h2>
          <div className="options-row">
            <label className="options-switch">
              <input
                type="checkbox"
                checked={config.debug.enabled}
                onChange={(e) => updateDebug({ enabled: e.target.checked })}
              />
              <span>{t('enableDebugMode')}</span>
            </label>
          </div>
          <div className="options-row">
            <label className="options-switch">
              <input
                type="checkbox"
                checked={config.debug.persist}
                onChange={(e) => updateDebug({ persist: e.target.checked })}
              />
              <span>{t('persistLogs')}</span>
            </label>
          </div>
          <div className="options-field">
            <label className="options-label" htmlFor="maxEntries">
              {t('maxLogEntries')}
            </label>
            <input
              id="maxEntries"
              className="options-input"
              type="number"
              min={50}
              max={5000}
              value={config.debug.maxEntries}
              onChange={(e) => updateDebug({ maxEntries: Number(e.target.value) })}
            />
          </div>
          <div className="options-field">
            <label className="options-label" htmlFor="debugLevel">
              {t('logLevel')}
            </label>
            <select
              id="debugLevel"
              className="options-input"
              value={config.debug.level}
              onChange={(e) => updateDebug({ level: e.target.value as Config['debug']['level'] })}
            >
              {DEBUG_LOG_LEVELS.map((level) => (
                <option key={level} value={level}>
                  {level.toUpperCase()}
                </option>
              ))}
            </select>
            <p className="options-hint">{t('logLevelHint')}</p>
          </div>
          <div className="options-actions">
            <button className="options-btn secondary" onClick={clearLogs}>
              {t('clearLogs')}
            </button>
            <button
              className="options-btn secondary"
              onClick={exportLogs}
              disabled={!logs || logs.entries.length === 0}
            >
              {t('exportLogs')}
            </button>
          </div>
          {logs && logs.persist && (
            <p className="options-hint">{t('localLogCount', String(logs.entries.length))}</p>
          )}
        </section>
      )}

      <section className="options-section">
        <h2 className="options-section-title">{t('actions')}</h2>
        {!showImport ? (
          <div className="options-actions">
            <button className="options-btn secondary" onClick={() => setShowImport(true)}>
              {t('importConfig')}
            </button>
          </div>
        ) : (
          <>
            <div className="options-field">
              <label className="options-label" htmlFor="import-config">
                {t('pasteConfig')}
              </label>
              <textarea
                id="import-config"
                className="options-input textarea"
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                placeholder={t('importPlaceholder')}
                rows={8}
              />
              <p className="options-hint">{t('importHint')}</p>
            </div>
            <div className="options-actions">
              <button className="options-btn" onClick={importConfig}>
                {t('importAndSave')}
              </button>
              <button className="options-btn secondary" onClick={() => setShowImport(false)}>
                {t('cancel')}
              </button>
            </div>
          </>
        )}
        <div className="options-actions">
          <button className="options-btn secondary" onClick={testConfig}>
            {t('testConfig')}
          </button>
          <button className="options-btn" onClick={save}>
            {t('save')}
          </button>
        </div>
        {status && <p className="options-status">{status}</p>}
      </section>
    </div>
  );
}

const root = createRoot(document.getElementById('root')!);
root.render(<Options />);
