/* global URL, console */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { translations } from './public/i18n.js';

const pages = await Promise.all(
  ['public/index.html', 'public/privacy/index.html'].map((file) =>
    readFile(new URL(file, import.meta.url), 'utf8')
  )
);
const keys = new Set(
  pages.flatMap((html) =>
    [...html.matchAll(/data-i18n(?:-aria-label)?="([^"]+)"/g)].map((match) => match[1])
  )
);
[
  'homeMetaTitle',
  'homeMetaDescription',
  'privacyMetaTitle',
  'privacyMetaDescription',
  'copied',
].forEach((key) => keys.add(key));

for (const [language, messages] of Object.entries(translations)) {
  assert.deepEqual(
    [...keys].filter((key) => !messages[key]).sort(),
    [],
    `${language} is missing translations`
  );
}

console.log(`i18n OK: ${keys.size} keys across ${Object.keys(translations).length + 1} languages`);
