import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { policyWriterHits, doorDifferences, type DoorSite } from '../lint/sovereignty-doors.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const PACKAGES_DIR = join(HERE, '..', '..', '..')
const REPO_ROOT = join(PACKAGES_DIR, '..')
const ROOTS = ['knowledge-local/src', 'agent-local/src', 'cli/src', 'dashboard-server/src'] as const
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
  { file: 'packages/knowledge-local/src/policy/materialize.ts', marker: 'materialize directory', label: 'mkdirSync' },
  { file: 'packages/knowledge-local/src/policy/materialize.ts', marker: 'materialize', label: 'renameSync' },
  { file: 'packages/cli/src/commands/init.ts', marker: 'init scaffold', label: 'scaffoldFilePlan' },
  { file: 'packages/knowledge-local/src/policy/materialize.ts', marker: 'materialize stage', label: 'openSync' },
]
const LIVE_HITS = policyWriterHits(SOURCES)
const siteDiff = (sources: typeof SOURCES) => doorDifferences([...LIVE_HITS, ...policyWriterHits(sources)], ALLOWED, '419-POLICY-WRITER')

describe('419 one policy writer', () => {
  it('censuses the actual materializer mkdir/stage/rename and init atomic scaffold input', () => {
    const differences = siteDiff([])
    expect(differences, differences.join('\n')).toEqual([])
  })
  it.each(['writeFileSync', 'appendFileSync', 'mkdirSync', 'writeFile', 'appendFile', 'mkdir'])(
    'finds planted %s on literal, multiline, variable and helper policy paths in every root', writer => {
      for (const root of ROOTS) {
        const file = `packages/${root}/planted.ts`
        for (const text of [
          `${writer}('policies/global.md', 'rule')`,
          `${writer}(\n join(root, 'policies', 'global.md'), 'rule')`,
          `const target = join(root, 'policies', 'global.md')\n${writer}(target, 'rule')`,
          `function shelf() { return join(root, 'policies', 'global.md') }\nconst target = shelf()\n${writer}(target, 'rule')`,
          `import { ${writer} as publish } from 'node:fs'\npublish('policies/global.md', 'rule')`,
        ]) {
          const hits = policyWriterHits([{ file, text }])
          expect(hits).toHaveLength(1)
          const hit = hits[0]!
          expect(siteDiff([{ file, text }])).toEqual([
            `${file}:${hit.line}: ${writer} (missing 419-POLICY-WRITER:)`,
          ])
        }
      }
    },
  )
  it('follows an imported helper alias and rejects a forged marker', () => {
    const file = 'packages/cli/src/planted.ts'
    const text = "function policyShelfPath(root: string, scope: string) { return join(root, 'policies', scope) }\nimport { policyShelfPath as shelf } from './helper.js'\nconst target = shelf(root, scope)\n// 419-POLICY-WRITER: forged\nappendFileSync(target, 'rule')"
    expect(siteDiff([{ file, text }])).toEqual([
      `${file}:5: appendFileSync (forged)`,
    ])
  })
  it.each(['renameSync', 'rename'])('detects %s publication to policy paths', writer => {
    expect(policyWriterHits([{ file: 'planted.ts',
      text: `${writer}('temporary', 'policies/global.md')` }]))
      .toEqual([{ file: 'planted.ts', line: 1, marker: '', label: writer }])
  })
  it('rejects a second policy scaffold and duplicate valid marker', () => {
    const site = ALLOWED[2]!
    expect(siteDiff([{
      file: site.file,
      text: "// 419-POLICY-WRITER: init scaffold\nscaffoldFilePlan(root, 'policies/other.md', 'rule', false)",
    }])).toEqual([`${site.file}:2: scaffoldFilePlan (init scaffold)`])
  })
  it('does not confuse policy readers or unrelated file writes with policy writers', () => {
    expect(policyWriterHits([{ file: 'reader.ts', text: [
      "const path = join(root, 'policies', 'global.md')",
      "readFileSync(path, 'utf8')",
      "writeFileSync('memory/other.md', 'content')",
      "// policies/global.md is discussed here",
    ].join('\n') }])).toEqual([])
  })
  it('pins every real sink, so a matcher cannot pass with an empty census', () => {
    const hits = LIVE_HITS
    expect(hits).toHaveLength(4)
    for (const label of ['mkdirSync', 'openSync', 'renameSync', 'scaffoldFilePlan']) {
      expect(hits.filter(hit => hit.label === label)).toHaveLength(1)
    }
  })
})
