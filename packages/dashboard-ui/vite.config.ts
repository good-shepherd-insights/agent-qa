import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

// `vitest/config` re-exports vite's `defineConfig` and additionally types the `test` key. This
// package has no separate vitest.config.ts, so vitest reads this file.
export default defineConfig({
  test: {
    // The 5s vitest default is tuned for a fast dev machine. A 2-core CI runner is 3-6x slower,
    // and jsdom component tests that drive several state transitions cross it — `TestsPage >
    // remembers cache changes…` did, on the fifth automatic CI run (2026-08-02). Matches the
    // 30s default the other 19 package configs now carry.
    testTimeout: 30_000,
  },
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
    extensions: ['.mjs', '.js', '.mts', '.tsx', '.ts', '.jsx', '.json'],
  },
  optimizeDeps: {
    include: ['monaco-editor'],
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/api/live-editor/ws': {
        target: 'http://localhost:3470',
        ws: true,
      },
      '/api': 'http://localhost:3470',
      '/screenshots': 'http://localhost:3470',
      '/videos': 'http://localhost:3470',
    },
  },
})
