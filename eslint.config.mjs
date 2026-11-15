import { defineConfig } from 'eslint/config'
import tseslint from '@electron-toolkit/eslint-config-ts'
import eslintConfigPrettier from '@electron-toolkit/eslint-config-prettier'
import eslintPluginSvelte from 'eslint-plugin-svelte'

export default defineConfig(
  {
    ignores: ['**/node_modules', '**/dist', '**/out', 'test-results', 'playwright-report', 'site']
  },
  tseslint.configs.recommended,
  eslintPluginSvelte.configs['flat/recommended'],
  {
    files: ['**/*.svelte', '**/*.svelte.ts'],
    languageOptions: {
      parserOptions: { parser: tseslint.parser },
      // Set by `define` in electron.vite.config.ts.
      globals: { __APP_VERSION__: 'readonly' }
    }
  },
  eslintConfigPrettier
)
