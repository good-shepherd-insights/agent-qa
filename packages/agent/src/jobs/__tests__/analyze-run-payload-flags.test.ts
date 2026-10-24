// The READER half of WTST-06's payload propagation (Phase 393, D-20).
//
// `post-run-tail.ts` copies `gateRun` and `excludedFromOutcomes` from the loaded handoff onto the
// enqueued `analyze-run` payload, and `AnalyzeRunPayloadSchema` validates that mint on the
// producer side. This file pins the other end: the hand-rolled reader in `kinds.ts`, which is
// deliberately NOT the schema — it reads payloads off a DURABLE queue, where a job may have been
// written by an older or a newer build, so refusing an unexpected shape would strand work rather
// than protect anything. The asymmetry is the design (see the schema module's header); this suite
// exists so nobody "fixes" it into a second strict validator.
//
// Three claims, and the third is the one that makes the first two non-vacuous:
//
//  1. BACK-COMPAT. A four-field payload — byte-for-byte what every queued job in an existing
//     store holds — is still read, and reads with BOTH flags absent rather than `false`. Absence
//     and `false` are different answers: `false` would let a downstream `if (payload.gateRun !==
//     undefined)` treat a perfectly ordinary run as a gate run.
//  2. PER-AXIS. The two markers are DISTINCT axes (C8, 384 D-10 / 388 D-14): a gate run still
//     feeds curation, so `gateRun` without `excludedFromOutcomes` is a real combination and must
//     not be read as an implication of its sibling.
//  3. THE READER UNDER TEST IS THE HANDLER'S READER. Claims 1 and 2 reach an exported function;
//     on their own they would still hold if the handler had quietly grown a second parse. So the
//     last two cases drive the REAL analyze-run handler through the registry and read which
//     permanent refusal comes back — a flagged payload must get PAST the shape refusal and die at
//     the handoff load, while a genuinely shapeless payload must die at the shape refusal. Both
//     sides move; a one-sided version of this would pass against a handler that refuses nothing.

import type { Job, JobHandlerOutcome } from '@vostride/agent-qa-schema'
import { describe, expect, it } from 'vitest'

import { createRealJobKindRegistry, readAnalyzeRunPayload } from '../kinds.js'
import type { AnalyzeRunPayload, PostRunJobCapabilities } from '../kinds.js'
import type { JobHandlerContext } from '../kind-registry.js'

const RUN_ID = 'run-393-05-payload-flags'

/** Byte-for-byte the shape `post-run-tail.ts` enqueued before this plan. */
const LEGACY_PAYLOAD = {
  runId: RUN_ID,
  handoffDigest: 'sha256:2b7f0c',
  handoffSchemaVersion: 6,
  executionContext: 'local-headless',
} as const

/**
 * Capabilities whose handoff load ALWAYS throws.
 *
 * Deliberate: the handler cases below are about WHICH refusal comes back, and a load that throws
 * gives the shape gate and the load gate two distinguishable messages one line apart. Nothing
 * here asserts anything about analysis itself.
 */
const LOAD_THROWS: PostRunJobCapabilities = {
  loadCompletedRunHandoff: () => {
    throw new Error('the handoff store is unreachable')
  },
  curateRun: async () => ({ curated: 0, deprecated: 0, complete: true }),
  persistAnalysis: () => {},
}

function contextFor(payload: unknown): JobHandlerContext {
  const job = {
    id: 'job_analyze_payload_flags',
    kind: 'analyze-run',
    status: 'queued',
    summary: 'fixture',
    attempts: 1,
    createdAt: '2026-08-10T00:00:00.000Z',
    updatedAt: '2026-08-10T00:00:00.000Z',
  } as unknown as Job
  return {
    job,
    payload,
    publishCheckpoint: async () => {},
    recordLlmAuthorship: (async (
      _checkpointId: string,
      author: (model: unknown) => Promise<unknown>,
    ) => author({ modelId: 'stub', generate: async () => ({ text: '' }) })) as unknown as
      JobHandlerContext['recordLlmAuthorship'],
  }
}

async function runAnalyzeRun(payload: unknown): Promise<JobHandlerOutcome> {
  return createRealJobKindRegistry(LOAD_THROWS).require('analyze-run').handler(contextFor(payload))
}

describe('readAnalyzeRunPayload — WTST-06 D-20 flag propagation, read half', () => {
  it('accepts the legacy four-field payload with BOTH flags absent, never false', () => {
    const read = readAnalyzeRunPayload(LEGACY_PAYLOAD)
    expect(read).toBeDefined()
    expect(read).toMatchObject({
      runId: RUN_ID,
      handoffDigest: 'sha256:2b7f0c',
      handoffSchemaVersion: 6,
      executionContext: 'local-headless',
    })
    // `undefined`, not `false`. A reader that normalised absence to `false` would make every
    // legacy job in a durable queue claim, positively, that it is not a gate run — a claim the
    // enqueuer never made.
    expect(read?.gateRun).toBeUndefined()
    expect(read?.excludedFromOutcomes).toBeUndefined()
  })

  it('exposes both flags from a payload that carries both', () => {
    const read = readAnalyzeRunPayload({
      ...LEGACY_PAYLOAD,
      gateRun: true,
      excludedFromOutcomes: true,
    })
    expect(read?.gateRun).toBe(true)
    expect(read?.excludedFromOutcomes).toBe(true)
  })

  it('reads each flag independently — the two are DISTINCT axes (C8)', () => {
    // C8, owner-ratified: gate runs DO feed curation. So `gateRun` alone is not a half-expressed
    // exclusion, it is the ordinary shape of a verify-before-present run whose evidence still
    // counts. Reading either flag as implying the other would silently widen the exclusion.
    const gateOnly = readAnalyzeRunPayload({ ...LEGACY_PAYLOAD, gateRun: true })
    expect(gateOnly?.gateRun).toBe(true)
    expect(gateOnly?.excludedFromOutcomes).toBeUndefined()

    const excludedOnly = readAnalyzeRunPayload({ ...LEGACY_PAYLOAD, excludedFromOutcomes: true })
    expect(excludedOnly?.excludedFromOutcomes).toBe(true)
    expect(excludedOnly?.gateRun).toBeUndefined()
  })

  it('treats a literal false on the wire as absent — only the marker is meaningful', () => {
    // The handoff carrier is `?: true` and the producer schema REFUSES `false` outright. The
    // reader cannot refuse (a durable queue entry it cannot read is a stranded job), so it
    // degrades to the same answer absence gives rather than inventing a third state.
    const read = readAnalyzeRunPayload({
      ...LEGACY_PAYLOAD,
      gateRun: false,
      excludedFromOutcomes: false,
    })
    expect(read).toBeDefined()
    expect(read?.gateRun).toBeUndefined()
    expect(read?.excludedFromOutcomes).toBeUndefined()
  })

  it('still ignores unknown keys — forward tolerance is why this reader is not the schema', () => {
    const read = readAnalyzeRunPayload({ ...LEGACY_PAYLOAD, gateRunReason: 'draft-eval' })
    expect(read).toBeDefined()
    expect(read).not.toHaveProperty('gateRunReason')
  })

  it('still refuses a payload missing the digest — the digest names the analysed bytes', () => {
    const { handoffDigest: _dropped, ...withoutDigest } = LEGACY_PAYLOAD
    expect(readAnalyzeRunPayload(withoutDigest)).toBeUndefined()
  })

  it('exposes the flags on the AnalyzeRunPayload claim type', () => {
    // A type-level pin: if the interface loses the optional fields, this stops compiling and
    // `tsc --noEmit` reds even though every runtime assertion above would still pass.
    const claim: AnalyzeRunPayload | undefined = readAnalyzeRunPayload({
      ...LEGACY_PAYLOAD,
      gateRun: true,
      excludedFromOutcomes: true,
    })
    const flags: { gateRun?: true; excludedFromOutcomes?: true } = {
      ...(claim?.gateRun === undefined ? {} : { gateRun: claim.gateRun }),
      ...(claim?.excludedFromOutcomes === undefined
        ? {}
        : { excludedFromOutcomes: claim.excludedFromOutcomes }),
    }
    expect(flags).toEqual({ gateRun: true, excludedFromOutcomes: true })
  })
})

describe('the real analyze-run handler reads THIS reader (D-20 join)', () => {
  it('lets a flagged payload past the shape refusal — it dies at the handoff load instead', async () => {
    const outcome = await runAnalyzeRun({
      ...LEGACY_PAYLOAD,
      gateRun: true,
      excludedFromOutcomes: true,
    })
    expect(outcome.status).toBe('permanent')
    // The load gate's message, one line PAST the shape gate. Getting here is the evidence that
    // the handler's parse accepted the six-field shape.
    expect(String((outcome as { reason: string }).reason)).toContain('could not be read')
    expect(String((outcome as { reason: string }).reason)).not.toContain('nothing for this job')
  })

  it('and still refuses a shapeless payload at the shape gate — the other cell moves', async () => {
    const outcome = await runAnalyzeRun({ gateRun: true, excludedFromOutcomes: true })
    expect(outcome.status).toBe('permanent')
    expect(String((outcome as { reason: string }).reason)).toContain('nothing for this job')
  })
})

// ---------------------------------------------------------------------------------------
// 422-15: the circularity copy on the wire (D-17/D-18).
//
// The same asymmetry as the two markers above, with one difference that matters. `gateRun` and
// `excludedFromOutcomes` degrade to absence when they are half-expressed, because a misread
// marker is a visibility loss. This member is a CLAIM about evidence: dropping a present-but-
// unreadable one would re-read a gated run as a historical one and hand its no-trust-change
// verdict the acceptance surface the ledger exists to withdraw. So absence stays tolerant and
// unreadability becomes its own answer.
// ---------------------------------------------------------------------------------------

describe('readAnalyzeRunPayload — the 422 circularity copy', () => {
  const ROW = {
    runId: RUN_ID,
    perTest: 0,
    stepIndex: 0,
    decisionOrdinal: 0,
    recordId: 'rec-alpha',
    handoffBaseDigest: 'sha256:base',
    briefDigest: 'sha256:brief',
    corpusDigest: 'sha256:corpus',
    profileDigest: 'sha256:profile',
    crossCheck: 'held',
    seedHonored: true,
  } as const

  it('keeps the legacy four-field payload ABSENT rather than empty', () => {
    const read = readAnalyzeRunPayload(LEGACY_PAYLOAD)
    expect(read).toBeDefined()
    expect('misdirectionEvidence' in (read as object)).toBe(false)
    expect(read?.misdirectionEvidenceUnreadable).toBeUndefined()
  })

  it('keeps an EMPTY ledger empty — the arbiter ran and recorded nothing', () => {
    const read = readAnalyzeRunPayload({ ...LEGACY_PAYLOAD, misdirectionEvidence: [] })
    expect(read?.misdirectionEvidence).toEqual([])
    expect(read?.misdirectionEvidenceUnreadable).toBeUndefined()
  })

  it('carries complete rows through verbatim', () => {
    const read = readAnalyzeRunPayload({ ...LEGACY_PAYLOAD, misdirectionEvidence: [ROW] })
    expect(read?.misdirectionEvidence).toEqual([ROW])
  })

  it('marks a half-spelled row UNREADABLE rather than dropping the claim', () => {
    const { recordId: _dropped, ...incomplete } = ROW
    const read = readAnalyzeRunPayload({
      ...LEGACY_PAYLOAD,
      misdirectionEvidence: [incomplete],
    })
    expect(read).toBeDefined()
    expect(read?.misdirectionEvidence).toBeUndefined()
    expect(read?.misdirectionEvidenceUnreadable).toBe(true)
  })

  it('marks a non-array member unreadable too — a ledger is a list or it is not one', () => {
    const read = readAnalyzeRunPayload({
      ...LEGACY_PAYLOAD,
      misdirectionEvidence: { rows: [ROW] },
    })
    expect(read?.misdirectionEvidenceUnreadable).toBe(true)
  })

  it('refuses a word outside the closed cross-check vocabulary', () => {
    const read = readAnalyzeRunPayload({
      ...LEGACY_PAYLOAD,
      misdirectionEvidence: [{ ...ROW, crossCheck: 'cleared' }],
    })
    expect(read?.misdirectionEvidenceUnreadable).toBe(true)
  })

  it('still ignores unknown SIBLING keys — the tolerance is about generation, not shape', () => {
    const read = readAnalyzeRunPayload({
      ...LEGACY_PAYLOAD,
      misdirectionEvidence: [ROW],
      misdirectionCapSource: 'default',
    })
    expect(read?.misdirectionEvidence).toEqual([ROW])
    expect(read).not.toHaveProperty('misdirectionCapSource')
  })
})

describe('the real analyze-run handler refuses an unreadable ledger (422 D-18)', () => {
  it('dies at the ledger gate, not at the shape gate', async () => {
    const outcome = await runAnalyzeRun({
      ...LEGACY_PAYLOAD,
      misdirectionEvidence: ['not a row'],
    })
    expect(outcome.status).toBe('permanent')
    // LOAD_THROWS makes the handoff unreadable, so reaching the load message proves the payload's
    // own shape was accepted; the ledger gate sits after the digest check and therefore after it.
    expect(String((outcome as { reason: string }).reason)).toContain('could not be read')
  })
})
