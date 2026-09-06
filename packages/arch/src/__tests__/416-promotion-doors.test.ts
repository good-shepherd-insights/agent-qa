/**
 * PROM-05 / SC3: every promotion append and pure-gate call has a named authority site.
 * Comments count as hits. Tests may spell needles in fixtures and are excluded.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const PACKAGES_DIR = join(HERE, '..', '..', '..')
const REPO_ROOT = join(PACKAGES_DIR, '..')
const ROOTS = ['knowledge-local/src'] as const
const NEEDLES = [
  { label: 'promoted append', needle: /type:\s*'promoted'/ },
  { label: 'gate call', needle: /\bevaluatePromotionGate\(/ },
] as const
const SCAN_EXCLUDED_DIRS = new Set(['dist', 'node_modules', '.turbo', 'coverage', '__tests__'])

interface Source {
  file: string
  text: string
}
interface Site {
  file: string
  marker: string
  label: string
}
interface Hit extends Site {
  line: number
}

const ALLOWED: readonly Site[] = Object.freeze([
  { file: 'packages/knowledge-local/src/curator/knowledge-store.ts', marker: 'door-1-2 revalidation', label: 'gate call' },
  { file: 'packages/knowledge-local/src/curator/knowledge-store.ts', marker: 'door-1-2 gate', label: 'gate call' },
  { file: 'packages/knowledge-local/src/curator/knowledge-store.ts', marker: 'door-1-2 promoted', label: 'promoted append' },
  { file: 'packages/knowledge-local/src/curator/commit.ts', marker: 'door-3 gate', label: 'gate call' },
  { file: 'packages/knowledge-local/src/curator/commit.ts', marker: 'door-3 promoted', label: 'promoted append' },
  // §5.5.5: the sole non-candidate promoted append is born active and never consults the gate.
  { file: 'packages/knowledge-local/src/curator/commit.ts', marker: 'born-active promoted', label: 'promoted append' },
  // This gate call derives a live verdict for a READ; it cannot append lifecycle authority.
  { file: 'packages/knowledge-local/src/gates/gate-receipt-read.ts', marker: 'read live-verdict', label: 'gate call' },
])

function collectSourceFiles(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!SCAN_EXCLUDED_DIRS.has(entry.name)) collectSourceFiles(full, out)
    } else if (entry.name.endsWith('.ts')) {
      out.push(full)
    }
  }
}

function findHits(sources: readonly Source[]): Hit[] {
  return sources.flatMap(({ file, text }) => {
    const lines = text.split('\n')
    return lines.flatMap((line, index) => NEEDLES.flatMap(({ label, needle }) => {
      if (!needle.test(line)) return []
      const marker = lines[index - 1]?.match(/^\s*\/\/ 416-DOOR:\s*(.+?)\s*$/)?.[1] ?? ''
      return [{ file, line: index + 1, marker, label }]
    }))
  })
}

function siteKey(site: Site): string {
  return `${site.file}::${site.marker}::${site.label}`
}

function siteDiff(sources: readonly Source[]): string[] {
  const hits = findHits(sources)
  const expected = new Set(ALLOWED.map(siteKey))
  const seen = new Set<string>()
  const differences: string[] = []
  for (const hit of hits) {
    const key = siteKey(hit)
    if (!expected.has(key) || seen.has(key)) {
      differences.push(`${hit.file}:${hit.line}: ${hit.label} (${hit.marker || 'missing 416-DOOR:'})`)
    }
    seen.add(key)
  }
  for (const key of expected) {
    if (!seen.has(key)) differences.push(`missing allowed site: ${key}`)
  }
  return differences
}

const files: string[] = []
for (const root of ROOTS) collectSourceFiles(join(PACKAGES_DIR, root), files)
const SOURCES = files.sort().map(file => ({
  file: relative(REPO_ROOT, file).split(sep).join('/'),
  text: readFileSync(file, 'utf8'),
}))

describe('416 promotion doors form the complete authority census', () => {
  it('SC3 every promoted append and gate call equals the named allowed sites', () => {
    const differences = siteDiff(SOURCES)
    expect(differences, differences.join('\n')).toEqual([])
  })

  it('SC3 positive-control names an extra in-memory promoted append by file:line', () => {
    const plant = 'packages/knowledge-local/src/curator/416-plant.ts'
    expect(siteDiff([...SOURCES, { file: plant, text: "type: 'promoted'" }]))
      .toEqual([`${plant}:1: promoted append (missing 416-DOOR:)`])
  })

  it('SC3 exactly three promoted appends and four gate calls include the carve-out and read', () => {
    const hits = findHits(SOURCES)
    for (const [label, count] of [['promoted append', 3], ['gate call', 4]] as const) {
      const sites = hits.filter(hit => hit.label === label)
      expect(sites, sites.map(hit => `${hit.file}:${hit.line} ${hit.marker}`).join('\n'))
        .toHaveLength(count)
    }
  })
})
