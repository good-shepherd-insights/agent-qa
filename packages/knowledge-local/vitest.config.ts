import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/__tests__/**/*.test.ts'],
    globals: true,
    // Bound filesystem and SQLite contention independently of the host CPU count.
    // Limit concurrent files while preserving the existing per-test timeout.
    maxWorkers: 4,
    // This package's acceptance tests intentionally exercise concurrent SQLite,
    // filesystem, rebuild, GC, and process-boundary paths. Vitest's 5-second
    // default is too small under full-workspace contention; keep the ceiling
    // bounded while giving those integration paths a realistic shared policy.
    testTimeout: 15_000,
    typecheck: {
      enabled: true,
      tsconfig: './tsconfig.json',
      include: ['src/**/*.test-d.ts'],
    },
  },
})
