import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import templateCompilerOptions from '@tresjs/core/template-compiler-options'
import Vue from '@vitejs/plugin-vue'
import { defineConfig, type Plugin } from 'vite'

/**
 * onnxruntime-web (pulled in transitively by @ricky0123/vad-web) loads its
 * JSEP glue via `import('/vad/ort-wasm-simd-threaded.jsep.mjs')`. The `.mjs`
 * files live in `public/vad/` as static assets, but Vite refuses to resolve
 * source-code imports of public files — it throws "This file is in /public
 * and will be copied as-is during build … It can only be referenced via
 * HTML tags."
 *
 * This middleware intercepts `/vad/*.mjs` before Vite's transform pipeline
 * and serves the raw file, bypassing the source-import restriction while
 * keeping the .wasm/.onnx siblings in the same folder.
 */
function serveVadMjsPlugin(): Plugin {
  return {
    name: 'serve-vad-mjs',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url
        if (!url) return next()
        const path = url.split('?')[0]
        if (!path.startsWith('/vad/') || !path.endsWith('.mjs')) return next()
        try {
          const filePath = resolve(import.meta.dirname, 'public', path.slice(1))
          const body = readFileSync(filePath)
          res.setHeader('Content-Type', 'application/javascript; charset=utf-8')
          res.end(body)
        }
        catch {
          next()
        }
      })
    },
  }
}

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

  // onnxruntime-web ships its wasm+glue as sibling .mjs/.wasm files served
  // statically out of `public/vad/`. If Vite pre-bundles it (or transforms
  // the .mjs glue), it rewrites internal `import('…jsep.mjs')` calls into
  // module-graph requests and fails with a 500 — so it stays excluded.
  //
  // @ricky0123/vad-web, however, is pure CommonJS (its `dist/index.js`
  // starts with `exports.…`). Without pre-bundling, the browser loads the
  // raw CJS and throws `ReferenceError: exports is not defined` on the
  // first `import('@ricky0123/vad-web')`. Including it here asks esbuild
  // to convert it to ESM while leaving onnxruntime-web alone.
  optimizeDeps: {
    exclude: ['onnxruntime-web'],
    include: ['@ricky0123/vad-web'],
  },

  plugins: [
    serveVadMjsPlugin(),
    Vue({
      include: [/\.vue$/],
      ...templateCompilerOptions,
    }),
  ],
})
