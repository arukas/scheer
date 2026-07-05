import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { sendMessage } from '../../src/shared/messaging';
import type { Config, DebugLogs } from '../../src/shared/schema';
import { DEBUG_LOG_LEVELS } from '../../src/shared/schema';
import { mergeImportedConfig } from '../../src/shared/storage';
import './style.css';

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
      setStatus('后端密钥不能为空');
      return;
    }
    if (!config.server.base.trim() && !config.server.create_product_endpoint.trim()) {
      setStatus('后端域名与创建商品接口地址至少填写一项');
      return;
    }

    try {
      await sendMessage({ type: 'SET_CONFIG', payload: { config } });
      setStatus('配置已保存');
      await load();
    } catch (err) {
      setStatus(`保存失败：${(err as Error).message}`);
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

  async function importConfig() {
    if (!config) return;
    if (!importText.trim()) {
      setStatus('请粘贴配置 JSON');
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(importText);
    } catch {
      setStatus('导入失败：JSON 格式不正确');
      return;
    }

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      setStatus('导入失败：配置必须是 JSON 对象');
      return;
    }

    if ((parsed as Partial<Config>).server !== undefined) {
      const server = (parsed as Partial<Config>).server;
      if (typeof server !== 'object' || server === null || Array.isArray(server)) {
        setStatus('导入失败：server 必须是对象');
        return;
      }
    }

    const merged = mergeImportedConfig(config, parsed as Partial<Config>);

    if (!merged.server.secret.trim()) {
      setStatus('导入失败：后端密钥不能为空');
      return;
    }
    if (!merged.server.base.trim() && !merged.server.create_product_endpoint.trim()) {
      setStatus('导入失败：后端域名与创建商品接口地址至少填写一项');
      return;
    }

    try {
      await sendMessage({ type: 'SET_CONFIG', payload: { config: merged } });
      setStatus('配置已导入并保存');
      setImportText('');
      setShowImport(false);
      await load();
    } catch (err) {
      setStatus(`导入失败：${(err as Error).message}`);
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
    return <div className="options-loading">加载中…</div>;
  }

  return (
    <div className="options">
      <header className="options-header">
        <h1 className="options-title">Scheer 配置</h1>
        <button className="options-btn secondary" onClick={openExtensionManagement}>
          扩展管理
        </button>
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
        <div className="options-field">
          <label className="options-label" htmlFor="secret-header">
            Token Header 名
          </label>
          <input
            id="secret-header"
            className="options-input"
            type="text"
            value={config.server.secret_header ?? ''}
            onChange={(e) => updateServer({ secret_header: e.target.value || undefined })}
            placeholder="Authorization"
          />
          <p className="options-hint">默认 Authorization；如需使用 X-Api-Key 等请修改此处。</p>
        </div>
        <div className="options-field">
          <label className="options-label" htmlFor="secret-prefix">
            Token 前缀
          </label>
          <input
            id="secret-prefix"
            className="options-input"
            type="text"
            value={config.server.secret_prefix ?? ''}
            onChange={(e) => updateServer({ secret_prefix: e.target.value || undefined })}
            placeholder="Bearer"
          />
          <p className="options-hint">默认 Bearer；不需要前缀时可清空，例如直接发送密钥本身。</p>
        </div>
      </section>

      {import.meta.env.VITE_SHOW_DEBUG_SETTINGS === 'true' && (
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
          <div className="options-field">
            <label className="options-label" htmlFor="debugLevel">
              日志留存等级
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
            <p className="options-hint">
              只保留所选等级及以上的日志。例如选 WARN 时只保留 warn/error。
            </p>
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
            <p className="options-hint">当前本地日志：{logs.entries.length} 条</p>
          )}
        </section>
      )}

      <section className="options-section">
        <h2 className="options-section-title">操作</h2>
        {!showImport ? (
          <div className="options-actions">
            <button className="options-btn secondary" onClick={() => setShowImport(true)}>
              通过 JSON 导入配置
            </button>
          </div>
        ) : (
          <>
            <div className="options-field">
              <label className="options-label" htmlFor="import-config">
                粘贴配置 JSON
              </label>
              <textarea
                id="import-config"
                className="options-input textarea"
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                placeholder='{ "server": { "base": "https://api.example.com", "secret": "sk-xxx" } }'
                rows={8}
              />
              <p className="options-hint">
                支持完整配置或部分配置导入，未提供的字段会保持当前值。必须是合法 JSON 对象。
              </p>
            </div>
            <div className="options-actions">
              <button className="options-btn" onClick={importConfig}>
                导入并保存
              </button>
              <button className="options-btn secondary" onClick={() => setShowImport(false)}>
                取消
              </button>
            </div>
          </>
        )}
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
