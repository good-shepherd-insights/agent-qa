import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { extractRunCassettes } from '@vostride/agent-qa-eval'
import type { ArtifactSource, Cassette, LeafReplayResult } from '@vostride/agent-qa-eval'
import { createModel } from '@vostride/agent-qa-model'
import type { ModelProfile, ResolvedModelAuth } from '@vostride/agent-qa-model'
import type { CompletedRunHandoff } from '@vostride/agent-qa-schema'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { FsCassetteStore } from '../cassette-store.js'
import { loadCassetteBundle } from '../cassette-loader.js'
import { runCassetteReplay } from '../replay-composition.js'
import { FsReplayRecordStore } from '../replay-record-store.js'
import { FsScoreStore, SCORE_FILE } from '../score-store.js'
import type { ScoreRecord } from '../score-store.js'
import {
  LOCAL_FIXTURE_BLOB_BYTES,
  LOCAL_FIXTURE_BLOB_SHA,
  makeLocalV2Handoff,
} from './fixtures/local-handoff-fixture.js'

// Instrument @vostride/agent-qa-safety so the D-06 masking context's dispose() is observable
// without changing production code. The wrapper returns the REAL empty-seeded context (masking +
// guardrail behaviour intact) and only counts dispose() calls. Every named export is preserved so
// the model egress chain (registerFirstPartySafetyHooks) and safety-local's resolver install are
// unaffected.
const safetyHooks = vi.hoisted(() => ({ disposeCalls: 0 }))
vi.mock('@vostride/agent-qa-safety', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@vostride/agent-qa-safety')>()
  return {
    ...actual,
    createMaskingContext: (options?: { minRegisteredLength?: number }) => {
      const context = actual.createMaskingContext(options)
      const dispose = context.dispose.bind(context)
      return Object.assign(context, {
        dispose: () => {
          safetyHooks.disposeCalls++
          dispose()
        },
      })
    },
  }
})

type StubLanguageModel = ReturnType<typeof createModel>
type CapturedCallOptions = Parameters<StubLanguageModel['doGenerate']>[0]
type StubGenerateResult = Awaited<ReturnType<StubLanguageModel['doGenerate']>>

const noneAuth: ResolvedModelAuth = { kind: 'none' }
const STUB_MODEL_ID = 'replay-composition-stub'

function stubProfile(): ModelProfile {
  return {
    provider: 'openai-compatible',
    model: STUB_MODEL_ID,
    baseURL: 'http://localhost:11434/v1',
    auth: { mode: 'none' },
  }
}

function actionGenerateResult(ref = 'e-continue'): StubGenerateResult {
  return {
    content: [
      {
        type: 'tool-call',
        toolCallId: 'replay-action',
        toolName: 'web_click',
        input: JSON.stringify({
          ref,
          reasoning: 'Click the recorded Continue button',
          confidence: 0.95,
          stepComplete: true,
          doesActionAdvanceUsTowardsGoal: true,
        }),
      },
    ],
    finishReason: { unified: 'stop', raw: 'stop' },
    usage: {
      inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 2, text: 0, reasoning: 0 },
    },
    warnings: [],
  }
}

function nonActionGenerateResult(toolName: string): StubGenerateResult {
  return {
    content: [
      {
        type: 'tool-call',
        toolCallId: 'replay-lookup',
        toolName,
        input: JSON.stringify({}),
      },
    ],
    finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
    usage: {
      inputTokens: { total: 8, noCache: 8, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 1, text: 0, reasoning: 0 },
    },
    warnings: [],
  }
}

interface CapturingStub {
  captured: CapturedCallOptions[]
  languageModels: Record<string, StubLanguageModel>
}

// A scripted capturing stub injected through createModel's `overrides.languageModels`, so every
// doGenerate params object is captured POST the pinned-last mask/guardrail middleware — the exact
// provider boundary. `script` maps the zero-based call index to the response for that round.
function capturingStub(script: (call: number) => StubGenerateResult): CapturingStub {
  const captured: CapturedCallOptions[] = []
  const stub: StubLanguageModel = {
    specificationVersion: 'v3',
    provider: 'replay-composition-stub',
    modelId: STUB_MODEL_ID,
    supportedUrls: {},
    async doGenerate(params) {
      const call = captured.length
      captured.push(params)
      return script(call)
    },
    async doStream() {
      return { stream: new ReadableStream() }
    },
  }
  return { captured, languageModels: { [STUB_MODEL_ID]: stub } }
}

function memArtifacts(): ArtifactSource {
  return {
    getBlob: (sha) => (sha === LOCAL_FIXTURE_BLOB_SHA ? LOCAL_FIXTURE_BLOB_BYTES : undefined),
  }
}

function extractLeaf(handoff: CompletedRunHandoff): { cassette: Cassette; artifacts: ArtifactSource } {
  const artifacts = memArtifacts()
  const { cassettes } = extractRunCassettes({ handoff, artifacts })
  const leaf = cassettes.find((entry) => entry.cassette.granularity === 'leaf')
  if (leaf === undefined) throw new Error('expected a leaf cassette from the local fixture')
  return { cassette: leaf.cassette, artifacts }
}

function findReplayRecords(root: string): string[] {
  if (!existsSync(root)) return []
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name === 'replay.json')
    .map((entry) => join(entry.parentPath, entry.name))
}

describe('runCassetteReplay — sanctioned composition (RPLY-02, D-03/D-04/D-06)', () => {
  const tempRoots: string[] = []

  async function tempRoot(prefix: string): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), prefix))
    tempRoots.push(root)
    return root
  }

  afterEach(async () => {
    safetyHooks.disposeCalls = 0
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  it('replays a loaded leaf cassette to a decision at temperature 0 through the pinned middleware', async () => {
    const { cassette, artifacts } = extractLeaf(makeLocalV2Handoff())
    const stub = capturingStub(() => actionGenerateResult())
    const replayDir = await tempRoot('replay-comp-temp0-')

    const outcome = await runCassetteReplay({
      cassette,
      artifacts,
      profile: stubProfile(),
      auth: noneAuth,
      modelOverrides: { languageModels: stub.languageModels },
      replayOutputBaseDir: replayDir,
    })

    if (!('granularity' in outcome)) throw new Error('expected a replay result, got a refusal')
    expect(outcome.granularity).toBe('leaf')
    const leaf = outcome as LeafReplayResult
    expect(leaf.samples).toHaveLength(1)
    const sample = leaf.samples[0]!
    expect(sample.outcome.kind).toBe('decision')
    if (sample.outcome.kind !== 'decision') throw new Error('expected a decision sample')
    expect(sample.outcome.identity.opClass).toBe('click')
    expect(sample.outcome.identity.target?.nameNormalized).toBe('continue')

    // The 366 sampling seam applied: the captured provider-boundary request pins temperature 0.
    expect(stub.captured).toHaveLength(1)
    expect(stub.captured[0]!.temperature).toBe(0)
  })

  it('stamps recorded and replayed model ids; a mismatch is data, not an error (D-03)', async () => {
    const { cassette, artifacts } = extractLeaf(makeLocalV2Handoff())
    const stub = capturingStub(() => actionGenerateResult())
    const replayDir = await tempRoot('replay-comp-ids-')

    const outcome = (await runCassetteReplay({
      cassette,
      artifacts,
      profile: stubProfile(),
      auth: noneAuth,
      modelOverrides: { languageModels: stub.languageModels },
      replayOutputBaseDir: replayDir,
    })) as LeafReplayResult

    // The replayed id derives ONLY from the caller profile (never the recorded id, D-03).
    expect(outcome.replayedModel).toEqual({ provider: 'openai-compatible', modelId: STUB_MODEL_ID })
    // The recorded id is stamped from the receipt and differs — a visible mismatch, never enforced.
    expect(outcome.recordedModel).toBeDefined()
    expect(outcome.recordedModel!.modelId).not.toBe(outcome.replayedModel.modelId)
  })

  it('constructs a fresh planner + accounting per sample under a forced k=3 escalation', async () => {
    const { cassette, artifacts } = extractLeaf(makeLocalV2Handoff())
    const stub = capturingStub(() => actionGenerateResult())
    const replayDir = await tempRoot('replay-comp-ksample-')

    const outcome = (await runCassetteReplay({
      cassette,
      artifacts,
      profile: stubProfile(),
      auth: noneAuth,
      modelOverrides: { languageModels: stub.languageModels },
      k: 3,
      escalationPredicate: () => true,
      replayOutputBaseDir: replayDir,
    })) as LeafReplayResult

    // Three independent samples ⇒ three create() cycles ⇒ three provider-boundary calls, each a
    // grounded decision with its own token accounting (no cross-sample bleed).
    expect(outcome.samples).toHaveLength(3)
    expect(stub.captured).toHaveLength(3)
    for (const sample of outcome.samples) {
      expect(sample.outcome.kind).toBe('decision')
      expect(sample.tokenUsage).toBeDefined()
    }
    expect(outcome.agreement.k).toBe(3)
  })

  it('lands guardrail audit rows under the replay output dir and disposes the masking context', async () => {
    const handoff = makeLocalV2Handoff()
    // A raw bearer token in the recorded step text is scanned by the guardrail detectors on every
    // replayed prompt (empty-seeded masking only auto-masks emails, so the token reaches the
    // guardrail) — it fires 'bearer' with a redact action and the replay-scoped JsonlAuditSink
    // records the row under the replay output dir (T-368-12 / T-368-13).
    handoff.tests[0]!.steps[0]!.stepText =
      'Authenticate with Bearer sk-replay-abcdefgh12345 then click Continue'
    const { cassette, artifacts } = extractLeaf(handoff)
    const stub = capturingStub(() => actionGenerateResult())
    const replayDir = await tempRoot('replay-comp-audit-')

    await runCassetteReplay({
      cassette,
      artifacts,
      profile: stubProfile(),
      auth: noneAuth,
      modelOverrides: { languageModels: stub.languageModels },
      replayOutputBaseDir: replayDir,
    })

    const auditPath = join(replayDir, 'guardrail_audit.jsonl')
    expect(existsSync(auditPath)).toBe(true)
    expect(readFileSync(auditPath, 'utf8')).toContain('bearer')
    expect(safetyHooks.disposeCalls).toBe(1)
  })

  it('persists the outcome only when a record store is supplied (D-12)', async () => {
    const { cassette, artifacts } = extractLeaf(makeLocalV2Handoff())

    const withStoreRoot = await tempRoot('replay-comp-store-')
    const withStoreReplayDir = await tempRoot('replay-comp-store-audit-')
    const persistedOutcome = await runCassetteReplay({
      cassette,
      artifacts,
      profile: stubProfile(),
      auth: noneAuth,
      modelOverrides: { languageModels: capturingStub(() => actionGenerateResult()).languageModels },
      replayOutputBaseDir: withStoreReplayDir,
      recordStore: new FsReplayRecordStore({ root: withStoreRoot }),
    })

    const records = findReplayRecords(join(withStoreRoot, 'eval', 'replays'))
    expect(records).toHaveLength(1)
    expect(JSON.parse(readFileSync(records[0]!, 'utf8'))).toEqual(
      JSON.parse(JSON.stringify(persistedOutcome)),
    )

    const noStoreRoot = await tempRoot('replay-comp-nostore-')
    const noStoreReplayDir = await tempRoot('replay-comp-nostore-audit-')
    await runCassetteReplay({
      cassette,
      artifacts,
      profile: stubProfile(),
      auth: noneAuth,
      modelOverrides: { languageModels: capturingStub(() => actionGenerateResult()).languageModels },
      replayOutputBaseDir: noStoreReplayDir,
    })
    expect(findReplayRecords(noStoreRoot)).toHaveLength(0)
  })
})

// ─── Task 2: end-to-end composition proof over the production round trip (D-05/D-12) ───

const RECORDED_LOOKUP_MARKER = 'RECORDED-LOOKUP-RESULT-XYZ'

function extractStoreLoad(
  handoff: CompletedRunHandoff,
  artifacts: ArtifactSource,
  bundleRoot: string,
): ReturnType<typeof loadCassetteBundle> {
  const { cassettes } = extractRunCassettes({ handoff, artifacts })
  const extracted = cassettes.find((entry) => entry.cassette.granularity === 'leaf')
  if (extracted === undefined) throw new Error('expected a leaf cassette from the local fixture')
  const written = new FsCassetteStore({ root: bundleRoot }).write(extracted)
  return loadCassetteBundle(written.dir)
}

describe('runCassetteReplay — production round-trip spine (RPLY-02, D-05/D-12)', () => {
  const tempRoots: string[] = []

  async function tempRoot(prefix: string): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), prefix))
    tempRoots.push(root)
    return root
  }

  afterEach(async () => {
    safetyHooks.disposeCalls = 0
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  it('extract → store → load → replay → persist, all on temp dirs with a captured stub', async () => {
    const bundleRoot = await tempRoot('replay-e2e-bundles-')
    const storeRoot = await tempRoot('replay-e2e-store-')
    const replayDir = await tempRoot('replay-e2e-audit-')

    const load = extractStoreLoad(makeLocalV2Handoff(), memArtifacts(), bundleRoot)
    expect(load.kind).toBe('loaded')
    if (load.kind !== 'loaded') throw new Error('expected a loaded bundle')

    const stub = capturingStub(() => actionGenerateResult())
    const outcome = await runCassetteReplay({
      cassette: load.cassette,
      artifacts: load.artifacts,
      profile: stubProfile(),
      auth: noneAuth,
      modelOverrides: { languageModels: stub.languageModels },
      replayOutputBaseDir: replayDir,
      recordStore: new FsReplayRecordStore({ root: storeRoot }),
    })

    if (!('granularity' in outcome)) throw new Error('expected a replay result, got a refusal')
    expect(outcome.granularity).toBe('leaf')
    const leaf = outcome as LeafReplayResult
    const sample = leaf.samples[0]!
    expect(sample.outcome.kind).toBe('decision')
    if (sample.outcome.kind !== 'decision') throw new Error('expected a decision sample')
    // Identity resolves against the recorded elements (grounded ref → role/nameNormalized/ordinal).
    expect(sample.outcome.identity.target?.nameNormalized).toBe('continue')
    // Same build recorded and replayed ⇒ no drift (the canonical input-leg hash matches the receipt).
    expect(leaf.promptDrift.drift).toBe(false)

    // The persisted record is deep-equal to the returned outcome.
    const records = findReplayRecords(join(storeRoot, 'eval', 'replays'))
    expect(records).toHaveLength(1)
    expect(JSON.parse(readFileSync(records[0]!, 'utf8'))).toEqual(JSON.parse(JSON.stringify(outcome)))
  })

  it('flows an evidence-incomplete cassette into a persisted refusal without invoking the planner', async () => {
    const bundleRoot = await tempRoot('replay-e2e-incomplete-bundles-')
    const storeRoot = await tempRoot('replay-e2e-incomplete-store-')
    const replayDir = await tempRoot('replay-e2e-incomplete-audit-')

    // No blob bytes available at extraction ⇒ the full-capture leaf is evidence-incomplete.
    const emptyArtifacts: ArtifactSource = { getBlob: () => undefined }
    const load = extractStoreLoad(makeLocalV2Handoff(), emptyArtifacts, bundleRoot)
    expect(load.kind).toBe('loaded')
    if (load.kind !== 'loaded') throw new Error('expected a loaded bundle')

    // A throwing stub proves the planner factory is never reached — a completeness refusal is
    // filtered before any sample runs (RPLY-02: a missing recorded observation is a hard error).
    let doGenerateCalls = 0
    const throwingStub: StubLanguageModel = {
      specificationVersion: 'v3',
      provider: 'replay-composition-stub',
      modelId: STUB_MODEL_ID,
      supportedUrls: {},
      async doGenerate() {
        doGenerateCalls++
        throw new Error('planner must not be invoked for an incomplete cassette')
      },
      async doStream() {
        return { stream: new ReadableStream() }
      },
    }

    const outcome = await runCassetteReplay({
      cassette: load.cassette,
      artifacts: load.artifacts,
      profile: stubProfile(),
      auth: noneAuth,
      modelOverrides: { languageModels: { [STUB_MODEL_ID]: throwingStub } },
      replayOutputBaseDir: replayDir,
      recordStore: new FsReplayRecordStore({ root: storeRoot }),
    })

    expect('kind' in outcome && outcome.kind === 'integrity-refusal').toBe(true)
    if (!('kind' in outcome)) throw new Error('expected a refusal')
    expect(outcome.reason).toBe('completeness')
    expect(doGenerateCalls).toBe(0)

    // The refusal is persisted too — refusals are never silent (D-08/D-12).
    const records = findReplayRecords(join(storeRoot, 'eval', 'replays'))
    expect(records).toHaveLength(1)
    expect(JSON.parse(readFileSync(records[0]!, 'utf8'))).toEqual(JSON.parse(JSON.stringify(outcome)))
  })

  it('serves a recorded exchange through the real plan() tool-loop (368-01 seam + exchange server)', async () => {
    const bundleRoot = await tempRoot('replay-e2e-exchange-bundles-')
    const replayDir = await tempRoot('replay-e2e-exchange-audit-')

    // Extend the recorded live decision with a non-action exchange (opaque evidence data).
    const handoff = makeLocalV2Handoff()
    const live = handoff.tests[0]!.steps[0]!.subActions[0]! as {
      exchanges?: { tool: string; args: Record<string, unknown>; result: unknown }[]
    }
    live.exchanges = [
      { tool: 'recorded_lookup', args: {}, result: { note: RECORDED_LOOKUP_MARKER } },
    ]

    const load = extractStoreLoad(handoff, memArtifacts(), bundleRoot)
    expect(load.kind).toBe('loaded')
    if (load.kind !== 'loaded') throw new Error('expected a loaded bundle')

    // Two-round scripted stub: round 1 requests the recorded non-action tool, round 2 grounds.
    const stub = capturingStub((call) =>
      call === 0 ? nonActionGenerateResult('recorded_lookup') : actionGenerateResult(),
    )

    const outcome = await runCassetteReplay({
      cassette: load.cassette,
      artifacts: load.artifacts,
      profile: stubProfile(),
      auth: noneAuth,
      modelOverrides: { languageModels: stub.languageModels },
      replayOutputBaseDir: replayDir,
    })

    if (!('granularity' in outcome)) throw new Error('expected a replay result, got a refusal')
    const leaf = outcome as LeafReplayResult
    expect(leaf.samples[0]!.outcome.kind).toBe('decision')

    // The exchange server served the recorded result, and the second-round request carried it back
    // to the model — proving the 368-01 seam + exchange server work through production planner code.
    expect(stub.captured).toHaveLength(2)
    expect(JSON.stringify(stub.captured[1]!)).toContain(RECORDED_LOOKUP_MARKER)
    // No recorded exchange left unconsumed.
    expect(leaf.unconsumedExchanges).toHaveLength(0)
  })
})

// ─── Task 3 (369-08): optional score persistence through the sanctioned composition ───

describe('runCassetteReplay — optional score persistence (369-08, D-13/OQ-2)', () => {
  const tempRoots: string[] = []

  async function tempRoot(prefix: string): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), prefix))
    tempRoots.push(root)
    return root
  }

  afterEach(async () => {
    safetyHooks.disposeCalls = 0
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  it('scores the replay in eval core and persists score.json beside replay.json (record first)', async () => {
    const { cassette, artifacts } = extractLeaf(makeLocalV2Handoff())
    const storeRoot = await tempRoot('replay-comp-scored-')
    const replayDir = await tempRoot('replay-comp-scored-audit-')

    const outcome = await runCassetteReplay({
      cassette,
      artifacts,
      profile: stubProfile(),
      auth: noneAuth,
      modelOverrides: { languageModels: capturingStub(() => actionGenerateResult()).languageModels },
      replayOutputBaseDir: replayDir,
      recordStore: new FsReplayRecordStore({ root: storeRoot }),
      scoreStore: new FsScoreStore({ root: storeRoot }),
    })

    if (!('granularity' in outcome)) throw new Error('expected a replay result, got a refusal')

    // Both files landed in the SAME slugged cassette dir — record-then-score ordering means the
    // record store's dir-recreate ran BEFORE the file-scoped score write (OQ-2).
    const records = findReplayRecords(join(storeRoot, 'eval', 'replays'))
    expect(records).toHaveLength(1)
    const scoreFile = join(dirname(records[0]!), SCORE_FILE)
    expect(existsSync(scoreFile)).toBe(true)

    const persisted = JSON.parse(readFileSync(scoreFile, 'utf8')) as ScoreRecord
    expect(persisted.cassetteId).toBe(cassette.id)
    expect(typeof persisted.matcherVersion).toBe('number')
    expect(persisted.score.kind).toBe('leaf')
    // The grounded click on the recorded ref settles to a scored diff with a resolved gold identity.
    expect(persisted.diffs).toHaveLength(1)
    expect(persisted.diffs[0]!.kind).toBe('scored')
    expect(persisted.diffs[0]!.goldIdentity).toBeDefined()
    expect(persisted.diffs[0]!.matcherVersion).toBe(persisted.matcherVersion)
  })

  it('never scores a refusal: replay.json persists, no score.json is written', async () => {
    const bundleRoot = await tempRoot('replay-comp-refusal-bundles-')
    const storeRoot = await tempRoot('replay-comp-refusal-store-')
    const replayDir = await tempRoot('replay-comp-refusal-audit-')

    // No blob bytes at extraction ⇒ evidence-incomplete cassette ⇒ completeness refusal.
    const emptyArtifacts: ArtifactSource = { getBlob: () => undefined }
    const load = extractStoreLoad(makeLocalV2Handoff(), emptyArtifacts, bundleRoot)
    expect(load.kind).toBe('loaded')
    if (load.kind !== 'loaded') throw new Error('expected a loaded bundle')

    const outcome = await runCassetteReplay({
      cassette: load.cassette,
      artifacts: load.artifacts,
      profile: stubProfile(),
      auth: noneAuth,
      modelOverrides: { languageModels: capturingStub(() => actionGenerateResult()).languageModels },
      replayOutputBaseDir: replayDir,
      recordStore: new FsReplayRecordStore({ root: storeRoot }),
      scoreStore: new FsScoreStore({ root: storeRoot }),
    })

    expect('kind' in outcome && outcome.kind === 'integrity-refusal').toBe(true)

    // The refusal record persists (refusals are never silent), but no score.json exists anywhere —
    // refusals are counted in reports, never scored.
    const records = findReplayRecords(join(storeRoot, 'eval', 'replays'))
    expect(records).toHaveLength(1)
    const scoreFiles = readdirSync(storeRoot, { recursive: true, withFileTypes: true }).filter(
      (entry) => entry.isFile() && entry.name === SCORE_FILE,
    )
    expect(scoreFiles).toHaveLength(0)
  })
})

export {
  STUB_MODEL_ID,
  actionGenerateResult,
  capturingStub,
  memArtifacts,
  nonActionGenerateResult,
  noneAuth,
  stubProfile,
}
export type { CapturingStub, StubGenerateResult }
