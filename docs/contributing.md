# 贡献指南

本文说明如何为 Scheer 新增平台抓取器、修改字段映射，以及提交前需要完成的自检。

## 目录约定

每个平台一个独立单文件，抓取器之间不共享平台特定逻辑：

```
src/shared/extractors/
├── shopify.ts        # 采集编排 + 原始字段 → 通用 Product 转换
├── newshop.ts
├── shopbase.ts
├── shopline.ts
├── xshoppy.ts
├── shoplazza.ts
├── tiktok.ts
├── shadowshop.ts
├── amazon.ts
├── alibaba1688.ts
└── jsonld.ts         # JSON-LD 兜底采集器（WordPress 等）
```

> 选择器直接写在各抓取器 TS 文件内。公共工具（XHR 拦截、JSON-LD 解析、MAIN world 桥）放在 `src/shared/`，但不得包含任何平台假设。

## 新增平台的最小步骤

1. **确认数据入口**
   阅读 `docs/design.md` §2.2 与 §2.3，确定该平台属于：
   - API 请求（GET / POST）
   - SSR 注水对象（需 MAIN world）
   - DOM 内嵌 JSON script
   - 静态 DOM / JSON-LD
   - 多源合并

2. **创建抓取器文件**

   ```bash
   touch src/shared/extractors/<platform>.ts
   ```

3. **实现平台识别**
   在 `src/shared/platform.ts` 中登记新平台：
   - 在 `PlatformKey` 中加入平台 key（提交代码参考 `docs/design.md` §7.3）。
   - 按 URL 规则或 HTML 指纹扩展 `detectPlatform` / `detectPlatformByHtml`，注意指纹检测顺序。

4. **实现数据采集**
   按平台入口获取原始数据：
   - API：使用 `fetch`（同源，自动带 cookie）。
   - 注水对象：通过 MAIN world 桥读取。
   - DOM script：直接 `document.querySelector` + `JSON.parse`。
   - 多源：分别取数后在抓取器文件内合并。

5. **实现字段转换**
   在抓取器文件中编写 `extract<Platform>Product`，输出严格符合 `docs/design.md` §6.1 的通用 Product。
   - 使用 `src/shared/schema.ts` 中的类型。
   - 只提交 `docs/design.md` §7.1 白名单字段。
   - 注意 `variant.options`、图片 `type`、价格单位、HTML 清洗等细节。

6. **选择器规则**
   平台相关的 CSS 选择器、JSON 路径等直接写在抓取器 TS 文件内。

7. **添加测试**
   参考 `docs/testing.md`，在 `tests/shared/extractors/<platform>.test.ts` 中内联样本并编写回归测试。

8. **手动验证**
   在真实商品页运行扩展，确认：
   - 平台识别正确。
   - 数据能正常抓取。
   - 提交后端后返回成功。

## 字段映射 Checklist

新增或修改平台时，逐条核对：

- [ ] `product.title` 已映射且非空。
- [ ] `product.handle` 已映射。
- [ ] `product.description_html` 已清洗懒加载图片 / 相对协议 URL / data-src 等。
- [ ] `product.vendor`、`product_type`、`tags` 按参考项目处理。
- [ ] `product.options` 顺序正确，无规格时默认 `Title / Default Title`。
- [ ] `variants[].title` 非空。
- [ ] `variants[].options` 与 `product.options` 对齐，每个元素包含 `name` 和 `value`。
- [ ] `variants[].price` 为字符串，decimal(8,2) 格式。
- [ ] `variants[].compare_at_price` 为空或低于 price 时按规则置 0。
- [ ] `variants[].sku` 透传平台原始 SKU，无需额外切分。
- [ ] `variants[].image_id` 映射到 `images[].source_image_id`。
- [ ] `images[].src` 补全 `https:`，去掉 query / 裁剪后缀。
- [ ] `images[].type`：`"image"` 或 `"video"`。
- [ ] 外层 `platform / source_url / source_product_id` 正确。

## 代码风格

- TypeScript 严格模式。
- 优先使用纯函数，抓取器内部副作用（fetch / DOM 读取）集中在各抓取器的入口函数。
- 不使用 `any`，原始数据类型用 `unknown` 进入后做校验。
- 选择器规则直接写在抓取器 TS 文件内。

## 提交前自检

```bash
pnpm lint
pnpm type-check
pnpm test
pnpm build
```

> 当前项目若未配置上述脚本，可先手动运行 `pnpm vitest` 与 `pnpm tsc --noEmit`。

## 修改现有平台字段

1. 先更新对应平台测试文件（`tests/shared/extractors/<platform>.test.ts`）中的内联样本与期望断言。
2. 修改 `src/shared/extractors/<platform>.ts` 中的转换逻辑。
3. 运行测试，确认差异在预期范围内。
4. 在 PR 描述中说明字段变更原因与影响平台。

## 不要做的事

- 不要在一个抓取器中引用另一个抓取器的平台逻辑。
- 不要为选择器单独建 JSON 规则文件；选择器直接写在抓取器 TS 文件内。
- 不要向后端提交 `docs/design.md` §6.1 列出的"扩展不传"字段。
- 不要新增平台 API 调用而不更新文档与测试。

## 相关文档

- [`docs/design.md`](design.md)：数据入口、schema、字段映射。
- [`docs/testing.md`](testing.md)：fixture 与回归测试。
- [`docs/debugging.md`](debugging.md)：手动验证与抓包。
- [`docs/platform-matrix.md`](platform-matrix.md)：平台支持状态。
