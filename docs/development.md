# 开发环境搭建与运行

本文面向 Scheer 开发者，说明如何在本地搭建环境、运行扩展、配置后端接口并排查常见启动问题。

## 环境要求

- **Node.js**：18.x 或更高（推荐 LTS）。
- **包管理器**：pnpm 8+；如无，可用 `corepack enable` 启用。
- **浏览器**：Chrome 115+（MV3 完整支持）。
- **操作系统**：macOS、Linux、Windows 均可。

## 安装依赖

```bash
pnpm install
```

## 代码规范与格式化

项目使用 **Prettier** 统一代码格式，**ESLint** 检查 TypeScript 规范。

```bash
# 检查代码格式
pnpm format:check

# 自动格式化全部文件
pnpm format

# 检查 ESLint 规范
pnpm lint

# 自动修复 ESLint 可修复的问题
pnpm lint:fix

# 类型检查
pnpm type-check
```

提交前建议依次运行：

```bash
pnpm format:check && pnpm lint && pnpm type-check && pnpm test
```

## Git 提交钩子

项目已配置 `husky` + `lint-staged`，执行 `git commit` 时会自动：

1. `lint-staged`：对暂存区文件运行 `prettier --check` 和 `eslint`
2. `npm run type-check`：全仓库 TypeScript 类型检查
3. `npm run test`：运行全部单元测试

如果任一检查失败，提交会被阻止。首次克隆后运行 `pnpm install` 会自动通过 `prepare` 脚本安装 husky hooks。

如想跳过钩子（不推荐），可加上 `--no-verify`：

```bash
git commit -m "..." --no-verify
```

## 本地开发

```bash
pnpm dev
```

WXT 会启动开发服务器，自动生成 `manifest.json` 并输出到 `dist/chrome-mv3/`。开发模式下支持 HMR，修改 Popup / Options / Content Script 后通常无需重新加载扩展。

## 加载已解压扩展

1. 打开 Chrome，地址栏输入 `chrome://extensions/` 回车。
2. 开启右上角"开发者模式"。
3. 点击"加载已解压的扩展程序"。
4. 选择本项目生成的 `dist/chrome-mv3/` 目录。
5. 扩展图标出现在 Chrome 工具栏，点击可打开 Popup。

> 如果 `dist/chrome-mv3/` 目录不存在，先执行 `pnpm dev` 或 `pnpm build`。

## 配置 Options

首次加载后，必须配置后端接口：

1. 右键扩展图标 → 选项（Options）。
2. 填写：
   - **创建商品接口地址**：后端提供的 `create_product_endpoint`，例如 `https://api.example.com/v1/products`。
   - **后端密钥**：作为请求头 `Authorization: Bearer <secret>` 发送。
3. 点击"保存"。

配置会写入 `chrome.storage.local`，仅在当前浏览器本地保存。

## 验证流程

1. 打开一个受支持平台的商品详情页（例如 Shopify `/products/<handle>`）。
2. 点击扩展图标，Popup 应显示当前平台与可抓状态。
3. 点击"创建商品"，观察接口返回结果。

## 常见启动问题

### HMR 不生效

- Content Script 的 HMR 支持有限，修改后可能需要点击扩展卡片的"重新加载"。
- Service Worker 更新后，建议在 `chrome://extensions` 中点击"更新"按钮。

### Content Script 未注入

- 检查 WXT 生成的 `manifest.json` 中 `content_scripts.matches` 是否包含目标站点。
- 检查目标页 URL 是否符合 `docs/design.md` §5.1 的初筛规则。
- 打开目标页 DevTools → Console，查看是否有扩展输出的日志。

### 样式不生效

- Popup / Options 使用原生 CSS，各自入口的 `style.css` 独立加载。
- 共享变量在 `src/shared/styles/variables.css`，通过 `@import` 引入。

### 跨域 / 接口调用失败

- 后端接口域名需要在 `manifest.json` 的 `host_permissions` 或运行时通过 `optional_host_permissions` 申请。
- 如果返回 401/403，检查 Options 中的密钥是否正确、后端是否校验通过。

### MAIN world 数据读不到

- ShopLine / ShopBase 等依赖 `window.__PRELOAD_STATE__` 或 `window.__INITIAL_STATE__`，需要在 MAIN world 注入读取脚本。
- 确认 `chrome.scripting.executeScript({ world: 'MAIN' })` 已正确调用，且目标页没有 CSP 拦截内联脚本。
- 查看 `docs/debugging.md` 中 MAIN world 调试章节。

## 构建生产包

```bash
# 生产构建
pnpm build

# 打包为 zip
pnpm zip
```

产物位于 `dist/chrome-mv3/`，`pnpm zip` 会生成 `dist/scheer-0.1.0-chrome.zip`，可直接分发给客户。生产构建会禁用 HMR 并进行代码压缩。

## 固定 Extension ID（外部配置导入）

「外部配置导入」功能要求接入方配置稳定的 Extension ID。zip 分发 + 加载已解压扩展时，ID 默认由安装路径决定，换个目录就会变，因此需要通过 manifest `key` 固定。

一次性生成密钥对：

```bash
# 私钥：本地保存，绝不入库（.gitignore 已排除 *.pem）
openssl genrsa -out scheer-extension-key.pem 2048

# 公钥（base64 单行）：即 manifest key
openssl rsa -in scheer-extension-key.pem -pubout -outform DER | base64 | tr -d '\n'
```

把公钥输出写入 `.env.local`：

```bash
SCHEER_EXTENSION_KEY=<上一步的 base64 输出>
```

之后通过 `pnpm build` 构建的产物 manifest 会携带该 key，无论安装路径如何，Extension ID 都固定不变（`npm run build` 的包装脚本会加载 `.env.local`；直接跑 `wxt build` 时需自行导出该环境变量）。

注意：

- 一旦发布过带 key 的构建，后续版本必须使用同一把 key，否则用户安装后 ID 变化、接入方配置会失效。
- 未配置 `SCHEER_EXTENSION_KEY` 时按现状构建（开发环境 ID 随机，不影响本地联调以外的事项）。

## 外部配置导入（验收）

扩展暴露 `bridge.html` 供任意网站发起配置导入请求（协议见 `Chrome_Extension_Import_Integration_Guide.md`）。手工验收：

1. 加载开发版扩展，在 `chrome://extensions` 卡片上复制 Extension ID。
2. 启动 demo 页：`npx serve sdk`（或 `python3 -m http.server -d sdk 8000`）。
3. 打开 demo 页，填入 Extension ID 与待导入 JSON，点击"发起导入请求"。
4. 扩展应弹出确认窗口：核对来源 origin、字段变更（`server.secret`/`server.headers` 掩码）；确认后配置写入，取消则不生效。

## 上传产物到 S3 / OSS

扩展支持构建或打包后自动上传到 S3 兼容的对象存储（阿里云 OSS、AWS S3、MinIO 等）。

### 配置凭证

复制模板并填写真实值：

```bash
cp .env.example .env.local
```

关键变量：

| 变量                   | 说明                                 | 示例                                   |
| ---------------------- | ------------------------------------ | -------------------------------------- |
| `S3_ENDPOINT`          | 对象存储 endpoint                    | `https://oss-cn-hangzhou.aliyuncs.com` |
| `S3_REGION`            | 区域                                 | `cn-hangzhou`                          |
| `S3_BUCKET`            | Bucket 名称                          | `your-bucket`                          |
| `S3_ACCESS_KEY_ID`     | Access Key                           | -                                      |
| `S3_SECRET_ACCESS_KEY` | Secret Key                           | -                                      |
| `S3_PATH_PREFIX`       | 上传路径前缀，默认 `scheer`          | `scheer`                               |
| `S3_UPLOAD_DIR`        | 是否同时上传 `dist/chrome-mv3/` 目录 | `false`                                |
| `S3_FORCE_PATH_STYLE`  | 是否使用 path-style（MinIO 需要）    | `false`                                |

### 执行上传

```bash
# 先 zip 再上传
pnpm zip:upload

# 完整流程：build + zip + upload
pnpm build:upload

# 仅上传（dist 下已有 zip）
pnpm upload
```

上传后的 key 规则：

```
scheer/<version>/scheer-<version>-<git-hash>-<buildtime>-chrome.zip
```

若开启 `S3_UPLOAD_DIR=true`，还会上传：

```
scheer/<version>/chrome-mv3/...
```

### MinIO 私有部署

MinIO 默认使用 path-style，需设置：

```bash
S3_FORCE_PATH_STYLE=true
S3_ENDPOINT=http://localhost:9000
```

### 构建后自动上传并返回访问链接

设置 `S3_AUTO_UPLOAD=true` 后，执行 `pnpm build` 会在构建完成后自动 zip 并上传：

```bash
S3_AUTO_UPLOAD=true pnpm build
```

如需在构建日志中打印公开访问链接，同时配置 `S3_PUBLIC_URL`：

```bash
S3_AUTO_UPLOAD=true \
S3_PUBLIC_URL=https://cdn.example.com \
pnpm build
```

控制台输出示例：

```text
构建并上传完成：
  key: scheer/0.1.0/scheer-0.1.0-57d473b-20260705-120136-chrome.zip
  url: https://cdn.example.com/scheer/0.1.0/scheer-0.1.0-57d473b-20260705-120136-chrome.zip
```

`S3_PUBLIC_URL` 常见填写方式：

- 阿里云 OSS 自定义域名：`https://cdn.example.com`
- Cloudflare R2 默认公共 URL：`https://pub-<hash>.r2.dev`
- AWS S3 virtual-hosted：`https://your-bucket.s3.your-region.amazonaws.com`
- MinIO 自定义域名：`https://minio.example.com`

不配置 `S3_PUBLIC_URL` 时，脚本仍会正常上传，但只打印 object key。

## 构建时环境变量

### `VITE_SHOW_DEBUG_SETTINGS`

默认情况下，options 页不展示「Debug 日志」设置区，避免普通用户接触到调试开关。

如需在构建时启用该区块：

```bash
# 命令行传入
VITE_SHOW_DEBUG_SETTINGS=true pnpm build

# 或在项目根目录创建 .env.local
# VITE_SHOW_DEBUG_SETTINGS=true
```

## 核心模块

`src/shared/` 已包含以下基础模块：

- `schema.ts`：`Product` / `Variant` / `Image` / `Config` / `DebugLogEntry` / `DebugLogs` / `Logger` 等共享类型。
- `storage.ts`：基于 WXT `wxt/storage` 的 `chrome.storage.local` 读写封装，包括 `config`、`debug_logs`、`history`。
- `logger.ts`：统一 Logger，支持 Debug 模式过滤、本地持久化、敏感信息脱敏与截断。
- `messaging.ts`：跨上下文消息类型与封装。
- `platform.ts`：平台识别（URL 规则 + HTML 指纹，覆盖 Shopify / NewShop / ShopBase / ShopLine / XShopPy / ShopLazza / TikTok / WordPress / ShadowShop / Amazon / 1688）。

Debug 日志子系统的详细规范见 [`docs/debug-logging-design.md`](debug-logging-design.md)。

## 下一步

- 了解测试写法：[`docs/testing.md`](testing.md)
- 了解调试技巧：[`docs/debugging.md`](debugging.md)
- 了解 Debug 日志子系统设计：[`docs/debug-logging-design.md`](debug-logging-design.md)
- 了解如何新增平台：[`docs/contributing.md`](contributing.md)
