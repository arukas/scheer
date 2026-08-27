**Web Accessible Extension Import Page（Manifest V3）实施文档**

_用途：直接交给项目内 AI / Coding Agent 按本文实施_

| **最终推荐：**不使用 externally_connectable，不要求事先知道接入系统的域名。第三方系统只配置 Extension ID，通过一个公开的 Web Accessible bridge 页面把“待导入配置”交给扩展；扩展暂存到 chrome.storage.session，再打开扩展自己的确认窗口，由用户明确确认后才写入正式配置。 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |

# 1. 目标与验收标准

目标是让任意 HTTP/HTTPS Web
项目在不知道扩展安装环境、也不需要被预先加入扩展域名白名单的情况下，向指定
Chrome Extension
发起“配置导入请求”。外部页面只能提出请求，不能静默修改扩展配置。

- 接入方只需要知道并配置 Extension ID。

- 扩展不需要维护 externally_connectable.matches 域名列表。

- 外部页面不能直接读取扩展已有 Token、密钥或完整配置。

- 外部页面不能静默写配置；用户必须在扩展自己的 UI 中确认。

- Token 等敏感配置不得放入 URL query/hash。

- 待确认配置只存
  chrome.storage.session；确认后才写入项目现有的正式配置存储。

- 来源网站 origin 必须显示在确认页中，让用户知道是谁发起了导入。

- 请求具备版本号、requestId、超时和字段白名单校验。

# 2. 推荐架构

虽然原始思路是“网页直接
window.open(chrome-extension://ID/import.html)”，生产实现建议拆成“公开
bridge + 私有确认页”。这样不需要把敏感配置塞进 URL，也不依赖跨域
window.opener 是否保留。

**数据流**

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th>第三方 Web 项目<br />
|<br />
| 创建隐藏
iframe：chrome-extension://&lt;EXTENSION_ID&gt;/integration/bridge.html<br />
| postMessage(REQUEST_CONFIG_IMPORT, config)<br />
v<br />
Web Accessible bridge.html（扩展页面）<br />
|<br />
| 校验 event.origin / 协议 / schema / TTL<br />
| chrome.storage.session.set(pendingImport)<br />
| chrome.windows.create(import.html, type="popup")<br />
v<br />
import.html（扩展私有确认窗口）<br />
|<br />
| 显示来源 origin + 待导入字段（Token 掩码）<br />
| [取消] / [确认导入]<br />
v<br />
确认后 -&gt; 写入项目现有正式配置存储<br />
取消/超时 -&gt; 删除 pendingImport</th>
</tr>
</thead>
<tbody>
</tbody>
</table>

| **关键边界：**bridge.html 可以被任意 HTTP/HTTPS 页面访问，这是为了实现“未知接入域名”。因此 bridge 的能力必须严格限制为“创建待确认导入请求”，绝不能提供 GET_CONFIG、GET_TOKEN、直接 SET_CONFIG 等高权限接口。 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |

# 3. 项目文件结构

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th>extension/<br />
├─ manifest.json<br />
├─ background/ # 保留项目原有结构即可<br />
│ └─ service-worker.js<br />
└─ integration/<br />
├─ bridge.html # Web Accessible；只做外部消息入口<br />
├─ bridge.js<br />
├─ import.html # 扩展内部确认页；不需要 Web Accessible<br />
├─ import.js<br />
├─ import.css<br />
└─ protocol.js # 可选：协议常量、校验、字段清洗<br />
<br />
web-project/<br />
└─ extension-import.js # 接入项目侧 SDK/工具函数</th>
</tr>
</thead>
<tbody>
</tbody>
</table>

# 4. manifest.json 修改

在现有 Manifest V3 基础上合并以下内容。不要覆盖项目已有
permissions、background、action、content_scripts 等字段。

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th>{<br />
"manifest_version": 3,<br />
"permissions": [<br />
"storage"<br />
],<br />
"web_accessible_resources": [<br />
{<br />
"resources": [<br />
"integration/bridge.html"<br />
],<br />
"matches": [<br />
"http://*/*",<br />
"https://*/*"<br />
]<br />
}<br />
]<br />
}</th>
</tr>
</thead>
<tbody>
</tbody>
</table>

说明：

- 只把 bridge.html 暴露给网页。bridge.html 加载的扩展内部 JS/CSS
  不需要为了这个目的全部暴露。

- 不配置 externally_connectable；网页不直接调用
  chrome.runtime.sendMessage(extensionId, ...) 。

- 不申请 \<all_urls\> host_permissions，不注入全站 content script。Web
  Accessible Resources 与 host permissions 是不同能力。

- 如果项目已经有 storage 权限，不重复添加。chrome.windows.create
  本身不要求 tabs 权限；只有读取 Tab 的敏感 URL/title 等属性时才需要
  tabs。

# 5. 通信协议：Extension Import Protocol v1

| **字段**  | **类型** | **要求**   | **说明**                                                               |
| --------- | -------- | ---------- | ---------------------------------------------------------------------- |
| protocol  | string   | 必填       | 固定值，例如 "extension-config-import"                                 |
| version   | number   | 必填       | 当前固定为 1                                                           |
| type      | string   | 必填       | REQUEST_CONFIG_IMPORT / BRIDGE_READY / IMPORT_REQUEST_ACCEPTED / ERROR |
| requestId | string   | 必填       | 调用方生成 UUID；用于去重与日志关联                                    |
| timestamp | number   | 必填       | Date.now() 毫秒时间戳                                                  |
| config    | object   | 请求时必填 | 仅允许项目定义的可导入字段                                             |

**请求示例**

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th>{<br />
"protocol": "extension-config-import",<br />
"version": 1,<br />
"type": "REQUEST_CONFIG_IMPORT",<br />
"requestId": "d5fb54a2-4ef8-4e67-a93a-7d1ed06e2489",<br />
"timestamp": 1787640000000,<br />
"config": {<br />
"apiUrl": "https://api.example.com",<br />
"token": "secret-token",<br />
"shopId": "123456"<br />
}<br />
}</th>
</tr>
</thead>
<tbody>
</tbody>
</table>

| **字段映射：**apiUrl/token/shopId 只是示例。Coding Agent 必须先检查实际项目当前配置结构，再定义 ALLOWED_CONFIG_KEYS 和 applyImportedConfig()；不要为了套示例而改坏现有配置模型。 |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |

# 6. Web 项目侧：通用调用代码

第三方项目自行配置扩展 ID。SDK 通过隐藏 iframe 加载 bridge.html，并以
BRIDGE_READY 作为“扩展已安装且桥接页可用”的真实握手信号。不要只依赖
iframe.onload。

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th>const PROTOCOL = 'extension-config-import';<br />
const VERSION = 1;<br />
<br />
export async function requestExtensionConfigImport({<br />
extensionId,<br />
config,<br />
timeout = 2000,<br />
}) {<br />
if (!extensionId) {<br />
throw new Error('extensionId is required');<br />
}<br />
<br />
const extensionOrigin = `chrome-extension://${extensionId}`;<br />
const bridgeUrl = `${extensionOrigin}/integration/bridge.html`;<br />
const requestId = crypto.randomUUID();<br />
<br />
const iframe = document.createElement('iframe');<br />
iframe.src = bridgeUrl;<br />
iframe.hidden = true;<br />
iframe.setAttribute('aria-hidden', 'true');<br />
document.body.appendChild(iframe);<br />
<br />
return await new Promise((resolve, reject) =&gt; {<br />
let ready = false;<br />
<br />
const timer = setTimeout(() =&gt; {<br />
cleanup();<br />
reject(new Error('Extension not installed or bridge
unavailable'));<br />
}, timeout);<br />
<br />
function cleanup() {<br />
clearTimeout(timer);<br />
window.removeEventListener('message', onMessage);<br />
iframe.remove();<br />
}<br />
<br />
function onMessage(event) {<br />
// 必须确认消息来自刚创建的 iframe。<br />
if (event.source !== iframe.contentWindow) return;<br />
if (event.origin !== extensionOrigin) return;<br />
<br />
const msg = event.data;<br />
if (!msg || msg.protocol !== PROTOCOL || msg.version !== VERSION)
return;<br />
<br />
if (msg.type === 'BRIDGE_READY' &amp;&amp; !ready) {<br />
ready = true;<br />
<br />
iframe.contentWindow.postMessage({<br />
protocol: PROTOCOL,<br />
version: VERSION,<br />
type: 'REQUEST_CONFIG_IMPORT',<br />
requestId,<br />
timestamp: Date.now(),<br />
config,<br />
}, extensionOrigin);<br />
<br />
return;<br />
}<br />
<br />
if (msg.requestId !== requestId) return;<br />
<br />
if (msg.type === 'IMPORT_REQUEST_ACCEPTED') {<br />
cleanup();<br />
resolve({ requestId, accepted: true });<br />
return;<br />
}<br />
<br />
if (msg.type === 'ERROR') {<br />
cleanup();<br />
reject(new Error(msg.message || msg.code || 'Extension import
failed'));<br />
}<br />
}<br />
<br />
window.addEventListener('message', onMessage);<br />
});<br />
}</th>
</tr>
</thead>
<tbody>
</tbody>
</table>

| **最终确认结果：**v1 的 Web 调用方只得到“扩展已接收请求并打开确认窗口”，不获取用户最终是否点击确认。这样协议最简单，也避免外部页面长期保持通信上下文。确实需要最终结果时，再单独扩展 v2。 |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |

# 7. bridge.html / bridge.js

**integration/bridge.html**

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th>&lt;!doctype html&gt;<br />
&lt;html&gt;<br />
&lt;head&gt;<br />
&lt;meta charset="UTF-8" /&gt;<br />
&lt;meta name="viewport" content="width=device-width, initial-scale=1"
/&gt;<br />
&lt;title&gt;Extension Import Bridge&lt;/title&gt;<br />
&lt;/head&gt;<br />
&lt;body&gt;<br />
&lt;script src="bridge.js"&gt;&lt;/script&gt;<br />
&lt;/body&gt;<br />
&lt;/html&gt;</th>
</tr>
</thead>
<tbody>
</tbody>
</table>

**integration/bridge.js**

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th>const PROTOCOL = 'extension-config-import';<br />
const VERSION = 1;<br />
const MAX_AGE_MS = 30_000;<br />
const PENDING_TTL_MS = 5 * 60_000;<br />
const STORAGE_KEY = 'pendingExternalConfigImport';<br />
<br />
const ALLOWED_CONFIG_KEYS = ['apiUrl', 'token', 'shopId'];<br />
<br />
function reply(target, targetOrigin, payload) {<br />
target.postMessage({<br />
protocol: PROTOCOL,<br />
version: VERSION,<br />
...payload,<br />
}, targetOrigin);<br />
}<br />
<br />
function isHttpOrigin(origin) {<br />
try {<br />
const url = new URL(origin);<br />
return url.protocol === 'https:' || url.protocol === 'http:';<br />
} catch {<br />
return false;<br />
}<br />
}<br />
<br />
function sanitizeConfig(input) {<br />
if (!input || typeof input !== 'object' || Array.isArray(input)) {<br />
throw new Error('INVALID_CONFIG');<br />
}<br />
<br />
const result = {};<br />
<br />
for (const key of ALLOWED_CONFIG_KEYS) {<br />
if (Object.prototype.hasOwnProperty.call(input, key)) {<br />
result[key] = input[key];<br />
}<br />
}<br />
<br />
// 示例校验；请按实际项目配置模型补充。<br />
if (result.apiUrl !== undefined) {<br />
const url = new URL(result.apiUrl);<br />
if (url.protocol !== 'https:') throw new
Error('API_URL_MUST_USE_HTTPS');<br />
result.apiUrl = url.toString().replace(/\/$/, '');<br />
}<br />
<br />
if (result.token !== undefined) {<br />
if (typeof result.token !== 'string' || result.token.length &gt; 4096)
{<br />
throw new Error('INVALID_TOKEN');<br />
}<br />
}<br />
<br />
if (Object.keys(result).length === 0) {<br />
throw new Error('EMPTY_CONFIG');<br />
}<br />
<br />
return result;<br />
}<br />
<br />
// 页面加载后通知父页面：扩展存在且 bridge 可用。<br />
window.parent.postMessage({<br />
protocol: PROTOCOL,<br />
version: VERSION,<br />
type: 'BRIDGE_READY',<br />
extensionId: chrome.runtime.id,<br />
extensionVersion: chrome.runtime.getManifest().version,<br />
}, '*');<br />
<br />
window.addEventListener('message', async (event) =&gt; {<br />
if (event.source !== window.parent) return;<br />
if (!isHttpOrigin(event.origin)) return;<br />
<br />
const msg = event.data;<br />
if (!msg || msg.protocol !== PROTOCOL || msg.version !== VERSION)
return;<br />
if (msg.type !== 'REQUEST_CONFIG_IMPORT') return;<br />
<br />
try {<br />
if (typeof msg.requestId !== 'string' || !msg.requestId) {<br />
throw new Error('INVALID_REQUEST_ID');<br />
}<br />
<br />
if (!Number.isFinite(msg.timestamp) || Math.abs(Date.now() -
msg.timestamp) &gt; MAX_AGE_MS) {<br />
throw new Error('REQUEST_EXPIRED');<br />
}<br />
<br />
const config = sanitizeConfig(msg.config);<br />
<br />
const current = await chrome.storage.session.get(STORAGE_KEY);<br />
const pending = current[STORAGE_KEY];<br />
if (pending &amp;&amp; pending.expiresAt &gt; Date.now()) {<br />
throw new Error('IMPORT_BUSY');<br />
}<br />
<br />
await chrome.storage.session.set({<br />
[STORAGE_KEY]: {<br />
requestId: msg.requestId,<br />
sourceOrigin: event.origin,<br />
receivedAt: Date.now(),<br />
expiresAt: Date.now() + PENDING_TTL_MS,<br />
config,<br />
},<br />
});<br />
<br />
await chrome.windows.create({<br />
url: chrome.runtime.getURL('integration/import.html'),<br />
type: 'popup',<br />
width: 480,<br />
height: 640,<br />
focused: true,<br />
});<br />
<br />
reply(event.source, event.origin, {<br />
type: 'IMPORT_REQUEST_ACCEPTED',<br />
requestId: msg.requestId,<br />
});<br />
} catch (error) {<br />
reply(event.source, event.origin, {<br />
type: 'ERROR',<br />
requestId: msg?.requestId,<br />
code: error?.message || 'UNKNOWN_ERROR',<br />
message: error?.message || 'Unknown error',<br />
});<br />
}<br />
});</th>
</tr>
</thead>
<tbody>
</tbody>
</table>

# 8. import.html：用户确认页面

确认页是扩展内部页面，不需要让网页直接传数据给它。它只读取
storage.session 里的 pendingExternalConfigImport。

**integration/import.html**

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th>&lt;!doctype html&gt;<br />
&lt;html&gt;<br />
&lt;head&gt;<br />
&lt;meta charset="UTF-8" /&gt;<br />
&lt;meta name="viewport" content="width=device-width, initial-scale=1"
/&gt;<br />
&lt;title&gt;导入插件配置&lt;/title&gt;<br />
&lt;link rel="stylesheet" href="import.css" /&gt;<br />
&lt;/head&gt;<br />
&lt;body&gt;<br />
&lt;main class="card"&gt;<br />
&lt;h1&gt;导入插件配置&lt;/h1&gt;<br />
&lt;p
class="hint"&gt;有网站请求修改此扩展的配置。请确认来源和内容。&lt;/p&gt;<br />
<br />
&lt;section&gt;<br />
&lt;div class="label"&gt;请求来源&lt;/div&gt;<br />
&lt;div id="sourceOrigin" class="value"&gt;&lt;/div&gt;<br />
&lt;/section&gt;<br />
<br />
&lt;section id="configPreview"&gt;&lt;/section&gt;<br />
<br />
&lt;p
class="warning"&gt;确认后将修改插件配置。请只接受你信任的网站发起的请求。&lt;/p&gt;<br />
<br />
&lt;div class="actions"&gt;<br />
&lt;button id="cancel" type="button"&gt;取消&lt;/button&gt;<br />
&lt;button id="confirm" type="button"
class="primary"&gt;确认导入&lt;/button&gt;<br />
&lt;/div&gt;<br />
<br />
&lt;div id="status" role="status"&gt;&lt;/div&gt;<br />
&lt;/main&gt;<br />
<br />
&lt;script src="import.js"&gt;&lt;/script&gt;<br />
&lt;/body&gt;<br />
&lt;/html&gt;</th>
</tr>
</thead>
<tbody>
</tbody>
</table>

**integration/import.js**

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th>const STORAGE_KEY = 'pendingExternalConfigImport';<br />
let pendingImport = null;<br />
<br />
function maskSecret(value) {<br />
if (!value) return '';<br />
if (value.length &lt;= 8) return '••••••••';<br />
return `${value.slice(0, 4)}••••••••${value.slice(-4)}`;<br />
}<br />
<br />
function addPreviewRow(container, label, value) {<br />
const row = document.createElement('div');<br />
row.className = 'preview-row';<br />
<br />
const labelEl = document.createElement('div');<br />
labelEl.className = 'label';<br />
labelEl.textContent = label;<br />
<br />
const valueEl = document.createElement('div');<br />
valueEl.className = 'value';<br />
valueEl.textContent = value ?? '';<br />
<br />
row.append(labelEl, valueEl);<br />
container.appendChild(row);<br />
}<br />
<br />
async function loadPendingImport() {<br />
const result = await chrome.storage.session.get(STORAGE_KEY);<br />
pendingImport = result[STORAGE_KEY];<br />
<br />
if (!pendingImport || pendingImport.expiresAt &lt;= Date.now()) {<br />
await chrome.storage.session.remove(STORAGE_KEY);<br />
const card = document.querySelector('.card');<br />
card.replaceChildren();<br />
<br />
const title = document.createElement('h1');<br />
title.textContent = '请求已失效';<br />
<br />
const message = document.createElement('p');<br />
message.textContent = '没有可导入的配置，请回到原网站重新发起。';<br />
<br />
card.append(title, message);<br />
return;<br />
}<br />
<br />
document.getElementById('sourceOrigin').textContent =
pendingImport.sourceOrigin;<br />
<br />
const preview = document.getElementById('configPreview');<br />
const cfg = pendingImport.config;<br />
<br />
if (cfg.apiUrl !== undefined) addPreviewRow(preview, 'API 地址',
cfg.apiUrl);<br />
if (cfg.shopId !== undefined) addPreviewRow(preview, 'Shop ID',
String(cfg.shopId));<br />
if (cfg.token !== undefined) addPreviewRow(preview, 'Token',
maskSecret(cfg.token));<br />
}<br />
<br />
async function applyImportedConfig(config) {<br />
// 重要：这里必须适配实际项目现有配置结构。<br />
// 不要无脑使用下面的示例覆盖整个 config。<br />
const current = await chrome.storage.local.get('config');<br />
<br />
await chrome.storage.local.set({<br />
config: {<br />
...(current.config || {}),<br />
...config,<br />
},<br />
});<br />
}<br />
<br />
document.getElementById('cancel').addEventListener('click', async ()
=&gt; {<br />
await chrome.storage.session.remove(STORAGE_KEY);<br />
window.close();<br />
});<br />
<br />
document.getElementById('confirm').addEventListener('click', async ()
=&gt; {<br />
if (!pendingImport) return;<br />
<br />
const confirmButton = document.getElementById('confirm');<br />
const cancelButton = document.getElementById('cancel');<br />
const status = document.getElementById('status');<br />
<br />
confirmButton.disabled = true;<br />
cancelButton.disabled = true;<br />
<br />
try {<br />
await applyImportedConfig(pendingImport.config);<br />
await chrome.storage.session.remove(STORAGE_KEY);<br />
<br />
status.textContent = '配置已导入。';<br />
setTimeout(() =&gt; window.close(), 700);<br />
} catch (error) {<br />
status.textContent = `导入失败：${error?.message || 'Unknown
error'}`;<br />
confirmButton.disabled = false;<br />
cancelButton.disabled = false;<br />
}<br />
});<br />
<br />
loadPendingImport();</th>
</tr>
</thead>
<tbody>
</tbody>
</table>

**integration/import.css（示例，可替换成项目现有 UI 风格）**

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th>:root {<br />
font-family: -apple-system, BlinkMacSystemFont, "Segoe UI",
sans-serif;<br />
color: #1f2937;<br />
background: #f6f7f9;<br />
}<br />
<br />
body { margin: 0; padding: 20px; }<br />
.card { max-width: 440px; margin: 0 auto; }<br />
h1 { margin: 0 0 8px; font-size: 22px; }<br />
.hint, .warning { color: #6b7280; line-height: 1.5; }<br />
section, .preview-row { margin: 14px 0; }<br />
.label { font-size: 12px; color: #6b7280; margin-bottom: 4px; }<br />
.value { font-size: 14px; word-break: break-all; }<br />
.actions { display: flex; justify-content: flex-end; gap: 10px;
margin-top: 24px; }<br />
button { padding: 8px 14px; border-radius: 8px; border: 1px solid
#d1d5db; background: white; }<br />
button.primary { background: #111827; color: white; border-color:
#111827; }<br />
button:disabled { opacity: .55; }<br />
#status { margin-top: 12px; font-size: 13px; }</th>
</tr>
</thead>
<tbody>
</tbody>
</table>

# 9. 必须执行的安全约束

| **要求**                             | **必须/建议** | **原因**                                                    |
| ------------------------------------ | ------------- | ----------------------------------------------------------- |
| 只开放 bridge.html                   | 必须          | Web Accessible Resource 会增加扩展可被检测与攻击的表面积。  |
| 外部只允许 REQUEST_CONFIG_IMPORT     | 必须          | 不能把扩展变成任意网站可操作的配置 API。                    |
| 所有写入必须由用户确认               | 必须          | 任意网站都能加载 bridge，所以最终授权必须在扩展 UI 内发生。 |
| 显示 sourceOrigin                    | 必须          | 让用户识别是谁发起请求。                                    |
| 字段白名单 + 类型/长度校验           | 必须          | 防止未知字段污染内部配置或造成存储/渲染问题。               |
| API URL 默认只接受 HTTPS             | 建议          | 降低把 Token 配到不安全 endpoint 的风险。                   |
| 敏感值不进入 URL                     | 必须          | 避免浏览器历史、日志、截图或其他 URL 处理链暴露。           |
| 用 textContent，不用未过滤 innerHTML | 必须          | 避免配置值形成 DOM XSS。                                    |
| pending request 设置 TTL             | 必须          | 防止旧请求长期留在 session 中。                             |
| 一个 pending request                 | 建议          | 避免多个来源同时打开确认窗口造成错配。                      |
| 确认时再次检查 pending 未过期        | 必须          | 不要仅依赖 bridge 入口校验。                                |
| 不得返回当前 Token/完整配置          | 必须          | 外部协议只写入提案，不提供秘密读取能力。                    |

# 10. 错误码建议

| **code**                                      | **含义**                    | **Web 项目处理建议**              |
| --------------------------------------------- | --------------------------- | --------------------------------- |
| INVALID_REQUEST_ID                            | requestId 缺失或格式错误    | 停止调用并检查 SDK。              |
| REQUEST_EXPIRED                               | timestamp 超出允许窗口      | 重新生成请求。                    |
| INVALID_CONFIG                                | config 不是合法对象         | 修正参数。                        |
| EMPTY_CONFIG                                  | 没有任何允许导入的字段      | 修正参数。                        |
| API_URL_MUST_USE_HTTPS                        | apiUrl 不是 HTTPS           | 让用户/系统改成 HTTPS。           |
| INVALID_TOKEN                                 | Token 类型或长度异常        | 修正参数。                        |
| IMPORT_BUSY                                   | 已有未处理导入请求          | 等待当前确认窗口结束后重试。      |
| Extension not installed or bridge unavailable | SDK 超时未收到 BRIDGE_READY | 提示安装插件或检查 Extension ID。 |

# 11. 给项目内 AI / Coding Agent 的执行要求

把下面这一节作为实际实施任务。Coding Agent
应先读取现有扩展代码，再最小化改动落地，不要机械照抄示例覆盖现有架构。

1.  确认项目是 Manifest V3，并定位
    manifest.json、当前配置存储实现、配置页面和 Service Worker。

2.  找出现有配置字段和存储
    key。记录哪些字段允许由外部导入，哪些字段绝对不能导入。

3.  新增
    integration/bridge.html、bridge.js、import.html、import.js、import.css（目录可按项目现有约定调整）。

4.  在 manifest.web_accessible_resources 中仅暴露 bridge.html，matches
    覆盖 http://\*/\* 和 https://\*/\*。不要添加
    externally_connectable。

5.  实现协议常量：protocol=extension-config-import、version=1。

6.  bridge 收到 postMessage 时必须校验
    event.source===window.parent、event.origin 为
    HTTP/HTTPS、协议版本、requestId、timestamp、config schema。

7.  把待导入配置写入 chrome.storage.session，包含
    sourceOrigin、requestId、receivedAt、expiresAt。

8.  通过 chrome.windows.create 打开 import.html 类型 popup；尺寸可按项目
    UI 调整。

9.  import.html 只从 storage.session 读取 pending request，不从 URL 接收
    Token。

10. 确认页面显示来源
    origin、待修改字段；Token/密钥掩码显示。所有动态文本使用
    textContent。

11. 取消时清理
    session；确认时调用项目已有配置保存逻辑或新增适配函数，不要绕过现有验证/迁移逻辑。

12. 确认成功后清理 pending request；失败时保留 UI
    并显示错误，不要悄悄吞错。

13. 新增一个 Web 侧 helper/SDK 示例，接入方只需提供 Extension ID 和
    config。

14. 补测试：未安装、错误 Extension ID、合法导入、取消、超时、HTTP
    apiUrl、未知字段、重复请求、Token 不显示明文、恶意 HTML
    字符串不执行。

15. 完成后给出修改文件清单、关键设计说明、实际测试方法和剩余风险。

| **禁止事项：**不要把 token/config JSON 拼到 chrome-extension://.../import.html?config=...；不要开放“读取当前配置/Token”的对外接口；不要为了本功能申请全站 content script、tabs 或 \<all_urls\> host_permissions。 |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |

# 12. 手工验收步骤

16. 加载开发版扩展，获取当前 Extension ID。

17. 在任意本地或测试 Web 项目中配置该 Extension ID，并调用
    requestExtensionConfigImport()。

18. 确认页面能通过隐藏 bridge iframe 收到 BRIDGE_READY；错误 ID
    时应在超时后提示“未安装或不可用”。

19. 发起合法配置导入。应出现一个由扩展创建的 popup
    窗口，而不是网页自己的确认框。

20. 确认 popup 显示正确 sourceOrigin；Token 只显示掩码。

21. 点击取消：正式配置不变化，storage.session pending 被删除。

22. 再次发起请求并点击确认：正式配置按预期写入，原有未涉及字段不被清空。

23. 传入 http:// API 地址、超长 Token、空 config、未知字段、过期
    timestamp，确认分别被拒绝或被白名单过滤。

24. 在 config 字段中放入 \<img src=x onerror=alert(1)\>
    等字符串，确认只作为文本显示，不执行。

25. 同时快速发起两次请求，确认第二次得到 IMPORT_BUSY
    或按项目定义的串行策略处理。

# 13. 接入页面 CSP 注意事项

本方案依赖第三方页面创建 chrome-extension://.../bridge.html
iframe。若接入站点设置了严格 Content-Security-Policy，尤其是 frame-src /
child-src 只允许 self，浏览器可能阻止该 iframe。

- 接入项目如果有严格 CSP，需要把 chrome-extension:
  scheme（或符合其安全策略的对应来源）加入允许的 frame-src/child-src。

- SDK 应以“未收到 BRIDGE_READY 超时”作为统一失败表现，不要把
  iframe.onload 当作安装检测。

- 如果某个接入方无法调整 CSP，则该站点不适合此 iframe bridge
  方案；改用固定 HTTPS Bridge 域名方案或为该已知站点采用
  externally_connectable。

| **设计现实：**不存在一种完全不受站点 CSP、扩展清单安全边界和浏览器弹窗策略影响的“任意网站零配置调用扩展”方式。本方案的取舍是：不维护域名白名单，但要求网页能够加载一个 chrome-extension: iframe。 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |

# 14. 与 externally_connectable 方案的区别

| **项目**                     | **本方案：Web Accessible bridge**             | **externally_connectable**              |
| ---------------------------- | --------------------------------------------- | --------------------------------------- |
| 接入域名是否预知             | 不需要                                        | 通常需要在 manifest matches 中声明      |
| 接入方需要什么               | Extension ID + SDK/协议                       | Extension ID + Chrome runtime messaging |
| 外部入口                     | chrome-extension://ID/integration/bridge.html | chrome.runtime.sendMessage(ID, ...)     |
| 是否需要 content script      | 不需要                                        | 不需要                                  |
| 是否可支持大量未知 SaaS 域名 | 适合                                          | 不适合动态未知域名                      |
| 主要安全边界                 | 扩展确认 UI + 严格 bridge 能力                | manifest 域名白名单 + 扩展消息校验      |

# 15. 上线前建议

- Extension ID：Chrome Web Store 同一个扩展条目更新版本时 ID
  稳定。开发环境如需固定 ID，应使用项目既有的固定 key/打包策略。

- 如果 Web SDK 会提供给第三方，建议给协议做 semver/version
  管理，不要让旧 SDK 因扩展升级直接失效。

- 如果未来需要“用户确认结果回传网页”，单独设计 v2，不要在 v1
  里通过轮询暴露正式配置。

- 如果不同系统可导入的字段不同，可在 UI
  中逐项显示变化（旧值/新值），但敏感旧值绝不对外返回。

- 如果插件已经有 Options/Settings
  的验证函数，应复用同一验证层，避免外部导入路径绕过正常配置约束。

# 16. Chrome 官方参考

- [<u>Manifest - Web Accessible
  Resources</u>](https://developer.chrome.com/docs/extensions/reference/manifest/web-accessible-resources)

- [<u>Chrome Extensions - Message
  passing</u>](https://developer.chrome.com/docs/extensions/develop/concepts/messaging)

- [<u>chrome.windows
  API</u>](https://developer.chrome.com/docs/extensions/reference/api/windows)

- [<u>chrome.runtime
  API</u>](https://developer.chrome.com/docs/extensions/reference/api/runtime)

- [<u>Extension security / Stay
  secure</u>](https://developer.chrome.com/docs/extensions/develop/security-privacy/stay-secure)

- [<u>Declare
  permissions</u>](https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions)

| **官方行为依据：**Chrome 官方文档确认：从网站 origin 导航到 chrome-extension:// 资源时，目标资源必须声明为 Web Accessible Resource；MV3 的 web_accessible_resources 可以把特定资源映射给指定 URL match patterns，并可使用通配站点模式。Chrome 同时建议尽量减少公开资源与权限范围。 |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |

# 附录 A：可直接复制给 Coding Agent 的任务摘要

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th>请在当前 Chrome Extension（Manifest
V3）项目中实现“通用外部配置导入”。<br />
<br />
核心要求：<br />
1. 不使用 externally_connectable，不维护接入网站域名白名单。<br />
2. 接入方只配置 Extension ID。<br />
3. 新增 Web Accessible integration/bridge.html，允许 HTTP/HTTPS
网站加载。<br />
4. Web 页面通过隐藏 iframe + postMessage 向 bridge 发送
REQUEST_CONFIG_IMPORT。<br />
5. bridge 必须校验来源、协议版本、requestId、timestamp 和 config
schema。<br />
6. 外部只能“提出导入请求”，不能直接 SET_CONFIG，也不能
GET_CONFIG/GET_TOKEN。<br />
7. 待导入配置写入 chrome.storage.session，带 sourceOrigin 和 5 分钟
TTL。<br />
8. bridge 通过 chrome.windows.create 打开扩展内部 import.html
popup。<br />
9. import.html 显示 sourceOrigin
和配置预览，敏感值掩码；用户点击确认后才写正式配置。<br />
10. Token/config 不得进入 URL query/hash。<br />
11. import 页面动态内容必须使用 textContent 或等价安全渲染，防止
XSS。<br />
12. 适配当前项目现有配置 storage key /
验证逻辑，不要机械创建新的平行配置体系。<br />
13. 只暴露 bridge.html；不要为了本功能申请 tabs、全站 content script 或
&lt;all_urls&gt; host_permissions。<br />
14. 补齐未安装、错误 ID、取消、确认、过期、重复请求、非法字段、XSS
字符串等测试。<br />
15.
完成后输出：修改文件清单、实现说明、测试步骤、兼容性/风险说明。<br />
<br />
协议固定：protocol="extension-config-import", version=1。<br />
请先检查现有项目配置结构，再实施最小改动。</th>
</tr>
</thead>
<tbody>
</tbody>
</table>
