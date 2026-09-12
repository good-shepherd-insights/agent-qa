/**
 * 422-06-T2 — a provider call that can be interrupted honestly.
 *
 * THE PROBLEM THIS FILE EXISTS FOR. 422-03's recovery model is idempotent recomputation plus
 * durable publication, and it is sound only because derivation and scanning are PURE: an
 * interrupted refresh simply re-derives the same bytes and publishes them again. A provider call
 * is not pure. A response that arrives after the process dies has been paid for and lost, and
 * re-running the same request pays a second time for a question that was already asked. So the
 * record of the ASK has to exist BEFORE the ask, and it has to survive a restart.
 *
 * THREE STATES, AND THEY MUST STAY THREE. A tuple this refresh never touched, a tuple that was
 * asked and answered with a refusal, and a tuple that was ANNOUNCED AND NEVER ANSWERED are three
 * different facts about spend, and collapsing any pair of them is how an interrupted run comes
 * to read as a free one. The store encodes them structurally rather than by a status field a
 * crash could fail to write: no reservation is `unattempted`, a reservation with a completion is
 * `completed`, and a reservation WITHOUT one is `interrupted` — which is exactly the state a
 * process that died between the call and the answer leaves behind, because it is the state it
 * leaves behind by doing nothing.
 *
 * THE INTERRUPTION WINDOWS ARE EXERCISED, NOT REASONED ABOUT. Every cell below reproduces a
 * specific instant — between reserve and call, between call and publish, and two owners racing
 * for one tuple — by driving the store at the seam where that instant actually is, rather than
 * by asserting that the code looks like it would be safe.
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ADVERSARIAL_PROMPT_HASH,
  ADVERSARIAL_PROMPT_VERSION,
  PROBE_GENERATOR_KINDS,
  extractRunCassettes,
  projectCorpusEntry,
  projectSilverLabelRecord,
  type ArtifactSource,
  type AuthoringModel,
  type GenerationRequest,
  type LeafCassette,
  type ProbeAuthorPort,
  type ProbeGeneratorKind,
  type ProbeText,
  type SeedingPlan,
} from '@vostride/agent-qa-eval'
import { asRunId, computeBriefDigest, type LosslessServedBriefProofV1 } from '@vostride/agent-qa-schema'
import {
  ADVERSARIAL_STAGING_SUBDIR,
  adversarialProbeTupleKey,
  loadAdversarialGuardrailPolicy,
  stageAdversarialProposal,
  type StageAdversarialProposalResult,
} from '../adversarial-composition.js'
import { COMMITTED_CASSETTES_DIR } from '../committed-root-store.js'
import {
  ADVERSARIAL_PROBE_SUBDIR,
  completeProbeCall,
  probeReservationOf,
  readProbeAttempt,
  readProbeAttempts,
  reserveProbeCall,
  type ProbeReservationKey,
} from '../adversarial-state.js'
import { seedCommittedCorpus } from '../seeding-composition.js'
import {
  LOCAL_FIXTURE_BLOB_BYTES,
  LOCAL_FIXTURE_BLOB_SHA,
  makeLocalV2Handoff,
} from './fixtures/local-handoff-fixture.js'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const POLICY = loadAdversarialGuardrailPolicy()

const AUTHOR: AuthoringModel = { id: 'fixture-probe-author-42206', family: 'fixture-family' }
const OTHER_AUTHOR: AuthoringModel = { id: 'fixture-second-author-42206', family: 'second-family' }

function proof(): LosslessServedBriefProofV1 {
  return {
    schemaVersion: 1,
    completeness: 'lossless',
    recordCap: 8,
    combinedBudget: 2048,
    admissionEvents: [],
    promptTurns: [
      {
        ordinal: 0,
        turnOrdinal: 0,
        runDate: '2026-09-11',
        policyL0: 'policy',
        learnedL1: 'learned one',
        learnedL2: 'learned two',
        contextTier: 'context',
        volatileTier: 'volatile',
        policyDigest: '1'.repeat(64),
        contextTierDigest: '2'.repeat(64),
        volatileTierDigest: '3'.repeat(64),
      },
    ],
  }
}

const artifacts: ArtifactSource = {
  getBlob: sha => (sha === LOCAL_FIXTURE_BLOB_SHA ? LOCAL_FIXTURE_BLOB_BYTES : undefined),
}

interface Fixture {
  root: string
  committedRoot: string
  agentQaRoot: string
  seedIds: readonly string[]
}

/** A committed root carrying `count` distinct proof-backed natural leaf seeds, ascending by id. */
function fixture(count = 1): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'adversarial-probe-recovery-'))
  roots.push(root)
  const committedRoot = join(root, 'committed')
  const agentQaRoot = join(root, '.agent-qa')
  mkdirSync(agentQaRoot, { recursive: true })
  const seedIds: string[] = []
  for (let index = 0; index < count; index += 1) {
    const runId = `run / adversarial-probe-recovery ${String(index).padStart(2, '0')}`
    const handoff = makeLocalV2Handoff({ runId: asRunId(runId) })
    const member = handoff.tests[0]!
    member.steps = [member.steps[0]!]
    const brief = member.steps[0]!.servedBrief
    brief.proof = proof()
    // A proof alone is not proof-backing: the seed must have been served something.
    brief.channel3 = [{ id: 'adversarial-probe-caution' as never, anchors: [], summary: 'served caution' }]
    brief.briefDigest = computeBriefDigest(brief)
    const extraction = extractRunCassettes({ handoff, artifacts })
    const extracted = extraction.cassettes.find(row => row.cassette.granularity === 'leaf')!
    const seed = extracted.cassette as LeafCassette
    const plan: SeedingPlan = {
      product: 'default',
      runId: handoff.runId,
      runSlug: `adversarial-probe-recovery-${String(index).padStart(2, '0')}`,
      cases: [
        {
          cassetteId: seed.id,
          labelRecord: projectSilverLabelRecord({ cassette: seed, runId: handoff.runId }),
          corpusEntry: projectCorpusEntry({
            cassette: seed,
            product: 'default',
            runId: handoff.runId,
            assignment: { split: 'natural' },
          }),
        },
      ],
      pairSkips: [],
      silverExclusions: [],
      pairCounts: { total: 0, sameState: 0, differingState: 0 },
      proceduresExcludedCount: 0,
    }
    expect(
      seedCommittedCorpus({
        plan,
        cassettes: [{ cassette: seed, blobs: extracted.blobs }],
        committedRoot,
        seedingOutputBaseDir: join(agentQaRoot, 'eval', 'audit', 'probe-recovery-seed'),
      }).refusals,
    ).toEqual([])
    seedIds.push(seed.id)
  }
  expect(new Set(seedIds).size).toBe(count)
  return { root, committedRoot, agentQaRoot, seedIds: [...seedIds].sort() }
}

function keyOf(f: Fixture, seedIndex = 0, kind: ProbeGeneratorKind = PROBE_GENERATOR_KINDS[0]): ProbeReservationKey {
  return {
    product: 'default',
    seedCassetteId: f.seedIds[seedIndex]!,
    kind,
    promptVersion: ADVERSARIAL_PROMPT_VERSION,
  }
}

interface RecordingAuthor {
  port: ProbeAuthorPort
  requests: GenerationRequest[]
  /** What the store said about the tuple AT THE INSTANT the port was entered. */
  statesAtCall: string[]
}

/**
 * A port that answers, and that reads the durable store from INSIDE the call.
 *
 * `statesAtCall` is the whole point: a reservation written after the answer would leave
 * `unattempted` here, so a cell that only inspected the store afterwards could not tell a
 * reserve-then-call from a call-then-reserve.
 */
function recordingAuthor(f: Fixture, answer: (request: GenerationRequest) => string): RecordingAuthor {
  const requests: GenerationRequest[] = []
  const statesAtCall: string[] = []
  return {
    requests,
    statesAtCall,
    port: {
      author: async (request: GenerationRequest): Promise<ProbeText> => {
        requests.push(request)
        statesAtCall.push(readProbeAttempt({
          agentQaRoot: f.agentQaRoot,
          key: {
            product: 'default',
            seedCassetteId: request.seedCassetteId,
            kind: request.kind,
            promptVersion: request.promptVersion,
          },
        }).kind)
        return { text: answer(request), usage: { promptTokens: 101, completionTokens: 11 } }
      },
    },
  }
}

/** A port that answers but reports NO usage — the provider that tells you nothing. */
function silentUsageAuthor(): { port: ProbeAuthorPort; calls: number } {
  const state = { calls: 0 }
  return {
    get calls() { return state.calls },
    port: {
      author: async (request: GenerationRequest): Promise<ProbeText> => {
        state.calls += 1
        return { text: `Continue to ${request.kind} review`, usage: {} }
      },
    },
  }
}

/** A port that never answers — the provider that failed, or the one the process outlived. */
function throwingAuthor(): { port: ProbeAuthorPort; calls: number[] } {
  const calls: number[] = []
  return {
    calls,
    port: {
      author: async (): Promise<ProbeText> => {
        calls.push(calls.length)
        throw new Error('the provider did not answer')
      },
    },
  }
}

async function stage(
  f: Fixture,
  opts: {
    author?: ProbeAuthorPort
    authoringModel?: AuthoringModel
    maxProbeCalls?: number
  } = {},
): Promise<StageAdversarialProposalResult> {
  return await stageAdversarialProposal({
    agentQaRoot: f.agentQaRoot,
    committedRoot: f.committedRoot,
    product: 'default',
    policy: POLICY,
    // One deterministic family keeps the batch small; the authored half is what is under test.
    mutators: ['confusable'],
    ...(opts.author === undefined
      ? {}
      : { probeAuthor: opts.author, authoringModel: opts.authoringModel ?? AUTHOR }),
    ...(opts.maxProbeCalls === undefined ? {} : { maxProbeCalls: opts.maxProbeCalls }),
  })
}

function probeCases(result: StageAdversarialProposalResult) {
  return result.staged.filter(row => row.promptVersion !== undefined)
}

/** Erase the reviewed batches, as a run that died before publishing would leave them. */
function discardStagedBatches(f: Fixture): void {
  rmSync(join(f.agentQaRoot, ADVERSARIAL_STAGING_SUBDIR), { recursive: true, force: true })
}

/**
 * Take the seed blob tree out from under the committed root, and put it back.
 *
 * This is the transient disk failure `resolveSeedBlobs` reports as `blob-unresolvable` — an
 * operational fault a repaired root fixes, NOT a statement about the bytes.
 */
function blobOutage(f: Fixture): { restore: () => void } {
  const live = join(f.committedRoot, COMMITTED_CASSETTES_DIR)
  const parked = join(f.root, 'parked-blobs')
  // ONLY the blob trees: the cassette and label documents must stay readable, or the seed
  // never becomes a candidate and no call is ever made.
  const blobDirs: string[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const child = join(dir, entry.name)
      if (entry.name === 'blobs') blobDirs.push(child)
      else walk(child)
    }
  }
  walk(live)
  expect(blobDirs.length).toBeGreaterThan(0)
  const saved = blobDirs.map((dir, index) => {
    const copy = join(parked, String(index))
    cpSync(dir, copy, { recursive: true })
    rmSync(dir, { recursive: true, force: true })
    return { dir, copy }
  })
  return {
    restore: () => {
      for (const { dir, copy } of saved) cpSync(copy, dir, { recursive: true })
    },
  }
}

function probeStoreFiles(f: Fixture): string[] {
  const dir = join(f.agentQaRoot, ADVERSARIAL_PROBE_SUBDIR, 'default')
  try {
    return readdirSync(dir).sort()
  } catch {
    return []
  }
}

describe('422 adversarial probe reservations — one call per tuple, honest interruption', () => {
  it('reserves durably before the port is entered, and the reservation survives the batch', async () => {
    const f = fixture()
    const author = recordingAuthor(f, request => `Continue to ${request.kind} review`)

    const result = await stage(f, { author: author.port })

    expect(result.kind).toBe('staged')
    expect(author.requests).toHaveLength(PROBE_GENERATOR_KINDS.length)
    // THE ORDERING CLAIM, read from inside the call: the store already knew about this tuple
    // before a single byte left for a provider. `interrupted` is what a held-but-unanswered
    // reservation looks like — which is precisely the state a call in flight is in.
    expect(author.statesAtCall).toEqual(PROBE_GENERATOR_KINDS.map(() => 'interrupted'))
    expect(result.spend.modelCalls).toBe(PROBE_GENERATOR_KINDS.length)
    expect(result.spend.usageKnown).toBe(true)

    // Every tuple now carries a reservation AND a completion; the reservation names the author
    // by digest and family, never by a raw model id — a configured id can embed a credential.
    for (const kind of PROBE_GENERATOR_KINDS) {
      const state = readProbeAttempt({ agentQaRoot: f.agentQaRoot, key: keyOf(f, 0, kind) })
      expect(state.kind).toBe('completed')
      if (state.kind !== 'completed') throw new Error('unreachable')
      expect(state.completion.outcome).toBe('derived')
      expect(state.usageKnown).toBe(true)
      expect(state.reservation.authorFamily).toBe(AUTHOR.family)
      expect(state.reservation.promptHash).toBe(ADVERSARIAL_PROMPT_HASH)
    }
    expect(JSON.stringify(readProbeAttempts({ agentQaRoot: f.agentQaRoot, product: 'default' })))
      .not.toContain(AUTHOR.id)
    expect(probeCases(result)).toHaveLength(PROBE_GENERATOR_KINDS.length)
  })

  it('never lets two owners author one tuple: the second observes the reservation the first holds', async () => {
    const f = fixture()
    const key = keyOf(f)

    const first = reserveProbeCall({
      agentQaRoot: f.agentQaRoot,
      reservation: probeReservationOf(key, { promptHash: ADVERSARIAL_PROMPT_HASH, author: AUTHOR }),
    })
    expect(first.kind).toBe('claimed')

    // A SECOND owner, with a different author, asks for the same tuple. It is refused the
    // allowance and handed the reservation that exists — not a second one beside it.
    const second = reserveProbeCall({
      agentQaRoot: f.agentQaRoot,
      reservation: probeReservationOf(key, { promptHash: ADVERSARIAL_PROMPT_HASH, author: OTHER_AUTHOR }),
    })
    expect(second.kind).toBe('already-claimed')
    expect(second.state.kind).toBe('interrupted')
    if (second.state.kind === 'interrupted') {
      expect(second.state.reservation.authorFamily).toBe(AUTHOR.family)
      expect(second.state.usageKnown).toBe(false)
    }
    // ONE reservation file for one tuple, whoever asked.
    expect(probeStoreFiles(f).filter(name => name.endsWith('.reservation.json'))).toHaveLength(1)

    // And a staging run over that host authors nothing for it: an allowance already consumed is
    // never re-issued, in the same process or a later one.
    const author = recordingAuthor(f, () => 'Continue to settlement')
    const result = await stage(f, { author: author.port })
    expect(author.requests.map(request => request.kind)).not.toContain(key.kind)
    expect(result.probeSkips.filter(row => row.kind === key.kind).map(row => row.reason))
      .toEqual(['tuple-interrupted'])
    expect(result.interruptedProbeCalls).toBe(1)
  })

  it('leaves a lost response visibly interrupted with unknown tokens, and never re-authors it', async () => {
    const f = fixture()
    const key = keyOf(f)
    // The crash instant: the reservation landed, the request left, and the process died before
    // any answer could be recorded. Nothing else is written, because nothing else CAN be.
    reserveProbeCall({
      agentQaRoot: f.agentQaRoot,
      reservation: probeReservationOf(key, { promptHash: ADVERSARIAL_PROMPT_HASH, author: AUTHOR }),
    })

    const state = readProbeAttempt({ agentQaRoot: f.agentQaRoot, key })
    expect(state.kind).toBe('interrupted')
    if (state.kind !== 'interrupted') throw new Error('unreachable')
    // An unknown outcome is its OWN outcome. It is not `unattempted` — a call was announced and
    // charged — and it is not a refusal, because nothing refused anything.
    expect(state.usageKnown).toBe(false)
    expect(Object.keys(state).includes('completion')).toBe(false)
    expect(readProbeAttempt({ agentQaRoot: f.agentQaRoot, key: keyOf(f, 0, PROBE_GENERATOR_KINDS[1]) }).kind)
      .toBe('unattempted')

    // The refresh that follows the restart charges the call, reports it, and does NOT re-open
    // the response window: re-asking would buy the same question twice.
    const author = recordingAuthor(f, () => 'Continue to settlement')
    const result = await stage(f, { author: author.port })
    expect(author.requests.map(request => request.kind)).toEqual([PROBE_GENERATOR_KINDS[1]])
    expect(result.spend.modelCalls).toBe(1)
    expect(result.interruptedProbeCalls).toBe(1)
    expect(result.probeSkips.map(row => ({ kind: row.kind, reason: row.reason })))
      .toContainEqual({ kind: key.kind, reason: 'tuple-interrupted' })
    expect(readProbeAttempt({ agentQaRoot: f.agentQaRoot, key }).kind).toBe('interrupted')
  })

  it('charges a refused or failed attempt and refuses to refill it', async () => {
    const f = fixture()
    const failing = throwingAuthor()

    const first = await stage(f, { author: failing.port })
    expect(failing.calls).toHaveLength(PROBE_GENERATOR_KINDS.length)
    expect(first.spend.modelCalls).toBe(PROBE_GENERATOR_KINDS.length)
    // A provider that answered with a failure is an ANSWER: the outcome is durable and the
    // tokens are honestly unknown rather than reported as zero.
    expect(first.spend.usageKnown).toBe(false)
    for (const kind of PROBE_GENERATOR_KINDS) {
      const state = readProbeAttempt({ agentQaRoot: f.agentQaRoot, key: keyOf(f, 0, kind) })
      expect(state.kind).toBe('completed')
      if (state.kind !== 'completed') throw new Error('unreachable')
      expect(state.completion.outcome).toBe('error')
      expect(state.usageKnown).toBe(false)
      expect(state.completion.promptTokens).toBeUndefined()
    }

    // A second refresh with a working author buys nothing: the tuples are spent for this prompt
    // generation, and a failed call is not a refund.
    const working = recordingAuthor(f, () => 'Continue to settlement')
    const second = await stage(f, { author: working.port })
    expect(working.requests).toEqual([])
    expect(second.spend.modelCalls).toBe(0)
    expect(second.probeSkips.map(row => row.reason))
      .toEqual(PROBE_GENERATOR_KINDS.map(() => 'tuple-already-decided'))

    // A completion is write-once. Re-deciding a tuple would erase the reason it was decided.
    expect(() => completeProbeCall({
      agentQaRoot: f.agentQaRoot,
      key: keyOf(f),
      completion: { schemaVersion: 1, outcome: 'derived', text: 'Smuggled', cassetteId: 'x'.repeat(64), promptTokens: 0, completionTokens: 0 },
    })).toThrow(/conflict/)
  })

  it('reuses a completed output with zero calls when the batch that held it is gone', async () => {
    const f = fixture()
    const author = recordingAuthor(f, request => `Continue to ${request.kind} review`)

    const first = await stage(f, { author: author.port })
    const firstProbeIds = probeCases(first).map(row => row.cassetteId).sort()
    expect(firstProbeIds).toHaveLength(PROBE_GENERATOR_KINDS.length)

    // The crash between the call and the publication: the answers are durable, the reviewed
    // batch is not. This is the window that makes recomputation-only recovery unsafe — without
    // the durable output the retry would have to buy the same answers again.
    discardStagedBatches(f)
    expect(existsSync(join(f.agentQaRoot, ADVERSARIAL_STAGING_SUBDIR))).toBe(false)

    const retry = await stage(f, { author: author.port })
    expect(author.requests).toHaveLength(PROBE_GENERATOR_KINDS.length)
    expect(retry.spend.modelCalls).toBe(0)
    // The SAME probes, at the same ids, derived from the stored text rather than re-authored.
    expect(probeCases(retry).map(row => row.cassetteId).sort()).toEqual(firstProbeIds)
  })

  it('does not re-issue a capped allowance on restart, and a new prompt generation is a new tuple', async () => {
    const f = fixture()
    const author = recordingAuthor(f, request => `Continue to ${request.kind} review`)

    // Budget of one over two tuples: one is bought, the other is deferred and disclosed.
    const first = await stage(f, { author: author.port, maxProbeCalls: 1 })
    expect(author.requests).toHaveLength(1)
    expect(first.probeSkips.map(row => row.reason)).toEqual(['probe-cap-exceeded'])

    // The restart. A fresh budget of one buys the tuple that was never asked — and NOT the one
    // that was, so two refreshes over two tuples cost exactly two calls, never three.
    discardStagedBatches(f)
    const second = await stage(f, { author: author.port, maxProbeCalls: 1 })
    expect(author.requests).toHaveLength(2)
    expect(new Set(author.requests.map(request => request.kind)).size).toBe(2)
    expect(second.spend.modelCalls).toBe(1)

    const third = await stage(f, { author: author.port, maxProbeCalls: 1 })
    expect(author.requests).toHaveLength(2)
    expect(third.spend.modelCalls).toBe(0)

    // A FUTURE prompt generation is a different question, so it is a different tuple with its
    // own allowance — and the store says so without any reset flag existing at all.
    const futureKey: ProbeReservationKey = { ...keyOf(f), promptVersion: ADVERSARIAL_PROMPT_VERSION + 1 }
    expect(readProbeAttempt({ agentQaRoot: f.agentQaRoot, key: futureKey }).kind).toBe('unattempted')
    expect(adversarialProbeTupleKey(futureKey.seedCassetteId, futureKey.kind, futureKey.promptVersion))
      .not.toBe(adversarialProbeTupleKey(futureKey.seedCassetteId, futureKey.kind, ADVERSARIAL_PROMPT_VERSION))
    expect(readFileSync(
      join(f.agentQaRoot, ADVERSARIAL_PROBE_SUBDIR, 'default',
        probeStoreFiles(f).find(name => name.endsWith('.reservation.json'))!),
      'utf8',
    )).not.toContain('reset')
  })

  it('refuses a completion for a tuple nothing reserved', async () => {
    const f = fixture()
    mkdirSync(f.agentQaRoot, { recursive: true })
    // A completion without a reservation would be an unaccounted call: the store would show an
    // answer nobody was ever charged for.
    expect(() => completeProbeCall({
      agentQaRoot: f.agentQaRoot,
      key: keyOf(f),
      completion: { schemaVersion: 1, outcome: 'error' },
    })).toThrow(TypeError)
    expect(probeStoreFiles(f)).toEqual([])
  })

  // CR-05/CR-01 regression. The probe half used to `continue` on an unresolvable blob WITHOUT
  // recording the derived answer, leaving a reservation with no completion beside it. The next
  // refresh read that pair as `interrupted` — "charged and never re-authored" — so the paid
  // text was gone and the tuple was closed forever for that prompt generation. The
  // deterministic half refuses to settle this exact condition and says why; the probe half was
  // doing something strictly worse than settling it.
  it('keeps the paid answer when the blob closure cannot be resolved, and re-derives it for free', async () => {
    const f = fixture()
    const author = recordingAuthor(f, request => `Continue to ${request.kind} review`)

    const outage = blobOutage(f)
    const first = await stage(f, { author: author.port })

    // The call happened and was charged, and the case could not be staged.
    expect(author.requests).toHaveLength(PROBE_GENERATOR_KINDS.length)
    expect(first.spend.modelCalls).toBe(PROBE_GENERATOR_KINDS.length)
    expect(probeCases(first)).toEqual([])
    expect(first.stagingSkips.map(row => row.reason)).toContain('blob-unresolvable')

    // THE CLAIM: the answer is durable anyway. An operational skip may not spend the one part
    // of a probe that cannot be recomputed.
    for (const kind of PROBE_GENERATOR_KINDS) {
      const state = readProbeAttempt({ agentQaRoot: f.agentQaRoot, key: keyOf(f, 0, kind) })
      expect(state.kind).toBe('completed')
      if (state.kind !== 'completed') throw new Error('unreachable')
      expect(state.completion.outcome).toBe('derived')
      expect(state.completion.text).toBe(`Continue to ${kind} review`)
    }

    // A repaired root re-derives from disk. The author THROWS, so a single new call would fail
    // the cell outright — which is the point: there must not be one.
    outage.restore()
    discardStagedBatches(f)
    const refuser = throwingAuthor()
    const second = await stage(f, { author: refuser.port })

    expect(refuser.calls).toEqual([])
    expect(second.spend.modelCalls).toBe(0)
    expect(probeCases(second)).toHaveLength(PROBE_GENERATOR_KINDS.length)
    expect(second.probeSkips.map(row => row.reason)).not.toContain('tuple-interrupted')
  })


  // CR-02 regression. `ProbeUsage` typed both counts as required `number` and the author
  // binding coerced an absent provider usage to `0`, so the durable completion ALWAYS carried
  // both fields, `completionUsageKnown` was unconditionally `true` for a derived completion,
  // and `spend.usageKnown` could only go false on the provider-threw path. An answered call
  // that reported nothing was therefore disclosed as a measured `0 in, 0 out`.
  it('reports unknown tokens as unknown when an answered call reports no usage', async () => {
    const f = fixture()
    const silent = silentUsageAuthor()

    const result = await stage(f, { author: silent.port })

    // The calls happened and the cases staged: this is an answered call, not a failed one.
    expect(silent.calls).toBe(PROBE_GENERATOR_KINDS.length)
    expect(result.spend.modelCalls).toBe(PROBE_GENERATOR_KINDS.length)
    expect(probeCases(result)).toHaveLength(PROBE_GENERATOR_KINDS.length)

    // THE CLAIM: unknown is carried as unknown, never accumulated as zero.
    expect(result.spend.usageKnown).toBe(false)
    expect(result.spend.promptTokens).toBe(0)
    expect(result.spend.completionTokens).toBe(0)

    for (const kind of PROBE_GENERATOR_KINDS) {
      const state = readProbeAttempt({ agentQaRoot: f.agentQaRoot, key: keyOf(f, 0, kind) })
      expect(state.kind).toBe('completed')
      if (state.kind !== 'completed') throw new Error('unreachable')
      expect(state.completion.outcome).toBe('derived')
      // ABSENT on disk, so the reader derives `usageKnown: false` from the fields themselves.
      expect(state.completion.promptTokens).toBeUndefined()
      expect(state.completion.completionTokens).toBeUndefined()
      expect(state.usageKnown).toBe(false)
    }
  })

})
