import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/__tests__/**/*.test.ts'],
    globals: true,
    maxWorkers: 1,
    typecheck: {
      enabled: true,
      tsconfig: './tsconfig.json',
      include: ['src/**/*.test-d.ts'],
      ignoreSourceErrors: true,
    },
  },
})
