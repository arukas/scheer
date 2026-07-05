import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import JSZip from 'jszip';
import { sendMessage } from '../../src/shared/messaging';
import type { CreateProductResponse } from '../../src/shared/messaging';
import type { Config, DebugLogs } from '../../src/shared/schema';
import type { PageStatus } from '../../src/shared/platform';
import { resolveEndpoint } from '../../src/shared/api';
import { redactSensitive } from '../../src/shared/logger';
import './style.css';

function Popup() {
  const [status, setStatus] = useState<PageStatus | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [logs, setLogs] = useState<DebugLogs | null>(null);
  const [hasHostPermission, setHasHostPermission] = useState<boolean | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<CreateProductResponse | null>(null);
  const [exportingDiagnostics, setExportingDiagnostics] = useState(false);

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
      const [permission, pageStatus, cfg, l] = await Promise.all([
        checkHostPermission(),
        sendMessage<PageStatus>({ type: 'GET_PAGE_STATUS' }),
        sendMessage<Config>({ type: 'GET_CONFIG' }),
        sendMessage<DebugLogs>({ type: 'GET_DEBUG_LOGS' }),
      ]);
      setHasHostPermission(permission);
      setStatus(pageStatus);
      setConfig(cfg);
      setLogs(l);
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

  async function exportDiagnostics() {
    if (!config || !status || !logs) return;
    setExportingDiagnostics(true);
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const tabId = tab?.id;

      let pageHtml: unknown = null;
      let productPayload: unknown = null;

      if (tabId) {
        try {
          pageHtml = await chrome.tabs.sendMessage(tabId, { type: 'GET_PAGE_HTML' });
        } catch (err) {
          pageHtml = { error: err instanceof Error ? err.message : String(err) };
        }

        if (status.platform) {
          try {
            productPayload = await chrome.tabs.sendMessage(tabId, {
              type: 'EXTRACT_PRODUCT',
              payload: { platform: status.platform },
            });
          } catch (err) {
            productPayload = {
              success: false,
              error: err instanceof Error ? err.message : String(err),
            };
          }
        }
      }

      const manifest = chrome.runtime.getManifest();
      const diagnostics = {
        exported_at: new Date().toISOString(),
        extension_version: manifest.version_name ?? manifest.version,
        url: tab?.url ?? status.url,
        page_status: status,
        page_html: pageHtml,
        product_payload: productPayload,
        config: redactSensitive(JSON.parse(JSON.stringify(config)) as Record<string, unknown>),
        debug_logs: logs,
      };

      const zip = new JSZip();
      zip.file('diagnostics.json', JSON.stringify(diagnostics, null, 2));
      if (
        pageHtml &&
        typeof pageHtml === 'object' &&
        pageHtml !== null &&
        'html' in pageHtml &&
        typeof (pageHtml as Record<string, unknown>).html === 'string'
      ) {
        zip.file('page.html', (pageHtml as Record<string, string>).html);
      }

      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `scheer-diagnostic-${new Date().toISOString()}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('导出诊断包失败', err);
      setSubmitResult({
        success: false,
        error: `导出诊断包失败：${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setExportingDiagnostics(false);
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
            {configReady ? '已配置' : '未配置'}
          </span>
          <button className="popup-btn icon" onClick={openOptions} title="打开配置">
            ⚙️
          </button>
        </div>
      </header>

      <section className="popup-section">
        <h2 className="popup-section-title">当前页面</h2>
        {status ? (
          <div className="popup-status">
            <div className="popup-row">
              <span className="popup-label">平台</span>
              <span className="popup-value">{status.platform ?? '未知'}</span>
            </div>
            <div className="popup-row">
              <span className="popup-label">可抓状态</span>
              <span className={`popup-value ${status.canExtract ? 'success' : 'warning'}`}>
                {status.canExtract ? '可采集' : '不可采集'}
              </span>
            </div>
            <div className="popup-row">
              <span className="popup-label">原因</span>
              <span className="popup-value muted">{status.reason}</span>
            </div>
          </div>
        ) : (
          <div className="popup-loading">加载中…</div>
        )}
        {hasHostPermission === false && (
          <div className="popup-permission">
            <p className="popup-permission-text">需要授权访问网站数据，才能识别商品页并采集。</p>
            <button className="popup-btn full-width" onClick={requestHostPermission}>
              授权访问所有网站
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
          {submitting ? '提交中…' : '创建商品'}
        </button>
        {!configReady && (
          <p className="popup-hint">请先在 Options 中配置后端域名、接口地址和密钥。</p>
        )}
        {configReady && !hasHostPermission && (
          <p className="popup-hint">请点击上方「授权访问所有网站」按钮授予页面访问权限。</p>
        )}
        {configReady && hasHostPermission && !status?.canExtract && (
          <p className="popup-hint">当前页面暂不支持采集。</p>
        )}
        {submitResult && (
          <div className={`popup-result ${submitResult.success ? 'success' : 'error'}`}>
            {submitResult.success ? (
              <>
                <p>创建成功 ✅</p>
                <p className="popup-result-detail">商品 ID：{submitResult.data.product_id}</p>
                <p className="popup-result-detail">日志 ID：{submitResult.data.log_id}</p>
              </>
            ) : (
              <p>创建失败：{submitResult.error}</p>
            )}
          </div>
        )}
      </section>

      <section className="popup-section">
        <h2 className="popup-section-title">调试</h2>
        <div className="popup-row">
          <span className="popup-label">Debug 模式</span>
          <span className="popup-value">{logs?.enabled ? '开启' : '关闭'}</span>
        </div>
        <div className="popup-row">
          <span className="popup-label">本地日志</span>
          <span className="popup-value">
            {logs?.persist ? `${logs.entries.length} 条` : '未持久化'}
          </span>
        </div>
        {logs?.enabled && (
          <button
            className="popup-btn secondary full-width"
            onClick={exportDiagnostics}
            disabled={exportingDiagnostics}
            style={{ marginTop: 'var(--space-md)' }}
          >
            {exportingDiagnostics ? '打包中…' : '导出诊断包'}
          </button>
        )}
      </section>

      <footer className="popup-footer">
        <button className="popup-btn secondary" onClick={openOptions}>
          打开 Options
        </button>
        <button className="popup-btn" onClick={exportLogs} disabled={!logs || !logs.persist}>
          导出日志
        </button>
      </footer>
    </div>
  );
}

const root = createRoot(document.getElementById('root')!);
root.render(<Popup />);
