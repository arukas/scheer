# Scheer 扩展「配置导入」对接文档

面向需要对接 Scheer Chrome 扩展的 Web 项目。读完本文即可完成接入。

## 这是什么

你的网页可以请求把一段配置（通常是后端地址 + 密钥）推送给用户浏览器里已安装的 Scheer 扩展。**扩展会弹出自己的确认窗口，用户点"确认导入"后配置才生效**。你的网页只能"提出请求"，不能静默改配置，也读不到扩展里的任何配置。

典型场景：用户在你的管理后台点击"一键配置浏览器插件"按钮 → 扩展弹窗 → 用户确认 → 插件即可向你的后端提交数据。

## 前置条件

1. 用户浏览器已安装 Scheer 扩展（Chrome，MV3）。
2. 你知道该扩展的 **Extension ID**（32 位小写字母）。正式分发的构建已固定 ID，由扩展提供方告诉你；开发联调时让用户在 `chrome://extensions` 卡片上复制。

## 快速开始（3 步）

1. 把本目录的 `extension-import.js` 复制到你的项目中（无依赖，可直接 import）。

2. 在你的页面逻辑中调用：

```js
import { requestExtensionConfigImport } from './extension-import.js';

async function onConnectClick() {
  try {
    await requestExtensionConfigImport({
      extensionId: 'EXTENSION_ID_HERE', // 扩展提供方给的 ID
      config: {
        server: {
          base: 'https://api.example.com', // 你的后端地址，必须 https
          secret: 'sk-xxx', // 用户的密钥
        },
      },
    });
    // 扩展已弹出确认窗口。请提示用户：请在浏览器扩展的确认窗口中完成操作。
    showToast('请在新弹出的扩展窗口中确认导入');
  } catch (err) {
    // 见「错误处理」一节
    showToast(`配置失败：${err.message}`);
  }
}
```

3. 由用户手势（点击按钮）触发调用。不要在页面加载时自动调用——未经用户操作突然弹出扩展窗口会被视为骚扰。

## config 可导入字段

`config` 是一个 JSON 对象，对应扩展的 `Config` 结构。**只需给要修改的字段；没给的字段保持用户当前值**。不在白名单内的字段会被静默丢弃。

常见接入只需要 `server` 部分；其余字段按需。

### server（远端服务）

| 字段                      | 类型   | 约束                                     | 说明                                   |
| ------------------------- | ------ | ---------------------------------------- | -------------------------------------- |
| `base`                    | string | https URL；localhost/127.0.0.1 允许 http | 后端域名，如 `https://api.example.com` |
| `secret`                  | string | 1–4096 字符，非空                        | 后端密钥；确认页掩码显示               |
| `create_product_endpoint` | string | `/` 开头的相对路径或 https URL，≤512     | 默认 `/scheer/products`                |
| `current_user_endpoint`   | string | 同上                                     | 默认 `/scheer/me`                      |
| `method`                  | string | 仅允许 `"POST"`                          |                                        |
| `secret_header`           | string | ≤128，非空                               | 默认 `Authorization`                   |
| `secret_prefix`           | string | ≤64，允许空串                            | 默认 `Bearer`                          |
| `headers`                 | object | ≤20 条；key ≤128；value ≤1024            | 自定义请求头；确认页掩码显示           |
| `timeout_ms`              | int    | 1000–120000                              | 默认 30000                             |

### crawl（采集行为，v1 基本不用动）

| 字段                    | 约束           |
| ----------------------- | -------------- |
| `product_mode`          | 仅 `"manual"`  |
| `extract_reviews`       | 仅 `false`     |
| `review_strategy`       | 仅 `"visible"` |
| `review_max_pages`      | int，1–100     |
| `confirm_before_submit` | boolean        |

### debug / ui / retry / storage / platforms（本地偏好，一般不建议外部导入）

| 字段                                                     | 约束                                                                                                                                                             |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `debug.enabled` / `debug.persist`                        | boolean                                                                                                                                                          |
| `debug.maxEntries`                                       | int，50–5000                                                                                                                                                     |
| `debug.level`                                            | `"debug" \| "info" \| "warn" \| "error"`                                                                                                                         |
| `ui.notify_success` / `ui.notify_failure`                | boolean                                                                                                                                                          |
| `retry.max_attempts`                                     | int，0–10                                                                                                                                                        |
| `retry.backoff_base_ms`                                  | int，0–60000                                                                                                                                                     |
| `retry.retryable_status`                                 | int 数组，每项 100–599，≤20 个                                                                                                                                   |
| `storage.keep_history_days`                              | int，0–3650                                                                                                                                                      |
| `storage.product_dedup_key` / `storage.review_dedup_key` | string，≤128，非空                                                                                                                                               |
| `platforms`                                              | object，key 限 `shopify/newshop/shopbase/shopline/xshoppy/shoplazza/tiktok/wordpress/shadowshop/amazon/alibaba1688`，value boolean；**整体替换**用户现有平台开关 |

完整示例：

```json
{
  "server": {
    "base": "https://api.example.com",
    "secret": "sk-9f2c...",
    "timeout_ms": 30000
  },
  "crawl": { "confirm_before_submit": true },
  "ui": { "notify_success": true, "notify_failure": true }
}
```

## 行为约定（重要）

- `requestExtensionConfigImport` **resolve 只表示"扩展已收到请求并弹出确认窗口"**，不代表用户点了确认。用户是否确认，v1 协议不会回传（也读不到配置）。
- 用户取消、直接关掉窗口、或 5 分钟未操作，请求自动作废，你的页面无需做任何清理。
- 同一个扩展同一时间只有一个待确认请求：窗口还开着时再发起会收到 `IMPORT_BUSY`；窗口已关闭则可以再次发起。

## 错误处理

```js
catch (err) {
  if (err.message.includes('not installed')) {
    // 未安装扩展 / Extension ID 错误 / 站点 CSP 拦截了扩展 iframe
    // → 引导用户安装扩展
  } else if (err.message === 'IMPORT_BUSY') {
    // 已有确认窗口开着 → 提示用户先处理那个窗口
  } else {
    // 字段校验失败等，message 会指明字段，如 "server.base: only https URLs are allowed"
  }
}
```

| 错误标识                                        | 含义                                    | 建议处理                     |
| ----------------------------------------------- | --------------------------------------- | ---------------------------- |
| `Extension not installed or bridge unavailable` | 超时未握手：未安装 / ID 错误 / CSP 拦截 | 引导安装扩展、核对 ID        |
| `IMPORT_BUSY`                                   | 已有待处理确认窗口                      | 提示用户先完成或关闭已有窗口 |
| `REQUEST_EXPIRED`                               | 请求时间戳超窗                          | 重试即可                     |
| `EMPTY_CONFIG`                                  | 没有任何可导入字段                      | 检查 config 字段名           |
| `INVALID_FIELD` / `INVALID_CONFIG`              | 字段值不合法（message 含字段名）        | 按上文约束修正               |
| `INVALID_MESSAGE` / `INVALID_REQUEST_ID`        | 协议信封错误                            | 检查 SDK 是否被改动          |

## CSP 注意事项

本方案要求你的页面能创建指向 `chrome-extension://<ID>/bridge.html` 的隐藏 iframe。如果你的站点设置了严格的 `Content-Security-Policy`，需要允许：

```
frame-src chrome-extension:;
```

（或把该 scheme 加进现有 `frame-src` / `child-src`）。不调整 CSP 时 iframe 会被浏览器拦截，表现为超时后报 "not installed"。

## 联调自测清单

1. 本地用 HTTP 静态服务起你的页面（`localhost` 即可，协议允许 http）。
2. 已安装扩展 + 正确 ID：调用后应弹出**扩展自己的确认窗口**，窗口里显示你的站点 origin 和字段变更（`secret` 掩码）。
3. 点"取消" → 扩展配置不变；再发起一次点"确认导入" → 扩展配置已更新，未涉及的字段保持原值。
4. 错误 ID：约 2 秒后收到 "not installed" 错误。
5. `config` 里放 `http://` 的外网 `base`、空 `secret`、未知字段：分别应报 `INVALID_FIELD`、被白名单丢弃。
6. 确认窗开着时再调一次：收到 `IMPORT_BUSY`。

## 安全边界（请勿试图绕过）

- 不要把 token/config 拼进 URL query/hash 传递。
- 不要尝试读取扩展的现有配置——协议没有这个能力，属于设计使然。
- 用户确认是唯一授权点；请用清晰的按钮文案（如"一键配置浏览器插件"）让用户预期会弹出扩展窗口。
