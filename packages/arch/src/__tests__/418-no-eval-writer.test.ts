/**
 * GATE2-06 / SC5: curator and local agent have no committed-root or eval/feedback writer.
 * Comments count as hits. Tests may spell needles in fixtures and are excluded.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const PACKAGES_DIR = join(HERE, '..', '..', '..')
const REPO_ROOT = join(PACKAGES_DIR, '..')
const ROOTS = ['knowledge-local/src', 'agent-local/src'] as const
const NEEDLES = [
  { label: 'feedback staging path', needle: /eval\/feedback/ },
  { label: 'gate-2 audit path', needle: /eval\/gate2/ },
  { label: 'staging constant', needle: /\b(GATE2_AUDIT_SUBDIR|FEEDBACK_STAGING_SUBDIR)\b/ },
  { label: 'committed corpus writer', needle: /\b(seedCommittedCorpus|stageFeedbackEntry|admitStagedFeedback|FsCommittedRootStore)\b/ },
  { label: 'committed root dir', needle: /agent-qa-eval\b/ },
  { label: 'eval-local main entry', needle: /@vostride\/agent-qa-eval-local(?!\/reader)/ },
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

// Only read-only path constants may be rostered with a preceding // 418-READ: reason.
// No writer or writer import closure is eligible. The current census needs no exemption.
const ALLOWED: readonly Site[] = Object.freeze([])

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
      const marker = lines[index - 1]?.match(/^\s*\/\/ 418-READ:\s*(.+?)\s*$/)?.[1] ?? ''
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
      differences.push(`${hit.file}:${hit.line}: ${hit.label} (${hit.marker || 'missing 418-READ:'})`)
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

describe('418 curator and local agent have no eval writer', () => {
  it('SC5 raw source contains no eval-root or feedback staging writer outside read-only constants', () => {
    const differences = siteDiff(SOURCES)
    expect(differences, differences.join('\n')).toEqual([])
  })

  it.each([
    ['eval/feedback', ['feedback staging path']],
    ['eval/gate2', ['gate-2 audit path']],
    ['GATE2_AUDIT_SUBDIR', ['staging constant']],
    ['FEEDBACK_STAGING_SUBDIR', ['staging constant']],
    ['seedCommittedCorpus', ['committed corpus writer']],
    ['stageFeedbackEntry', ['committed corpus writer']],
    ['admitStagedFeedback', ['committed corpus writer']],
    ['FsCommittedRootStore', ['committed corpus writer']],
    ['agent-qa-eval', ['committed root dir']],
    ['@vostride/agent-qa-eval-local', ['committed root dir', 'eval-local main entry']],
  ] as const)('SC5 detects %s in comments and code in both roots, even with an unrostered marker', (text, labels) => {
    for (const root of ROOTS) {
      const file = `packages/${root}/418-plant.ts`
      for (const prefix of ['', '// ', '// 418-READ: forged allowance\n']) {
        const line = prefix.includes('\n') ? 2 : 1
        const marker = line === 2 ? 'forged allowance' : 'missing 418-READ:'
        expect(siteDiff([...SOURCES, { file, text: prefix + text }]))
          .toEqual(labels.map(label => `${file}:${line}: ${label} (${marker})`))
      }
    }
  })
})
