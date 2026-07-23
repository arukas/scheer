# Amazon 商品采集器设计

> 状态：**评审通过，已实现**（评审点结论见 §11)
> 依赖:`src/shared/schema.ts`、`src/shared/price.ts`、`src/shared/platform.ts` 现有约定

## 1. 背景与结论

Amazon 商品页视觉上无规律，但 DOM 骨架与内嵌数据结构在桌面端高度稳定。本文档的规则基于以下真实页面样本交叉验证（2026-07 抓取，桌面 UA):

| 样本                      | ASIN                          | 类目     | 变体规模                         | 验证结果                                              |
| ------------------------- | ----------------------------- | -------- | -------------------------------- | ----------------------------------------------------- |
| Oura Ring 5               | B0GRK1N94H(parent B0H33QSLRB) | 电子     | 3 维（Style/Size/Color)× 49 变体 | 全部规则命中                                          |
| Crocs Classic Clog        | B0014C2NBC(parent B0FBS23TFH) | 鞋       | 2 维（Size/Color)× 781 变体      | 全部规则命中                                          |
| WD Blue HDD               | B0088PUEPK(parent B0GSSLV894) | 电脑配件 | 2 维（Size/Style)× 9 变体        | 全部规则命中                                          |
| Atomic Habits（书）       | 0735211299                    | 图书     | 无 dpx twister（走 tmmSwatches)  | 按单变体兜底                                          |
| Oura Ring 5(amazon.de)    | B0GRK1N94H                    | 电子     | 同上                             | 结构同美站；价格 `412,32USD`(USD 进口价，逗号小数）   |
| Oura Ring 5(amazon.co.jp) | B0GRK1N94H                    | 电子     | 同上                             | 结构同美站；价格 `USD414.85`（货币代码前缀）          |
| Atomic Habits(amazon.de)  | 0735211299                    | 图书     | tmmSwatches                      | corePrice 为空，价格在 `#tmm-grid-swatch-*` 内（§7.1) |

> 国际站与美站的 DOM 结构、`twister-js-init-dpx-data`、`colorImages` 完全一致，仅价格文本格式本地化——差异全部收敛在价格解析（§5.10)。

**反爬说明**:curl 等直接抓取会命中验证码页（`/errors/validateCaptcha`)。本采集器与现有 DOM 型采集器（shopbase/tiktok/shadowshop）一样，运行在 content script 中读取用户浏览器已渲染的 DOM，天然不受反爬影响。**不发起任何额外网络请求**。

## 2. 平台识别规则

### 2.1 URL 识别（`detectPlatformByUrl` 新增分支）

hostname 命中 **Amazon 域名白名单**（显式枚举各站点，含 `amazon.co.uk` / `amazon.com.au` 等双段后缀；正则无法把这类后缀与 `amazon.evil.com` 仿冒域名区分，故不用正则）:

```
amazon.com/.ca/.com.mx/.com.br/.co.uk/.de/.fr/.it/.es/.nl/.se/.pl/.com.be/.ie/.com.tr/.ae/.sa/.eg/.in/.co.jp/.sg/.com.au/.co.za/.cn
```

`www.amazon.com`、`smile.amazon.com`、`m.amazon.com` 等子域名以后缀匹配命中，返回 `'amazon'`。

### 2.2 采集范围（`isAllowedProductUrl` 调整）

Amazon host 下，路径满足以下之一即视为商品页：

- `/dp/<ASIN>`
- `/gp/product/<ASIN>`
- `/<slug>/dp/<ASIN>`（带 SEO slug 的完整形态）

ASIN 规则：`[A-Z0-9]{10}`（书籍为 10 位 ISBN，如 `0735211299`)。非 Amazon host 的既有规则（`/products/`、`/product/`）不变。

### 2.3 HTML 指纹兜底（`detectPlatformByHtml` 新增）

页面源码包含以下任一字符串时识别为 `'amazon'`（用于 background 的 SW 探测回退链）:

- `images-na.ssl-images-amazon.com`
- `m.media-amazon.com`
- `AmazonUI`

优先级：放在所有现有指纹**之后**，避免误判。

### 2.4 ASIN 提取（新增内部 helper)

按优先级回退：

1. twister 数据 `currentAsin`（见 §4)
2. URL 路径 `/dp/<ASIN>` 或 `/gp/product/<ASIN>` 捕获组
3. DOM `input#ASIN` 的 value

## 3. 页面数据入口总览

| 数据                       | 入口                                                                                              | 稳定性                            |
| -------------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------- |
| 标题/价格/品牌/描述/面包屑 | 固定 ID 的 DOM 节点（§5)                                                                          | 4/4 样本命中                      |
| 变体矩阵                   | 内联 script:`P.register('twister-js-init-dpx-data', function() { var dataToReturn = {...} })`(§4) | 3/3 有变体样本命中                |
| 图集                       | 内联 script 中 `'colorImages': { 'initial': [...] }`(§6)                                          | 4/4 样本命中                      |
| 页面状态 JSON              | `<script type="a-state" data-a-state='{"key":"..."}'>JSON</script>`                               | 通用机制，v1 仅用于移动端价格兜底 |

无 JSON-LD、无 og: meta,Amazon 不依赖开放结构化数据。

## 4. 变体矩阵解析算法（核心）

### 4.1 定位

遍历 `doc` 中所有 `<script>`，找到 `textContent` 同时包含 `twister-js-init-dpx-data` 与 `var dataToReturn` 的脚本；从 `var dataToReturn` 之后第一个 `{` 开始为数据对象起点。

### 4.2 为什么不能整体 JSON.parse

该对象是 JS 表达式而非严格 JSON：实测包含字符串拼接（如 `"ajaxUrlParams" : "..." + "&landingAsin=B0GRK1N94H"`)。**采用按键提取**：在脚本文本中定位 `"<key>"` → 冒号 → 值起点：

- 值以 `{` / `[` 开头 → **字符串感知的平衡括号扫描**（同 `shadowshop.ts` 已有技术）截取后 `JSON.parse`（子对象均为纯数据，实测可严格解析）;
- 值以 `"` 开头 → 直接取字符串字面量。

### 4.3 需要的键

| 键                           | 类型                      | 含义                                              | 示例                                        |
| ---------------------------- | ------------------------- | ------------------------------------------------- | ------------------------------------------- |
| `dimensions`                 | `string[]`                | 维度内部名，**定义顺序**                          | `["style_name","size_name","color_name"]`   |
| `variationDisplayLabels`     | `Record<string,string>`   | 维度内部名 → 显示名                               | `{"size_name":"Size","color_name":"Color"}` |
| `variationValues`            | `Record<string,string[]>` | 每个维度的可选值（按维度内部名）                  | `{"size_name":["6","7","8",...]}`           |
| `dimensionValuesDisplayData` | `Record<string,string[]>` | **ASIN → 展示值数组**（顺序与 `dimensions` 对齐） | `"B0GRK4F84K": ["Ring","7","Stealth"]`      |
| `dimensionToAsinMap`         | `Record<string,string>`   | 组合索引 → ASIN；索引为 `_` 分隔的各维度值下标    | `"0_2_4": "B0GRK1N94H"`                     |
| `currentAsin`                | `string`                  | 当前页面选中变体                                  | `"B0GRK1N94H"`                              |
| `parentAsin`                 | `string`                  | 父 ASIN（商品族）                                 | `"B0H33QSLRB"`                              |

> 组合索引语义：`"0_2_4"` 表示 `dimensions[0]` 取 `variationValues[dimensions[0]][0]`、`dimensions[1]` 取第 2 项、`dimensions[2]` 取第 4 项。校验示例：`0_2_4` → Ring / 8 / Silver，与页面标题 "Oura Ring 5 - Silver - Size 8" 一致。

### 4.4 一致性校验（失败即降级，不硬报错）

- `dimensionValuesDisplayData[asin]` 数组长度 ≠ `dimensions.length` → 跳过该变体并 `warn` 日志；
- `dimensions` / `dimensionValuesDisplayData` 任一缺失 → 视为无变体，走单变体兜底（§7.2)。

## 5. 字段转化规则（CreateProductPayload)

### 5.1 外层字段

| 字段                | 规则                                                                                                |
| ------------------- | --------------------------------------------------------------------------------------------------- |
| `platform`          | 固定 `'amazon'`                                                                                     |
| `source_url`        | 入参 `url` 原样透传（与现有采集器一致）                                                             |
| `source_product_id` | `parentAsin ?? currentAsin`。理由：同一父 ASIN 下切换颜色/尺码 URL 会变，但商品族不变，后端去重更稳 |

### 5.2 `product.title`

1. 取 `#productTitle` 文本，压缩空白字符；
2. **变体后缀清理【已定案：保守方案】**：当前变体的每个展示值 `v`（来自 `dimensionValuesDisplayData[currentAsin]`)，将标题按 `" - "` 切分后，**仅当某 segment 整体等于 `v`，或整体等于 `"<dimensionDisplayLabels[dim]> <v>"` 形态**（大小写不敏感、压缩空白）时删除该 segment（每个 `v` 最多删一个 segment)。
   - 示例：`"Oura Ring 5 - Silver - Size 8 - World's Smallest..."` × 当前值 `["Ring","8","Silver"]` → `"Oura Ring 5 - World's Smallest..."`(`Silver` 段整体匹配被删，`Size 8` 段匹配 `"Size" + "8"` 被删，`Ring` 因 `"Oura Ring 5"` 段含其它词不删——不会误伤正文词汇）
3. 移动端兜底：`#productTitle` 缺失时取 `#title`；
4. 仍为空 → 抛错（非商品页或验证码页，见 §7.4)。

### 5.3 `product.handle`

`source_product_id` 的小写形式（如 `b0h33qslrb`)。Amazon 无 slug 概念，ASIN 即稳定标识。

### 5.4 `product.vendor`

取 `#bylineInfo` 文本（剔除 style/script 子节点），按序匹配：

1. `Visit the <X> Store` → `X`
2. `Brand: <X>` → `X`
3. 其余非空文本原样（如书籍页 `by <Author>`)

`#bylineInfo` 为空时按 **Premium 品牌 logo 形态**兜底（实测：Oura 等 premium 品牌的 `#bylineInfo` 只剩注释，品牌渲染为 logo 图片）:

4. `#visitStoreDesktopUrl` 文本 → 走同样的模式匹配
5. `#brandLogoBylineLink img` 的 `title`（如 `Visit the OURA Store`)→ 模式匹配
6. 同节点 `alt` 短文本（≤60 字符）直接作品牌名
7. 全部落空 → `undefined`

### 5.5 `product.product_type`

取 `#wayfinding-breadcrumbs_feature_div` 面包屑**最后一级**链接文本（如 `Smart Rings`)；缺失 → `undefined`。

**【评审点 B】** 是否把面包屑全路径写入 `tags`（如 `["Electronics","Wearable Technology","Smart Rings"]`)?Amazon 无原生 tags 概念，默认不填。

### 5.6 `product.description_html`

按序拼接存在的部分：

1. `#feature-bullets` 内 `<ul>` 的 outerHTML（书/鞋类目无此节点，跳过）
2. `#productDescription` 内部 HTML

清洗规则（对齐 contributing checklist)：协议相对 URL `//` 补 `https:`；剔除 `data-src` 懒加载属性并把其值并入 `src`;**不收录 `#aplus`**（内容含大量脚本/视频/营销模块，噪声大）【评审点 C】。

两部分均缺失 → `undefined`。

### 5.7 `product.options`

仅当有 twister 数据时存在；`dimensions` 按下标展开：

```
name     = variationDisplayLabels[dim] ?? dim      // 显示名兜底内部名
position = idx + 1
values   = variationValues[dim] 按原顺序去重；缺失时从 dimensionValuesDisplayData 全量收集有序唯一值
```

无 twister → `options` 为 `[]`,variants 走 Default Title 兜底（与 shopbase 一致）。

### 5.8 `product.variants`

枚举来源：`dimensionValuesDisplayData` 全量 ASIN。

| 字段                     | 规则                                                                                                                                      |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `source_variant_id`      | 变体 ASIN                                                                                                                                 |
| `position`               | 按 `dimensionToAsinMap` 组合索引数值升序排序后的序号（从 1 开始）；索引段不足时按 ASIN 字典序补后                                         |
| `title`                  | 展示值数组 `join(' / ')`，如 `Ring / 8 / Silver`                                                                                          |
| `price`                  | **全部变体 = 当前页价格**（已定策略），解析规则见 §5.10                                                                                   |
| `compare_at_price`       | 全部变体 = 当前页划线价（若有），过 `formatCompareAtPrice`（低于售价自动回退为售价）；无划线价则不输出该字段                              |
| `sku`                    | 变体 ASIN（天然 SKU)                                                                                                                      |
| `barcode`                | **仅当前变体**：商品信息表的 UPC/EAN/GTIN/ISBN-13(§5.11)。条码是精确标识且页面只含当前变体的，不复制给其它变体                            |
| `options`                | 按 `dimensions` 顺序 `[{name: 显示名, value: 展示值}]`                                                                                    |
| `source_image_id`        | 按 swatch 维度取值关联（§5.9)：当前色取值 → `MAIN`；其余颜色取值 → `swatch:<值>`；无 swatch 维度（如容量×款式）或取值无 swatch 图时不输出 |
| `grams`                  | 商品信息表 "Item Weight" 换算（§5.11)；商品族级近似**全变体填充**（与价格同策略）；无数据 → `0`                                           |
| `weight` / `weight_unit` | Item Weight 原始数值与单位（`oz`/`lb`/`g`/`kg`)；无数据 → `null` / `'g'`                                                                  |

### 5.9 `product.images` 与变体图片关联

**主图集**：内联 script 中 `'colorImages': { 'initial': [...] }`（定位包含 `colorImages` 的 script，从 `'initial'` 后的 `[` 起平衡扫描，单引号 JS 对象转 JSON 解析——实测结构为纯数据）。该数组为**当前选中变体（颜色）的整套图**。

每张图：

| 字段              | 规则                                                            |
| ----------------- | --------------------------------------------------------------- |
| `src`             | 优先 `hiRes`(1500px 原图），缺失用 `large`，再过 `normalizeSrc` |
| `position`        | 数组顺序，从 1 开始                                             |
| `source_image_id` | 条目 `variant` 标签（`MAIN`/`PT01`…)                            |
| `alt`             | 商品标题                                                        |
| `type`            | 恒 `'image'`；视频在独立 video block,v1 跳过                    |

数组为空 → 回退 `#landingImage` 的 `src`；再空 → `images: []`。

**变体图片关联（swatch 升级大图，零网络请求）**:

1. 读取 `img[id^="inline-twister-image-"]`（兼容 `img.swatch-image`):`alt` 即维度展示值（如 `Silver`),`src` 为 64px 缩略图；修饰符 `._SS64_.jpg` → `._SL1500_.jpg` 升级为 1500px 大图（实测：修饰符是服务端变换，同 asset id 可取大图；`colorToAsin` 实测为空，不可用）
2. **选维度**：不假设维度名是 color，取 swatch 图覆盖变体取值最多的维度（尺码/容量等文本维度自然无覆盖）
3. **关联**：当前选中色的取值 → `MAIN`（主图集即该色整套图，不重复追加）；其余颜色取值 → 追加 `swatch:<值>` 图片到 `images[]`（按变体排序后首次出现的顺序）,`alt` 为 `<标题> (<值>)`
4. **诚实留空**：无 swatch 维度的商品（如 WD 硬盘）、以及取值没有 swatch 图的变体（如 Oura 的 Sizing Kit)，不输出 `source_image_id`
5. 单变体商品（无 twister)：图集即该变体本身，`source_image_id` 关联首张图（若有 `source_image_id`)

### 5.10 价格解析

- 售价：`#corePrice_feature_div` 内第一个 `.a-price .a-offscreen` 文本（如 `$399.00`);fallback 链：`#price_inside_buybox` → `#priceblock_ourprice` → `#priceblock_dealprice` → `#tmmSwatches` 选中态 swatch 内 `.a-offscreen`（书籍）→ 页面首个含数字的 `.a-price .a-offscreen`。
- 划线价：同区域内 `.a-price.a-text-price .a-offscreen`（如 `List: $499.00` 的 `$499.00`)；无则省略。
- 价格文本实测形态（国际站差异大，必须统一处理）:
  | 站点 | 实测文本 | 解析结果 |
  |---|---|---|
  | .com | `$399.00`、`$1,234.56` | 399.00 / 1234.56 |
  | .de | `412,32USD`、`20,32 USD`(含 `\xa0` 不换行空格）、`399,00 €` | 412.32 / 20.32 / 399.00 |
  | .co.jp | `USD414.85`、`￥39,900` | 414.85 / 39900.00 |
- **解析规则（amazon.ts 内置 `parseAmazonPrice`，替代通用 `formatPrice`)**:
  1. 剔除数字、小数点与逗号之外的字符，兼容任意货币符号、货币代码及空白；
  2. 同时含 `.` 与 `,` → 靠右者为小数分隔符，另一个视为分组符剔除（`1.234,56` → 1234.56;`1,234.56` → 1234.56);
  3. 仅含 `,` 且以 `,\d{1,2}` 结尾 → 逗号为小数点（`412,32` → 412.32)；否则逗号为分组符（`39,900` → 39900);
  4. 仅含 `.` → 点小数；
  5. 结果过 `formatPrice` 输出两位小数字符串。
- 国际站可能展示 USD 进口价（样本：DE 站显示 `412,32USD`)——只解析数值，币种不随站点假设，也不写入 payload(schema 无币种字段）。

### 5.11 商品信息表（重量与条码）

Amazon 的 "Product information" 区存在结构化字段，两种布局（实测均有）:

- **表格布局**:`<tr><th>Item Weight</th><td>3.8 Ounces</td></tr>`(prodDetails 及各类目变体）
- **列表布局**:`<li><span class="a-list-item">ISBN-13 ‏ : ‎ 978-0735211292</span></li>`(detailBullets，分隔符含 U+200F/U+200E 不可见字符，需先剔除）

合并读取为 label → value 映射（label 小写化、去尾冒号；同 label 先出现者优先）。标签本地化：英文 + 德语常用词（`Item Weight`/`Artikelgewicht`)，其余语种出现后按需补充。

**重量**（键：`item weight` / `artikelgewicht`):

- 值形如 `0.06 Kilograms` / `3.8 Ounces` / `440 Grams`；数值复用 `parseAmazonPrice`（兼容逗号小数）
- 单位映射：`ounce(s)/oz → oz(×28.3495)`、`pound(s)/lb(s) → lb(×453.59237)`、`gram(s)/g → g`、`kilogram(s)/kg → kg`
- `grams` = 换算后四舍五入整数；`weight`/`weight_unit` = 原始数值与归一化单位
- **填充策略：全变体**（商品族级近似，与价格策略一致；不同尺码的轻微重量差异无法从页面获知）

**条码**（键按序：`upc` → `ean` → `gtin` → `global trade identification number` → `isbn-13` → `isbn-10`):

- 去连字符/空白后须为 8-14 位数字，原样字符串输出
- **仅赋当前变体**:UPC/EAN 按变体分发，页面只含当前选中者的；复制给其它变体会产生错误标识，故宁缺毋滥（书籍 ISBN-13 同理，仅对应当前格式）
- 实测:Crocs `UPC 841158002436`(+ `Global Trade Identification Number 00841158002436`,GTIN-14 带前导零，优先取 UPC)、WD `UPC 718037779911`、书籍 `ISBN-13 978-0735211292`

## 6. 当前变体与选中态

- `currentAsin` 用于：标题清理（§5.2)、`source_product_id` 兜底（§5.1)、日志标记；
- 不变体级特殊化 position（不置顶）【评审点 E：是否把当前变体排 position 1，使主图/当前价语义更直观】。

## 7. 边界情况

### 7.1 书籍 / 媒体类目（tmmSwatches)

无 dpx twister，格式选择器（Kindle/精装/平装）为 `#tmmSwatches` 另一套结构。**v1 按无变体处理**（单变体 Default Title)+ `warn` 日志；格式矩阵留作未来工作（§8)。

实证（amazon.de 书籍页）:`#corePrice_feature_div` 的 `.a-offscreen` 为空文本，**各格式的价格直接写在 `#tmm-grid-swatch-<FORMAT>` 节点内**（如精装 `20,32 USD`)——因此 §5.10 的售价 fallback 链包含 tmm swatch，且未来做格式矩阵时无需额外请求即可拿到每格式价格（比 twister 更省事）。

### 7.2 无变体商品

无 twister script → 单变体：

```
title: 'Default Title', options: [{name:'Title', value:'Default Title'}],
sku: 当前 ASIN, price: 当前页价格, grams: 0
```

### 7.3 移动端页面（m 站 / 响应式 touch 版）

扩展使用场景为桌面浏览器，v1 以桌面规则为主。有限兜底：标题 `#title`；价格读 `<script type="a-state" data-a-state='{"key":"..."}'>…` 中 `buying-options-price-data` 的 `priceAmount`；变体 key 为 `mobile-twister-dim-list` / `mobile-twister-dim-val-list` / `mobile-twister-dims-to-asin-list`（索引 `:` 分隔）。**移动端支持标为尽力而为，不进测试基线**。

### 7.4 验证码 / 反爬页

`#productTitle` 缺失且存在 `form[action*="validateCaptcha"]` → 抛出明确错误：`Amazon 返回了人机验证页，请在浏览器中完成验证后重试`。

### 7.5 价格缺失

售价节点全部落空 → 抛错（价格是关键字段，不静默置 0)；`compare_at_price` 缺失属正常，省略即可。

## 8. 已知限制与未来工作（v1 不做）

1. **变体价格**：页面仅含当前选中变体价格，全量需逐个发 twister AJAX(49~781 次/商品）,v1 不请求，统一填当前价；
2. **分色整套图集**：每个颜色的完整图集（MAIN+PT01…）需逐个切换变体才有；v1 已通过 swatch 升级大图解决**每色主图**（§5.9)，整套图集留作未来工作；
3. **书籍格式矩阵**(`#tmmSwatches`);
4. **视频**收录（video block 独立结构）;
5. **非当前变体的条码**（页面只含当前变体的 UPC/EAN，其余变体留空）;
6. **非英语标签的商品信息表**（重量/条码标签已覆盖英/德，其它语种出现后按需补充）。

## 9. 改动清单

| 文件                                     | 改动                                                                                            |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `src/shared/schema.ts`                   | `PlatformKey` 增加 `'amazon'`                                                                   |
| `src/shared/platform.ts`                 | §2 全部：host 识别、`isAllowedProductUrl` 放行 `/dp/` 与 `/gp/product/`、HTML 指纹、ASIN helper |
| `src/shared/extractors/amazon.ts`        | 新增，`extractAmazonProduct(url, doc)`，纯 DOM 解析，无网络请求                                 |
| `src/shared/extract.ts`                  | switch 增加 `case 'amazon'`                                                                     |
| `tests/shared/extractors/amazon.test.ts` | 新增（§10)                                                                                      |
| `docs/platform-matrix.md`                | 平台矩阵补 Amazon 行                                                                            |

代码风格对齐现有采集器：`createLogger('shared/extractors/amazon')`、`unknown` 进、校验后转、不用 `any`。

## 10. 测试计划（vitest + jsdom，样本内联，同现有惯例)

1. **多变体全量解析**：内联裁剪后的 Oura 页面关键片段（twister script + colorImages script + corePrice + bylineInfo)→ 断言 49 个变体、options 3 维、当前价填充、`source_product_id = parentAsin`、title 清理结果；
2. **两维变体**(Crocs 形态裁剪）→ dimensions 顺序与 options 对齐；
3. **无 twister** → Default Title 单变体，sku = URL ASIN;
4. **标题清理**：含 `" - Silver - Size 8 - "` 的标题 → 清理后不含变体 segment（随评审点 A 的结论调整）;
5. **byline 三种形态**:`Visit the X Store` / `Brand: X` / 自由文本；
6. **划线价**:`.a-text-price` 存在/缺失两例，低于售价时回退；
7. **国际站价格**(`parseAmazonPrice` 单测）:`$1,234.56` / `412,32USD` / `20,32\xa0USD` / `399,00 €` / `USD414.85` / `￥39,900` / `1.234,56`;
8. **验证码页** → 抛指定错误信息；
9. **价格缺失** → 抛错；
10. **平台识别**:`amazon.com` / `amazon.co.uk` / `/dp/` 与 `/gp/product/` 路径、非 Amazon 不受影响（补进 `tests/shared/platform.test.ts`)。

## 11. 评审点汇总（已定案）

| #   | 议题                              | 结论                                                             |
| --- | --------------------------------- | ---------------------------------------------------------------- |
| A   | 标题中变体值的清理粒度            | **保守方案**:segment 整体等于 `v` 或 `"<label> <v>"` 才删（§5.2) |
| B   | 面包屑是否写入 `tags`             | 不写                                                             |
| C   | `#aplus` 是否进 description       | 不进                                                             |
| D   | ~~欧洲站逗号小数~~ **已实证解决** | amazon.ts 内置 `parseAmazonPrice`(§5.10,DE/JP 样本验证）         |
| E   | 当前变体是否排 position 1         | 不置顶，按组合索引升序                                           |

## 12. 字段对应关系审计（schema ↔ Amazon)

> 审计时间 2026-07，基于 7 个真实页面样本（美/德/日三站，电子/鞋/电脑/图书四类）。状态：✅ 已映射并验证；🟡 已映射但有明示限制；➖ Amazon 无此数据（按设计留空）。

### CreateProductPayload

| 字段                | 状态 | Amazon 来源                                     |
| ------------------- | ---- | ----------------------------------------------- |
| `platform`          | ✅   | 固定 `'amazon'`                                 |
| `source_url`        | ✅   | 入参原样                                        |
| `source_product_id` | ✅   | `parentAsin ?? currentAsin`（商品族级稳定标识） |

### Product

| 字段               | 状态 | Amazon 来源                                                             |
| ------------------ | ---- | ----------------------------------------------------------------------- |
| `title`            | ✅   | `#productTitle` + 变体后缀保守清理                                      |
| `handle`           | ✅   | `source_product_id` 小写                                                |
| `description_html` | 🟡   | `#feature-bullets` + `#productDescription`；不含 `#aplus`（定案 C)      |
| `vendor`           | ✅   | `#bylineInfo` 三模式 + premium logo 兜底（§5.4)；非英语 byline 原样透传 |
| `product_type`     | ✅   | `#wayfinding-breadcrumbs` 末级                                          |
| `tags`             | ➖   | Amazon 无 tags 概念（定案 B)                                            |
| `options`          | ✅   | twister `dimensions` + `variationDisplayLabels` + `variationValues`     |
| `published_scope`  | ➖   | Amazon 无此概念                                                         |
| `variants`         | ✅   | twister `dimensionValuesDisplayData` 全量                               |
| `images`           | ✅   | `colorImages.initial` + swatch 升级大图（§5.9)                          |

### ProductVariant

| 字段                     | 状态 | Amazon 来源                                            |
| ------------------------ | ---- | ------------------------------------------------------ |
| `source_variant_id`      | ✅   | 变体 ASIN                                              |
| `position`               | ✅   | 组合索引数值升序                                       |
| `title`                  | ✅   | 展示值 `join(' / ')`                                   |
| `price`                  | 🟡   | 当前页售价，**全变体同价**（定案策略，§5.10)           |
| `compare_at_price`       | 🟡   | 当前页划线价（仅促销时存在），全变体同                 |
| `sku`                    | ✅   | 变体 ASIN                                              |
| `barcode`                | 🟡   | 商品信息表 UPC/EAN/GTIN/ISBN-13,**仅当前变体**（§5.11) |
| `options`                | ✅   | 与 `product.options` 对齐                              |
| `source_image_id`        | 🟡   | swatch 维度关联（§5.9)；无 swatch 维度/取值时留空      |
| `grams`                  | 🟡   | Item Weight 换算，全变体近似（§5.11)；无数据 → 0       |
| `weight` / `weight_unit` | 🟡   | Item Weight 原值；无数据 → null / 'g'                  |

### ProductImage

| 字段              | 状态 | Amazon 来源                          |
| ----------------- | ---- | ------------------------------------ |
| `source_image_id` | ✅   | `MAIN`/`PT01..` 或 `swatch:<颜色值>` |
| `position`        | ✅   | 数组顺序                             |
| `src`             | ✅   | `hiRes` 优先，修饰符升级             |
| `alt`             | ✅   | 标题（swatch 图加颜色后缀）          |
| `type`            | 🟡   | 恒 `image`；视频已知未收录（§8.4)    |

🟡 汇总：5 处限制全部是**页面数据本身的边界**（变体价格/划线价/条码只含当前选中者、重量为族级近似、非当前色整套图集、视频），均需逐变体发请求才能突破，v1 明确不做（§8)。
