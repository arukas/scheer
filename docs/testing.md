# 测试策略

本文说明 Scheer 的测试框架、fixture 组织方式、抓取器回归测试写法，以及 CI 建议。

## 测试框架

- **单元测试**：Vitest。
- **测试对象**：抓取器中的纯函数（平台识别、字段转换、数据清洗）。
- **不测试**：Chrome 扩展 API、真实网络请求、真实浏览器 DOM。这些通过手动测试或 e2e 工具覆盖。

## 为什么抓取器适合单元测试

每个平台抓取器的核心逻辑是：

```
原始数据（HTML / JSON / 注水对象） → 转换函数 → 通用 Product 对象
```

输入输出都是纯数据，天然适合用 Vitest 做快照回归。

## Fixture 约定

`tests/fixtures/` 按平台组织：

```
tests/fixtures/
├── shopify/
│   ├── product.json              # /products/<handle>.json 响应
│   └── expected-product.json     # 转换后的通用 Product
├── newshop/
│   ├── product.json
│   └── expected-product.json
├── shopbase/
│   ├── initial-state.json        # window.__INITIAL_STATE__ 片段
│   └── expected-product.json
├── shopline/
│   ├── preload-state.json        # window.__PRELOAD_STATE__.product 片段
│   └── expected-product.json
├── xshoppy/
│   ├── pop-detail.json           # /buyer/product/pop-detail 响应
│   └── expected-product.json
├── shoplazza/
│   ├── product.json              # /api/products/{id} 响应
│   ├── page.html                 # 商品页 HTML（用于长描述）
│   └── expected-product.json
└── tiktok/
    ├── modern-router-data.json   # #__MODERN_ROUTER_DATA__ 内容
    └── expected-product.json
```

### Fixture 来源

- 从真实商品页保存原始响应（注意脱敏：去掉 cookie、token、个人地址等）。
- 每个平台至少保留 1 个典型样本；结构异常（无规格、单 variant、懒加载图片多）的样本单独建文件。

## 抓取器测试示例

假设 `src/content/extractors/shopify/product.ts` 导出 `transformShopifyProduct`：

```ts
import { describe, it, expect } from 'vitest';
import { transformShopifyProduct } from '@/content/extractors/shopify/product';
import raw from '@tests/fixtures/shopify/product.json';
import expected from '@tests/fixtures/shopify/expected-product.json';

describe('shopify transformer', () => {
  it('matches expected product schema', () => {
    const result = transformShopifyProduct(raw.product);
    expect(result).toEqual(expected);
  });
});
```

## MAIN world 桥的测试

`shared/main-world.ts` 负责与页面 MAIN world 通信。测试时不需要真实浏览器：

- 模拟 `window` 对象与 `postMessage` / `CustomEvent`。
- 模拟 `chrome.scripting.executeScript`。
- 断言数据回传路径正确、异常超时处理正确。

## 新增平台的测试流程

1. 在 `tests/fixtures/<platform>/` 添加原始数据和 `expected-product.json`。
2. 编写 `transform<Platform>Product` 测试。
3. 运行测试，生成或更新快照：

   ```bash
   pnpm test
   pnpm test -- --update
   ```

4. 手动在真实商品页验证一次，确认 fixture 与线上结构一致。

## CI 建议

在 `.github/workflows/ci.yml` 或等价 CI 中配置：

```yaml
steps:
  - uses: actions/checkout@v4
  - uses: pnpm/action-setup@v3
  - run: pnpm install
  - run: pnpm lint
  - run: pnpm type-check
  - run: pnpm test
  - run: pnpm build
```

> 当前项目尚未配置 lint / type-check 脚本，后续按需添加；本文仅作为约定参考。

## 快照策略

- 抓取器输出使用 `toEqual` 精确匹配，避免快照过大导致 diff 难以 review。
- 如果平台改版导致字段变化，先更新 fixture，再运行测试确认差异，最后提交 PR。

## 相关文档

- [`docs/design.md`](design.md)：字段映射与 schema 定义。
- [`docs/contributing.md`](contributing.md)：新增平台抓取器流程。
- [`docs/debugging.md`](debugging.md)：手动验证与抓包。
