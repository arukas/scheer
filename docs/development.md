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

## 核心模块

`src/shared/` 已包含以下基础模块：

- `schema.ts`：`Product` / `Variant` / `Image` / `Config` / `DebugLogEntry` / `DebugLogs` / `Logger` 等共享类型。
- `storage.ts`：基于 WXT `wxt/storage` 的 `chrome.storage.local` 读写封装，包括 `config`、`debug_logs`、`history`。
- `logger.ts`：统一 Logger，支持 Debug 模式过滤、本地持久化、敏感信息脱敏与截断。
- `messaging.ts`：跨上下文消息类型与封装。
- `platform.ts`：轻量平台识别（占位实现，后续由 7 个抓取器补齐）。

Debug 日志子系统的详细规范见 [`docs/debug-logging-design.md`](debug-logging-design.md)。

## 下一步

- 了解测试写法：[`docs/testing.md`](testing.md)
- 了解调试技巧：[`docs/debugging.md`](debugging.md)
- 了解 Debug 日志子系统设计：[`docs/debug-logging-design.md`](debug-logging-design.md)
- 了解如何新增平台：[`docs/contributing.md`](contributing.md)
