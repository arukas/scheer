/**
 * Scheer 共享类型定义
 *
 * 本文件按 docs/design.md §6 与 docs/debug-logging-design.md 定义：
 * - 商品 / 变体 / 图片结构（用于创建商品请求）
 * - 用户配置（Config）
 * - 本地历史（HistoryItem）
 * - Debug 日志相关类型
 */

// ============================================================================
// 基础辅助类型
// ============================================================================

/** 支持的平台内部 key（与 docs/design.md §7.3 对齐） */
export type PlatformKey =
  | 'shopify'
  | 'newshop'
  | 'shopbase'
  | 'shopline'
  | 'xshoppy'
  | 'shoplazza'
  | 'tiktok';

/** 提交给后端时使用的平台代码（newshop 在后端可能对应 wshop） */
export type PlatformCode = PlatformKey | 'wshop';

// ============================================================================
// 商品相关类型（v1 商品采集，评论等待 v2）
// ============================================================================

/** 图片对象，对应后端 images 表 */
export interface ProductImage {
  /** 平台原始 image id，仅用于日志 / variant 映射 */
  source_image_id?: string;
  /** 与 product_id 唯一的 position */
  position: number;
  /** 图片 URL，必须补全 https: */
  src: string;
  alt?: string;
  /** 1=图片，2=视频 */
  categories?: 1 | 2;
}

/** 变体对象，对应后端 variants 表 */
export interface ProductVariant {
  /** 平台原始 variant id，仅用于日志 / 排查 */
  source_variant_id?: string;
  /** 与 product_id 唯一的 position */
  position: number;
  title: string;
  /** sku 第一个 '-' 前段；无 '-' 取整体；无 sku 存 '' */
  main_sku: string;
  option1: string;
  option2?: string | null;
  option3?: string | null;
  /** decimal(8,2) 字符串 */
  price: string;
  compare_at_price?: string;
  sku?: string;
  barcode?: string;
  /** 关联 images[].source_image_id */
  source_image_id?: string;
  grams: number;
  weight?: number | null;
  weight_unit?: string | null;
  taxable: 1 | 0;
  tax_code?: string | null;
  presentment_prices?: unknown[];
}

/** 商品规格维度定义 */
export interface ProductOption {
  name: string;
  position: number;
  values: string[];
}

/** 商品对象，对应后端 products 表 */
export interface Product {
  title: string;
  handle?: string;
  body_html?: string;
  vendor?: string;
  product_type?: string;
  tags?: string;
  options?: ProductOption[];
  published_scope?: string;
  variants: ProductVariant[];
  images: ProductImage[];
}

/** 创建商品请求体（docs/design.md §6.1） */
export interface CreateProductPayload {
  platform: PlatformCode;
  source_url: string;
  source_product_id?: string;
  product: Product;
}

/** 创建商品成功响应 */
export interface CreateProductSuccessResponse {
  product_id: string;
  log_id: string;
  user: { id: string; name: string };
  message?: string;
}

/** 创建商品失败响应 */
export interface CreateProductErrorResponse {
  message: string;
}

// ============================================================================
// 配置与历史
// ============================================================================

/** 远端服务配置 */
export interface ServerConfig {
  /** 后端域名，如 https://api.example.com */
  base: string;
  /** 创建商品接口；默认相对路径 /scheer/products，也支持完整 URL */
  create_product_endpoint: string;
  /** 获取当前用户信息接口；默认相对路径 /scheer/me，也支持完整 URL */
  current_user_endpoint: string;
  method?: 'POST';
  secret: string;
  timeout_ms?: number;
}

/** 采集行为配置（v1 固定字段，评论相关等待 v2） */
export interface CrawlConfig {
  product_mode: 'manual';
  extract_reviews: false;
  review_strategy?: 'visible';
  review_max_pages?: number;
  confirm_before_submit?: boolean;
}

/** Debug 子配置 */
export interface DebugConfig {
  /** Debug 模式总开关 */
  enabled: boolean;
  /** 是否把日志持久化到 chrome.storage.local */
  persist: boolean;
  /** 本地日志最大条数，默认 500 */
  maxEntries: number;
}

/** 用户配置，整体存 chrome.storage.local 的 config 键 */
export interface Config {
  server: ServerConfig;
  crawl: CrawlConfig;
  debug: DebugConfig;
  platforms?: Record<PlatformKey, boolean>;
  retry?: { max_attempts: number; backoff_base_ms: number; retryable_status: number[] };
  ui?: { notify_success: boolean; notify_failure: boolean };
  storage?: { keep_history_days: number; product_dedup_key: string; review_dedup_key?: string };
}

/** 默认配置 */
export const DEFAULT_CONFIG: Config = {
  server: {
    base: '',
    create_product_endpoint: '/scheer/products',
    current_user_endpoint: '/scheer/me',
    secret: '',
    timeout_ms: 30000,
  },
  crawl: {
    product_mode: 'manual',
    extract_reviews: false,
    confirm_before_submit: true,
  },
  debug: {
    enabled: false,
    persist: false,
    maxEntries: 500,
  },
};

/** 本地历史项 */
export interface HistoryItem {
  id: string;
  source_url: string;
  platform: PlatformKey;
  status: 'success' | 'failed';
  product_id?: string;
  log_id?: string;
  user?: { id: string; name: string };
  error?: { message: string };
  created_at: string;
  updated_at: string;
}

// ============================================================================
// Debug 日志类型
// ============================================================================

/** 日志级别 */
export type DebugLogLevel = 'debug' | 'info' | 'warn' | 'error';

/** 单条日志条目 */
export interface DebugLogEntry {
  /** ISO 8601 时间戳 */
  timestamp: string;
  /** 日志级别 */
  level: DebugLogLevel;
  /**
   * 上下文标识，建议格式：
   * - scraper/<platform>   如 scraper/shopify
   * - background/<module>  如 background/submit
   * - popup/<module>       如 popup/ui
   * - options/<module>     如 options/config
   * - shared/<module>      如 shared/storage
   */
  context: string;
  /** 日志消息 */
  message: string;
  /** 结构化附加信息，写入前会经过脱敏处理 */
  payload?: Record<string, unknown>;
}

/** 本地存储的 Debug 日志集合，存 chrome.storage.local 的 debug_logs 键 */
export interface DebugLogs {
  /** Debug 模式总开关，与 Config.debug.enabled 保持一致 */
  enabled: boolean;
  /** 是否持久化到 storage */
  persist: boolean;
  /** 最大保留条数 */
  maxEntries: number;
  /** 日志条目，按时间递增 */
  entries: DebugLogEntry[];
}

/** Debug 日志默认值 */
export const DEFAULT_DEBUG_LOGS: DebugLogs = {
  enabled: false,
  persist: false,
  maxEntries: 500,
  entries: [],
};

/** Logger 接口 */
export interface Logger {
  debug(message: string, payload?: unknown): void;
  info(message: string, payload?: unknown): void;
  warn(message: string, payload?: unknown): void;
  error(message: string, payload?: unknown): void;
}
