/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 构建时控制 options 页是否展示 Debug 日志设置区 */
  readonly VITE_SHOW_DEBUG_SETTINGS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
