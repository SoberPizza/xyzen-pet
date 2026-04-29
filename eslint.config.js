import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import pluginVue from 'eslint-plugin-vue'

export default [
  { ignores: ['dist/', 'node_modules/', 'src/ipc/bindings.ts'] },

  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginVue.configs['flat/recommended'],

  {
    files: ['src/**/*.{ts,vue}', 'tests/**/*.ts'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
      },
    },
    rules: {
      // TypeScript handles undefined variable detection, so disable JS-level check
      'no-undef': 'off',
      // Empty catch blocks are a deliberate "best-effort cleanup" idiom used
      // throughout the VRM/audio lifecycle code (disconnect, stop, etc.).
      'no-empty': ['error', { allowEmptyCatch: true }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'error',
      'vue/no-unused-vars': 'error',
      'vue/multi-word-component-names': 'off',
      'vue/require-default-prop': 'off',
      // Enforce decoupling: buddy must not import from the main Xyzen monorepo.
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['@xyzen/shared', '@xyzen/shared/*'], message: 'buddy must stay decoupled — do not import @xyzen/shared.' },
          { group: ['@xyzen/platform-web', '@xyzen/platform-web/*'], message: 'buddy must stay decoupled — do not import @xyzen/platform-web.' },
          { group: ['@sciol/xyzen', '@sciol/xyzen/*'], message: 'buddy must stay decoupled — do not import the main web app package.' },
          { group: ['**/frontend/**'], message: 'buddy must stay decoupled — do not reach into frontend/.' },
        ],
      }],
    },
  },
]
