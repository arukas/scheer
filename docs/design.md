# Scheer - Chrome 扩展（MV3）商品采集方案设计

> 版本：v0.2（草案）
> 状态：待评审 / 待补充

## 1. 背景与目标

### 1.1 项目目标

开发一个 Chrome（Manifest V3）浏览器扩展（**私有化发布，不上架 Web Store**），用于：

- 在用户当前浏览的商品页上，采集 **商品信息**；
- 按平台类型将原始数据转换为**通用商品模型**；
- 按用户配置的远端**创建商品接口**（URL + 认证）将结构化商品数据发送到后端服务；

字段转换规则将**参考既有的 curl 爬虫项目**（PHP）保持一致，本扩展只负责"浏览器内的抓 + 转 + 发"。

> 评论采集不进 v1，等待 v2 再设计 / 实现；本文保留的评论内容均视为 v2 占位。

### 1.2 核心价值

- **人工辅助采集**：用户浏览商品时一键推送数据到自有系统；
- **零侵入**：完全运行在用户浏览器内，无需在被采集站做任何部署；
- **多平台归一**：不同 SaaS 建站平台 + TikTok 输出统一 schema；
- **后端最小化**：后端只提供创建商品接口，扩展只做"抓 + 转 + 发"。

### 1.3 非目标（本期不做）

- 不上架 Chrome Web Store（私有化分发，企业内加载）；
- 不做后台无人值守批量爬虫（不绕过任何网站风控、不做 RPA 自动翻页 / 自动滚动刷评论）；
- 不做商品数据存储与展示的后台系统；
- 不做后端；
- v1 不做评论采集；评论等待 v2；
- 不做支付、下单等交易动作；
- 不做自动批量采集 / 自动翻页；
- 不做复杂字段映射 UI；
- 不内置任何平台的官方 API 对接（只用页面可见数据 + 页面内已发生的 XHR）。

---

## 2. 目标平台

### 2.1 平台清单

| 平台            | 类型      | 说明                     |
| --------------- | --------- | ------------------------ |
| **Shopify**     | SaaS 建站 | 行业基准，结构最规整     |
| **NewShop**     | SaaS 建站 | NewShop / WShop 自建站   |
| **ShopBase**    | SaaS 建站 | POD / 电商建站           |
| **ShopLine**    | SaaS 建站 |                          |
| **XShopPy**     | SaaS 建站 |                          |
| **ShopLazza**   | SaaS 建站 |                          |
| **TikTok Shop** | 社交电商  | `shop.tiktok.com` 商品页 |

> ⚠️ **以上 7 个平台各自独立，互不共用抓取逻辑。** 不要假设 NewShop / ShopBase / ShopLine / XShopPy / ShopLazza 兼容 Shopify 的接口或 DOM。既有 PHP 参考项目已覆盖 `Shopify / NewShop / ShopBase / ShopLine / XShopPy / ShopLazza` 6 个平台；`TikTok` 是本扩展新增适配。

### 2.2 七个独立抓取器

每个平台是一个独立抓取器，各自维护：**平台识别规则、数据获取入口、商品字段转换、评论采集方式**。抓取器之间不继承、不共用 Shopify 假设。

| 抓取器          | 商品数据入口                                                                                                                                                                                          | 评论采集方式（v2） |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| **Shopify**     | ✅ 商品页 URL 追加 `.json`（`/products/<handle>.json`）取 JSON                                                                                                                                        | v2                 |
| **NewShop**     | ✅ **URL 改写**：`/products/<handle>` → `/api/store/products/<handle>` 取 JSON                                                                                                                        | v2                 |
| **ShopBase**    | ✅ **页面注水**：`window.__INITIAL_STATE__`                                                                                                                                                           | v2                 |
| **ShopLine**    | ✅ **页面注水**：`window.__PRELOAD_STATE__.product`                                                                                                                                                   | v2                 |
| **XShopPy**     | ✅ 页面读 `input.product-id`（`body > div.PageContainer.J-PageContainer > input.product-id`）→ **POST** `/buyer/product/pop-detail`（JSON body: `product_id`）                                        | v2                 |
| **ShopLazza**   | ✅ **混合**：页面 `<input type="hidden" name="product_id">` → `/api/products/{id}` 取主体；详情描述读 DOM `.product-info__desc-tab-content`；API 图片 `src` 前补 `https:`，详情 HTML 懒加载属性需清洗 | v2                 |
| **TikTok Shop** | ✅ DOM `<script id="__MODERN_ROUTER_DATA__">` 取 JSON                                                                                                                                                 | v2                 |

> 评论入口全部延后到 v2。

每个抓取器遵循统一的方法论（§4.1 三层回退），但**具体选择器、数据入口、字段映射各自维护、互不继承**。

### 2.3 数据获取的技术要点（底层机制，跨平台通用）

不同入口对应不同实现机制，影响 content script 注入策略：

| 机制                       | 适用平台                                                                                                                                 | 实现要点                                                                                                                                                                                                                                       |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **API 请求（GET / POST）** | NewShop（GET `/api/store/products/<handle>`）、Shopify（GET `/products/<handle>.json`）、XShopPy（**POST** `/buyer/product/pop-detail`） | 从 DOM / URL 取得 id / handle → 构造 API 请求 → content script 内 `fetch`（同源，自动带页面 cookie）。XShopPy 按参考项目使用 `Content-Type: application/json`，JSON body 为 `{ "product_id": id }`。                                           |
| **SSR 注水对象**           | ShopLine（`window.__PRELOAD_STATE__.product`）、ShopBase（`window.__INITIAL_STATE__`）                                                   | ⚠️ 这些对象挂在页面 **MAIN world** 的 `window` 上，content script 默认运行在 isolated world **读不到**。需用 MV3 的 `chrome.scripting.executeScript({world:"MAIN"})` 或注入 `<script>` 在主世界读取后，经 `postMessage` / `CustomEvent` 回传。 |
| **DOM 内嵌 JSON script**   | TikTok（`script#__MODERN_ROUTER_DATA__`）                                                                                                | 直接从 DOM 读取 script text，`JSON.parse` 后从 `loaderData` 中找 PDP 节点。                                                                                                                                                                    |
| **XHR / fetch 拦截**       | 兜底（注水对象 / API 不返回所需字段时）                                                                                                  | 在 MAIN world **尽早** patch `window.fetch` / `XMLHttpRequest`，捕获目标接口响应。要求 content script `run_at:"document_start"` 才能拦到早期请求。                                                                                             |
| **静态 DOM / JSON-LD**     | 兜底                                                                                                                                     | isolated world 内直接 `document.querySelector` / 读 `<script type="application/ld+json">`。                                                                                                                                                    |
| **多源合并**               | ShopLazza（API 主体 + DOM 详情）                                                                                                         | ⚠️ 单平台内可能**同时**用 API 与 DOM：API 取结构化主体字段，DOM 补 API 不返回的部分（如 ShopLazza 的 `.product-info__desc-tab-content` 长描述）。抓取器内部需把多源结果**合并**为统一 Product，不能假设一个平台只有一个数据源。                |

**已知字段清洗规则**（实现期对照参考项目继续补充）：

- ShopLine / ShopLazza：详情 HTML 里懒加载图片属性需清洗，`data-style` → `style`，`srcset / data-srcset / data-src` → `src`，去掉 `_{width}`、内联占位尺寸与 `_800.png?...` 这类裁剪后缀。
- ShopLazza：API 返回图片多为协议相对 URL，入库前补成 `https:`。
- XShopPy：详情 HTML 里图片 `data-original` → `src`。
- NewShop：图片 `type` 由 `media_content_type` 判断，非 `video` 为 `"image"`，`video` 为 `"video"`。

> 关键约束：**MAIN world 注入的数据回传**是注水 / 拦截两条路径的共同难点，需统一封装一个"主世界桥"工具（见附录 A 的 `shared/main-world.ts`），各抓取器复用但不含平台假设。

### 2.4 TikTok Shop 特性

- 参考来源：`/Users/Hakuryu/Workspace/code/analysis` 的 `feature/6997074979` 最新提交 `2b10e02996c7b336996e60b5aaf5f393eb1f5849`（`CrawlTikTokService.php`）；
- 商品数据来自页面 DOM 内 `<script id="__MODERN_ROUTER_DATA__">...</script>`，不是 `window.__PRELOAD_STATE__`；
- JSON 路径：`loaderData` 中找到包含 `page_config.components_map` 的节点，再在 `components_map` 中找 `component_name === "product_info"`，主体为 `component_data.product_info.product_model`；
- URL 形如 `shop.tiktok.com/view/product/<id>` 或短链；
- 进入采集前先去掉 URL query；
- 若 `component_data.error_code === "23002002"`、错误信息包含 `get product detail not exist`，或页面 / JSON 提示 `product not available in this country or region`，按商品不可访问处理；
- 若找不到 `__MODERN_ROUTER_DATA__`，服务端参考实现会识别 captcha / security check；扩展内只需给出“页面未加载完整或被风控”的失败原因。

### 2.5 参考 PHP 的平台探测流程

参考入口：`/Users/Hakuryu/Workspace/code/analysis/app/Services/Products/Import/CrawlService.php`。

1. URL 解析只取 path 中 `/products/<handle>` 的 `handle`；没有 host 或 handle 时判为不支持。
2. 并发尝试 4 个请求：Shopify `/products/<handle>.json`、NewShop `/api/store/products/<handle>`、商品页 `/products/<handle>`、NewShop 无代理请求。
3. Shopify / NewShop 命中 JSON 后直接进入对应 crawler。
4. 商品页 HTML 命中后按顺序识别：ShopLazza hidden `product_id` → ShopLine `__PRELOAD_STATE__.product=...` → ShopBase `__INITIAL_STATE__ = JSON.parse(...)` → XShopPy `input.product-id`。
5. Cloudflare 403 或无匹配时返回“不支持”；这只是 PHP 服务端爬虫行为，浏览器扩展在用户页内抓取，优先复用同源页面数据，不需要代理。

---

## 3. 总体架构

### 3.1 商品采集器

v1 只内置商品采集；评论采集等待 v2。插件监控符合 URL 规则的页面，判断平台与可抓取状态；用户点击后实时调用后端创建商品接口：

```
┌────────────────────────────────────────────────────────────────┐
│                    Chrome Extension (MV3)                       │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │   Popup      │  │  Options     │  │   Review/Edit Drawer │  │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬───────────┘  │
│         └───────┬──────────┴─────────────────────┘             │
│                 ▼                                               │
│   ┌──────────────────────────────────────────┐                  │
│   │         Background Service Worker         │                  │
│   │  页面状态 / 单次提交 / 网络发送 / 消息   │                  │
│   └──────┬────────────────────────┬───────────┘                 │
│          │                        │                             │
│   ┌──────▼─────────┐      ┌───────▼──────────┐                  │
│   │  Storage        │      │  HTTP Client      │                 │
│   │ (chrome.storage)│      │  (fetch→用户后端) │                 │
│   └────────────────┘      └───────────────────┘                 │
│                                                                 │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │                Content Script(s)                         │   │
│   │  ┌────────────────────────────────────────────────────┐  │   │
│   │  │  7 个独立抓取器（Shopify / NewShop / ShopBase /     │  │   │
│   │  │   ShopLine / XShopPy / ShopLazza / TikTok）         │  │   │
│   │  │  每个抓取器 = 商品采集 + 字段转换（评论 v2）        │  │   │
│   │  └────────────────────────────────────────────────────┘  │   │
│   │             XHR/Fetch 拦截器（可选，复用页面内 API）     │   │
│   └─────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌──────────────────┐
                    │   用户远端服务    │  (用户自备)
                    └──────────────────┘
```

### 3.2 运行时职责

| 运行时             | 职责                                                                                   |
| ------------------ | -------------------------------------------------------------------------------------- |
| **Content Script** | 注入目标页，识别平台，判断是否可抓，运行对应商品抓取器，必要时经 MAIN world 读注水对象 |
| **Background SW**  | 监听 tab URL / 状态变化，保存配置，转发单次创建商品请求，与 UI 通信                    |
| **Popup**          | 展示后端配置状态、当前平台、是否可抓，提供"创建商品"按钮，并展示实时接口结果           |
| **Options**        | 配置创建商品 endpoint 与后端密钥                                                       |
| **Storage**        | 配置、本地历史（成功 / 失败结果）                                                      |

---

## 4. 采集策略

### 4.1 三层回退（适用所有平台）

1. **平台原生数据接口**（优先，结构化，**各平台各自确认**）
   - 每个平台自身暴露的数据入口（具体见 §2.2 表格：API / 注水对象 / DOM 等，各平台不同，**不能套用其他平台**）
2. **结构化嵌入**（次选）
   - JSON-LD（schema.org Product / AggregateRating / Review）
   - Open Graph / Twitter meta
3. **DOM 选择器**（兜底）
   - 平台特定的 CSS 选择器（规则以 JSON 数据形式维护）

### 4.2 抓取器结构（7 个，各自独立）

每个平台一个抓取器，内部职责：

- **平台识别**：URL host → 平台特征指纹，区分 7 个平台、互不混淆；
- **商品采集**：按本平台的数据入口提取，输出**通用 Product 对象**（见 §6.1）；
- **评论采集**：v2 再做；v1 不实现；
- **字段转换**：本平台原始字段 → 通用 schema，规则与参考项目的 crawler 分支对齐（见 §7）。

> 抓取器之间**不共享平台特定逻辑**。公共能力（XHR 拦截、等待元素、JSON-LD 解析等）作为**工具函数**复用，但不复用任何平台假设。

### 4.3 评论采集（v2）

v1 不实现评论采集；不写评论抓取器、不做评论 UI、不做评论 endpoint。v2 另行设计。

---

## 5. 核心流程

### 5.1 页面监控流程

```
Tab URL 更新 / 激活
   ↓
按 URL 规则初筛：商品详情页候选 / 非商品页
   ↓
候选页注入 content script
   ↓
平台识别 + canExtract 轻量探测
   ↓
Popup 展示：平台类型、可抓 / 不可抓原因、创建商品按钮状态
```

v1 URL 初筛规则：

- 通用 SaaS：URL path 包含 `/products/<handle>`；
- TikTok：host 包含 `shop.tiktok.com`，path 命中 `/view/product/<id>` 或可在页面内找到 `script#__MODERN_ROUTER_DATA__`；
- 其他平台可先按 URL + 页面指纹双判断，避免误判。

### 5.2 商品创建流程

```
Popup「创建商品」
   ↓
校验 endpoint + 后端密钥已配置；当前页 canExtract=true
   ↓
Content Script 运行对应抓取器，按平台入口取数（见 §2.2）
   ↓
组装 §6.1 创建商品请求
   ↓
实时 POST `create_product_endpoint`
   ↓
等待接口返回结果
   ↓
成功：展示后端 product_id、log_id、接口返回的当前用户信息，并写本地 history
失败：展示接口错误信息，并允许用户手动重试
```

### 5.3 评论采集流程

v1 不执行。评论采集等待 v2。

### 5.4 实时提交流程

```
组装请求（URL + 后端密钥 + body）
   ↓
fetch
   ↓
┌─ 2xx            → success，记录后端返回的 product_id，写 history
├─ 401/403        → auth_failed，提示用户检查密钥
├─ 4xx（非鉴权）   → failed（不重试），记错误
└─ 5xx / 网络      → failed，展示错误，用户手动重试
```

> v1 不做后台异步队列、自动重试、dead-letter。接口必须实时返回创建结果；评论 endpoint 等 v2 再定。

---

## 6. 数据模型

### 6.1 创建商品请求（对齐后端 products / variants / images 三表）

扩展采集后组装、经 `create_product_endpoint` 一次 POST。后端只负责：创建 `products`、创建嵌套的 `variants/images`、追加一条采集日志、返回新商品 ID。`variants` 与 `images` 是 `product` 的属性（嵌套），结构类 Shopify 产品 JSON。字段名**严格对齐后端表**，映射成本最小。
来源标记：**(采)**=采集自平台、扩展填；**(后)**=后端处理、扩展不传。

请求头：

```http
Authorization: Bearer <后端提供的密钥>
Content-Type: application/json
```

```jsonc
{
  // 以下外层字段不入商品三表，后端写采集日志
  "platform": "shopify",            // (采) shopify|newshop|shopbase|shopline|xshoppy|shoplazza|tiktok
  "source_url": "https://...",       // (采) 当前商品页 URL
  "source_product_id": "123456789",  // (采) 平台商品 ID；可为空

  "product": {
    // ===== products 表 =====
    // id：后端生成自己的新 id，扩展不传；平台 ID 放 source_product_id / 日志
    "title": "...",                 // (采) NOT NULL
    "handle": "tshirt-black",       // (采)
    "description_html": "...",      // (采) 商品详情 HTML
    "vendor": "...",                // (采)
    "product_type": "...",          // (采)
    "tags": [...],                  // (采) string[]
    "options": [...],               // (采) 规格维度定义（JSON）
    "published_scope": "",          // 默认空值；后端若不收则发送层过滤
    // user_id / store_id / label / status：均 (后)，扩展不传

    // ===== variants 表（1:N，product 的属性）=====
    "variants": [
      {
        "source_variant_id": "987654", // (采) 平台 variant id；仅用于日志 / 排查
        "position": 1,              // (采) NOT NULL，与 product_id 唯一
        "title": "Black / M",       // (采) NOT NULL
        "price": "99.00",           // (采) decimal(8,2) NOT NULL
        "compare_at_price": "199.00", // (采) 划线价
        "sku": "ABC-001",           // (采)
        "barcode": "...",           // (采)
        "options": [                // (采) 该 variant 在所有规格维度上的取值
          { "name": "Color", "value": "Black" },
          { "name": "Size", "value": "M" }
        ],
        "source_image_id": "111",   // (采) 关联下方 source image；后端创建后自行映射 image_id
        "grams": 0,                 // (采) NOT NULL
        "weight": null,             // (采)
        "weight_unit": null,        // (采)
      }
    ],

    // ===== images 表（1:N，product 的属性；id 后端生成，扩展不传）=====
    "images": [
      {
        "source_image_id": "111",   // (采) 平台 image id；仅用于 variant 图片映射 / 日志
        "position": 1,              // (采) NOT NULL，与 product_id 唯一
        "src": "https://...",       // (采) NOT NULL；ShopLazza API 图片需补 `https:`
        "alt": "...",               // (采)
        "type": "image"             // (采) "image" 或 "video"
      }
    ]
  }
}
```

> **扩展不传的字段**（后端处理）：`product.id / variants.id / variants.product_id / variants.image_id / images.id / images.product_id / user_id / store_id / label / status / part_id / shared / shared_parts_int / created_at / updated_at / variants.status / variants.inventory_policy / variants.inventory_management / variants.fulfillment_service / images.attachment_id`。
>
> **`variant.options` 规则**：每个元素包含 `name`（规格维度名，与 `product.options[].name` 对齐）和 `value`（该变体在此维度上的取值）。单规格默认用 `{ name: "Title", value: "Default Title" }`。
>
> **采集日志字段**：`platform / source_url / source_product_id / created_product_id / error_message / raw_summary` 等由后端写日志；评论相关（`rating / review_count` 等）等待 v2。

成功响应：

```jsonc
{
  "product_id": "后端新商品ID",
  "log_id": "采集日志ID",
  "user": {
    "id": "当前用户ID",
    "name": "当前用户名",
  },
  "message": "created",
}
```

失败响应：

```jsonc
{
  "message": "错误原因",
}
```

插件在保存成功后展示 `user`，让用户知道本次商品保存到了哪个后端账号下。

### 6.2 评论对象

v1 不定义。评论等待 v2。

### 6.3 用户配置（Config）

```jsonc
{
  "server": {
    "base": "https://api.example.com",
    "create_product_endpoint": "https://api.example.com/v1/products", // 纯创建商品接口
    "method": "POST",
    "secret": "后端提供的密钥", // 作为 Bearer token 发送
    "timeout_ms": 30000,
    "batch_reviews": false, // v2 占位：评论是否批量打包发送
  },
  "crawl": {
    "product_mode": "manual", // v1 固定：监控页面，但必须用户手动点创建
    "extract_reviews": false, // v1 固定 false；评论等待 v2
    "review_strategy": "visible", // v2 占位
    "review_max_pages": 5, // v2 占位
    "confirm_before_submit": true,
  },
  "platforms": {
    // 平台开关
    "shopify": true,
    "tiktok": true /* ... */,
  },
  "retry": {
    "max_attempts": 5,
    "backoff_base_ms": 2000,
    "retryable_status": [408, 429, 500, 502, 503, 504],
  },
  "ui": { "notify_success": true, "notify_failure": true },
  "storage": {
    "keep_history_days": 30,
    "product_dedup_key": "source_url",
    "review_dedup_key": "external_id", // v2 占位
  },
}
```

### 6.4 本地历史项（HistoryItem）

```jsonc
{
  "id": "uuid",
  "source_url": "https://...",
  "platform": "shopify",
  "status": "success", // success | failed
  "product_id": "后端新商品ID",
  "log_id": "采集日志ID",
  "user": { "id": "...", "name": "..." },
  "error": { "message": "..." },
  "created_at": "...",
  "updated_at": "...",
}
```

---

## 7. 字段转换（对齐参考项目）

参考路径：

- `/Users/Hakuryu/Workspace/code/analysis/app/Services/Products/Import/CrawlService.php`
- `/Users/Hakuryu/Workspace/code/analysis/app/Services/Products/Import/Crawlers/*Crawler.php`
- `/Users/Hakuryu/Workspace/code/analysis/app/Services/Products/Import/NewShopCrawler.php`
- `/Users/Hakuryu/Workspace/code/analysis/app/Models/Products/{Product,Variant,Image}.php`

### 7.1 通用字段白名单

参考 PHP 的 `SELF_PROPERTY_LIST`，扩展提交层按这些字段收口：

| 对象    | 字段                                                                                                                                     |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Product | `description_html`、`handle`、`options`、`product_type`、`published_scope`、`tags`、`title`、`vendor`                                    |
| Variant | `barcode`、`compare_at_price`、`grams`、`options`、`position`、`price`、`sku`、`title`、`weight`、`weight_unit`，提交时额外带 `image_id` |
| Image   | `position`、`src`、`alt`、`type`                                                                                                         |

### 7.2 各平台转换规则

| 平台      | Product                                                                                                                                                                                                 | Options                                                                                                                                      | Images                                                                                     | Variants                                                                                                                                                                                                                                                                           |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shopify   | 直接取 Shopify JSON `product` 的 Product 白名单字段                                                                                                                                                     | 删除每个 option 的 `id`、`product_id`                                                                                                        | 取 Image 白名单；position 按返回顺序重排；保留源 image id 只用于 variant `image_id` 映射   | 取 Variant 白名单；position 重排；`image_id` 映射到新图片                                                                                                                                                                                                                          |
| NewShop   | `title/post_content/tags/variant_attrs/slug/content` → `title/description_html/options/handle`；`handle=slug`；`description_html=post_content ?? content ?? ""`                                         | `variant_attrs`：`position=序号`，`values=value`，删除 `value/is_visible/is_variation/is_taxonomy`；无规格则默认 `Title / Default Title`     | `gallery`：`id=ID`，`src=url`，`type=(media_content_type === "video" ? "video" : "image")` | `variants`：`image_id=feature_image.ID`，`compare_at_price=regular_price`，`options` 从 `attrs` 按 option name 匹配；无 variants 时用商品 `price/sku/regular_price` 生成 Default Title；`sku` 第一个 `-` 前 50 字符；`compare_at_price` 空或低于 `price` 时置 `0`                  |
| ShopBase  | `description` → `description_html`，另取 `handle/product_type/published/published_scope/tags/title/vendor`                                                                                              | `options[].values[].name` 转为 values；规格值 ID 在 variant 中反查成名称                                                                     | `images[]` 取 `alt/src/type`，position 重排，保留源 image id 做映射                        | `weight=0`，`weight_unit=g`；`options` 从 option value id 反查名称；`image_id` 映射                                                                                                                                                                                                |
| ShopLine  | `spu.title` → `title`；详情优先 DOM `.mce-content-body`，否则 `productSeo.desc`；`handle` 取 `productSeo.url` 最后一段                                                                                  | `sku.skuAttributeMap`：`name=defaultName`，`position=attributeWeight`，`values=skuAttributeValueMap.defaultValue`，按 position 排序          | `spu.imageList`：`src=url`，`alt=alt`，position 重排                                       | `sku.skuList`：`price/originPrice` 分为单位，除以 100；`sku=itemNo`；`options` 按 `skuAttributeIds.attributeWeight` 匹配；`weightUnit` 默认 `g`；单 variant 时强制 `Title / Default Title`                                                                                         |
| XShopPy   | `/buyer/product/pop-detail` 成功后取返回 `data` 的 Product 白名单字段；`description_html` 清洗 `data-original` 图片                                                                                     | `attribute`：`name=specName`，`values=specItems`，`position=序号`，删除 `specName/specItems/specCodes`；无规格则默认 `Title / Default Title` | `images[].file_preview` → `src`，position 重排，type 默认 `image`                          | `sku_list`：`sku=sku_code`；`spec` JSON 按 option name 填 `options`；无规格则 `Default Title`                                                                                                                                                                                      |
| ShopLazza | API `data.product` 取 Product 白名单；`description_html` 优先 DOM `.product-info__desc-tab-content` 清洗结果，否则 `meta_description`                                                                   | 删除 option 的 `id`；无规格则默认 `Title / Default Title`                                                                                    | API 图片 `src` 前补 `https:`，position 重排，type 默认 `image`                             | `weight` 空则 `0`；单 variant 且无 `options` 时设 `Default Title`；variant image 按 `https:` + `image.src` 映射到图片                                                                                                                                                              |
| TikTok    | `product_model.name` → `title`；`handle` 从 URL 的 `product/products/pdp` 后一段取，若是 18-20 位纯数字则用 title slug；`description_html` 由 `product_properties` 表格 + `description` block HTML 组合 | `sale_properties`：`name=property_name`，`values=property_values[].property_value_name`，position 重排                                       | `product_model.images[].url_list[0]` → `src`，去掉 query，position 重排，type 默认 `image` | `skus`：`sku=sku_name`；`property_pairs[].sku_property_value_name` → `options`；title 用规格值 `/` 拼接；价格从 `promotion_model.promotion_product_price.skus_price` 取 `seller_subtotal_deduction`；`compare_at_price=price / discount_decimal`；无有效规格时生成 `Default Title` |

### 7.3 平台代码

参考 `PlatformEnum::code()`：

| 平台      | code        |
| --------- | ----------- |
| Shopify   | `shopify`   |
| NewShop   | `wshop`     |
| XShopPy   | `xshoppy`   |
| ShopLazza | `shoplazza` |
| ShopLine  | `shopline`  |
| ShopBase  | `shopbase`  |
| TikTok    | `tiktok`    |
| Internal  | `内部服务`  |
| Unknown   | `未知平台`  |

扩展内部建议仍使用小写英文 key（`shopify/newshop/shopbase/shopline/xshoppy/shoplazza/tiktok`）；提交给后端时如需兼容旧 PHP，可在发送层把 NewShop 转为 `wshop`。

### 7.4 参考项目里的服务端专属路径

PHP `CrawlService::capture($url, $flash=true)` 对 NewShop 有一条内部 fast path：按 `domain/third_domain` 找 `Store`，再走 WShop Admin API 拉商品。这依赖服务端登录态和内部 API，浏览器扩展不实现；v1 后端也不做代抓，只接收扩展提交的商品数据创建商品。

---

## 8. 安全与凭据

### 8.1 凭据存储（⚠️ 重点）

`chrome.storage` **不加密**，因此：

- 只保存后端提供的密钥，不保存账号密码；
- 凭据存 `storage.local`，不要用 `sync`；
- Options 页明确提示"凭据以明文保存在本地浏览器"。

### 8.2 认证方式

v1 只支持后端提供的密钥：

```http
Authorization: Bearer <secret>
```

不做 Basic / 自定义 header / 字段映射鉴权 UI；需要时后续再加。

### 8.3 传输与权限

- 后端 endpoint **强制 HTTPS**；
- 日志 / 错误不打印凭据与完整 body；
- content script 使用 `matches: ["<all_urls>"]` 以便监控任意自建站商品页，但脚本启动后先按 URL 规则快速退出；非候选页不做 DOM 探测；
- 后端创建接口的 origin 用 `optional_host_permissions` 运行时申请；
- 只申请必要 API：`storage`、`tabs`、`scripting`。

---

## 9. Manifest V3 关键约束

| 约束                 | 对策                                                                                   |
| -------------------- | -------------------------------------------------------------------------------------- |
| SW 会被随时 kill     | 不依赖后台长任务；单次提交实时完成，本地 history 落 `chrome.storage`                   |
| 禁止远程代码         | adapter 选择器规则只能是**数据（JSON）**，解释器内置；不能 eval 远程 JS                |
| fetch 受 SW 寿命影响 | 单次提交，超时后提示用户手动重试                                                       |
| host_permissions     | content script 负责页面监控；后端 origin 使用 `optional_host_permissions` + 运行时申请 |

---

## 10. 用户交互（UI）

### 10.1 Popup

- 后端连接状态：展示创建商品接口是否已配置；未配置则提示去 Options 配置；
- 当前页平台识别结果（Shopify / NewShop / ... / TikTok / 未知）；
- 当前页可抓状态：可抓 / 不可抓，并显示原因；
- 主按钮 **创建商品**；仅在 endpoint + secret 已配置且当前页可抓时启用；
- 提交中展示 loading；接口返回后展示成功 / 失败；
- 保存成功后展示接口返回的 `user` 信息与后端 `product_id`；
- 快捷入口：Options、历史、失败重试。

### 10.2 Options

- 远端配置：`create_product_endpoint`、后端提供的密钥；
- **测试配置**按钮：只校验 URL / HTTPS / 密钥是否填写；不调用后端创建接口；
- 平台开关；评论采集配置等待 v2；
- 凭据安全提示。

### 10.3 预览（提交前）

- 商品：只读预览核心字段、图片、变体数量；
- 提交 / 取消；
- 不做复杂字段映射 UI，不做逐字段编辑器。

### 10.4 通知 / 其他

- v1 不做右键菜单、键盘快捷键、系统通知；
- 成功 / 失败结果只在 Popup 内展示并写本地 history。

---

## 11. 发布与分发（私有化 / 外部客户）

### 11.1 分发方式

- **不上架 Chrome Web Store**，纯私有分发；
- 用户为**外部客户**，无统一终端管理（无企业策略 / MDM）；
- 安装：客户开启 Chrome **开发者模式** → 加载已解压扩展（`.zip` 解压目录）；
- 新版通过既有渠道（链接 / 群 / 邮件）通知客户下载。

### 11.2 自动更新：不做

外部客户机不受管理 + Chrome 75+ 拒绝非商店 `.crx`，v1 不做自动更新、远端规则热更新、版本检查。更新流程走人工下载新版 → 扩展页重新加载。

### 11.3 外部客户使用摩擦（须预先告知）

- Chrome 会**反复弹"禁用不明扩展"警告**，客户需手动确认保留（开发者模式扩展固有骚扰）；
- 首次安装须引导：开启开发者模式 → 加载已解压扩展；
- 更新流程：下载新版 → 扩展页点"重新加载"（或替换目录）；
- 需提供图文安装 / 更新说明文档。

### 11.4 长期风险 / Plan B

Chrome 持续收紧非商店扩展，若未来开发者模式被进一步限制，评估转为 **Web Store「未列表 / Unlisted」上架**（直链分发 + 官方自动更新，代价是一次性过 Google 审核与隐私声明）。当前作为 Plan B。

---

## 12. 可靠性与运维

- **重试**：v1 不自动重试；失败后展示错误，用户手动点击重试。
- **去重**：v1 不做复杂去重 / upsert；可在本地 history 提醒“当前 URL 曾提交过”，是否再次提交由用户决定。
- **日志**：保留最近 N 条请求 / 响应（脱敏）；"导出诊断包"。
- **选择器热更新**：v1 不做远端规则热更新；规则随扩展版本发布。

---

## 13. 待确认 / 待补充事项

### A. 业务范围（已部分确认）

1. ✅ 私有化发布，不上架。
2. ✅ v1 采集商品；评论等待 v2。
3. ✅ 平台：Shopify / NewShop / ShopBase / ShopLine / XShopPy / ShopLazza / TikTok。
4. ✅ 仅监控商品详情页候选；不做列表页 / 集合页批量采集。
5. ✅ 插件自动监控符合 URL 规则的页面并判断平台 / 可抓状态；创建商品必须用户手动点击。
6. ✅ 提交前可做只读预览；不做复杂编辑器 / 字段映射 UI。

### B. 评论采集（v2）

7. ⏳ 评论等待 v2，本期不实现。
8. ⏳ v2 再确认评论获取策略；v1 不做评论、不做自动翻页。
9. ❓ 评论最大翻页数 / 最大条数上限？
10. ❓ 评论里的图片 / 视频是传 URL 还是下载二进制？
11. ❓ 商家回复（reply）是否要采？
12. ❓ 评论是逐条发还是批量打包？后端期望哪种？
13. ⏳ 评论 endpoint 等 v2；v1 只有创建商品 endpoint。

### C. 后端契约

14. ✅ 后端只提供纯创建商品接口：接收 §6.1 payload，创建商品 / variants / images，并追加一条日志。
15. ✅ 鉴权：后端提供密钥，插件用 `Authorization: Bearer <secret>`。
16. ✅ 后端返回它生成的商品 ID，扩展用于本地 history 标记成功。
17. ✅ 请求体格式：v1 单条商品 POST 一次；批量等待后续需要再加。

### D. 字段对齐

18. ✅ **参考的 PHP curl 爬虫项目代码路径与商品字段白名单已补充到 §7**；评论字段定义等待 v2。
19. ❓ Product schema 里是否还缺字段（如重量 / 关税 / 发货地 / 物流时效 / UPC / EAN / ISBN）？
20. ❓ 多语言 / 多币种是否需要处理？

### E. 非功能

21. ✅ v1 只需要一套后端配置：`create_product_endpoint` + `secret`。
22. ❓ 预期日均采集量级？（影响 history 保存条数与接口超时设置）
23. ❓ 是否需要在扩展内展示采集历史与统计？

### F. 各平台数据入口（确认进度）

24. ✅ NewShop：URL 改写 `/products/<handle>` → `/api/store/products/<handle>`（JSON）；PHP 另有服务端内部 WShop Admin API fast path，扩展不实现。
25. ✅ ShopLine：`window.__PRELOAD_STATE__.product`（需 MAIN world 读取）。
26. ✅ ShopBase：`window.__INITIAL_STATE__`（需 MAIN world 读取）。
27. ✅ TikTok：`script#__MODERN_ROUTER_DATA__`，规则来自 `analysis` 分支 `feature/6997074979` 最新提交。
28. ✅ Shopify：商品页 URL 追加 `.json`（`/products/<handle>.json`）。
29. ✅ XShopPy：读 `body > div.PageContainer.J-PageContainer > input.product-id` → POST `/buyer/product/pop-detail`（`Content-Type: application/json`，body: `{ "product_id": id }`）。
30. ✅ ShopLazza：页面 `<input type="hidden" name="product_id">` → `/api/products/{id}`；详情描述读 DOM `.product-info__desc-tab-content`；API 图片 `src` 前补 `https:`，详情 HTML 懒加载图片属性需清洗。
31. ⏳ 评论入口全部等待 v2。
32. ❓ 各商品入口的返回结构样例（JSON / 注水对象），用于写字段映射回归。建议每个平台各提供 1 个样本商品页 URL。

### G. 后端创建接口

33. ✅ 商品数据回传使用 `create_product_endpoint`，语义为“创建商品并写一条日志”。
34. ✅ 不需要用户信息接口；后端只需要创建商品接口。
35. ✅ 扩展不显式带归属用户 ID；后端按认证信息 / 登录态自行归属。

### H. 后端字段映射（对齐 products / variants / images 三表）

36. ✅ **主键处理**：扩展不传后端主键；平台 ID 放 `source_product_id/source_variant_id/source_image_id`，后端生成自己的 `products/variants/images` ID。
37. ✅ **user_id**：扩展不传，后端按登录态自动填。
38. ✅ **store_id**：扩展不传，后端自行处理。
39. ✅ **label / published_scope**：`label` 扩展不传；`published_scope` 默认空值。
40. ✅ **variant.options**：每个元素为 `{ name, value }`，`name` 与 `product.options[].name` 对齐；无规格时默认 `{ name: "Title", value: "Default Title" }`。
41. ✅ **images.type**：`"image"` 表示图片，`"video"` 表示视频。
42. ✅ **无对应列字段**：评论相关等待 v2；`source_url/platform/source_*_id` 不入商品三表，由后端写日志。
43. ✅ **提交结构**：`variants` / `images` 是 `product` 的属性，嵌套一次 POST（见 §6.1）。
44. ✅ **upsert 语义**：v1 不做 upsert，只创建新商品；重复提交由后端按业务决定拒绝还是创建新记录。
45. ❓ **参考 PHP 复用前需复核的小问题**：`ShopBaseCrawler::discharge()` 当前创建了本地 `$product` 但未赋给 `$this->product`；若以后后端直接复用该 crawler，需要先修正。

---

## 14. 风险与建议

- **凭据安全**：只保存后端密钥，不保存账号密码。
- **7 个平台各自独立适配**：每个平台的数据入口、DOM 结构都需逐站实测，不能套用 Shopify；v1 工作量 = 7 个商品抓取器。
- **评论碎片化（v2）**：各平台评论来源不统一（平台原生 or 第三方 App），第三方评论 App 每多支持一个 = 一份额外子规则；v2 初期每个平台先打通"原生 / 最高频的一种"即可。
- **TikTok**：依赖 DOM 内 `script#__MODERN_ROUTER_DATA__`；如果页面被安全校验或区域限制替换内容，需要返回明确失败原因。
- **MV3 寿命**：所有状态必须持久化。
- **选择器失效**：规则随扩展版本发布；站点改版需要发新版。
- **风控边界**：禁止自动批量翻页 / 多 tab 并发；扩展定位为"人工辅助"。评论自动翻页等待 v2 再评估。

---

## 附录 A：目录结构（建议）

```
scheer/
├── manifest.json
├── src/
│   ├── background/
│   │   ├── index.ts               // SW 入口
│   │   ├── submit.ts              // 单次创建商品请求
│   │   └── history.ts             // 本地成功 / 失败记录
│   ├── content/
│   │   ├── index.ts               // 注入入口：平台识别 → 分发到对应 extractor
│   │   ├── platform.ts            // 平台识别（URL host + 指纹）
│   │   ├── extractors/            // ★ 7 个独立抓取器，互不共用平台逻辑
│   │   │   ├── shopify/
│   │   │   │   ├── index.ts       //   商品采集编排
│   │   │   │   ├── product.ts     //   本平台原始字段 → 通用 Product
│   │   │   │   └── selectors.json //   本平台选择器规则（数据）
│   │   │   ├── newshop/{ product.ts, selectors.json }
│   │   │   ├── shopbase/{ ... }
│   │   │   ├── shopline/{ ... }
│   │   │   ├── xshoppy/{ ... }
│   │   │   ├── shoplazza/{ ... }
│   │   │   └── tiktok/{ ... }     //   读 script#__MODERN_ROUTER_DATA__
│   │   └── shared/                // 工具函数：可跨抓取器复用，但不含平台假设
│   │       ├── main-world.ts      //   MAIN world 桥：读 window 注水对象 / 回传（ShopLine/ShopBase 等用）
│   │       ├── xhr-intercept.ts   //   拦截页面 fetch / XHR（兜底用）
│   │       ├── jsonld.ts          //   JSON-LD 解析
│   │       ├── wait.ts            //   等待元素可见
│   ├── popup/
│   ├── options/
│   └── shared/
│       ├── schema.ts              // Product / Config 类型；Review 等 v2
│       ├── storage.ts
│       └── messaging.ts
├── vendor/                        // 第三方库（打包进扩展，禁 CDN）
├── docs/
└── tests/
    └── fixtures/                  // 每平台样本页快照，用于选择器回归
```

要点：

- `extractors/<platform>/` 各自独立，**不互相 import**；新增平台 = 新增一个目录；
- 选择器规则以 `selectors.json`（数据）存放；v1 不做远端热更新；
- `shared/` 只放无平台假设的纯工具，跨抓取器复用。

---

## 附录 B：技术栈

| 层           | 选型             | 理由                                                                              |
| ------------ | ---------------- | --------------------------------------------------------------------------------- |
| **语言**     | TypeScript       | products / variants / images / Config 定义为类型；7 个抓取器 + 字段映射复用、防错 |
| **扩展框架** | WXT              | 专为浏览器扩展设计，原生支持 MV3、HMR、`manifest.json` 自动生成、多浏览器构建     |
| **构建**     | Vite（WXT 内置） | 快速 HMR 与打包                                                                   |
| **UI**       | React            | Popup / Options 表单                                                              |
| **样式**     | 原生 CSS         | 避免与宿主页面 CSS 冲突，无额外构建依赖                                           |
| **抓取器**   | 纯 TS 函数       | 无副作用，易单测、易回归                                                          |
| **测试**     | Vitest           | 商品抓取器对 `tests/fixtures/` 样本页快照做回归；logger / storage 单元测试        |
| **依赖**     | 全部打包进扩展   | MV3 禁远程代码，禁 CDN                                                            |

约定：

- 所有 schema（对齐 §6 三表）集中在 `src/shared/schema.ts`，抓取器与提交层共享同一类型源；
- 创建商品请求严格按 §6.1 组装（`platform/source_url/source_product_id` 外层 + `product{ 主体, variants[], images[] }`），POST 到 `create_product_endpoint`。
