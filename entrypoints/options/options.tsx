import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { sendMessage } from '../../src/shared/messaging';
import type { Config, DebugLogs } from '../../src/shared/schema';
import './style.css';

function Options() {
  const [config, setConfig] = useState<Config | null>(null);
  const [logs, setLogs] = useState<DebugLogs | null>(null);
  const [status, setStatus] = useState<string>('');

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
    try {
      await sendMessage({ type: 'SET_CONFIG', payload: { config } });
      setStatus('配置已保存');
      await load();
    } catch (err) {
      setStatus(`保存失败：${(err as Error).message}`);
    }
  }

  function updateServer(partial: Partial<Config['server']>) {
    setConfig((prev) =>
      prev ? { ...prev, server: { ...prev.server, ...partial } } : prev
    );
  }

  function updateDebug(partial: Partial<Config['debug']>) {
    setConfig((prev) =>
      prev ? { ...prev, debug: { ...prev.debug, ...partial } } : prev
    );
  }

  async function testConfig() {
    if (!config) return;
    setStatus('正在请求后端…');
    try {
      const result = await sendMessage<
        { success: true; data: unknown } | { success: false; error: string }
      >({ type: 'TEST_CONFIG', payload: { config } });
      if (result.success) {
        const preview = JSON.stringify(result.data).slice(0, 240);
        setStatus(`连接成功：${preview}`);
      } else {
        setStatus(`连接失败：${result.error}`);
      }
    } catch (err) {
      setStatus(`测试失败：${(err as Error).message}`);
    }
  }

  async function clearLogs() {
    await sendMessage({ type: 'CLEAR_DEBUG_LOGS' });
    await load();
    setStatus('调试日志已清除');
  }

  async function exportLogs() {
    if (!logs) return;
    const text = await sendMessage<string>({ type: 'EXPORT_DEBUG_LOGS' });
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `scheer-debug-logs-${new Date().toISOString()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (!config) {
    return <div className="options-loading">加载中…</div>;
  }

  return (
    <div className="options">
      <header className="options-header">
        <h1 className="options-title">Scheer 配置</h1>
      </header>

      <section className="options-section">
        <h2 className="options-section-title">远端服务</h2>
        <div className="options-field">
          <label className="options-label" htmlFor="base">
            后端域名
          </label>
          <input
            id="base"
            className="options-input"
            type="url"
            value={config.server.base}
            onChange={(e) => updateServer({ base: e.target.value })}
            placeholder="https://api.example.com"
          />
          <p className="options-hint">
            当下方接口填写相对 URI 时，会与此域名拼接；填写完整 URL 时则直接请求该地址。
          </p>
        </div>
        <div className="options-field">
          <label className="options-label" htmlFor="create-product-endpoint">
            创建商品接口地址
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
            当前用户信息接口地址
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
            后端密钥
          </label>
          <input
            id="secret"
            className="options-input"
            type="password"
            value={config.server.secret}
            onChange={(e) => updateServer({ secret: e.target.value })}
            placeholder="Bearer token"
          />
          <p className="options-hint">
            凭据以明文保存在本地 chrome.storage.local 中，不上传任何服务器。
          </p>
        </div>
      </section>

      <section className="options-section">
        <h2 className="options-section-title">Debug 日志</h2>
        <div className="options-row">
          <label className="options-switch">
            <input
              type="checkbox"
              checked={config.debug.enabled}
              onChange={(e) => updateDebug({ enabled: e.target.checked })}
            />
            <span>启用 Debug 模式</span>
          </label>
        </div>
        <div className="options-row">
          <label className="options-switch">
            <input
              type="checkbox"
              checked={config.debug.persist}
              onChange={(e) => updateDebug({ persist: e.target.checked })}
            />
            <span>保存调试日志到本地</span>
          </label>
        </div>
        <div className="options-field">
          <label className="options-label" htmlFor="maxEntries">
            最大日志条数
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
        <div className="options-actions">
          <button className="options-btn secondary" onClick={clearLogs}>
            清除日志
          </button>
          <button
            className="options-btn secondary"
            onClick={exportLogs}
            disabled={!logs || logs.entries.length === 0}
          >
            导出日志
          </button>
        </div>
        {logs && logs.persist && (
          <p className="options-hint">
            当前本地日志：{logs.entries.length} 条
          </p>
        )}
      </section>

      <section className="options-section">
        <h2 className="options-section-title">操作</h2>
        <div className="options-actions">
          <button className="options-btn secondary" onClick={testConfig}>
            测试配置
          </button>
          <button className="options-btn" onClick={save}>
            保存
          </button>
        </div>
        {status && <p className="options-status">{status}</p>}
      </section>
    </div>
  );
}

const root = createRoot(document.getElementById('root')!);
root.render(<Options />);
