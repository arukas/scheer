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

## 样本约定

当前不使用 `tests/fixtures/` 目录，测试样本直接内联在各抓取器的测试文件中（可参考 `tests/shared/extractors/xshoppy.test.ts` 的实际写法）：

- **接口响应**：在测试文件内以对象字面量定义样本（如 `sampleResponse`），断言时与转换结果逐字段比对。
- **网络请求**：`beforeEach` 中用 `vi.fn()` 替换 `global.fetch`，各用例以 `mockResolvedValueOnce` 返回内联样本构造的响应。
- **DOM 依赖**：用 `document.implementation.createHTMLDocument()` 构造文档并插入目标节点（如 `input.product-id`），作为参数传给抓取器。

### 样本来源

- 从真实商品页保存原始响应后内联进测试（注意脱敏：去掉 cookie、token、个人地址等）。
- 每个平台至少保留 1 个典型样本；结构异常（无规格、单 variant、懒加载图片多）的场景单独写用例。

## 抓取器测试示例

以 `src/shared/extractors/shopify.ts` 导出的 `extractShopifyProduct` 为例（完整代码见 `tests/shared/extractors/shopify.test.ts`）：

```ts
import { describe, it, expect, vi } from 'vitest';
import { extractShopifyProduct } from '@/shared/extractors/shopify';

const sampleResponse = {
  product: { id: 123456789, title: 'IPod Nano - 8GB' /* ... */ },
};

describe('shopify extractor', () => {
  it('converts Shopify .json API response to CreateProductPayload', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(sampleResponse),
      headers: { get: () => 'application/json' },
    });
    global.fetch = fetchMock;

    const payload = await extractShopifyProduct(
      'https://example.myshopify.com/products/ipod-nano-8gb'
    );

    expect(payload.platform).toBe('shopify');
    expect(payload.product.title).toBe('IPod Nano - 8GB');
  });
});
```

## MAIN world 桥的测试

`shared/main-world.ts` 负责与页面 MAIN world 通信。测试时不需要真实浏览器：

- 模拟 `window` 对象与 `postMessage` / `CustomEvent`。
- 模拟 `chrome.scripting.executeScript`。
- 断言数据回传路径正确、异常超时处理正确。

## 新增平台的测试流程

1. 在 `tests/shared/extractors/<platform>.test.ts` 中内联样本响应并编写回归断言。
2. 运行测试：

   ```bash
   pnpm test
   ```

3. 手动在真实商品页验证一次，确认内联样本与线上结构一致。

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
- 如果平台改版导致字段变化，先更新内联样本，再运行测试确认差异，最后提交 PR。

## 相关文档

- [`docs/design.md`](design.md)：字段映射与 schema 定义。
- [`docs/contributing.md`](contributing.md)：新增平台抓取器流程。
- [`docs/debugging.md`](debugging.md)：手动验证与抓包。
