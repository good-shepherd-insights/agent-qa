// Phase 371 proof obligations for the committed eval root (ROOT-01/ROOT-02).
//
// The raw-byte proof (GUARD-FUT-04): a MaskingContext-registered value masked at the record
// boundary appears nowhere raw in the whole tree. Every negative assertion is paired with a
// positive control so a vacuous pass is impossible (T-371-19). Undeclared credential-shaped
// text is committed as written (441 D-15, C441-COMMITTED).
//
// The tracked/ignored partition is a PURE ignore-aware filesystem walk — no git
// subprocess (Research OQ-1). The walk's exclusion rules are parsed from the scaffolded
// .gitignore the store itself wrote, so the proof cannot drift from the artifact
// (T-371-20).

import { readFileSync, readdirSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  buildEvalReport,
  buildSeedingPlan,
  committedFileText,
  extractRunCassettes,
  projectBaselinePointer,
} from '@vostride/agent-qa-eval'
import type { ArtifactSource, ExtractedCassette, SeedingPlan } from '@vostride/agent-qa-eval'
import { SecretRedactor, SecretStore } from '@vostride/agent-qa-runner'
import { asRef } from '@vostride/agent-qa-schema'
import type { CompletedRunHandoff, Decision, SubActionEvidence } from '@vostride/agent-qa-schema'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { writeBaselinePointer } from '../baseline-pointer.js'
import { BLOBS_SUBDIR } from '../cassette-store.js'
import {
  committedBaselinePointerPath,
  committedCassettePath,
  committedCorpusPath,
  committedLabelPath,
  committedReportPath,
} from '../committed-root-store.js'
import {
  COMMITTED_REPORT_JSON_FILE,
  COMMITTED_REPORT_MARKDOWN_FILE,
  commitEvalReport,
} from '../report-committing.js'
import { seedCommittedCorpus } from '../seeding-composition.js'
import type { SeedingReport } from '../seeding-composition.js'
import {
  LOCAL_FIXTURE_BLOB_BYTES,
  LOCAL_FIXTURE_BLOB_SHA,
  makeLocalV2Handoff,
} from './fixtures/local-handoff-fixture.js'

/**
 * The 414-05 shared partition vector (Plan 01 replaced buildSeedingPlan's old
 * `handoffPath` input with `partition` DATA). Same salt and fractions as
 * `committed-corpus-source.test.ts`: a 64-lowercase-hex salt, and a
 * `heldOutFraction` above the fixture silver leaf's bucket fraction under that
 * salt so the seeded root carries a held-out entry.
 */
const TEST_PARTITION = {
  saltHex: 'a3f'.repeat(21).concat('b'),
  heldOutFraction: 0.95,
  privateFraction: 0.5,
} as const
const PRODUCT = 'default'

// ---------------------------------------------------------------------------
// The pure ignore-aware walker (no git subprocess — Research OQ-1 resolution).
// ---------------------------------------------------------------------------

interface CommittedWalk {
  /** Files git would track: everything not under an ignore-covered directory. */
  trackedPaths: string[]
  /** Files under a directory covered by a scaffolded ignore rule. */
  ignoredPaths: string[]
  /** Directory names the scaffolded .gitignore covers (parsed, not hardcoded). */
  ignoredDirNames: string[]
}

/**
 * Parse the store's scaffolded ignore rules. The scaffold's rule dialect is
 * `**\/<name>/` (a directory name ignored at any depth); anything else in the file
 * would mean the store's artifact drifted from what this walker understands — fail
 * loudly rather than silently mis-partitioning.
 */
function parseIgnoredDirNames(gitignoreText: string): string[] {
  return gitignoreText
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
    .map((rule) => {
      const match = /^\*\*\/([^/*]+)\/$/.exec(rule)
      if (match === null) throw new Error(`unsupported scaffolded ignore rule: ${rule}`)
      return match[1]!
    })
}

/** Recursively partition every file under root using the scaffolded ignore rules. */
function walkCommittedRoot(root: string): CommittedWalk {
  const ignoredDirNames = parseIgnoredDirNames(readFileSync(join(root, '.gitignore'), 'utf8'))
  const trackedPaths: string[] = []
  const ignoredPaths: string[] = []

  function visit(rel: string, ignored: boolean): void {
    for (const entry of readdirSync(rel === '' ? root : join(root, rel), { withFileTypes: true })) {
      const childRel = rel === '' ? entry.name : `${rel}/${entry.name}`
      if (entry.isDirectory()) {
        visit(childRel, ignored || ignoredDirNames.includes(entry.name))
      } else {
        ;(ignored ? ignoredPaths : trackedPaths).push(childRel)
      }
    }
  }

  visit('', false)
  return {
    trackedPaths: trackedPaths.sort(),
    ignoredPaths: ignoredPaths.sort(),
    ignoredDirNames,
  }
}

/** Relative paths (from the given set) whose raw bytes contain the needle. */
function filesContaining(root: string, relPaths: readonly string[], needle: string): string[] {
  return relPaths.filter((rel) => readFileSync(join(root, rel)).includes(needle))
}

// ---------------------------------------------------------------------------
// D-15 partition + D-13 membership machinery.
// ---------------------------------------------------------------------------

/** An ignore-covered blob: .../blobs/<64-hex> — the ONLY legitimate ignored shape. */
const BLOB_PATH_RE = /(?:^|\/)blobs\/[0-9a-f]{64}$/

/** The known tracked text kinds — everything checkpointed and reviewable (D-15). */
const TRACKED_TEXT_KINDS: readonly { kind: string; matches: (rel: string) => boolean }[] = [
  { kind: 'gitignore', matches: (rel) => rel === '.gitignore' },
  { kind: 'root-marker', matches: (rel) => rel === 'eval-root.json' },
  { kind: 'cassette', matches: (rel) => /^cassettes\/.+\/cassette\.json$/.test(rel) },
  { kind: 'label', matches: (rel) => /^labels\/.+\.json$/.test(rel) },
  { kind: 'corpus', matches: (rel) => /^corpus\/.+\.json$/.test(rel) },
  { kind: 'contract', matches: (rel) => /^contracts\/[^/]+\.v\d+\.json$/.test(rel) },
]

function trackedKindsFor(rel: string): string[] {
  return TRACKED_TEXT_KINDS.filter((candidate) => candidate.matches(rel)).map(
    (candidate) => candidate.kind,
  )
}

interface MembershipCounts {
  cassetteCount: number
  labelCount: number
  corpusCount: number
}

/**
 * The D-13 invariant, both ways, derived from the exported path builders:
 *  (a) every cassette.json implies its label + corpus files at the builder paths,
 *      and its own id round-trips to its own path;
 *  (b) every label record and corpus entry implies its cassette bundle;
 *  (c) every label/corpus file's cassetteId round-trips to the file's own path.
 */
function assertMembershipInvariant(root: string, walk: CommittedWalk): MembershipCounts {
  const tracked = new Set(walk.trackedPaths)
  const cassettePaths = walk.trackedPaths.filter(
    (rel) => rel.startsWith('cassettes/') && rel.endsWith('/cassette.json'),
  )
  const labelPaths = walk.trackedPaths.filter((rel) => rel.startsWith('labels/'))
  const corpusPaths = walk.trackedPaths.filter((rel) => rel.startsWith('corpus/'))

  for (const rel of cassettePaths) {
    const cassette = JSON.parse(readFileSync(join(root, rel), 'utf8')) as { id: string }
    expect(committedCassettePath(PRODUCT, cassette.id)).toBe(rel)
    expect(tracked.has(committedLabelPath(PRODUCT, cassette.id))).toBe(true)
    expect(tracked.has(committedCorpusPath(PRODUCT, cassette.id))).toBe(true)
  }

  for (const rel of labelPaths) {
    const record = JSON.parse(readFileSync(join(root, rel), 'utf8')) as { cassetteId: string }
    expect(committedLabelPath(PRODUCT, record.cassetteId)).toBe(rel)
    expect(tracked.has(committedCassettePath(PRODUCT, record.cassetteId))).toBe(true)
  }

  for (const rel of corpusPaths) {
    const entry = JSON.parse(readFileSync(join(root, rel), 'utf8')) as { cassetteId: string }
    expect(committedCorpusPath(PRODUCT, entry.cassetteId)).toBe(rel)
    expect(tracked.has(committedCassettePath(PRODUCT, entry.cassetteId))).toBe(true)
  }

  return {
    cassetteCount: cassettePaths.length,
    labelCount: labelPaths.length,
    corpusCount: corpusPaths.length,
  }
}

// ---------------------------------------------------------------------------
// Fixtures — the 371-08 seeding fixture: 1 silver case + 1 same-state pair.
// ---------------------------------------------------------------------------

function fullArtifacts(): ArtifactSource {
  const entries = new Map<string, Uint8Array>([[LOCAL_FIXTURE_BLOB_SHA, LOCAL_FIXTURE_BLOB_BYTES]])
  return { getBlob: (sha) => entries.get(sha) }
}

function decisionFor(subAction: SubActionEvidence): Decision {
  return {
    plan: subAction.plan,
    plannedAction: structuredClone(subAction.plannedAction),
    result: structuredClone(subAction.result),
  }
}

function seedingHandoff(): CompletedRunHandoff {
  const handoff = makeLocalV2Handoff()
  // Luhn-proof the fixture timestamps: the fixture's 1725000000100 is a 13-digit
  // Luhn-valid number the creditCard detector blocks; a 10-digit epoch stays below
  // the candidate floor (371-08's recorded gotcha).
  for (const test of handoff.tests) {
    for (const step of test.steps) {
      for (const subAction of step.subActions) {
        subAction.stateBefore = { ...subAction.stateBefore, timestamp: 1_725_000_000 }
      }
    }
  }
  const silverTest = handoff.tests[0]!
  const pairTest = structuredClone(silverTest)
  pairTest.testId = 'eval-local::self-heal'
  pairTest.testIndex = 1
  pairTest.steps = [structuredClone(silverTest.steps[0]!)]
  const step = pairTest.steps[0]!
  const failedSub = step.subActions[0]!
  const continueRef2 = asRef('e-continue-2')
  const primaryElement = failedSub.stateBefore.elements[0]!
  failedSub.stateBefore.elements = [
    primaryElement,
    {
      ...structuredClone(primaryElement),
      ref: continueRef2,
      name: 'Continue again',
      nameNormalized: 'continue again',
      labels: { ariaLabel: 'Continue again' },
    },
  ]
  failedSub.stateBefore.refMap = {
    ...failedSub.stateBefore.refMap,
    [continueRef2]: structuredClone(failedSub.stateBefore.refMap[primaryElement.ref]!),
  }
  const recoveringSub = structuredClone(failedSub)
  recoveringSub.plannedAction = { type: 'click', ref: continueRef2 }
  step.subActions = [failedSub, recoveringSub]
  step.selfHeal = {
    failedDecision: decisionFor(failedSub),
    recoveringDecision: decisionFor(recoveringSub),
  }
  handoff.tests = [silverTest, pairTest]
  return handoff
}

function extract(handoff: CompletedRunHandoff): ExtractedCassette[] {
  return extractRunCassettes({ handoff, artifacts: fullArtifacts() }).cassettes
}

function planFor(handoff: CompletedRunHandoff, cassettes: readonly ExtractedCassette[]): SeedingPlan {
  return buildSeedingPlan({ handoff, cassettes, partition: TEST_PARTITION })
}

describe('committed-root proofs (ROOT-02 / GUARD-FUT-04, D-13, D-15)', () => {
  let root: string
  let outDir: string

  function seed(
    plan: SeedingPlan,
    cassettes: readonly ExtractedCassette[],
  ): SeedingReport {
    return seedCommittedCorpus({
      plan,
      cassettes,
      committedRoot: root,
      seedingOutputBaseDir: outDir,
    })
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'eval-local-root-proof-'))
    outDir = await mkdtemp(join(tmpdir(), 'eval-local-root-proof-out-'))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
    await rm(outDir, { recursive: true, force: true })
  })

  it('raw-byte proof, masking layer (GUARD-FUT-04): a MaskingContext-registered value appears nowhere raw in the committed tree', () => {
    const REGISTERED = 'melon-proof-registered-secret-9x7q'
    const redactor = new SecretRedactor(SecretStore.fromEnvContent(`PROOF_TOKEN=${REGISTERED}`))

    const rawUrl = `https://example.test/checkout?token=${REGISTERED}`
    // Positive controls: the unmasked fixture text contains the value, and the
    // mask actually rewrites it to the placeholder.
    expect(rawUrl).toContain(REGISTERED)
    const maskedUrl = redactor.redactString(rawUrl)
    expect(maskedUrl).not.toContain(REGISTERED)
    expect(maskedUrl).toContain('[secret:PROOF_TOKEN]')

    // Apply the mask at the simulated record boundary — upstream of extraction,
    // mirroring how live recording masks evidence before it is ever staged.
    const handoff = seedingHandoff()
    for (const test of handoff.tests) {
      for (const step of test.steps) {
        for (const subAction of step.subActions) {
          subAction.stateBefore = { ...subAction.stateBefore, url: maskedUrl }
        }
      }
    }
    const cassettes = extract(handoff)
    const plan = planFor(handoff, cassettes)

    const report = seed(plan, cassettes)
    expect(report.refusals).toEqual([])
    expect(report.seededCount).toBe(3)

    // The raw registered value appears in ZERO tracked files AND ZERO ignored files.
    const walk = walkCommittedRoot(root)
    expect(walk.trackedPaths.length).toBeGreaterThan(0)
    expect(filesContaining(root, walk.trackedPaths, REGISTERED)).toEqual([])
    expect(filesContaining(root, walk.ignoredPaths, REGISTERED)).toEqual([])

    // The masked placeholder DID land — proof the crafted evidence flowed through.
    expect(filesContaining(root, walk.trackedPaths, '[secret:PROOF_TOKEN]').length).toBeGreaterThan(0)
  })

  it('text/blob partition is total and exclusive over every committed file (D-15)', () => {
    const handoff = seedingHandoff()
    const cassettes = extract(handoff)
    const plan = planFor(handoff, cassettes)

    const report = seed(plan, cassettes)
    expect(report.refusals).toEqual([])

    const walk = walkCommittedRoot(root)
    // The tree exercises BOTH sides: at least one blob landed.
    expect(walk.ignoredPaths.length).toBeGreaterThan(0)
    expect(walk.trackedPaths.length).toBeGreaterThan(0)

    // Ignored side: every ignored file is a blobs/<64-hex> blob and NOTHING else —
    // an ignored file matching a tracked text kind would be a hidden measurement.
    for (const rel of walk.ignoredPaths) {
      expect(rel).toMatch(BLOB_PATH_RE)
      expect(trackedKindsFor(rel)).toEqual([])
    }

    // Tracked side: every tracked file is exactly ONE known text kind, is NOT
    // blob-shaped, and (except the gitignore) parses as JSON. No third category.
    for (const rel of walk.trackedPaths) {
      const kinds = trackedKindsFor(rel)
      expect(kinds, `unclassified tracked file: ${rel}`).toHaveLength(1)
      expect(BLOB_PATH_RE.test(rel)).toBe(false)
      if (rel !== '.gitignore') {
        expect(() => JSON.parse(readFileSync(join(root, rel), 'utf8'))).not.toThrow()
      }
    }
  })

  it('corpus membership invariant holds both ways after seeding, with consistent counts (D-13)', () => {
    const handoff = seedingHandoff()
    const cassettes = extract(handoff)
    const plan = planFor(handoff, cassettes)

    const report = seed(plan, cassettes)
    expect(report.refusals).toEqual([])

    const walk = walkCommittedRoot(root)
    const counts = assertMembershipInvariant(root, walk)

    // Count consistency on a fresh root: bundles === corpus entries === label
    // records === report.seededCount.
    expect(counts.cassetteCount).toBe(report.seededCount)
    expect(counts.labelCount).toBe(report.seededCount)
    expect(counts.corpusCount).toBe(report.seededCount)
    expect(report.seededCount).toBe(3)
  })
})

describe('C441-COMMITTED', () => {
  const CARD = '4242 4242 4242 4242'
  const BEARER = 'Bearer abc123def456ghi789'
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'eval-local-c441-committed-'))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('an eval report with credential-shaped text is committed as written', () => {
    const report = buildEvalReport([])
    const markdown = `# Eval baseline report\n\npaid with ${CARD}\nheader: ${BEARER}\n`

    const outcome = commitEvalReport({ report, markdown, committedRoot: root })

    expect(outcome).toEqual({
      kind: 'committed',
      json: 'written',
      markdown: 'written',
      reportDir: expect.any(String),
    })
    const written = readFileSync(
      join(root, committedReportPath(report.batchKey, COMMITTED_REPORT_MARKDOWN_FILE)),
      'utf8',
    )
    expect(written).toBe(markdown)
    expect(written).toContain(CARD)
    expect(written).toContain(BEARER)
    expect(
      readFileSync(join(root, committedReportPath(report.batchKey, COMMITTED_REPORT_JSON_FILE)), 'utf8'),
    ).toBe(committedFileText(report))
  })

  it('a baseline pointer with the same text is written', () => {
    const report = buildEvalReport([])
    const pointer = {
      ...projectBaselinePointer({
        plannerModelId: 'gpt-5.6-terra',
        fingerprint: 'fp-fixture',
        corpusDigest: 'digest-fixture',
        matcherVersion: 1,
        batchKey: report.batchKey,
      }),
      profileKey: `planner=${CARD}|auth=${BEARER}`,
    }

    const outcome = writeBaselinePointer({ report, pointer, committedRoot: root })

    const relPath = committedBaselinePointerPath(pointer.profileKey)
    expect(outcome).toEqual({ kind: 'written', path: relPath })
    const written = readFileSync(join(root, relPath), 'utf8')
    expect(written).toBe(committedFileText(pointer))
    expect(written).toContain(CARD)
    expect(written).toContain(BEARER)
  })
})
