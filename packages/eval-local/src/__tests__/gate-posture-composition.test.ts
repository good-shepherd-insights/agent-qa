import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  buildSeedingPlan,
  committedFileText,
  countGateSet,
  extractRunCassettes,
  projectPartitionManifest,
  assessPanelEligibility,
  createPanelIdentity,
} from '@vostride/agent-qa-eval'
import type { ArtifactSource, ExtractedCassette, SeedingPlan } from '@vostride/agent-qa-eval'
import { defaultGuardrailPolicyInput, loadGuardrailPolicy } from '@vostride/agent-qa-safety'
import type { CompletedRunHandoff } from '@vostride/agent-qa-schema'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { readCommittedCorpus } from '../committed-corpus-source.js'
import {
  FsCommittedRootStore,
  committedPartitionManifestPath,
} from '../committed-root-store.js'
import { readGatePostureFor } from '../gate-posture-composition.js'
import { seedCommittedCorpus, writePartitionManifest } from '../seeding-composition.js'
import {
  LOCAL_FIXTURE_BLOB_BYTES,
  LOCAL_FIXTURE_BLOB_SHA,
  makeLocalV2Handoff,
} from './fixtures/local-handoff-fixture.js'

/** The 414-05 shared partition vector — the same one the read-leg cells use. */
const TEST_PARTITION = {
  saltHex: 'a3f'.repeat(21).concat('b'),
  heldOutFraction: 0.95,
  privateFraction: 0.5,
} as const

const PRODUCT = 'default'
const PLANNER_MODEL_ID = 'gpt-5.6-terra'
const policy = loadGuardrailPolicy(defaultGuardrailPolicyInput)

function fullArtifacts(): ArtifactSource {
  const entries = new Map<string, Uint8Array>([[LOCAL_FIXTURE_BLOB_SHA, LOCAL_FIXTURE_BLOB_BYTES]])
  return { getBlob: (sha) => entries.get(sha) }
}

function sourceHandoff(): CompletedRunHandoff {
  const handoff = makeLocalV2Handoff()
  for (const test of handoff.tests) {
    for (const step of test.steps) {
      for (const subAction of step.subActions) {
        subAction.stateBefore = { ...subAction.stateBefore, timestamp: 1_725_000_000 }
      }
    }
  }
  return handoff
}

function extract(handoff: CompletedRunHandoff): ExtractedCassette[] {
  return extractRunCassettes({ handoff, artifacts: fullArtifacts() }).cassettes
}

describe('readGatePostureFor (414 D-15, ROOT-10)', () => {
  let root: string
  let outDir: string
  let plan: SeedingPlan

  function posture(committedRoot: string) {
    return readGatePostureFor({
      committedRoot,
      scope: { tier: 'product', key: PRODUCT },
      minimumGateSet: 1,
      judge: { plannerModelId: PLANNER_MODEL_ID },
      canary: { kind: 'not-provided' },
    })
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'eval-local-gate-posture-root-'))
    outDir = await mkdtemp(join(tmpdir(), 'eval-local-gate-posture-out-'))
    const handoff = sourceHandoff()
    const cassettes = extract(handoff)
    plan = buildSeedingPlan({ handoff, cassettes, partition: TEST_PARTITION })
    seedCommittedCorpus({
      plan,
      cassettes,
      committedRoot: root,
      seedingOutputBaseDir: outDir,
      policy,
    })
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
    await rm(outDir, { recursive: true, force: true })
  })

  it('composes the read leg and the manifests into the posture for one scope', () => {
    const manifest = projectPartitionManifest({
      product: PRODUCT,
      saltHex: TEST_PARTITION.saltHex,
      heldOutFraction: TEST_PARTITION.heldOutFraction,
      privateFraction: TEST_PARTITION.privateFraction,
    })
    expect(
      writePartitionManifest({
        manifest,
        committedRoot: root,
        seedingOutputBaseDir: outDir,
        policy,
      }).kind,
    ).toBe('written')

    const read = readCommittedCorpus(root)
    const result = posture(root)

    expect(result.refusals).toEqual([])
    expect(result.posture.scope.partition).toBe(PRODUCT)
    expect(result.posture.scope.resolution).toBe('product-key')
    expect(result.posture.partition.kind).toBe('present')
    // The counts are eval's ONE counter over the entries the read leg loaded.
    expect(result.posture.counts).toEqual(countGateSet(read.snapshot.entries))
    expect(result.posture.gateSetNonEmpty).toBe(true)
    expect(result.posture.minimumGateSet).toBe(1)
    expect(result.posture.judge.reason).toBe('no-judge-configured')
    expect(result.posture.canary).toEqual({ kind: 'not-provided' })
    // T-414-15: the salt never travels; the echo carries its digest.
    expect(JSON.stringify(result.posture)).not.toContain(TEST_PARTITION.saltHex)
  })

  it.each([false, true])('keeps the entire refused panel across the disk fold (absent root: %s)', absent => {
    const ids = ['claude-opus-4', 'gemini-2.5']
    const result = readGatePostureFor({ committedRoot: absent ? join(root, 'absent') : root,
      scope: { tier: 'product', key: PRODUCT }, minimumGateSet: 1,
      judge: { plannerModelId: PLANNER_MODEL_ID, judgeMemberModelIds: ids,
        recordedModelId: 'gemini-recorded' }, canary: { kind: 'not-provided' } })
    const eligibility = assessPanelEligibility({ memberModelIds: ids,
      replayedModelId: PLANNER_MODEL_ID, recordedModelId: 'gemini-recorded' })
    expect(result.posture.judge).toMatchObject({ capable: false, reason: 'no-eligible-judge',
      panelSize: 2, members: createPanelIdentity(ids).members,
      families: 'families' in eligibility ? eligibility.families : undefined })
    expect(result.posture.gateSetNonEmpty).toBe(!absent)
  })

  it('answers over an absent root with zeros, an absent partition and the read notice', () => {
    const absent = join(root, 'does-not-exist')

    const result = posture(absent)

    expect(result.posture.counts).toEqual({
      natural: 0,
      heldOutShared: 0,
      heldOutPrivate: 0,
      adversarial: 0,
    })
    expect(result.posture.gateSetNonEmpty).toBe(false)
    expect(result.posture.partition).toEqual({ kind: 'absent' })
    expect(result.refusals).toEqual([])
    expect(result.notices.some((notice) => notice.includes('does-not-exist'))).toBe(true)
  })

  it('surfaces a refused manifest in refusals and still returns the posture', () => {
    const store = new FsCommittedRootStore({ committedRoot: root })
    const relPath = committedPartitionManifestPath(PRODUCT)
    store.writeText(
      relPath,
      committedFileText({
        ...projectPartitionManifest({
          product: PRODUCT,
          saltHex: TEST_PARTITION.saltHex,
          heldOutFraction: TEST_PARTITION.heldOutFraction,
          privateFraction: TEST_PARTITION.privateFraction,
        }),
        salt: 'a'.repeat(63),
      }),
    )

    const result = posture(root)

    expect(result.refusals).toHaveLength(1)
    expect(result.refusals[0]?.path).toBe(join(root, relPath))
    expect(result.refusals[0]?.reason).toContain('partition manifest rejected:')
    // A refused manifest is a manifest that is not there: the posture still answers.
    expect(result.posture.partition).toEqual({ kind: 'absent' })
    expect(result.posture.gateSetNonEmpty).toBe(true)
  })
})
