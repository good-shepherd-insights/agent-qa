import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { commitDoorHits, doorDifferences, type DoorSite } from '../lint/sovereignty-doors.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const PACKAGES_DIR = join(HERE, '..', '..', '..')
const REPO_ROOT = join(PACKAGES_DIR, '..')
const ROOTS = ['knowledge-local/src', 'agent-local/src', 'cli/src'] as const
const SCAN_EXCLUDED_DIRS = new Set(['dist', 'node_modules', '.turbo', 'coverage', '__tests__'])
function collectSourceFiles(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!SCAN_EXCLUDED_DIRS.has(entry.name)) collectSourceFiles(full, out)
    } else if (entry.name.endsWith('.ts')) out.push(full)
  }
}
const files: string[] = []
for (const root of ROOTS) collectSourceFiles(join(PACKAGES_DIR, root), files)
const SOURCES = files.sort().map(file => ({
  file: relative(REPO_ROOT, file).split(sep).join('/'),
  text: readFileSync(file, 'utf8'),
}))

const ALLOWED: readonly DoorSite[] = [
  { file: 'packages/knowledge-local/src/review/apply-review.ts', marker: 'commitInProcess', label: 'store commit' },
  { file: 'packages/knowledge-local/src/curator/knowledge-store.ts', marker: 'curator profile pipeline', label: 'profile commit' },
  { file: 'packages/knowledge-local/src/curator/knowledge-store.ts', marker: 'curator propose-only', label: 'profile commit' },
  { file: 'packages/knowledge-local/src/curator/knowledge-store.ts', marker: 'curator disposition', label: 'profile commit' },
  { file: 'packages/knowledge-local/src/curator/knowledge-store.ts', marker: 'curator canary confirm', label: 'store commit' },
]
const siteDiff = (sources: typeof SOURCES) => doorDifferences(commitDoorHits(sources), ALLOWED, '419-COMMIT-DOOR')

describe('419 one commit door', () => {
  it('every commit equals the marked review door and curator internals', () => {
    const differences = siteDiff(SOURCES)
    expect(differences, differences.join('\n')).toEqual([])
  })
  it.each([
    ['store.commit([])', 'store commit'],
    ['commitWithProfile([])', 'profile commit'],
  ])('finds planted %s in every root, including comments and forged markers', (needle, label) => {
    for (const root of ROOTS) {
      const file = `packages/${root}/planted.ts`
      for (const prefix of ['', '// ', '// 419-COMMIT-DOOR: forged\n']) {
        const line = prefix.includes('\n') ? 2 : 1
        expect(siteDiff([...SOURCES, { file, text: prefix + needle }])).toEqual([
          `${file}:${line}: ${label} (${line === 2 ? 'forged' : 'missing 419-COMMIT-DOOR:'})`,
        ])
      }
    }
  })
  it('rejects a duplicate of a valid marked site', () => {
    const site = ALLOWED[0]!
    expect(siteDiff([...SOURCES, { file: site.file, text: '// 419-COMMIT-DOOR: commitInProcess\nstore.commit([])' }]))
      .toEqual([`${site.file}:2: store commit (commitInProcess)`])
  })
  it('pins two store sites and three profile sites', () => {
    const hits = commitDoorHits(SOURCES)
    expect(hits.filter(hit => hit.label === 'store commit')).toHaveLength(2)
    expect(hits.filter(hit => hit.label === 'profile commit')).toHaveLength(3)
  })
})

