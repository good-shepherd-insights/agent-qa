import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts', 'src/reader.ts', 'src/embedder-worker/worker-entry.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'node24',
  splitting: false,
  removeNodeProtocol: false,
})
