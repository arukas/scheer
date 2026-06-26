/**
 * 安全的 fetch + JSON 解析工具
 *
 * 后端 / 平台接口可能返回空 body 或非 JSON，直接调用 res.json() 会抛出
 * "Unexpected end of JSON input"。这里先用 text() 读取，再尝试解析，
 * 失败时把响应片段一起抛出来，方便排查。
 */

import { createLogger } from './logger';

const log = createLogger('shared/fetch');

export async function fetchJson(url: string, options?: RequestInit): Promise<unknown> {
  log.debug('发送 fetch 请求', { url, method: options?.method ?? 'GET' });

  const res = await fetch(url, options);
  const text = await res.text();
  const preview = text.trim().slice(0, 256);

  log.debug('收到 fetch 响应', {
    url,
    status: res.status,
    statusText: res.statusText,
    contentType: res.headers.get('content-type'),
    bodyLength: text.length,
    preview,
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}${preview ? `: ${preview}` : '（空响应）'}`);
  }

  if (!text.trim()) {
    throw new Error('后端返回空响应体');
  }

  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`响应不是合法 JSON：${preview || '(empty)'}`, { cause: err });
  }
}
