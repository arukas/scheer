# 通用商品模型（Product Model）

本文档定义 Scheer 扩展向后端提交商品数据时使用的标准 JSON 结构。

所有平台抓取器（Shopify、ShopLine、JSON-LD 等）都必须把原始数据转换成这个通用模型。

## 根对象：`CreateProductPayload`

```ts
{
  platform: string;           // 平台代码，必填
  source_url: string;         // 原商品页 URL，必填
  source_product_id?: string; // 平台原始商品 ID
  product: Product;           // 商品主体，必填
}
```

### `platform` 取值

当前已支持的平台代码：

- `shopify`
- `shopline`
- `newshop`
- `jsonld`（兜底抓取）

## 商品主体：`Product`

```ts
{
  title: string;                         // 商品标题，必填
  handle?: string;                       // URL handle
  description_html?: string;             // 商品详情 HTML
  vendor?: string;                       // 品牌 / 供应商
  product_type?: string;                 // 商品类型
  tags?: string[];                       // 标签数组
  options?: ProductOption[];             // 规格维度定义
  published_scope?: string;              // 发布范围，如 "global"
  variants: ProductVariant[];            // 商品变体，必填
  images: ProductImage[];                // 商品媒体，必填
}
```

### `ProductOption` 规格维度

```ts
{
  name: string;      // 规格维度名，如 "Color" / "Size"
  position: number;  // 顺序，从 1 开始
  values: string[];  // 该维度所有可选值
}
```

### `ProductVariant` 变体

```ts
{
  source_variant_id?: string;    // 平台原始 variant ID
  position: number;              // 顺序，必填，从 1 开始
  title: string;                 // 变体标题，必填
  price: string;                 // 售价，decimal(8,2) 字符串，必填
  compare_at_price?: string;     // 划线价
  sku?: string;                  // 完整 SKU
  barcode?: string;              // 条形码
  options: VariantOption[];      // 该变体在各维度上的取值，必填
  source_image_id?: string;      // 关联主图的 source_image_id
  grams: number;                 // 克重，必填
  weight?: number | null;        // 重量数值
  weight_unit?: string | null;   // 重量单位，如 "kg"
}
```

### `VariantOption` 变体上的具体选项值

```ts
{
  name: string; // 规格维度名，必须与 ProductOption.name 对齐
  value: string; // 该变体在此维度上的取值
}
```

### `ProductImage` 图片 / 视频

```ts
{
  source_image_id?: string;              // 平台原始媒体 ID
  position: number;                      // 顺序，必填，从 1 开始
  src: string;                           // 媒体 URL，必填，必须补全 https:
  alt?: string;                          // 替代文本
  type?: 'image' | 'video';              // 媒体类型
}
```

## 通用约定

### 1. 无规格商品

如果商品没有任何规格维度，`product.options` 为空或不存在，`variant.options` 统一为：

```json
[{ "name": "Title", "value": "Default Title" }]
```

### 2. `variant.options` 对齐规则

- `VariantOption.name` 必须与 `ProductOption.name` 一一对应。
- `VariantOption.value` 必须来自对应 `ProductOption.values`。
- 顺序与 `ProductOption` 的 `position` 一致。

### 3. 图片与变体关联

`variant.source_image_id` 对应某张 `image.source_image_id`。

### 4. 价格格式

所有价格都是字符串，保留两位小数：

```json
"price": "19.99"
```

### 5. 已移除字段

以下字段已弃用，不再提交：

- `variant.main_sku`
- `variant.option1` / `variant.option2` / `variant.option3`
- `variant.taxable`
- `variant.tax_code`
- `variant.presentment_prices`
- `image.categories`（改为 `image.type`）
- `product.body_html`（改为 `product.description_html`）

## 完整示例

```json
{
  "platform": "shopify",
  "source_url": "https://example.com/products/sample-product",
  "source_product_id": "123456789",
  "product": {
    "title": "Sample Product",
    "handle": "sample-product",
    "description_html": "<p>Product description.</p>",
    "vendor": "Example Brand",
    "product_type": "Apparel",
    "tags": ["new", "summer"],
    "published_scope": "global",
    "options": [
      {
        "name": "Color",
        "position": 1,
        "values": ["Black", "White"]
      },
      {
        "name": "Size",
        "position": 2,
        "values": ["S", "M", "L"]
      }
    ],
    "variants": [
      {
        "source_variant_id": "987654321",
        "position": 1,
        "title": "Black / M",
        "price": "29.99",
        "compare_at_price": "39.99",
        "sku": "SMP-BLK-M",
        "barcode": "123456789012",
        "options": [
          { "name": "Color", "value": "Black" },
          { "name": "Size", "value": "M" }
        ],
        "source_image_id": "111",
        "grams": 200,
        "weight": 0.2,
        "weight_unit": "kg"
      }
    ],
    "images": [
      {
        "source_image_id": "111",
        "position": 1,
        "src": "https://cdn.example.com/image1.jpg",
        "alt": "Product image",
        "type": "image"
      }
    ]
  }
}
```

## 各平台转换状态

| 平台      | 实现文件                            | 状态      |
| --------- | ----------------------------------- | --------- |
| Shopify   | `src/shared/extractors/shopify.ts`  | ✅ 已兼容 |
| ShopLine  | `src/shared/extractors/shopline.ts` | ✅ 已兼容 |
| JSON-LD   | `src/shared/extractors/jsonld.ts`   | ✅ 已兼容 |
| NewShop   | `src/shared/extractors/newshop.ts`  | ✅ 已兼容 |
| WordPress | 仅识别，采集器待实现                | 识别项    |
| ShopBase  | 未实现                              | 设计中    |
| XShopPy   | 未实现                              | 设计中    |
| ShopLazza | 未实现                              | 设计中    |
| TikTok    | 未实现                              | 设计中    |
