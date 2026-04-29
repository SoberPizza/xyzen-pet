import { resolve } from 'node:path'

import templateCompilerOptions from '@tresjs/core/template-compiler-options'
import Vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

export default defineConfig({
  base: './',

  server: {
    port: 5174,
  },

  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, 'src'),
    },
  },

  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
  },

  worker: {
    format: 'es',
  },

  plugins: [
    Vue({
      include: [/\.vue$/],
      ...templateCompilerOptions,
    }),
  ],
})
