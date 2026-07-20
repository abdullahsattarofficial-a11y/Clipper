import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  // Relative asset paths so the built app works no matter where it's served
  // from — the domain root, a subfolder (e.g. GitHub Pages project sites), or
  // opened through a simple local static server. Absolute '/assets/...' paths
  // 404 in all but the domain-root case.
  base: './',
  plugins: [react()],
  server: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  // The ffmpeg.wasm worker is created via `new Worker(new URL('./worker.js',
  // import.meta.url))`. Vite's dep optimizer rewrites that URL to the prebundled
  // deps folder, where worker.js doesn't exist — so `ffmpeg.load()` silently
  // hangs forever. Excluding these packages makes Vite serve their real ESM
  // source, so the worker URL (and its relative imports) resolve correctly.
  optimizeDeps: {
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util', '@ffmpeg/core'],
  },
})
