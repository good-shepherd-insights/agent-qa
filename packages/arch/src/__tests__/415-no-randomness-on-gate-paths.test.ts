/**
 * FLOOR-03 / FLOOR-05: named cells for the gate's deterministic source and process boundaries.
 *
 * ROOTS is pinned deliberately: cli/src/eval-session-composition.ts mints the partition SALT
 * with randomBytes (414 D-06, a seed-time act) and is outside this gate/partition/sampling/fuzz
 * census. Every draw inside ROOTS must instead use createSeededRng with its seed recorded.
 * Comments count as hits; nothing is stripped. Tests may spell needles in fixtures, so __tests__
 * is excluded along with build output and dependency trees.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
/** packages/arch/src/__tests__ -> packages. */
const PACKAGES_DIR = join(HERE, '..', '..', '..')
const REPO_ROOT = join(PACKAGES_DIR, '..')

const ROOTS = [
  'eval/src/gate',
  'eval/src/stats',
  'eval/src/labels/split-assignment.ts',
  'eval/src/labels/silver-sampling.ts',
  'eval-local/src/aa-floor-composition.ts',
  'eval-local/src/release-gate-composition.ts',
  // Phase 422 owns this future source root; its absence is allowed and disclosed below.
  'eval/src/adversarial',
] as const

const NEEDLES = [
  { label: 'Math.random', needle: /\bMath\.random\b/ },
  { label: 'crypto.randomUUID', needle: /\bcrypto\.randomUUID\b/ },
  { label: 'getRandomValues', needle: /\bgetRandomValues\b/ },
  { label: 'randomBytes', needle: /\brandomBytes\b/ },
  { label: 'a node:crypto import', needle: /from ['"]node:crypto['"]/ },
] as const

const SCAN_EXCLUDED_DIRS = new Set(['dist', 'node_modules', '.turbo', 'coverage', '__tests__'])

function collectSourceFiles(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (SCAN_EXCLUDED_DIRS.has(entry.name)) continue
      collectSourceFiles(full, out)
      continue
    }
    if (entry.name.endsWith('.ts')) out.push(full)
  }
}

function findNeedle(needle: RegExp, source: string, file: string): string[] {
  const hits: string[] = []
  source.split('\n').forEach((line, index) => {
    if (needle.test(line)) hits.push(`${file}:${index + 1}`)
  })
  return hits
}

function relativePath(file: string): string {
  return relative(REPO_ROOT, file).split(sep).join('/')
}

const files: string[] = []
const skippedRoots: string[] = []
for (const root of ROOTS) {
  const full = join(PACKAGES_DIR, root)
  if (!existsSync(full)) {
    skippedRoots.push(root)
    continue
  }
  if (statSync(full).isDirectory()) collectSourceFiles(full, files)
  else if (full.endsWith('.ts')) files.push(full)
}
const SOURCES = files.sort().map(file => ({
  file: relativePath(file),
  text: readFileSync(file, 'utf8'),
}))

describe('415 gate randomness and release-gate isolation', () => {
  it('finds every planted needle — the known-positive control for the extractor', () => {
    const plants = [
      'Math.random()',
      'crypto.randomUUID()',
      'crypto.getRandomValues(new Uint8Array(1))',
      'randomBytes(1)',
      "import { createHash } from 'node:crypto'",
    ]
    for (const [index, { label, needle }] of NEEDLES.entries()) {
      const source = ['const untouched = 1', plants[index], '// tail'].join('\n')
      expect(
        findNeedle(needle, source, 'synthetic/planted.ts'),
        `the extractor could not find the planted ${label}`,
      ).toEqual(['synthetic/planted.ts:2'])
      expect(
        findNeedle(needle, `// ${plants[index]}`, 'synthetic/commented.ts'),
        `comments must count for ${label}`,
      ).toEqual(['synthetic/commented.ts:1'])
    }
  })

  for (const { label, needle } of NEEDLES) {
    it(`no source under a gate, partition or fuzz root spells ${label}`, () => {
      const hits = SOURCES.flatMap(source => findNeedle(needle, source.text, source.file))
      expect(
        hits,
        [
          'unseeded randomness on a gate, partition, sampling or fuzz path (comments count):',
          ...hits,
          `Skipped absent roots: ${skippedRoots.join(', ') || 'none'}`,
        ].join('\n'),
      ).toEqual([])
    })
  }

  it('no vitest config, turbo pipeline or package test script references the release gate', () => {
    const gateReference = /release-gate|m3-release|eval gate/
    const packageDirs = readdirSync(PACKAGES_DIR, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => join(PACKAGES_DIR, entry.name))
    const configs = [
      join(REPO_ROOT, 'turbo.json'),
      ...packageDirs.map(dir => join(dir, 'vitest.config.ts')).filter(file => existsSync(file)),
    ]
    const hits = configs.flatMap(file =>
      findNeedle(gateReference, readFileSync(file, 'utf8'), relativePath(file)),
    )
    const manifests = [
      join(REPO_ROOT, 'package.json'),
      ...packageDirs.map(dir => join(dir, 'package.json')).filter(file => existsSync(file)),
    ]
    for (const file of manifests) {
      const manifest = JSON.parse(readFileSync(file, 'utf8')) as { scripts?: { test?: string } }
      // Only scripts.test: validate:release-gate is the legitimate standalone entrypoint.
      if (gateReference.test(manifest.scripts?.test ?? '')) {
        hits.push(`${relativePath(file)}:scripts.test`)
      }
    }
    expect(hits, `the release gate must retain its own process and budget:\n${hits.join('\n')}`).toEqual(
      [],
    )
  })
})
