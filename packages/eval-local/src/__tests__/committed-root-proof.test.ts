// Phase 371 proof obligations for the committed eval root (ROOT-01/ROOT-02).
//
// The raw-byte proof (GUARD-FUT-04): a secret-shaped value planted in staged evidence
// can NEVER reach the git-TRACKED committed set — shown at the pattern-detector layer
// (the committed-egress checkpoint refuses the carrying case) and at the value-masking
// layer (a MaskingContext-registered value masked at the record boundary appears nowhere
// raw in the whole tree). Every negative assertion is paired with a positive control so
// a vacuous pass is impossible (T-371-19).
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
  buildSeedingPlan,
  committedFileText,
  extractRunCassettes,
} from '@vostride/agent-qa-eval'
import type { ArtifactSource, ExtractedCassette, SeedingPlan } from '@vostride/agent-qa-eval'
import {
  createMaskingContext,
  defaultGuardrailPolicyInput,
  loadGuardrailPolicy,
} from '@vostride/agent-qa-safety'
import { asRef } from '@vostride/agent-qa-schema'
import type { CompletedRunHandoff, Decision, SubActionEvidence } from '@vostride/agent-qa-schema'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { BLOBS_SUBDIR } from '../cassette-store.js'
import {
  committedCassettePath,
  committedCorpusPath,
  committedLabelPath,
} from '../committed-root-store.js'
import { seedCommittedCorpus } from '../seeding-composition.js'
import type { SeedingReport } from '../seeding-composition.js'
import {
  LOCAL_FIXTURE_BLOB_BYTES,
  LOCAL_FIXTURE_BLOB_SHA,
  makeLocalV2Handoff,
} from './fixtures/local-handoff-fixture.js'

const HANDOFF_PATH = '.agent-qa/runs/run---eval-local-standalone/handoff.json'
// AKIA + 16 uppercase-alphanumerics — the exact shape the awsKey PATTERN detector
// catches (an arbitrary random string would NOT be detected — Research Pitfall 4).
const AWS_KEY = 'AKIAIOSFODNN7EXAMPLE'
const PRODUCT = 'default'

const policy = loadGuardrailPolicy(defaultGuardrailPolicyInput)

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
  return buildSeedingPlan({ handoff, cassettes, handoffPath: HANDOFF_PATH })
}

/** Plant the AWS-key-shaped secret in ONE staged cassette's text evidence. */
function plantSecret(
  cassettes: readonly ExtractedCassette[],
  plan: SeedingPlan,
): { staged: ExtractedCassette[]; plantedId: string } {
  const targetCase = plan.cases.find(
    (planCase) => planCase.labelRecord.label.pairing?.relation === 'contrastive-negative',
  )!
  const staged = structuredClone(cassettes) as ExtractedCassette[]
  const target = staged.find((entry) => entry.cassette.id === targetCase.cassetteId)!
  if (target.cassette.granularity !== 'leaf') throw new Error('fixture pair member must be a leaf')
  target.cassette.input.stateBefore.url = `https://example.test/checkout?key=${AWS_KEY}`
  return { staged, plantedId: targetCase.cassetteId }
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
      policy,
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

  it('raw-byte proof, detector layer (GUARD-FUT-04): a planted secret never reaches the tracked committed set', () => {
    const handoff = seedingHandoff()
    const cassettes = extract(handoff)
    const plan = planFor(handoff, cassettes)
    const { staged, plantedId } = plantSecret(cassettes, plan)

    // Positive control FIRST: the secret IS present in the staged input fixture —
    // the exact text the seeding helper would commit — so the probe below is live.
    const stagedTarget = staged.find((entry) => entry.cassette.id === plantedId)!
    expect(committedFileText(stagedTarget.cassette)).toContain(AWS_KEY)

    const report = seed(plan, staged)

    // (1) The carrying case is refused, with a detection naming the detector.
    expect(report.refusals).toHaveLength(1)
    const refusal = report.refusals[0]!
    expect(refusal.cassetteId).toBe(plantedId)
    expect(refusal.kind).toBe('egress-blocked')
    if (refusal.kind !== 'egress-blocked') throw new Error('expected egress-blocked refusal')
    expect(refusal.detections.some((detection) => detection.detector === 'awsKey')).toBe(true)

    // (2) Raw-byte walk of the git-TRACKED committed set: zero occurrences. The
    // walker's exclusion rules come from the scaffolded .gitignore on disk, and
    // that file must contain a rule covering blobs dirs.
    const walk = walkCommittedRoot(root)
    expect(walk.ignoredDirNames).toContain(BLOBS_SUBDIR)
    expect(walk.trackedPaths.length).toBeGreaterThan(0)
    expect(filesContaining(root, walk.trackedPaths, AWS_KEY)).toEqual([])
    // Stronger than required: the ignored (blob) side is clean too.
    expect(filesContaining(root, walk.ignoredPaths, AWS_KEY)).toEqual([])

    // (4) The refusal was per-case: clean siblings in the same batch landed.
    expect(report.seededCount).toBe(2)
    const landedIds = plan.cases
      .map((planCase) => planCase.cassetteId)
      .filter((id) => id !== plantedId)
    for (const id of landedIds) {
      expect(walk.trackedPaths).toContain(committedCassettePath(PRODUCT, id))
    }
  })

  it('raw-byte proof, masking layer (GUARD-FUT-04): a MaskingContext-registered value appears nowhere raw in the committed tree', () => {
    const REGISTERED = 'melon-proof-registered-secret-9x7q'
    const context = createMaskingContext()
    context.register(REGISTERED)

    const rawUrl = `https://example.test/checkout?token=${REGISTERED}`
    // Positive controls: the unmasked fixture text contains the value, and the
    // mask actually rewrites it to the placeholder.
    expect(rawUrl).toContain(REGISTERED)
    const maskedUrl = context.mask(rawUrl)
    expect(maskedUrl).not.toContain(REGISTERED)
    expect(maskedUrl).toContain('<SECRET_0>')

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
    expect(filesContaining(root, walk.trackedPaths, '<SECRET_0>').length).toBeGreaterThan(0)
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

  it('membership invariant survives refusals: the refused case is absent from all three trees (D-13 x D-14)', () => {
    const handoff = seedingHandoff()
    const cassettes = extract(handoff)
    const plan = planFor(handoff, cassettes)
    const { staged, plantedId } = plantSecret(cassettes, plan)

    const report = seed(plan, staged)
    expect(report.refusals).toHaveLength(1)
    expect(report.refusals[0]!.cassetteId).toBe(plantedId)
    expect(report.seededCount).toBe(2)

    const walk = walkCommittedRoot(root)
    // The refused case appears in NONE of the three trees.
    expect(walk.trackedPaths).not.toContain(committedCassettePath(PRODUCT, plantedId))
    expect(walk.trackedPaths).not.toContain(committedLabelPath(PRODUCT, plantedId))
    expect(walk.trackedPaths).not.toContain(committedCorpusPath(PRODUCT, plantedId))

    // And the invariant still holds both ways over what DID land.
    const counts = assertMembershipInvariant(root, walk)
    expect(counts.cassetteCount).toBe(report.seededCount)
    expect(counts.labelCount).toBe(report.seededCount)
    expect(counts.corpusCount).toBe(report.seededCount)
  })
})
