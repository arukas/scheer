import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { sendMessage } from '../../src/shared/messaging';
import type { CreateProductResponse } from '../../src/shared/messaging';
import type { Config } from '../../src/shared/schema';
import type { PageStatus } from '../../src/shared/platform';
import { resolveEndpoint } from '../../src/shared/api';
import { localizeDocument, t } from '../../src/shared/i18n';
import './style.css';

localizeDocument('popupDocumentTitle');

function Popup() {
  const [status, setStatus] = useState<PageStatus | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [hasHostPermission, setHasHostPermission] = useState<boolean | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<CreateProductResponse | null>(null);

  useEffect(() => {
    refresh();

    // 用户切换标签页或当前页 URL 变化时刷新状态
    const handleTabChange = () => {
      // 清除上一次提交结果，避免跨页面残留
      setSubmitResult(null);
      refresh();
    };

    chrome.tabs.onActivated.addListener(handleTabChange);
    chrome.tabs.onUpdated.addListener(handleTabChange);

    return () => {
      chrome.tabs.onActivated.removeListener(handleTabChange);
      chrome.tabs.onUpdated.removeListener(handleTabChange);
    };
  }, []);

  async function checkHostPermission(): Promise<boolean> {
    try {
      return await chrome.permissions.contains({ origins: ['https://*/*'] });
    } catch {
      return false;
    }
  }

  async function requestHostPermission() {
    try {
      const granted = await chrome.permissions.request({ origins: ['https://*/*'] });
      if (granted) {
        setHasHostPermission(true);
        await refresh();
      }
    } catch (err) {
      console.error('申请权限失败', err);
    }
  }

  async function refresh() {
    try {
      const [permission, pageStatus, cfg] = await Promise.all([
        checkHostPermission(),
        sendMessage<PageStatus>({ type: 'GET_PAGE_STATUS' }),
        sendMessage<Config>({ type: 'GET_CONFIG' }),
      ]);
      setHasHostPermission(permission);
      setStatus(pageStatus);
      setConfig(cfg);
    } catch (err) {
      console.error('Popup 刷新失败', err);
    }
  }

  async function openOptions() {
    await chrome.windows.create({
      url: chrome.runtime.getURL('/options.html'),
      type: 'popup',
      width: 720,
      height: 760,
      focused: true,
    });
  }

  async function createProduct() {
    if (!configReady || !status?.canExtract) return;
    setSubmitting(true);
    setSubmitResult(null);
    try {
      const result = await sendMessage<CreateProductResponse>({ type: 'CREATE_PRODUCT' });
      setSubmitResult(result);
    } catch (err) {
      setSubmitResult({ success: false, error: err instanceof Error ? err.message : String(err) });
    } finally {
      setSubmitting(false);
    }
  }

  const configReady = Boolean(
    config &&
    resolveEndpoint(config.server.base ?? '', config.server.create_product_endpoint) &&
    resolveEndpoint(config.server.base ?? '', config.server.current_user_endpoint) &&
    config.server.secret
  );

  const canCreate = configReady && hasHostPermission && status?.canExtract;

  return (
    <div className="popup">
      <header className="popup-header">
        <h1 className="popup-title">Scheer</h1>
        <div className="popup-header-actions">
          <span className={`popup-badge ${configReady ? 'ready' : 'not-ready'}`}>
            {t(configReady ? 'configured' : 'notConfigured')}
          </span>
          <button className="popup-btn icon" onClick={openOptions} title={t('openSettings')}>
            ⚙️
          </button>
        </div>
      </header>

      <section className="popup-section">
        <h2 className="popup-section-title">{t('currentPage')}</h2>
        {status ? (
          <div className="popup-status">
            <div className="popup-row">
              <span className="popup-label">{t('platform')}</span>
              <span className="popup-value">{status.platform ?? t('unknown')}</span>
            </div>
            <div className="popup-row">
              <span className="popup-label">{t('extractionStatus')}</span>
              <span className={`popup-value ${status.canExtract ? 'success' : 'warning'}`}>
                {t(status.canExtract ? 'extractable' : 'notExtractable')}
              </span>
            </div>
            <div className="popup-row">
              <span className="popup-label">{t('reason')}</span>
              <span className="popup-value muted">{status.reason}</span>
            </div>
          </div>
        ) : (
          <div className="popup-loading">{t('loading')}</div>
        )}
        {hasHostPermission === false && (
          <div className="popup-permission">
            <p className="popup-permission-text">{t('permissionDescription')}</p>
            <button className="popup-btn full-width" onClick={requestHostPermission}>
              {t('grantAllSites')}
            </button>
          </div>
        )}
      </section>

      <section className="popup-section">
        <button
          className="popup-btn full-width"
          onClick={createProduct}
          disabled={!canCreate || submitting}
        >
          {t(submitting ? 'submitting' : 'createProduct')}
        </button>
        {!configReady && <p className="popup-hint">{t('configureFirstHint')}</p>}
        {configReady && !hasHostPermission && (
          <p className="popup-hint">{t('grantPermissionHint')}</p>
        )}
        {configReady && hasHostPermission && !status?.canExtract && (
          <p className="popup-hint">{t('unsupportedPageHint')}</p>
        )}
        {submitResult && (
          <div className={`popup-result ${submitResult.success ? 'success' : 'error'}`}>
            {submitResult.success ? (
              <>
                <p>{t('createSuccess')}</p>
                <p className="popup-result-detail">
                  {t('productId', String(submitResult.data.product_id))}
                </p>
                <p className="popup-result-detail">
                  {t('logId', String(submitResult.data.log_id))}
                </p>
              </>
            ) : (
              <p>{t('createFailed', submitResult.error)}</p>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

const root = createRoot(document.getElementById('root')!);
root.render(<Popup />);
