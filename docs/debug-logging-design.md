# Scheer Debug 日志子系统设计

> 对应代码接口：
>
> - `src/shared/schema.ts`
> - `src/shared/storage.ts`
> - `src/shared/logger.ts`
> - 使用文档：`docs/debugging.md`

## 1. 设计目标

Scheer 需要支持 7 个独立的电商平台抓取器，每个平台的数据入口、DOM 结构、字段映射都不相同。开发/联调过程中，平台识别失败、可抓状态为 false、字段缺失、MAIN world 注入异常、后端接口返回错误等问题非常常见。

Debug 日志子系统的设计目标是：

1. **可开关**：开发时开启 Debug 模式记录详细日志，生产环境默认关闭。
2. **可持久化**：日志可选择写入 `chrome.storage.local`，便于离线排查与导出。
3. **安全**：自动脱敏 secret、token、Authorization、body 等敏感信息。
4. **AI 友好**：日志格式统一、结构化，方便 vibe/AI 根据日志快速定位代码路径并给出修复/优化建议。
5. **轻量**：不阻塞业务逻辑，存储有上限，防止 chrome.storage.local 膨胀。

## 2. 数据模型

### 2.1 单条日志条目 `DebugLogEntry`

```ts
interface DebugLogEntry {
  timestamp: string; // ISO 8601，如 2026-06-24T05:01:03.744Z
  level: 'debug' | 'info' | 'warn' | 'error';
  context: string; // 上下文标识
  message: string; // 日志消息
  payload?: Record<string, unknown>; // 结构化附加信息（已脱敏）
}
```

**context 命名约定**：

| 场景                      | 推荐 context                                 |
| ------------------------- | -------------------------------------------- |
| 平台抓取器                | `scraper/shopify`、`scraper/tiktok` 等       |
| Background Service Worker | `background/submit`、`background/history` 等 |
| Popup UI                  | `popup/ui`、`popup/submit` 等                |
| Options 配置页            | `options/config` 等                          |
| 共享工具                  | `shared/storage`、`shared/main-world` 等     |

### 2.2 本地日志集合 `DebugLogs`

存储在 `chrome.storage.local` 的 `debug_logs` 键，通过 WXT 的 `wxt/storage` 模块读写：

```ts
interface DebugLogs {
  enabled: boolean; // Debug 模式总开关
  persist: boolean; // 是否写入 storage.local
  maxEntries: number; // 最大保留条数，默认 500
  level: 'debug' | 'info' | 'warn' | 'error'; // 留存级别，默认 info
  entries: DebugLogEntry[];
}
```

默认值：

```ts
{
  enabled: false,
  persist: false,
  maxEntries: 500,
  level: 'info',
  entries: []
}
```

### 2.3 配置中的 Debug 字段

`Config.debug` 与 `DebugLogs` 的 `enabled` / `persist` / `maxEntries` / `level` 字段必须保持语义一致。Options 页读取/写入的是 `Config.debug`，Logger 实际读取的是 `DebugLogs`。实现期保证两者同步。

```ts
interface Config {
  server: ServerConfig;
  crawl: CrawlConfig;
  debug: {
    enabled: boolean;
    persist: boolean;
    maxEntries: number;
    level: 'debug' | 'info' | 'warn' | 'error';
  };
}
```

## 3. Logger API

### 3.1 创建 Logger

```ts
import { createLogger } from '@/shared/logger';

const log = createLogger('scraper/shopify');

log.debug('开始识别平台', { url: location.href });
log.info('命中 Shopify URL 规则', { platform: 'shopify' });
log.warn('variant.price 为空，回退到 root.price', { productUrl: url });
log.error('MAIN world 注入失败', { error: err.message });
```

### 3.2 级别过滤规则

Logger 同时受 `enabled` 和 `level` 控制：

| `enabled` | 配置 `level` | console 输出         | storage 写入（需 `persist=true`） |
| --------- | ------------ | -------------------- | --------------------------------- |
| false     | info（默认） | 仅 `info/warn/error` | 不写入                            |
| false     | warn         | 仅 `warn/error`      | 不写入                            |
| false     | error        | 仅 `error`           | 不写入                            |
| true      | debug        | 全部级别             | 全部级别                          |
| true      | info         | `info/warn/error`    | `info/warn/error`                 |
| true      | warn         | `warn/error`         | `warn/error`                      |
| true      | error        | 仅 `error`           | 仅 `error`                        |

**说明**：

- `level` 默认 `info`，即保留 `info` 及以上级别。
- `enabled === false` 时，`debug` 级始终不输出；其他级别按 `level` 过滤。
- `persist` 仅在 `enabled === true` 时生效，避免用户误开 persist 但关闭 enabled 导致意外写入。

## 4. 脱敏与截断规则

所有写入 storage 或 console 的 `payload` 必须先经过 `sanitizePayload(payload)` 处理。

### 4.1 脱敏规则 `redactSensitive`

1. 递归遍历对象与数组。
2. 若 key（不区分大小写）匹配正则：
   ```
   /secret|authorization|token|password|cookie|api[-_]?key/
   ```
   对应的值替换为字符串 `'<redacted>'`。
3. 若字符串值匹配 `/^Bearer\s+/i`，整串替换为 `'<redacted>'`。
4. 嵌套对象同样递归处理。

### 4.2 截断规则 `truncateBody`

1. `payload.body` 或 `payload.responseText` 为字符串且长度超过 2048 字符时：
   - 保留前 2048 字符
   - 追加 `' ... [truncated]'`
2. 不记录完整的 HTTP 响应 body，只记录：
   - 状态码 `status`
   - `content-type`
   - 错误摘要 `errorMessage`
   - 必要时的前 2048 字符片段

### 4.3 示例

输入：

```ts
{
  url: 'https://api.example.com/v1/products',
  headers: { Authorization: 'Bearer sk-1234567890' },
  body: '{"title":"...非常长的 body..."}' // 长度 > 2048
}
```

处理后：

```ts
{
  url: 'https://api.example.com/v1/products',
  headers: { Authorization: '<redacted>' },
  body: '{"title":"...前 2048 字符..." ... [truncated]'
}
```

## 5. 存储限制与清理策略

### 5.1 上限

- `maxEntries` 默认 500。
- `chrome.storage.local` 单扩展约 5MB 限制；按每条日志平均 1KB 估算，500 条约 500KB，安全。

### 5.2 清理方式

- **Options 页**：提供「清除调试日志」按钮。
- **Console**：
  ```js
  chrome.storage.local.set({
    debug_logs: { enabled: true, persist: true, maxEntries: 500, entries: [] },
  });
  ```
- **自动清理**：追加新日志时，若 `entries.length > maxEntries`，移除最旧的条目（`shift`）。

### 5.3 导出

Options / Popup 提供「导出调试日志」按钮，调用 `exportDebugLogs(logs)` 生成 `.log` 文件下载。导出格式为 **NDJSON（Newline Delimited JSON）**：

- 第一行为元数据对象（`type`、`exported_at`、`enabled`、`persist`、`maxEntries`、`count`）。
- 后续每一行为一条 `DebugLogEntry` JSON 对象。

示例：

```
{"type":"scheer-debug-logs","exported_at":"2026-06-25T05:00:00.000Z","enabled":true,"persist":true,"maxEntries":500,"count":2}
{"timestamp":"2026-06-25T04:59:58.000Z","level":"info","context":"shared/api","message":"发送创建商品请求","payload":{"url":"https://api.example.com/scheer/products","method":"POST","headers":{"Authorization":"<redacted>","Content-Type":"application/json"},"payloadSummary":{"platform":"shopify","source_url":"https://example.com/products/xxx"},"curl":"curl -X POST -H 'Authorization: <redacted>' -H 'Content-Type: application/json' --data-raw '{...}' 'https://api.example.com/scheer/products'"}}
{"timestamp":"2026-06-25T04:59:59.000Z","level":"info","context":"shared/api","message":"创建商品请求成功","payload":{"status":200,"product_id":"123","log_id":"abc"}}
```

这种格式便于用 `jq -R '. | fromjson'` 或日志分析工具逐行解析。

## 6. 与 vibe/AI 协作的约定

当开发中遇到问题需要 AI 协助时，按以下格式整理信息：

### 6.1 应包含的上下文

1. **Debug 日志导出文件**（或最近 20 条相关日志）。
2. **复现步骤**：
   - 目标平台（Shopify / TikTok / ...）
   - 商品页 URL（可脱敏 host）
   - 操作步骤（点击创建商品 / 刷新页面 / ...）
3. **期望行为 vs 实际行为**
4. **扩展版本 / commit hash**

### 6.2 日志中应记录的关键节点

各模块应在关键节点记录日志，方便 AI 根据日志还原执行路径：

| 模块       | 记录点                 | 级别  | payload 建议                        |
| ---------- | ---------------------- | ----- | ----------------------------------- |
| 平台识别   | URL 初筛结果           | debug | `url`, `platform`, `matchedRule`    |
| 平台识别   | 平台识别失败           | warn  | `url`, `reason`                     |
| 可抓探测   | DOM/API/注水对象存在性 | debug | `selector`, `found`, `statusCode`   |
| 可抓探测   | 可抓状态为 false       | warn  | `platform`, `reason`, `domSnapshot` |
| 抓取器     | 开始抓取               | info  | `platform`, `sourceUrl`             |
| 抓取器     | 字段缺失/回退          | warn  | `field`, `fallback`, `rawValue`     |
| 抓取器     | 抓取异常               | error | `error`, `step`, `context`          |
| MAIN world | 注入尝试               | debug | `targetObject`, `injectionTiming`   |
| MAIN world | 注入失败               | error | `error`, `csp`, `timing`            |
| XHR 拦截   | patch 成功             | debug | `patchedMethods`                    |
| XHR 拦截   | 拦截到请求             | debug | `url`, `method`                     |
| 后端提交   | 请求发送               | info  | `endpoint`, `status`, `durationMs`  |
| 后端提交   | 失败                   | error | `status`, `errorMessage`            |

### 6.3 给 AI 的 prompt 模板

````
我在开发 Scheer Chrome 扩展时遇到一个问题：

【复现步骤】
1. 打开 ... 平台商品页
2. ...

【期望】
...

【实际】
...

【Debug 日志】
```json
<粘贴 exportDebugLogs 输出>
````

请根据日志定位问题代码路径，并给出修复或优化建议。

```

## 7. 实现 Checklist（编码阶段对照）

- [ ] `src/shared/schema.ts` 中 `DebugLogEntry`、`DebugLogs`、`Logger`、`Config.debug` 类型稳定。
- [x] `src/shared/storage.ts` 基于 WXT `wxt/storage` 实现 `getDebugLogs`、`setDebugLogs`、`appendDebugLog`、`clearDebugLogs`、`exportDebugLogs`（NDJSON `.log` 格式）。
- [ ] `src/shared/logger.ts` 实现 `createLogger`、`buildLogEntry`、`redactSensitive`、`truncateBody`、`sanitizePayload`。
- [ ] Logger 初始化时读取 `DebugLogs`，`enabled` / `persist` / `level` 变更时动态生效。
- [ ] Options 页提供 Debug 模式开关、持久化开关、最大条数输入、日志等级选择、清除日志按钮、导出日志按钮。
- [ ] Background / Content Script / Popup 中使用 `createLogger` 替换裸 `console.log`。
- [ ] 生产构建默认 `debug.enabled = false`、`debug.persist = false`。
- [ ] 测试覆盖：级别过滤、脱敏、截断、存储上限。

## 8. 相关文档

- [`docs/debugging.md`](debugging.md)：面向开发者的 Debug 模式使用指南。
- [`docs/design.md`](design.md)：扩展整体架构与数据模型。
- [`docs/development.md`](development.md)：本地开发与日志查看方式。
```
