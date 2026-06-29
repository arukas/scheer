/**
 * 价格格式化工具
 *
 * 所有 extractor 最终都应输出固定两位小数字符串，如 "19.99"。
 * 输入可能是 number、string 或 null/undefined；无法解析时回退到 "0.00"。
 */

const NON_DIGIT_RE = /[^0-9.]/g;

function parseNumericPrice(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const cleaned = value.replace(NON_DIGIT_RE, '');
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

/**
 * 将任意价格输入格式化为两位小数字符串。
 */
export function formatPrice(value: unknown): string {
  return parseNumericPrice(value).toFixed(2);
}

/**
 * 格式化原价/对比价。
 * 原价（compare_at_price）必须大于等于销售价；若原始值小于销售价，则回退为与销售价一致。
 */
export function formatCompareAtPrice(value: unknown, price: number | string): string {
  const compare = parseNumericPrice(value);
  const numericPrice = typeof price === 'string' ? parseNumericPrice(price) : price;
  return (compare >= numericPrice ? compare : numericPrice).toFixed(2);
}
