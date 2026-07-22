import { existsSync, readFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

// Mirrors packages/arch/src/lint/extract-specifiers.ts without importing arch into this package.
const SPECIFIER_RE =
  /\bfrom\s+['"]([^'"]+)['"]|\bimport\s+['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)|\brequire\.resolve\(\s*['"]([^'"]+)['"]\s*\)|\brequire\(\s*['"]([^'"]+)['"]\s*\)/g
const FORBIDDEN_DIRECTORY = /(?:^|\/)(?:curator|queue|journal|lease)(?:\/|$)/
const SOURCE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function importSpecifiers(source: string): string[] {
  return [...source.matchAll(SPECIFIER_RE)].flatMap((match) => {
    const specifier = match[1] ?? match[2] ?? match[3] ?? match[4] ?? match[5]
    return specifier === undefined ? [] : [specifier]
  })
}

function resolveTypeScriptImport(importer: string, specifier: string): string | undefined {
  const target = resolve(dirname(importer), specifier)
  const base = target.replace(/\.(?:[cm]?js|jsx)$/, '')
  return [
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.mts`,
    `${base}.cts`,
    resolve(base, 'index.ts'),
    resolve(base, 'index.tsx'),
  ].find((candidate) => existsSync(candidate))
}

function sourceRelative(file: string): string {
  return relative(SOURCE_ROOT, file).replaceAll('\\', '/')
}

describe('reader entry import closure', () => {
  it('never reaches write-side directories', () => {
    const pending = [resolve(SOURCE_ROOT, 'reader.ts')]
    const visited = new Set<string>()
    const forbiddenEdges: string[] = []

    while (pending.length > 0) {
      const file = pending.shift()!
      if (visited.has(file)) continue
      visited.add(file)

      for (const specifier of importSpecifiers(readFileSync(file, 'utf8'))) {
        if (!specifier.startsWith('.')) continue
        const resolved = resolveTypeScriptImport(file, specifier)
        expect(resolved, `unresolved reader edge: ${sourceRelative(file)} -> ${specifier}`)
          .toBeDefined()
        if (resolved === undefined) continue

        const edge = `${sourceRelative(file)} -> ${specifier} -> ${sourceRelative(resolved)}`
        if (FORBIDDEN_DIRECTORY.test(sourceRelative(resolved))) forbiddenEdges.push(edge)
        if (!visited.has(resolved)) pending.push(resolved)
      }
    }

    expect([...visited].map(sourceRelative)).toContain('reader.ts')
    expect(forbiddenEdges, 'reader import closure crossed into the write side').toEqual([])
  })
})
