import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  NODE_BUILTINS,
  classifySpecifier,
  extractSpecifiers,
  sourceFilesFor,
  specifiersInSource,
} from '../extract-specifiers.js'

describe('specifier extraction', () => {
  it('captures from, export-from, import type, bare import, dynamic import, require.resolve, and require forms', () => {
    const source = [
      "import { readFileSync } from 'node:fs'",
      "export { createModel } from '@vostride/agent-qa-model'",
      "import type { Tool } from './tool.js'",
      "import 'dotenv/config'",
      '@import "tailwindcss";',
      "const sdk = await import('@ai-sdk/anthropic')",
      "const sqlite = require('better-sqlite3')",
      "const manifest = require.resolve('pkg/package.json')",
    ].join('\n')

    expect(specifiersInSource(source, '/fixture.ts')).toEqual([
      { specifier: 'node:fs', file: '/fixture.ts', line: 1 },
      { specifier: '@vostride/agent-qa-model', file: '/fixture.ts', line: 2 },
      { specifier: './tool.js', file: '/fixture.ts', line: 3 },
      { specifier: 'dotenv/config', file: '/fixture.ts', line: 4 },
      { specifier: 'tailwindcss', file: '/fixture.ts', line: 5 },
      { specifier: '@ai-sdk/anthropic', file: '/fixture.ts', line: 6 },
      { specifier: 'better-sqlite3', file: '/fixture.ts', line: 7 },
      { specifier: 'pkg/package.json', file: '/fixture.ts', line: 8 },
    ])
  })

  it('extracts located specifiers from a file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-qa-arch-specifiers-'))
    const file = join(dir, 'fixture.ts')
    writeFileSync(file, ["import { z } from 'zod'", "await import('@ai-sdk/openai')"].join('\n'))

    expect(extractSpecifiers(file)).toEqual([
      { specifier: 'zod', file, line: 1 },
      { specifier: '@ai-sdk/openai', file, line: 2 },
    ])
  })
})

describe('specifier classification', () => {
  it('partitions relative, Node, internal, and external npm specifiers', () => {
    expect(classifySpecifier('./local.js')).toEqual({ kind: 'relative' })
    expect(classifySpecifier('../local.js')).toEqual({ kind: 'relative' })
    expect(classifySpecifier('@/components/button')).toEqual({ kind: 'relative' })
    expect(classifySpecifier('node:fs')).toEqual({ kind: 'node', bare: 'fs' })
    expect(classifySpecifier('fs')).toEqual({ kind: 'node', bare: 'fs' })
    expect(classifySpecifier('@vostride/agent-qa-core')).toEqual({
      kind: 'internal',
      pkgName: '@vostride/agent-qa-core',
    })
    expect(classifySpecifier('@vostride/agent-qa-core/sub')).toEqual({
      kind: 'internal',
      pkgName: '@vostride/agent-qa-core',
    })
    expect(classifySpecifier('@ai-sdk/openai')).toEqual({
      kind: 'external',
      pkgName: '@ai-sdk/openai',
    })
    expect(classifySpecifier('better-sqlite3')).toEqual({
      kind: 'external',
      pkgName: 'better-sqlite3',
    })
  })

  it('exports a builtin set that includes bare and node-prefixed names', () => {
    expect(NODE_BUILTINS.has('fs')).toBe(true)
    expect(NODE_BUILTINS.has('node:fs')).toBe(true)
  })
})

describe('sourceFilesFor', () => {
  it('returns source files while excluding tests and ownership contracts', () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'agent-qa-arch-source-'))
    const packageDir = 'packages/fixture'
    const packageRoot = join(repoRoot, packageDir)
    mkdirSync(join(packageRoot, 'src', '__tests__'), { recursive: true })
    writeFileSync(join(packageRoot, 'src', 'index.ts'), 'export const ok = true\n')
    writeFileSync(join(packageRoot, 'src', 'view.tsx'), 'export const ok = <div />\n')
    writeFileSync(join(packageRoot, 'src', 'style.css'), '@import "tailwindcss";\n')
    writeFileSync(join(packageRoot, 'src', 'ownership-contract.ts'), 'export const contract = {}\n')
    writeFileSync(join(packageRoot, 'src', '__tests__', 'index.test.ts'), 'it("works", () => {})\n')

    expect(sourceFilesFor(packageDir, repoRoot)).toEqual([
      join(packageRoot, 'src', 'index.ts'),
      join(packageRoot, 'src', 'style.css'),
      join(packageRoot, 'src', 'view.tsx'),
    ])
  })

  it('returns an empty list when a package has no src directory', () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'agent-qa-arch-source-empty-'))

    expect(sourceFilesFor('packages/missing', repoRoot)).toEqual([])
  })
})
