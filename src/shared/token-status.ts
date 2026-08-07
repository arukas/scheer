/**
 * Token 有效期解析与状态分类
 *
 * 后端可在「当前用户信息」接口（默认 /scheer/me）的响应中通过可选字段
 * token_expires_at（ISO 8601 字符串）上报当前配置的 token 的过期时间。
 * 字段缺失、为 null 或无法解析时，一律按永久有效处理。
 */

import type { TokenStatus } from './schema';

/** 剩余有效期少于该阈值（3 天）时，在 UI 上展示告警标识 */
export const TOKEN_EXPIRY_WARNING_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * 从当前用户信息接口的响应中解析 token_expires_at。
 * 仅接受可解析的日期字符串，并归一化为 ISO 8601；其它情况返回 null（视为永久有效）。
 */
export function extractTokenExpiresAt(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) return null;
  const raw = (data as Record<string, unknown>).token_expires_at;
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const time = Date.parse(raw);
  if (Number.isNaN(time)) return null;
  return new Date(time).toISOString();
}

/** Token 有效期的展示级别 */
export type TokenStatusLevel = 'permanent' | 'valid' | 'warning' | 'expired';

export interface TokenStatusView {
  level: TokenStatusLevel;
  /** 过期时间；永久有效时为 null */
  expiresAt: Date | null;
  /** 剩余整天数（永久有效时为 Infinity） */
  remainingDays: number;
  /** 剩余整小时数（永久有效时为 Infinity） */
  remainingHours: number;
}

/**
 * 把缓存的 TokenStatus 分类为 UI 展示状态：
 * - permanent：无过期时间
 * - expired：已超过过期时间
 * - warning：剩余不足 3 天
 * - valid：其余情况
 */
export function classifyTokenStatus(
  status: TokenStatus,
  now: number = Date.now()
): TokenStatusView {
  if (!status.expires_at) {
    return {
      level: 'permanent',
      expiresAt: null,
      remainingDays: Infinity,
      remainingHours: Infinity,
    };
  }

  const expiresAt = new Date(status.expires_at);
  const remainingMs = expiresAt.getTime() - now;
  if (remainingMs <= 0) {
    return { level: 'expired', expiresAt, remainingDays: 0, remainingHours: 0 };
  }

  return {
    level: remainingMs < TOKEN_EXPIRY_WARNING_MS ? 'warning' : 'valid',
    expiresAt,
    remainingDays: Math.floor(remainingMs / (24 * 60 * 60 * 1000)),
    remainingHours: Math.floor(remainingMs / (60 * 60 * 1000)),
  };
}
