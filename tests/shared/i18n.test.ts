import { describe, expect, it } from 'vitest';
import zhCn from '../../public/_locales/zh_CN/messages.json';
import en from '../../public/_locales/en/messages.json';
import es from '../../public/_locales/es/messages.json';

describe('i18n messages', () => {
  it('keeps every locale in sync', () => {
    const expected = Object.keys(zhCn).sort();

    expect(Object.keys(en).sort()).toEqual(expected);
    expect(Object.keys(es).sort()).toEqual(expected);
    expect([zhCn, en, es].flatMap(Object.values).every(({ message }) => message.trim())).toBe(true);
  });
});
