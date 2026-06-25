/**
 * 跨上下文消息类型与类型安全封装
 *
 * 使用 chrome.runtime.sendMessage / onMessage 在 popup/options/content/background 之间通信。
 */

import type { CreateProductSuccessResponse } from './schema';
import type { PlatformKey } from './schema';

export type MessageType =
  | 'GET_PAGE_STATUS'
  | 'GET_PAGE_HTML'
  | 'GET_CONFIG'
  | 'SET_CONFIG'
  | 'GET_DEBUG_LOGS'
  | 'CLEAR_DEBUG_LOGS'
  | 'EXPORT_DEBUG_LOGS'
  | 'EXTRACT_PRODUCT'
  | 'CREATE_PRODUCT'
  | 'TEST_CONFIG';

export interface BaseMessage {
  type: MessageType;
}

export interface GetPageStatusMessage extends BaseMessage {
  type: 'GET_PAGE_STATUS';
}

export interface GetPageHtmlMessage extends BaseMessage {
  type: 'GET_PAGE_HTML';
}

export interface GetConfigMessage extends BaseMessage {
  type: 'GET_CONFIG';
}

export interface SetConfigMessage extends BaseMessage {
  type: 'SET_CONFIG';
  payload: { config: import('./schema').Config };
}

export interface GetDebugLogsMessage extends BaseMessage {
  type: 'GET_DEBUG_LOGS';
}

export interface ClearDebugLogsMessage extends BaseMessage {
  type: 'CLEAR_DEBUG_LOGS';
}

export interface ExportDebugLogsMessage extends BaseMessage {
  type: 'EXPORT_DEBUG_LOGS';
}

export interface ExtractProductMessage extends BaseMessage {
  type: 'EXTRACT_PRODUCT';
  payload: { platform: PlatformKey };
}

export interface CreateProductMessage extends BaseMessage {
  type: 'CREATE_PRODUCT';
}

export interface TestConfigMessage extends BaseMessage {
  type: 'TEST_CONFIG';
  payload: { config: import('./schema').Config };
}

export type ScheerMessage =
  | GetPageStatusMessage
  | GetPageHtmlMessage
  | GetConfigMessage
  | SetConfigMessage
  | GetDebugLogsMessage
  | ClearDebugLogsMessage
  | ExportDebugLogsMessage
  | ExtractProductMessage
  | CreateProductMessage
  | TestConfigMessage;

export type CreateProductResponse =
  | { success: true; data: CreateProductSuccessResponse }
  | { success: false; error: string };

export async function sendMessage<T = unknown>(message: ScheerMessage): Promise<T> {
  return chrome.runtime.sendMessage(message);
}

export function onMessage<T = unknown>(
  callback: (
    message: ScheerMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: T) => void
  ) => void | boolean | Promise<T>
): void {
  chrome.runtime.onMessage.addListener(callback);
}
