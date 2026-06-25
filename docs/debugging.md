# 调试指南

本文说明如何调试 Scheer 扩展的各个运行环境：Popup、Options、Content Script、Service Worker，以及 MAIN world 注入与 XHR/fetch 拦截。

## 通用原则

- MV3 的 Service Worker 随时可能被回收，调试时不要依赖跨请求的内存状态。
- 所有持久化状态应写入 `chrome.storage.local`，调试时可通过 DevTools → Application → Storage → Extension storage 查看。
- 错误日志不要打印 secret 或完整 body。

## 调试 Popup / Options

1. 右键扩展图标 → 点击"检查弹出内容"（Inspect popup），即可打开 Popup 的 DevTools。
2. Options 页直接在 `chrome-extension://<id>/options.html` 打开，按 `F12` 即可。
3. 在 Console 中可查看 React 渲染日志、后端接口返回、本地状态。

## 调试 Content Script

1. 打开目标商品页，按 `F12` 打开 DevTools。
2. 切换到 **Sources** 面板。
3. 左侧找到 **Content scripts**，展开后能看到 Scheer 注入的脚本。
4. 在抓取器代码中打断点，刷新页面后重新触发。

> Content Script 运行在 isolated world，不能直接访问页面 JS 变量，但可以通过 `chrome.scripting.executeScript({ world: 'MAIN' })` 与 MAIN world 通信。

## 调试 Service Worker

1. 进入 `chrome://extensions/`。
2. 找到 Scheer 扩展卡片，点击"Service Worker"链接（通常显示为 `background.js`）。
3. 这会打开 Service Worker 的 DevTools，可查看 Console、Network、Sources。
4. 如果 Service Worker 被 kill，需要重新触发事件（如切换 tab、点击 Popup）才能再次激活。

## 调试 MAIN world 注入

ShopLine、ShopBase 等平台需要读取 `window.__PRELOAD_STATE__` 或 `window.__INITIAL_STATE__`：

1. 在目标页 DevTools → Console 中直接输入 `window.__PRELOAD_STATE__`，确认对象存在。
2. 如果 Content Script 读不到，检查是否已通过 `chrome.scripting.executeScript({ world: 'MAIN' })` 注入读取脚本。
3. 在注入脚本中打 `console.log`，观察数据是否成功通过 `postMessage` 或 `CustomEvent` 回传。
4. 常见问题：
   - 注入时机太晚，目标数据已被页面脚本覆盖或清空。
   - CSP 阻止内联脚本执行（某些站点对扩展注入的内联脚本也有 CSP）。
   - 回传事件名与监听端不一致。

## 调试 XHR / fetch 拦截

当 API 或注水对象拿不到所需字段时，需要拦截页面内请求：

1. Content Script 在 `run_at: 'document_start'` 时注入。
2. 在 MAIN world 中 patch `window.fetch` 和 `XMLHttpRequest.prototype.open/send`。
3. 打开目标页 DevTools → Network，确认目标请求确实存在。
4. 在拦截代码中打 log，确认 patch 生效且捕获到响应。
5. 如果拦截不到，很可能是注入时机晚于请求发出，检查 manifest 的 `run_at` 与注入顺序。

## 后端接口联调

1. 打开 Popup / Options 的 DevTools → Network。
2. 点击"创建商品"，观察 POST `create_product_endpoint` 请求：
   - Request Headers 中是否包含 `Authorization: Bearer <secret>`。
   - Request Payload 是否符合 `docs/design.md` §6.1 结构。
3. 查看 Response，确认后端返回 `product_id`、`log_id`、`user`。
4. 如果失败，先复制 curl 到本地复现，排除扩展侧问题。

## 查看本地存储

1. 打开扩展任意页面的 DevTools。
2. 切换到 **Application** → **Storage** → **Extension storage** → **Local**。
3. 可查看：
   - `config`：用户配置（endpoint、secret 等，注意 secret 明文存储）。
   - `history`：最近提交记录。

## 快速诊断清单

| 现象 | 检查点 |
| --- | --- |
| 扩展图标不显示 | 是否已加载 `dist/`；manifest 是否有效；是否有报错。 |
| Popup 白屏 | React 渲染异常；查看 Console 错误。 |
| 平台识别为"未知" | URL 是否命中规则；Content Script 是否注入。 |
| 可抓状态为 false | 页面结构是否变化；选择器是否失效；API 是否 404。 |
| 提交后 401/403 | secret 是否正确；后端鉴权逻辑是否正常。 |
| MAIN world 数据为空 | 注入时机；CSP；回传事件名。 |
| 拦截不到 XHR | `run_at` 是否为 `document_start`；patch 是否生效。 |

## Debug 模式与详细日志

> 完整接口规范与实现约定见 [`docs/debug-logging-design.md`](debug-logging-design.md)。本文是面向开发者的使用指南。

为方便开发、联调以及让 AI（vibe）快速定位问题，扩展支持 **Debug 模式**。开启后会在运行时记录更详细的上下文日志，并持久化到本地，便于回溯与诊断。

### 开启 Debug 模式

1. 打开扩展 **Options** 页。
2. 在高级设置中勾选 **启用 Debug 模式**。
3. 勾选 **保存调试日志到本地**（可选，用于离线排查）。
4. 点击保存后重新加载扩展或刷新目标页面生效。

> Debug 模式仅在开发/测试阶段使用，生产包默认关闭，避免泄露敏感信息或占用过多存储。

### Debug 模式会记录什么

开启后，扩展会在 `console` 输出并可选写入 `chrome.storage.local` 的 `debug_logs` 键：

| 记录点 | 内容 | 用途 |
| --- | --- | --- |
| 平台识别 | 当前 URL、匹配到的平台、confidence、URL 规则命中情况 | 解决“平台识别为未知” |
| 可抓状态 | DOM 关键元素、选择器命中结果、API 状态码、注入脚本回调 | 解决“可抓状态为 false” |
| 抓取过程 | 抓取器入口、中间状态、字段提取结果、缺失字段清单 | 校验字段映射与页面结构变化 |
| MAIN world 注入 | 注入时机、目标 window 对象存在性、回传事件 payload | 排查 `__PRELOAD_STATE__` 读不到 |
| XHR/fetch 拦截 | patch 成功标志、拦截到的请求 URL、响应摘要 | 排查拦截不到请求 |
| 后端交互 | 请求头（不含 secret 明文）、payload 结构、响应码、响应体 | 联调后端接口 |
| 异常与错误 | 报错堆栈、失败步骤、上下文快照 | 让 vibe/AI 快速定位根因 |

> 注意：日志中会对 `Authorization` 头、`secret`、完整 body 进行脱敏或截断，避免泄露凭据。

### 查看本地调试日志

1. 打开扩展任意页面的 DevTools。
2. 切换到 **Application** → **Storage** → **Extension storage** → **Local**。
3. 查看 `debug_logs` 键，内容格式大致如下：

```json
{
  "enabled": true,
  "persist": true,
  "maxEntries": 500,
  "entries": [
    {
      "timestamp": "2026-06-24T05:01:03.744Z",
      "level": "warn",
      "context": "scraper/shopify",
      "message": "variant.price 为空，回退到 root.price",
      "payload": { "productUrl": "https://example.com/products/xxx", "fallback": true }
    }
  ]
}
```

4. 可在 Console 中执行以下代码导出日志：

```js
chrome.storage.local.get('debug_logs', ({ debug_logs }) => {
  console.log(JSON.stringify(debug_logs, null, 2));
});
```

### 给 vibe/AI 提供日志以协助修复

遇到问题时，按以下方式整理信息可让 AI 更快给出修复/优化建议：

1. 开启 Debug 模式并复现问题。
2. 复制相关日志条目（尤其是 `error` / `warn` 级别）。
3. 附带以下上下文：
   - 目标平台与商品页 URL（可脱敏）。
   - 扩展版本 / commit hash。
   - 复现步骤。
   - 期望行为 vs 实际行为。
4. 将日志与上下文一起提供给 vibe，AI 可基于日志中的失败步骤、字段缺失、API 异常等信息定位代码路径并给出修复方案。

### 清理日志

Debug 日志会随时间增长，建议定期清理：

- 在 Options 页点击 **清除调试日志**。
- 或在 Console 中执行：

```js
chrome.storage.local.set({
  debug_logs: { enabled: true, persist: true, maxEntries: 500, entries: [] }
});
```

### 在代码中记录 Debug 日志

业务代码统一通过 `createLogger` 记录，避免直接调用 `console.log`：

```ts
import { createLogger } from '@/shared/logger';

const log = createLogger('scraper/shopify');

log.debug('开始识别平台', { url: location.href });
log.info('命中 Shopify URL 规则', { platform: 'shopify' });
log.warn('variant.price 为空，回退到 root.price', { productUrl: url });
log.error('MAIN world 注入失败', { error: err.message });
```

Logger 会自动完成：
- 按 `debug_logs.enabled` 过滤 `debug` 级别
- 按 `debug_logs.persist` 决定是否写入 `chrome.storage.local`
- 对 `secret`、`Authorization`、`body` 等进行脱敏或截断

### Debug 模式最佳实践

- 本地开发时默认开启 Debug 模式，便于实时查看问题。
- 提交 issue 或请求 AI 协助前，先保存并导出最新日志。
- 不要在日志中手动打印 secret、token、完整用户数据。
- 生产构建前应确保 `debug_logs.enabled = false`，且日志持久化开关关闭。

## 相关文档

- [`docs/debug-logging-design.md`](debug-logging-design.md)：Debug 日志子系统的接口、数据模型、脱敏与 AI 协作约定。
- [`docs/development.md`](development.md)：环境搭建与运行。
- [`docs/testing.md`](testing.md)：自动化回归测试。
- [`docs/design.md`](design.md)：MV3 约束与架构说明。
