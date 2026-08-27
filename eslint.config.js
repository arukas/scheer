import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    ignores: ['dist/**', '.output/**', '.wxt/**', 'node_modules/**'],
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    // sdk/ 是面向接入方的浏览器端纯 JS，不走 TS 编译
    files: ['sdk/**/*.js'],
    languageOptions: {
      globals: {
        window: 'readonly',
        document: 'readonly',
        crypto: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
      },
    },
  }
);
