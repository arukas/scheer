# Scheer

一个私有化分发的 Chrome 扩展（Manifest V3），用于在浏览商品页时一键采集商品信息，并按统一 schema 推送到用户自有的后端服务。

> 当前为设计阶段，代码尚未落地。详细产品方案见 [`docs/design.md`](docs/design.md)。

## 核心能力

- **人工辅助采集**：用户浏览商品页时，由扩展自动识别平台并判断可采集状态，用户点击后实时推送数据。
- **零侵入**：完全运行在用户浏览器内，无需在被采集站点部署任何代码。
- **多平台归一**：支持 Shopify、NewShop、ShopBase、ShopLine、XShopPy、ShopLazza、TikTok Shop，输出统一商品结构。
- **后端最小化**：后端只需提供创建商品接口，扩展只负责"抓 + 转 + 发"。

## 适用场景

- 外部客户需要从多个 SaaS 建站平台或 TikTok Shop 人工采集商品到自己的系统。
- 私有化部署，不上架 Chrome Web Store，通过加载已解压扩展分发。
- v1 仅采集商品信息；评论采集、自动批量采集等留待后续版本。

## 技术栈

| 层级     | 技术             | 说明                                                                      |
| -------- | ---------------- | ------------------------------------------------------------------------- |
| 语言     | TypeScript       | 类型约束商品 / 变体 / 图片结构，降低 7 个平台映射出错概率。               |
| 扩展框架 | WXT              | 专为浏览器扩展设计，原生支持 MV3、HMR、自动 manifest 生成、多浏览器构建。 |
| 构建     | Vite（WXT 内置） | 快速 HMR 与打包。                                                         |
| UI       | React            | Popup / Options 页面。                                                    |
| 样式     | 原生 CSS         | 避免与宿主页面 CSS 冲突，无 Tailwind 构建依赖。                           |
| 测试     | Vitest           | 抓取器对商品页快照做回归；logger / storage 单元测试。                     |
| 依赖     | 全部打包进扩展   | MV3 禁止远程代码与 CDN。                                                  |

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
4. 选择项目根目录下的 `dist/chrome-mv3/` 文件夹。
5. 扩展图标出现在工具栏，点击 Options 配置后端接口。

### 配置后端

在 Options 页填写：

- **创建商品接口地址**（`create_product_endpoint`）：例如 `https://api.example.com/v1/products`。
- **后端密钥**：作为 `Authorization: Bearer <secret>` 发送。

> 凭据以明文保存在本地 `chrome.storage.local` 中，不上传任何服务器。

### 构建

```bash
# 开发构建（输出到 .output/chrome-mv3/）
pnpm build

# 生产 zip 包
pnpm zip
```

产物输出到 `dist/chrome-mv3/`，zip 包输出到 `dist/scheer-0.1.0-chrome.zip`，可直接分发给客户。

## 项目目录

```
scheer/
├── entrypoints/          # WXT 入口
│   ├── background.ts     # Service Worker
│   ├── content.ts        # Content Script（平台识别 + 抓取器入口）
│   ├── popup/            # 弹窗 UI
│   │   ├── index.html
│   │   ├── popup.tsx
│   │   └── style.css
│   └── options/          # 配置页 UI
│       ├── index.html
│       ├── options.tsx
│       └── style.css
├── src/
│   └── shared/           # 类型定义、storage、logger、messaging、platform
│       ├── schema.ts
│       ├── storage.ts
│       ├── logger.ts
│       ├── messaging.ts
│       ├── platform.ts
│       └── styles/
│           └── variables.css
├── tests/                # 测试
│   └── shared/
│       ├── logger.test.ts
│       └── storage.test.ts
├── docs/
│   ├── design.md                # 产品/架构/数据模型详细设计
│   ├── development.md           # 开发环境搭建与运行
│   ├── testing.md               # 测试策略
│   ├── debugging.md             # 调试指南
│   ├── debug-logging-design.md  # Debug 日志子系统设计规范
│   ├── contributing.md          # 如何新增平台 / 修改字段
│   └── platform-matrix.md       # 平台支持状态速查
├── wxt.config.ts
├── package.json
├── tsconfig.json
└── README.md
```

## 文档索引

- [`docs/design.md`](docs/design.md)：产品目标、架构、数据模型、字段映射、MV3 约束、安全与分发。
- [`docs/debug-logging-design.md`](docs/debug-logging-design.md)：Debug 日志子系统的接口、数据模型、脱敏规则与 AI 协作约定。
- [`docs/development.md`](docs/development.md)：环境搭建、本地运行、扩展加载、常见问题。
- [`docs/testing.md`](docs/testing.md)：测试框架、fixture 约定、回归测试写法。
- [`docs/debugging.md`](docs/debugging.md)：Popup / Content Script / Service Worker / MAIN world 调试技巧。
- [`docs/contributing.md`](docs/contributing.md)：新增平台抓取器、字段映射 checklist、提交前自检。
- [`docs/platform-matrix.md`](docs/platform-matrix.md)：7 个平台数据入口与实现状态一览。

## 安全与合规

- 不上架 Chrome Web Store，通过私有渠道分发。
- 只保存后端提供的密钥，不保存账号密码；凭据明文存储在本地浏览器。
- 后端接口强制 HTTPS。
- 不绕过任何网站风控、不做 RPA 自动翻页、不批量采集。

## 状态

- `docs/design.md` v0.2 已完成并进入待评审状态。
- 代码实现与测试文档正在按设计稿准备中。

## License

私有项目，未经授权不得对外分发。
