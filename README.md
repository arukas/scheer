# Scheer

[English](#overview) | [中文](#简介)

<!-- OVERVIEW -->

## Overview

Scheer is a privacy-first Chrome extension (Manifest V3) that helps you collect product information from popular e-commerce platforms and push it to your own backend service in a normalized schema. It runs entirely inside the user's browser, requires no code on the target site, and keeps credentials on the local machine only.

<a name="简介"></a>

## 简介

Scheer 是一款面向多平台商品采集的 Chrome 扩展（Manifest V3）。当用户浏览支持的平台商品页时，扩展会自动识别平台、提取商品信息，并一键推送到用户自有的后端服务。扩展完全运行在浏览器内，无需在被采集站点部署任何代码，所有凭据均保存在本地。

## 核心功能

- **一键采集商品**：浏览 Shopify、NewShop、ShopBase、ShopLine、XShopPy、ShopLazza、TikTok Shop 等商品页时，点击即可抓取并推送。
- **多平台归一化**：不同平台的字段、价格、规格、图片自动映射为统一商品 schema，降低后端对接成本。
- **零侵入**：不依赖目标站点代码，纯浏览器端采集。
- **推送自有后端**：通过标准 REST 接口将结构化商品数据发送到用户配置的接口。
- **本地历史与调试**：本地保存采集历史，支持导出脱敏调试日志，便于排查问题。
- **隐私优先**：后端密钥仅保存在 `chrome.storage.local`，不上传任何服务器。

## 支持平台

| 平台            | 商品采集 | 说明                                            |
| --------------- | :------: | ----------------------------------------------- |
| Shopify         |    ✅    | `/products/<handle>.json` 结构化数据            |
| NewShop / WShop |    ✅    | `/api/store/products/<handle>` 接口             |
| ShopBase        |    ✅    | `window.__INITIAL_STATE__` 页面注水数据         |
| ShopLine        |    ✅    | `window.__PRELOAD_STATE__.product` 页面注水数据 |
| XShopPy         | 🔍 识别  | 采集器待实现                                    |
| ShopLazza       |    ✅    | API + DOM 混合采集                              |
| TikTok Shop     |    ✅    | `__MODERN_ROUTER_DATA__` 页面内嵌 JSON          |
| Amazon          |    ✅    | 商品 DOM + `twister-js-init-dpx-data`           |
| WordPress       |    ✅    | JSON-LD Product 结构化数据                      |
| ShadowShop      |    ✅    | `window.__INITIAL_STATE__` 页面注水数据         |

> 评论采集、批量自动采集、列表页采集等将后续版本支持。

## 技术栈

| 层级     | 技术             | 说明                                                |
| -------- | ---------------- | --------------------------------------------------- |
| 语言     | TypeScript       | 类型约束商品 / 变体 / 图片结构                      |
| 扩展框架 | WXT              | 原生支持 MV3、HMR、自动 manifest 生成、多浏览器构建 |
| 构建     | Vite（WXT 内置） | 快速 HMR 与打包                                     |
| UI       | React            | Popup / Options 页面                                |
| 样式     | 原生 CSS         | 避免与宿主页面 CSS 冲突                             |
| 测试     | Vitest           | 抓取器回归、logger / storage 单元测试               |

## 快速开始

### 环境要求

- Node.js 18+
- pnpm 8+（或 npm / yarn）
- Chrome 115+

### 本地开发

```bash
# 安装依赖
pnpm install

# 启动开发服务器（WXT HMR）
pnpm dev
```

### 加载扩展到 Chrome

1. 打开 Chrome，进入 `chrome://extensions/`。
2. 开启右上角"开发者模式"。
3. 点击"加载已解压的扩展程序"。
4. 选择项目根目录下的 `.output/chrome-mv3/`（开发构建）或 `dist/chrome-mv3/`（生产构建）文件夹。
5. 扩展图标出现在工具栏，点击 Options 配置后端接口。

### 配置后端

在 Options 页填写：

- **后端域名**（`base`）：例如 `https://api.example.com`。
- **创建商品接口**（`create_product_endpoint`）：默认 `/scheer/products`，也支持完整 URL。
- **当前用户信息接口**（`current_user_endpoint`）：默认 `/scheer/me`，用于测试连接。
- **后端密钥**：作为 `Authorization: Bearer <secret>` 发送。

> 凭据以明文保存在本地 `chrome.storage.local` 中，不上传任何服务器。

### 构建

```bash
# 开发构建（输出到 .output/chrome-mv3/）
pnpm build

# 生产 zip 包
pnpm zip
```

生产产物输出到 `dist/chrome-mv3/`，zip 包输出到 `dist/scheer-<version>-chrome.zip`。

## 后端接口约定

Scheer 通过 HTTPS 向后端接口发送标准化的商品数据。后端只需要实现以下两个接口即可对接。

### 鉴权

所有请求均通过 `Authorization` 头部携带密钥：

```http
Authorization: Bearer <secret>
Content-Type: application/json
```

### 1. 创建商品接口

用于提交抓取到的商品数据。

- **方法**：默认 `POST`（可在配置中指定）
- **地址**：由 `base` + `create_product_endpoint` 拼接，或直接使用完整 URL
- **默认路径**：`/scheer/products`

#### 请求体

```jsonc
{
  "platform": "shopify", // 平台代码，见下方平台代码表
  "source_url": "https://example.com/products/sample", // 商品来源 URL
  "source_product_id": "123456", // 平台原始商品 ID（可选）
  "product": {
    "title": "Sample Product",
    "handle": "sample-product",
    "description_html": "<p>商品描述 HTML</p>",
    "vendor": "Vendor Name",
    "product_type": "Apparel",
    "tags": ["tag1", "tag2"],
    "published_scope": "global",
    "options": [
      {
        "name": "Color",
        "position": 1,
        "values": ["Black", "White"],
      },
    ],
    "variants": [
      {
        "source_variant_id": "987654",
        "position": 1,
        "title": "Black / M",
        "price": "99.00",
        "compare_at_price": "199.00",
        "sku": "ABC-001",
        "barcode": "123456789012",
        "options": [
          { "name": "Color", "value": "Black" },
          { "name": "Size", "value": "M" },
        ],
        "source_image_id": "111",
        "grams": 0,
        "weight": null,
        "weight_unit": null,
      },
    ],
    "images": [
      {
        "source_image_id": "111",
        "position": 1,
        "src": "https://cdn.example.com/image.jpg",
        "alt": "Product image",
        "type": "image", // "image" 或 "video"
      },
    ],
  },
}
```

#### 字段说明

| 字段                       | 类型       | 必填 | 说明                        |
| -------------------------- | ---------- | :--: | --------------------------- |
| `platform`                 | `string`   |  ✅  | 平台代码，见下表            |
| `source_url`               | `string`   |  ✅  | 被抓取商品页完整 URL        |
| `source_product_id`        | `string`   |  ❌  | 平台原始商品 ID，仅用于日志 |
| `product.title`            | `string`   |  ✅  | 商品标题                    |
| `product.handle`           | `string`   |  ❌  | 商品 handle / slug          |
| `product.description_html` | `string`   |  ❌  | 商品描述 HTML               |
| `product.vendor`           | `string`   |  ❌  | 品牌商 / 供应商             |
| `product.product_type`     | `string`   |  ❌  | 商品分类                    |
| `product.tags`             | `string[]` |  ❌  | 标签数组                    |
| `product.published_scope`  | `string`   |  ❌  | 发布范围                    |
| `product.options`          | `array`    |  ❌  | 规格维度定义                |
| `product.variants`         | `array`    |  ✅  | 商品变体列表                |
| `product.images`           | `array`    |  ✅  | 商品媒体列表                |

#### 变体（variant）字段

| 字段               | 类型             | 必填 | 说明                         |
| ------------------ | ---------------- | :--: | ---------------------------- |
| `position`         | `number`         |  ✅  | 与商品内唯一的变体排序       |
| `title`            | `string`         |  ✅  | 变体标题                     |
| `price`            | `string`         |  ✅  | 售价，decimal(8,2) 字符串    |
| `compare_at_price` | `string`         |  ❌  | 划线价                       |
| `sku`              | `string`         |  ❌  | SKU                          |
| `barcode`          | `string`         |  ❌  | 条码                         |
| `options`          | `array`          |  ✅  | 该变体在所有规格维度上的取值 |
| `source_image_id`  | `string`         |  ❌  | 关联图片的原始 ID            |
| `grams`            | `number`         |  ✅  | 重量（克），无重量时填 `0`   |
| `weight`           | `number \| null` |  ❌  | 重量数值                     |
| `weight_unit`      | `string \| null` |  ❌  | 重量单位                     |

#### 图片（image）字段

| 字段       | 类型                 | 必填 | 说明                        |
| ---------- | -------------------- | :--: | --------------------------- |
| `position` | `number`             |  ✅  | 与商品内唯一的图片排序      |
| `src`      | `string`             |  ✅  | 图片 URL，必须补全 `https:` |
| `alt`      | `string`             |  ❌  | 替代文本                    |
| `type`     | `"image" \| "video"` |  ❌  | 媒体类型，默认 `"image"`    |

#### 成功响应（HTTP 2xx）

后端创建商品成功后，必须返回以下 JSON 结构：

```jsonc
{
  "product_id": "backend-new-product-id", // 后端生成的新商品 ID
  "log_id": "log-entry-id", // 本次采集日志 ID
  "user": {
    "id": "current-user-id",
    "name": "Current User Name",
  },
  "message": "created", // 可选，人类可读信息
}
```

扩展会保存 `product_id` 与 `log_id` 到本地历史，并在 Popup 中展示 `user` 信息。

#### 失败响应（HTTP 4xx / 5xx）

失败时返回：

```jsonc
{
  "message": "错误原因描述",
}
```

扩展会将 `message` 展示给用户，并记录到本地历史。

### 2. 测试连接接口

用于 Options 页"测试连接"功能，验证鉴权与连通性。

- **方法**：`GET`
- **地址**：由 `base` + `current_user_endpoint` 拼接，或直接使用完整 URL
- **默认路径**：`/scheer/me`
- **响应**：任意合法 JSON 即可，扩展仅判断是否返回 2xx 与合法 JSON。

### 平台代码表

| 平台            | 提交代码     |
| --------------- | ------------ |
| Shopify         | `shopify`    |
| NewShop / WShop | `newshop`    |
| XShopPy         | `xshoppy`    |
| ShopLazza       | `shoplazza`  |
| ShopLine        | `shopline`   |
| ShopBase        | `shopbase`   |
| TikTok Shop     | `tiktok`     |
| Amazon          | `amazon`     |
| WordPress       | `wordpress`  |
| ShadowShop      | `shadowshop` |

> 旧后端可将 `newshop` 映射为 `wshop`。

## 项目目录

```
scheer/
├── entrypoints/          # WXT 入口
│   ├── background.ts     # Service Worker
│   ├── content.ts        # Content Script（平台识别 + 抓取器入口）
│   ├── popup/            # 弹窗 UI
│   └── options/          # 配置页 UI
├── src/
│   └── shared/           # 类型定义、storage、logger、messaging、platform、api
├── tests/                # Vitest 测试
├── docs/                 # 设计文档与开发指南
├── wxt.config.ts
├── package.json
├── tsconfig.json
└── README.md
```

## 文档索引

- [`docs/design.md`](docs/design.md)：产品目标、架构、数据模型、字段映射、MV3 约束、安全与分发。
- [`docs/development.md`](docs/development.md)：环境搭建、本地运行、扩展加载、常见问题。
- [`docs/testing.md`](docs/testing.md)：测试框架、fixture 约定、回归测试写法。
- [`docs/debugging.md`](docs/debugging.md)：Popup / Content Script / Service Worker / MAIN world 调试技巧。
- [`docs/contributing.md`](docs/contributing.md)：新增平台抓取器、字段映射 checklist、提交前自检。
- [`docs/platform-matrix.md`](docs/platform-matrix.md)：平台支持状态速查。

## 开发与测试

```bash
# 类型检查
pnpm type-check

# 运行测试
pnpm test

# 代码检查
pnpm lint

# 格式化
pnpm format
```

## 安全与合规

- 只保存后端提供的密钥，不保存账号密码；凭据明文存储在本地浏览器。
- 后端接口强制 HTTPS。
- 日志与错误信息会脱敏处理，不打印完整 body 与敏感头部。
- 不绕过任何网站风控、不做 RPA 自动翻页、不批量采集。

## 贡献

欢迎提交 Issue 与 PR。新增平台抓取器请参考 [`docs/contributing.md`](docs/contributing.md)。

## License

MIT License © Scheer Contributors
