import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { extractRunCassettes } from '@vostride/agent-qa-eval'
import type { ArtifactSource, Cassette, LeafReplayResult } from '@vostride/agent-qa-eval'
import { createModel } from '@vostride/agent-qa-model'
import type { ModelProfile, ResolvedModelAuth } from '@vostride/agent-qa-model'
import type { CompletedRunHandoff } from '@vostride/agent-qa-schema'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { runCassetteReplay } from '../replay-composition.js'
import { FsReplayRecordStore } from '../replay-record-store.js'
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
