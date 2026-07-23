# 平台支持状态矩阵

本文档汇总 8 个目标平台的数据入口、实现状态与已知限制，供开发者快速查阅。

> 状态说明：
>
> - `已实现`：采集器与回归测试均已落地。
> - `仅识别`：可以识别平台，但采集器尚未实现。
> - `已验证`：已在真实商品页手动验证通过。

## 平台总览

| 平台        | 类型      | 数据入口                                 | MAIN world | 状态   | 备注                                |
| ----------- | --------- | ---------------------------------------- | ---------- | ------ | ----------------------------------- |
| Shopify     | SaaS 建站 | `/products/<handle>.json`                | 否         | 已实现 | 结构化接口采集                      |
| NewShop     | SaaS 建站 | URL 改写 `/api/store/products/<handle>`  | 否         | 已实现 | 结构化接口采集                      |
| ShopBase    | SaaS 建站 | `window.__INITIAL_STATE__`               | 是         | 已实现 | 读取页面注水数据                    |
| ShopLine    | SaaS 建站 | `window.__PRELOAD_STATE__.product`       | 是         | 已实现 | 失败时回退 JSON-LD                  |
| XShopPy     | SaaS 建站 | POST `/buyer/product/pop-detail`         | 否         | 仅识别 | 采集器待实现                        |
| ShopLazza   | SaaS 建站 | `/api/products/{id}` + DOM 详情          | 否         | 已实现 | API + DOM 混合采集                  |
| TikTok Shop | 社交电商  | `<script id="__MODERN_ROUTER_DATA__">`   | 否         | 已实现 | 区域限制 / captcha 会明确报错       |
| Amazon      | 综合电商  | `twister-js-init-dpx-data` + 固定 DOM ID | 否         | 已实现 | 规则详见 `docs/amazon-extractor.md` |

## 平台代码对照

提交给后端时使用的平台代码：

| 平台        | 扩展内部 key | 后端代码（参考 PHP） |
| ----------- | ------------ | -------------------- |
| Shopify     | `shopify`    | `shopify`            |
| NewShop     | `newshop`    | `wshop`              |
| ShopBase    | `shopbase`   | `shopbase`           |
| ShopLine    | `shopline`   | `shopline`           |
| XShopPy     | `xshoppy`    | `xshoppy`            |
| ShopLazza   | `shoplazza`  | `shoplazza`          |
| TikTok Shop | `tiktok`     | `tiktok`             |
| Amazon      | `amazon`     | `amazon`             |

> 发送层如需兼容旧 PHP，可将 `newshop` 转为 `wshop`。

## 数据入口详情

### Shopify

- **入口**：当前商品页 URL 追加 `.json`。
- **示例**：`https://example.com/products/sample-product.json`
- **返回**：Shopify 标准 Product JSON。
- **关键字段**：直接取 Product / Variant / Image 白名单。

### NewShop

- **入口**：URL 改写 `/products/<handle>` → `/api/store/products/<handle>`。
- **返回**：NewShop 私有 JSON。
- **注意**：
  - `handle = slug`
  - `description_html = post_content ?? content ?? ""`
  - 图片 `type` 由 `media_content_type` 判断，非 video 为 `"image"`，video 为 `"video"`

### ShopBase

- **入口**：`window.__INITIAL_STATE__`。
- **读取方式**：MAIN world 桥。
- **注意**：
  - `options[].values[].name` 转 values
  - variant 中 option value id 反查名称
  - `weight = 0`，`weight_unit = g`

### ShopLine

- **入口**：`window.__PRELOAD_STATE__.product`。
- **读取方式**：MAIN world 桥。
- **注意**：
  - 详情优先 DOM `.mce-content-body`，否则 `productSeo.desc`
  - `handle` 取 `productSeo.url` 最后一段
  - 价格 `price / originPrice` 需除以 100

### XShopPy

- **入口**：POST `/buyer/product/pop-detail`。
- **前置**：读 DOM `body > div.PageContainer.J-PageContainer > input.product-id`。
- **Body**：`{ "product_id": id }`，`Content-Type: application/json`。
- **注意**：
  - 详情 HTML 中 `data-original` → `src`
  - 无规格时默认 `Title / Default Title`

### ShopLazza

- **入口**：`/api/products/{id}` + DOM `.product-info__desc-tab-content`。
- **前置**：读 `<input type="hidden" name="product_id">`。
- **注意**：
  - API 图片 `src` 前补 `https:`
  - 详情 HTML 懒加载属性清洗
  - variant image 按 `https:` + `image.src` 映射

### TikTok Shop

- **入口**：`<script id="__MODERN_ROUTER_DATA__">`。
- **JSON 路径**：`loaderData` → `page_config.components_map` → `component_name === "product_info"` → `component_data.product_info.product_model`。
- **注意**：
  - 进入采集前去掉 URL query
  - `error_code === "23002002"` 或区域不可访问时按失败处理
  - `handle` 优先从 URL 取，纯数字时用 title slug

### Amazon

- **入口**：内联 script `P.register('twister-js-init-dpx-data', ...)`（变体矩阵）+ 固定 DOM ID（`#productTitle` / `#corePrice_feature_div` / `#bylineInfo` / `colorImages`）。
- **读取方式**：content script 直接读已渲染 DOM，无网络请求。
- **注意**：
  - twister 对象含 JS 字符串拼接，按键名定位 + 平衡括号扫描提取，不能整体 `JSON.parse`
  - 全部变体价格 = 当前页价格；`source_product_id` = parentAsin
  - 价格解析内置 `parseAmazonPrice`，兼容国际站逗号小数与货币代码
  - 书籍/媒体类目（`#tmmSwatches`）v1 按单变体处理
  - 详细规则与边界情况见 [`docs/amazon-extractor.md`](amazon-extractor.md)

## 评论采集（v2）

所有平台评论采集均不在 v1 范围，等待 v2 统一设计。

## 常见问题

### 某平台页面改版后抓取失败怎么办？

1. 确认数据入口是否仍然有效（API 是否 404、注水对象是否改名）。
2. 更新 `selectors.json` 或 `product.ts` 中的字段映射。
3. 更新 `tests/fixtures/<platform>/` 样本。
4. 运行回归测试，手动验证后提交 PR。

### 新增一个平台需要多少工作？

按经验，一个平台至少需要：

- 1 个数据入口调研（30 min ~ 2 h）
- 1 个抓取器目录 + 字段转换实现（2 ~ 6 h）
- 1 组 fixture + 测试（1 ~ 2 h）
- 真实商品页手动验证（1 ~ 2 h）

## 相关文档

- [`docs/design.md`](design.md)：完整数据入口、字段映射、架构设计。
- [`docs/contributing.md`](contributing.md)：新增平台的具体流程。
- [`docs/testing.md`](testing.md)：fixture 与回归测试。
