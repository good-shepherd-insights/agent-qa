import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // The 5s vitest default is tuned for a fast dev machine. A 2-core CI runner is
    // 3-6x slower and 395 workspace tests sit in the 0.7-5s band, several within 150ms
    // of the default. Matches the precedent knowledge-local already set.
    testTimeout: 30_000,
    // 2026-10-02 (quick 261002-tmo): hooks with no budget of their own close browsers, stop
    // spawned dashboards or enumerate every surface. Each awaits the real operation, so the
    // ceiling bounds a hang and asserts nothing; vitest's 10 s default was outrun under forced
    // gates (432-08 #5 run-mark-browser; 432-39 #6 run 2, seven browser/conformance files at
    // load 41-52). Hooks that state their own budget keep it.
    hookTimeout: 120_000,
    include: ['src/**/__tests__/**/*.test.ts'],
    globals: true,
    typecheck: {
      enabled: true,
      tsconfig: './tsconfig.json',
      include: ['src/**/*.test-d.ts'],
    },
  },
})
