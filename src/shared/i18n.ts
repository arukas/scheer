export function t(key: string, substitutions?: string | string[]): string {
  return globalThis.chrome?.i18n?.getMessage(key, substitutions) || key;
}

export function localizeDocument(titleKey: string): void {
  document.documentElement.lang = chrome.i18n.getUILanguage();
  document.title = t(titleKey);
}
