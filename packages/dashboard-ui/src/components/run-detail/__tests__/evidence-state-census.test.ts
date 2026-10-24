import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { EVIDENCE_STATES } from '@/lib/evidence-state-view'

const sourceRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sourceFiles(path)
    return /\.tsx?$/.test(entry.name) && !/\.(test|test-d|spec)\.tsx?$/.test(entry.name)
      ? [path]
      : []
  })
}

it('EVIDENCE-STATE-SIX-VALUES: source literals use only the six evidence states', () => {
  const files = sourceFiles(sourceRoot)
  expect(files.length).toBeGreaterThan(0)
  const literals = files.flatMap((path) => {
    const source = readFileSync(path, 'utf8')
    const pattern = /(?:data-evidence-state\s*=\s*\{?\s*|['"]data-evidence-state['"]\s*:\s*)['"`]([^'"`]+)['"`]/g
    return [...source.matchAll(pattern)].map((match) => ({
      file: relative(sourceRoot, path), value: match[1],
    }))
  })
  const allowed = new Set<string>(EVIDENCE_STATES)
  expect(allowed.size).toBe(6)
  expect(literals.filter(({ value }) => !allowed.has(value))).toEqual([])
  expect(literals.map(({ value }) => value)).not.toContain('incom' + 'plete')
})
