/**
 * Amazon 商品抓取器（规则见 docs/amazon-extractor.md）
 *
 * 1. 基础字段：固定 ID 的 DOM 节点（#productTitle / #corePrice_feature_div / #bylineInfo 等）。
 * 2. 变体矩阵：内联 script `P.register('twister-js-init-dpx-data', ...)` 中的 dataToReturn 对象。
 *    该对象含 JS 字符串拼接，不能整体 JSON.parse，采用按键名定位 + 字符串感知平衡括号扫描。
 * 3. 图集：内联 script 中 `'colorImages': { 'initial': [...] }`，数组内容为严格 JSON。
 *
 * 纯 DOM 解析，不发起网络请求；移动端页面为有限兜底（尽力而为）。
 */

import type { CreateProductPayload, ProductImage, ProductOption, ProductVariant } from '../schema';
import { extractAmazonAsinFromUrl } from '../platform';
import { createLogger } from '../logger';
import { formatPrice, formatCompareAtPrice } from '../price';

const log = createLogger('shared/extractors/amazon');

const AMAZON_ASIN_RE = /^[A-Z0-9]{10}$/;

type RawObject = Record<string, unknown>;

interface TwisterData {
  dimensions: string[];
  variationDisplayLabels: Record<string, string>;
  variationValues: Record<string, string[]>;
  dimensionValuesDisplayData: Record<string, string[]>;
  dimensionToAsinMap: Record<string, string>;
  currentAsin?: string;
  parentAsin?: string;
}

interface VariantEntry {
  asin: string;
  values: string[];
}

// ============================================================================
// 基础工具
// ============================================================================

function parseJsonSafely(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function collapseWs(text: string): string {
  return text.replace(/[\s\xa0]+/g, ' ').trim();
}

function normalizeSrc(src: string): string {
  if (src.startsWith('http:') || src.startsWith('https:')) return src;
  if (src.startsWith('//')) return `https:${src}`;
  return src;
}

function toStringOrUndefined(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  return String(value);
}

/**
 * 字符串感知的平衡括号扫描。
 * 从 text[start]（须为 { 或 [）开始，返回括号配平的子串；失败返回 null。
 */
function scanBalanced(text: string, start: number): string | null {
  const stack: string[] = [];
  let inStr = false;
  let quote = '';
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) inStr = false;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inStr = true;
      quote = ch;
    } else if (ch === '{' || ch === '[') {
      stack.push(ch);
    } else if (ch === '}' || ch === ']') {
      const open = stack.pop();
      if (!open) return null;
      if (stack.length === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

// ============================================================================
// 价格解析（parseAmazonPrice，见 docs/amazon-extractor.md §5.10）
// ============================================================================

/**
 * 解析 Amazon 各站点价格文本，兼容：
 * - 任意货币符号/代码前后缀（$399.00 / ₹1,299.00 / AED 399.00）
 * - 不换行空格（20,32\xa0USD）
 * - 美式分组（$1,234.56）与欧式小数逗号（1.234,56 / 412,32）
 * 无法解析或数值 <= 0 时返回 null。
 */
export function parseAmazonPrice(raw: string | null | undefined): number | null {
  if (!raw) return null;
  let s = raw.replace(/[^\d.,]/g, '');
  if (!/\d/.test(s)) return null;

  const hasDot = s.includes('.');
  const hasComma = s.includes(',');
  if (hasDot && hasComma) {
    // 靠右者为小数分隔符，另一个为分组符
    if (s.lastIndexOf('.') > s.lastIndexOf(',')) {
      s = s.replace(/,/g, '');
    } else {
      s = s.replace(/\./g, '').replace(',', '.');
    }
  } else if (hasComma) {
    // 仅以 ,d 或 ,dd 结尾视为小数逗号，否则为分组符
    s = /,\d{1,2}$/.test(s) ? s.replace(',', '.') : s.replace(/,/g, '');
  }

  const num = Number(s);
  return Number.isFinite(num) && num > 0 ? num : null;
}

// ============================================================================
// twister 变体矩阵（docs/amazon-extractor.md §4）
// ============================================================================

/** 在 script 文本中按 `"key"` 定位并提取值（对象/数组平衡扫描，字符串字面量直取） */
function extractTwisterValue(scriptText: string, key: string): unknown {
  const keyIdx = scriptText.indexOf(`"${key}"`);
  if (keyIdx === -1) return undefined;

  let i = scriptText.indexOf(':', keyIdx);
  if (i === -1) return undefined;
  i += 1;
  while (i < scriptText.length && ' \n\t'.includes(scriptText[i])) i++;
  if (i >= scriptText.length) return undefined;

  const ch = scriptText[i];
  if (ch === '{' || ch === '[') {
    const blob = scanBalanced(scriptText, i);
    return blob ? parseJsonSafely(blob) : undefined;
  }
  if (ch === '"') {
    // 字符串字面量：escape 感知扫到收尾引号后 JSON.parse
    for (let j = i + 1; j < scriptText.length; j++) {
      if (scriptText[j] === '\\') {
        j++;
        continue;
      }
      if (scriptText[j] === '"') {
        return parseJsonSafely(scriptText.slice(i, j + 1));
      }
    }
  }
  return undefined;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(String);
}

function asStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as RawObject)) {
    if (typeof v === 'string' || typeof v === 'number') out[k] = String(v);
  }
  return out;
}

function asStringArrayRecord(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(value as RawObject)) {
    if (Array.isArray(v)) out[k] = v.map(String);
  }
  return out;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * 定位并解析 twister dpx 数据。
 * 形状校验失败（如键命中了嵌套同名键）时整体降级为 null，走单变体兜底。
 */
function parseTwister(doc: Document): TwisterData | null {
  let scriptText: string | null = null;
  for (const script of Array.from(doc.querySelectorAll('script'))) {
    const text = script.textContent ?? '';
    if (text.includes('twister-js-init-dpx-data') && text.includes('var dataToReturn')) {
      scriptText = text.slice(text.indexOf('var dataToReturn'));
      break;
    }
  }
  if (!scriptText) return null;

  const dimensions = asStringArray(extractTwisterValue(scriptText, 'dimensions'));
  const dimensionValuesDisplayData = asStringArrayRecord(
    extractTwisterValue(scriptText, 'dimensionValuesDisplayData')
  );

  // 形状校验：dimensions 非空且每个变体的展示值数量与维度数一致（至少存在一致者）
  const validCount = Object.values(dimensionValuesDisplayData).filter(
    (v) => v.length === dimensions.length
  ).length;
  if (dimensions.length === 0 || validCount === 0) {
    log.warn('twister 数据形状校验失败，按无变体处理', {
      dimensions,
      displayDataSize: Object.keys(dimensionValuesDisplayData).length,
    });
    return null;
  }

  return {
    dimensions,
    variationDisplayLabels: asStringRecord(
      extractTwisterValue(scriptText, 'variationDisplayLabels')
    ),
    variationValues: asStringArrayRecord(extractTwisterValue(scriptText, 'variationValues')),
    dimensionValuesDisplayData,
    dimensionToAsinMap: asStringRecord(extractTwisterValue(scriptText, 'dimensionToAsinMap')),
    currentAsin: optionalString(extractTwisterValue(scriptText, 'currentAsin')),
    parentAsin: optionalString(extractTwisterValue(scriptText, 'parentAsin')),
  };
}

// ============================================================================
// DOM 字段读取
// ============================================================================

function readAsinFromInput(doc: Document): string | undefined {
  const value = doc.querySelector<HTMLInputElement>('input#ASIN')?.value;
  return value && AMAZON_ASIN_RE.test(value) ? value : undefined;
}

/** 标题变体后缀清理（保守方案，docs/amazon-extractor.md §5.2） */
function removeVariantSegments(title: string, values: string[], twister: TwisterData): string {
  const norm = (s: string) => collapseWs(s).toLowerCase();
  const segments = title.split(' - ');
  const removeIdx = new Set<number>();

  values.forEach((value, dimIdx) => {
    const label = twister.variationDisplayLabels[twister.dimensions[dimIdx]];
    const targets = [norm(value)];
    if (label) targets.push(norm(`${label} ${value}`));
    const idx = segments.findIndex((s, i) => !removeIdx.has(i) && targets.includes(norm(s)));
    if (idx >= 0) removeIdx.add(idx);
  });

  if (removeIdx.size === 0) return title;
  return segments
    .filter((_, i) => !removeIdx.has(i))
    .join(' - ')
    .replace(/^[\s\-–]+|[\s\-–]+$/g, '');
}

function readTitle(doc: Document, twister: TwisterData | null): string {
  const el = doc.querySelector('#productTitle') ?? doc.querySelector('#title');
  let title = collapseWs(el?.textContent ?? '');
  if (!title) return '';

  if (twister?.currentAsin) {
    const values = twister.dimensionValuesDisplayData[twister.currentAsin];
    if (values) title = removeVariantSegments(title, values, twister);
  }
  return title;
}

/** 取节点文本（剔除 style/script 子节点，避免品牌 logo 的 CSS 混入） */
function textWithoutStyleScript(el: Element): string {
  const clone = el.cloneNode(true) as Element;
  for (const bad of Array.from(clone.querySelectorAll('style, script'))) {
    bad.remove();
  }
  return clone.textContent ?? '';
}

const VENDOR_PATTERNS = [/^visit the (.+?) store$/i, /^brand:\s*(.+)$/i];

function matchVendorPattern(text: string): string | undefined {
  for (const pattern of VENDOR_PATTERNS) {
    const m = pattern.exec(text);
    if (m) return m[1].trim();
  }
  return undefined;
}

function readVendor(doc: Document): string | undefined {
  // 常规形态：#bylineInfo 文本
  const byline = doc.querySelector('#bylineInfo');
  if (byline) {
    const text = collapseWs(textWithoutStyleScript(byline));
    if (text) {
      return matchVendorPattern(text) ?? text; // 无模式命中时原样透传（如书籍作者）
    }
  }

  // Premium 品牌形态：#bylineInfo 留空，品牌渲染为 logo 图片
  const candidates = [
    doc.querySelector('#visitStoreDesktopUrl')?.textContent,
    doc.querySelector('#brandLogoBylineLink img')?.getAttribute('title'),
    doc.querySelector('#brandLogoBylineLink img')?.getAttribute('alt'),
  ];
  for (const candidate of candidates) {
    const text = collapseWs(candidate ?? '');
    if (!text) continue;
    const matched = matchVendorPattern(text);
    if (matched) return matched;
    if (text.length <= 60) return text; // img alt 短文本直接作品牌名
  }
  return undefined;
}

function readProductType(doc: Document): string | undefined {
  const links = doc.querySelectorAll('#wayfinding-breadcrumbs_feature_div ul li a');
  for (let i = links.length - 1; i >= 0; i--) {
    const text = collapseWs(links[i].textContent ?? '');
    if (text) return text;
  }
  return undefined;
}

/** 清洗描述 HTML：懒加载 data-src 并入 src，协议相对 URL 补 https: */
function cleanHtml(doc: Document, html: string): string {
  const container = doc.createElement('div');
  container.innerHTML = html;

  for (const img of Array.from(container.querySelectorAll('img'))) {
    const dataSrc = img.getAttribute('data-src');
    const src = img.getAttribute('src');
    if (dataSrc && (!src || src.startsWith('data:'))) {
      img.setAttribute('src', dataSrc);
    }
    img.removeAttribute('data-src');
  }
  for (const el of Array.from(container.querySelectorAll('[src], [href]'))) {
    for (const attr of ['src', 'href'] as const) {
      const value = el.getAttribute(attr);
      if (value?.startsWith('//')) el.setAttribute(attr, `https:${value}`);
    }
  }
  return container.innerHTML;
}

function readDescription(doc: Document): string | undefined {
  const parts: string[] = [];
  const bullets = doc.querySelector('#feature-bullets ul');
  if (bullets) parts.push(bullets.outerHTML);
  const desc = doc.querySelector('#productDescription');
  if (desc) parts.push(desc.innerHTML);
  if (parts.length === 0) return undefined;
  return cleanHtml(doc, parts.join('\n'));
}

const PRICE_SELECTORS = [
  '#corePrice_feature_div .a-price .a-offscreen',
  '#corePrice_feature_div .a-offscreen',
  '#price_inside_buybox',
  '#priceblock_ourprice',
  '#priceblock_dealprice',
  '#tmmSwatches .a-offscreen',
  '.a-price .a-offscreen',
];

function findPrice(doc: Document): number | null {
  for (const selector of PRICE_SELECTORS) {
    for (const el of Array.from(doc.querySelectorAll(selector))) {
      const num = parseAmazonPrice(el.textContent);
      if (num !== null) return num;
    }
  }

  // 移动端兜底：div[class*="buying-options-price-data"] 的 JSON 文本
  const carrier = doc.querySelector('[class*="buying-options-price-data"]');
  const json = parseJsonSafely(carrier?.textContent ?? '');
  if (json && typeof json === 'object') {
    for (const group of Object.values(json as RawObject)) {
      const first = Array.isArray(group) ? group[0] : undefined;
      if (first && typeof first === 'object') {
        const amount = (first as RawObject).priceAmount;
        const num = typeof amount === 'number' ? amount : Number(amount);
        if (Number.isFinite(num) && num > 0) return num;
      }
    }
  }
  return null;
}

function findCompareAtPrice(doc: Document): number | null {
  const region = doc.querySelector('#corePrice_feature_div');
  if (!region) return null;
  for (const el of Array.from(region.querySelectorAll('.a-price.a-text-price .a-offscreen'))) {
    const num = parseAmazonPrice(el.textContent);
    if (num !== null) return num;
  }
  return null;
}

// ============================================================================
// 商品信息表（docs/amazon-extractor.md §5.11）
// 两种布局：prodDetails 表格 <tr><th>label</th><td>value</td></tr>，
// 与 detailBullets 列表 <li><span class="a-list-item">Label ‏ : ‎ value</span></li>。
// ============================================================================

/** 不可见格式字符（Amazon 分隔符里的 LRM U+200E / RLM U+200F / bidi U+202A-U+202E） */
const INVISIBLE_RE = /[‎‏‪-‮]/g;

function cleanLabelText(text: string): string {
  return collapseWs(text.replace(INVISIBLE_RE, ' ')).replace(/:+$/, '').trim().toLowerCase();
}

/** 读取全部 label → value 行（两种布局合并，先出现者优先） */
function readDetailRows(doc: Document): Map<string, string> {
  const rows = new Map<string, string>();
  const put = (label: string, value: string) => {
    if (label && value && !rows.has(label)) rows.set(label, value);
  };

  // 表格布局
  for (const tr of Array.from(doc.querySelectorAll('tr'))) {
    const th = tr.querySelector('th');
    const td = tr.querySelector('td');
    if (!th || !td) continue;
    put(cleanLabelText(th.textContent ?? ''), collapseWs(td.textContent ?? ''));
  }

  // detailBullets 列表布局："Label ‏ : ‎ value"
  const bulletSelector =
    '#detailBullets_feature_div li, #detailBulletsWrapper_feature_div li, #detailBullets li';
  for (const li of Array.from(doc.querySelectorAll(bulletSelector))) {
    const text = collapseWs((li.textContent ?? '').replace(INVISIBLE_RE, ' '));
    const idx = text.indexOf(':');
    if (idx <= 0) continue;
    put(cleanLabelText(text.slice(0, idx)), collapseWs(text.slice(idx + 1)));
  }

  return rows;
}

function findDetailValue(rows: Map<string, string>, labels: string[]): string | undefined {
  for (const label of labels) {
    const value = rows.get(label);
    if (value) return value;
  }
  return undefined;
}

const WEIGHT_LABELS = ['item weight', 'artikelgewicht'];
const BARCODE_LABELS = [
  'upc',
  'ean',
  'gtin',
  'global trade identification number',
  'isbn-13',
  'isbn-10',
];

const WEIGHT_UNITS: Record<string, { unit: string; factor: number }> = {
  ounce: { unit: 'oz', factor: 28.3495 },
  ounces: { unit: 'oz', factor: 28.3495 },
  oz: { unit: 'oz', factor: 28.3495 },
  pound: { unit: 'lb', factor: 453.59237 },
  pounds: { unit: 'lb', factor: 453.59237 },
  lb: { unit: 'lb', factor: 453.59237 },
  lbs: { unit: 'lb', factor: 453.59237 },
  gram: { unit: 'g', factor: 1 },
  grams: { unit: 'g', factor: 1 },
  g: { unit: 'g', factor: 1 },
  kilogram: { unit: 'kg', factor: 1000 },
  kilograms: { unit: 'kg', factor: 1000 },
  kg: { unit: 'kg', factor: 1000 },
};

interface ItemWeight {
  grams: number;
  weight: number;
  weight_unit: string;
}

/** 解析 "Item Weight" 行（如 "3.8 Ounces" / "0.06 Kilograms" / "440 Grams"） */
function parseItemWeight(text: string | undefined): ItemWeight | null {
  if (!text) return null;
  const m = /^([\d.,]+)\s*([a-zA-Z]+)/.exec(text.trim());
  if (!m) return null;
  const num = parseAmazonPrice(m[1]);
  if (num === null) return null;
  const unitInfo = WEIGHT_UNITS[m[2].toLowerCase()];
  if (!unitInfo) return null;
  return {
    grams: Math.round(num * unitInfo.factor),
    weight: num,
    weight_unit: unitInfo.unit,
  };
}

/** 条码：UPC/EAN/GTIN/ISBN，去连字符后须为 8-14 位数字 */
function parseBarcode(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const digits = text.replace(/[-\s]/g, '');
  return /^\d{8,14}$/.test(digits) ? digits : undefined;
}

// ============================================================================
// 图集与变体图片关联（docs/amazon-extractor.md §5.9）
// ============================================================================

function readColorImageEntries(doc: Document): RawObject[] {
  for (const script of Array.from(doc.querySelectorAll('script'))) {
    const text = script.textContent ?? '';
    const colorIdx = text.indexOf("'colorImages'");
    if (colorIdx === -1) continue;
    const initIdx = text.indexOf("'initial'", colorIdx);
    if (initIdx === -1) continue;
    const arrStart = text.indexOf('[', initIdx);
    if (arrStart === -1) continue;
    const blob = scanBalanced(text, arrStart);
    if (!blob) continue;

    // 实测数组内容为双引号严格 JSON；个别页面可能为单引号 JS 对象，做一次兜底转换
    let parsed = parseJsonSafely(blob);
    if (!Array.isArray(parsed)) {
      parsed = parseJsonSafely(blob.replace(/'/g, '"'));
    }
    if (Array.isArray(parsed)) {
      return parsed.filter((e): e is RawObject => e !== null && typeof e === 'object');
    }
  }
  return [];
}

/** Amazon 图片修饰符升级：._SS64_.jpg / ._AC_SR38,50_.jpg → ._SL1500_.jpg */
function upgradeToHiRes(src: string): string {
  return src.replace(/\._[^.]+_\.([a-z0-9]+)$/i, '._SL1500_.$1');
}

/**
 * 读取变体 swatch 图：alt 即维度展示值（如 "Silver"），src 为 64px 缩略图，
 * 升级修饰符后得到 1500px 大图（实测修饰符为服务端变换，同 asset 可取大图）。
 */
function readSwatchImages(doc: Document): Map<string, string> {
  const map = new Map<string, string>();
  const imgs = doc.querySelectorAll('img[id^="inline-twister-image-"], img.swatch-image');
  for (const img of Array.from(imgs)) {
    const alt = collapseWs(img.getAttribute('alt') ?? '');
    const src = img.getAttribute('src') ?? '';
    if (!alt || !src || map.has(alt)) continue;
    map.set(alt, normalizeSrc(upgradeToHiRes(src)));
  }
  return map;
}

/** 选出 swatch 图覆盖最多的维度（不假设维度名为 color）；无覆盖返回 -1 */
function pickSwatchDimension(
  twister: TwisterData,
  entries: VariantEntry[],
  swatchMap: Map<string, string>
): number {
  let bestIdx = -1;
  let bestCount = 0;
  twister.dimensions.forEach((_dim, idx) => {
    const used = new Set(entries.map((e) => e.values[idx]));
    let count = 0;
    for (const value of used) {
      if (swatchMap.has(value)) count++;
    }
    if (count > bestCount) {
      bestIdx = idx;
      bestCount = count;
    }
  });
  return bestCount > 0 ? bestIdx : -1;
}

interface ImagePlan {
  images: ProductImage[];
  /** 维度展示值 → images[].source_image_id（当前色指向 MAIN，其余指向各自 swatch 图） */
  imageIdByDimValue: Map<string, string>;
}

interface ImageContext {
  swatchDimIdx: number;
  entries: VariantEntry[];
  swatchMap: Map<string, string>;
  landingDimValue?: string;
}

function buildImages(doc: Document, title: string, ctx: ImageContext): ImagePlan {
  const images: ProductImage[] = [];

  // 当前选中变体的整套图集
  for (const entry of readColorImageEntries(doc)) {
    const src = toStringOrUndefined(entry.hiRes) ?? toStringOrUndefined(entry.large);
    if (!src) continue;
    images.push({
      source_image_id: toStringOrUndefined(entry.variant),
      position: images.length + 1,
      src: normalizeSrc(src),
      alt: title || undefined,
      type: 'image',
    });
  }

  if (images.length === 0) {
    const landingSrc = doc.querySelector('#landingImage')?.getAttribute('src');
    if (landingSrc) {
      images.push({
        position: 1,
        src: normalizeSrc(landingSrc),
        alt: title || undefined,
        type: 'image',
      });
    }
  }

  const imageIdByDimValue = new Map<string, string>();
  if (ctx.swatchDimIdx >= 0 && images.length > 0) {
    // 当前色：整套图集即其图集，关联 MAIN
    const mainId = images.find((i) => i.source_image_id === 'MAIN')?.source_image_id;
    if (ctx.landingDimValue && mainId) {
      imageIdByDimValue.set(ctx.landingDimValue, mainId);
    }

    // 其余颜色：追加 swatch 升级大图（按变体排序后首次出现的顺序）
    const seen = new Set<string>();
    for (const entry of ctx.entries) {
      const value = entry.values[ctx.swatchDimIdx];
      if (seen.has(value) || value === ctx.landingDimValue) continue;
      seen.add(value);
      const src = ctx.swatchMap.get(value);
      if (!src) continue;
      const id = `swatch:${value}`;
      imageIdByDimValue.set(value, id);
      images.push({
        source_image_id: id,
        position: images.length + 1,
        src,
        alt: title ? `${title} (${value})` : value,
        type: 'image',
      });
    }
  }

  return { images, imageIdByDimValue };
}

// ============================================================================
// options / variants 构建
// ============================================================================

function dimLabel(twister: TwisterData, dim: string): string {
  return twister.variationDisplayLabels[dim] ?? dim;
}

/** 组合索引 "0_2_4" → [0, 2, 4]，非法时返回 undefined */
function parseCombo(combo: string): number[] | undefined {
  const parts = combo.split('_').map(Number);
  return parts.length > 0 && parts.every((n) => Number.isInteger(n) && n >= 0) ? parts : undefined;
}

function compareVariantEntries(
  a: VariantEntry,
  b: VariantEntry,
  asinToCombo: Record<string, number[]>
): number {
  const comboA = asinToCombo[a.asin];
  const comboB = asinToCombo[b.asin];
  if (comboA && comboB) {
    for (let i = 0; i < Math.max(comboA.length, comboB.length); i++) {
      const diff = (comboA[i] ?? Infinity) - (comboB[i] ?? Infinity);
      if (diff !== 0) return diff;
    }
  } else if (comboA) {
    return -1;
  } else if (comboB) {
    return 1;
  }
  return a.asin < b.asin ? -1 : a.asin > b.asin ? 1 : 0;
}

/** 从 twister 数据展开变体列表（按组合索引数值升序），形状不符的变体跳过并告警 */
function buildVariantEntries(twister: TwisterData): VariantEntry[] {
  const asinToCombo: Record<string, number[]> = {};
  for (const [combo, asin] of Object.entries(twister.dimensionToAsinMap)) {
    if (asinToCombo[asin]) continue;
    const parts = parseCombo(combo);
    if (parts) asinToCombo[asin] = parts;
  }

  const entries: VariantEntry[] = [];
  for (const [asin, values] of Object.entries(twister.dimensionValuesDisplayData)) {
    if (values.length !== twister.dimensions.length) {
      log.warn('变体展示值数量与维度不一致，已跳过', { asin, values });
      continue;
    }
    entries.push({ asin, values });
  }
  entries.sort((a, b) => compareVariantEntries(a, b, asinToCombo));
  return entries;
}

function buildOptions(twister: TwisterData, entries: VariantEntry[]): ProductOption[] {
  return twister.dimensions.map((dim, idx) => {
    let values = twister.variationValues[dim];
    if (Array.isArray(values) && values.length > 0) {
      values = [...new Set(values.map(String))];
    } else {
      // variationValues 缺失时从变体展示值收集有序唯一值
      const collected: string[] = [];
      for (const entry of entries) {
        const v = entry.values[idx];
        if (v && !collected.includes(v)) collected.push(v);
      }
      values = collected;
    }
    return { name: dimLabel(twister, dim), position: idx + 1, values };
  });
}

interface PriceContext {
  price: string;
  compareAtPrice?: string;
}

function priceFields(priceCtx: PriceContext): { price: string; compare_at_price?: string } {
  return priceCtx.compareAtPrice !== undefined
    ? { price: priceCtx.price, compare_at_price: priceCtx.compareAtPrice }
    : { price: priceCtx.price };
}

function buildDefaultVariant(asin: string | undefined, priceCtx: PriceContext): ProductVariant {
  return {
    source_variant_id: asin,
    position: 1,
    title: 'Default Title',
    ...priceFields(priceCtx),
    sku: asin,
    options: [{ name: 'Title', value: 'Default Title' }],
    grams: 0,
    weight: null,
    weight_unit: 'g',
  };
}

// ============================================================================
// 主流程
// ============================================================================

export function extractAmazonProduct(url: string, doc?: Document): CreateProductPayload {
  if (!doc) {
    throw new Error('Amazon 采集需要页面 DOM（doc 参数缺失）');
  }

  // 验证码 / 反爬页
  if (!doc.querySelector('#productTitle') && doc.querySelector('form[action*="validateCaptcha"]')) {
    throw new Error('Amazon 返回了人机验证页，请在浏览器中完成验证后重试');
  }

  const twister = parseTwister(doc);
  if (!twister && doc.querySelector('#tmmSwatches')) {
    log.warn('检测到 tmmSwatches（书籍/媒体格式选择器），v1 按单变体处理');
  }

  const currentAsin =
    twister?.currentAsin ?? extractAmazonAsinFromUrl(url) ?? readAsinFromInput(doc) ?? undefined;

  const title = readTitle(doc, twister);
  if (!title) {
    throw new Error('未能从页面解析到商品标题（#productTitle 缺失）');
  }

  const priceNum = findPrice(doc);
  if (priceNum === null) {
    throw new Error('未能从页面解析到售价');
  }
  const priceCtx: PriceContext = { price: formatPrice(priceNum) };
  const compareNum = findCompareAtPrice(doc);
  if (compareNum !== null) {
    priceCtx.compareAtPrice = formatCompareAtPrice(compareNum, priceCtx.price);
  }

  // options / variants / 图片关联
  let options: ProductOption[] = [];
  let variants: ProductVariant[] = [];
  let imageCtx: ImageContext = { swatchDimIdx: -1, entries: [], swatchMap: new Map() };
  if (twister) {
    const entries = buildVariantEntries(twister);
    options = buildOptions(twister, entries);
    variants = entries.map((entry, idx) => ({
      source_variant_id: entry.asin,
      position: idx + 1,
      title: entry.values.join(' / '),
      ...priceFields(priceCtx),
      sku: entry.asin,
      options: twister.dimensions.map((dim, i) => ({
        name: dimLabel(twister, dim),
        value: entry.values[i],
      })),
      grams: 0,
      weight: null,
      weight_unit: 'g',
    }));

    // 变体图片关联：swatch 图覆盖最多的维度（通常为颜色）
    const swatchMap = readSwatchImages(doc);
    const swatchDimIdx = pickSwatchDimension(twister, entries, swatchMap);
    const landingDimValue =
      swatchDimIdx >= 0
        ? entries.find((e) => e.asin === currentAsin)?.values[swatchDimIdx]
        : undefined;
    imageCtx = { swatchDimIdx, entries, swatchMap, landingDimValue };
  }
  if (variants.length === 0) {
    variants = [buildDefaultVariant(currentAsin, priceCtx)];
    options = [];
  }

  // 商品信息表：重量为商品族级近似（与价格同策略，全变体填充）；
  // 条码是精确标识，页面只含当前变体的，仅赋给当前变体
  const detailRows = readDetailRows(doc);
  const itemWeight = parseItemWeight(findDetailValue(detailRows, WEIGHT_LABELS));
  const barcode = parseBarcode(findDetailValue(detailRows, BARCODE_LABELS));
  if (itemWeight) {
    for (const variant of variants) {
      variant.grams = itemWeight.grams;
      variant.weight = itemWeight.weight;
      variant.weight_unit = itemWeight.weight_unit;
    }
  }
  if (barcode) {
    const barcodeTarget =
      variants.length === 1
        ? variants[0]
        : variants.find((v) => v.source_variant_id === currentAsin);
    if (barcodeTarget) barcodeTarget.barcode = barcode;
  }

  const imagePlan = buildImages(doc, title, imageCtx);
  if (imageCtx.swatchDimIdx >= 0) {
    // 按变体在 swatch 维度上的取值关联图片（当前色 → MAIN，其余 → swatch 图）
    variants.forEach((variant, idx) => {
      const dimValue = imageCtx.entries[idx]?.values[imageCtx.swatchDimIdx];
      const imageId = dimValue ? imagePlan.imageIdByDimValue.get(dimValue) : undefined;
      if (imageId) variant.source_image_id = imageId;
    });
  } else if (variants.length === 1 && imagePlan.images[0]?.source_image_id) {
    // 单变体商品：图集即该变体本身
    variants[0].source_image_id = imagePlan.images[0].source_image_id;
  }

  const sourceProductId = twister?.parentAsin ?? currentAsin;

  return {
    platform: 'amazon',
    source_url: url,
    source_product_id: sourceProductId,
    product: {
      title,
      handle: sourceProductId?.toLowerCase(),
      description_html: readDescription(doc),
      vendor: readVendor(doc),
      product_type: readProductType(doc),
      tags: undefined,
      options,
      published_scope: undefined,
      variants,
      images: imagePlan.images,
    },
  };
}
