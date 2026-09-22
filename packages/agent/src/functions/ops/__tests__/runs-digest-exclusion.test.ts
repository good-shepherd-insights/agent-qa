// `runs.digest` carries and prints the exclusion fact (Phase 425 plan 07, D-08 · law 6).
//
// Plan 02 widened `RunDigestChainOutcomes` with the same additive-optional `exclusion` field it
// put on `PostProcessingStatus`, and deliberately left the digest op's arm unwritten. This is
// that arm, measured where it matters: the value on `chain` and the words on the rendered line.
//
// ONE FOLD, TWO OPS. The fact is minted by `projectPostProcessingExclusion` over the durable
// handoff this op ALREADY loads for its own run-not-found refusal — not re-derived here, not
// read off missing job rows, and not read off `run.status`. A gate run's chain is never
// enqueued, so an op that inferred exclusion from an empty chain would also call every
// in-flight run excluded, one poll too early.
//
// The negative half is as load-bearing as the positive one: an ordinary run's chain must carry
// no `exclusion` key at all and must render the two chip-word clauses byte-identically, or the
// arm is a rewrite of the shipped line wearing a condition.

import {
  CURRENT_HANDOFF_SCHEMA_VERSION,
  FunctionScopeSchema,
} from '@vostride/agent-qa-schema'
import type {
  CompletedRunHandoff,
  FunctionCaller,
  RunDigest,
} from '@vostride/agent-qa-schema'
import { describe, expect, it } from 'vitest'

import { asJobId } from '@vostride/agent-qa-schema'
import type { JobIdSource } from '../../../jobs/engine.js'
import { invokeFunction } from '../../invoke.js'
import { createFunctionRegistry } from '../../registry.js'
import type { FunctionDeps } from '../../spec.js'
import { RUNS_DIGEST_FUNCTION_ID } from '../runs-digest.js'

const RUN_ID = 'run-425-07-digest'

const CALLER: FunctionCaller = {
  surface: 'test',
  grantedScopes: [...FunctionScopeSchema.options],
  safeMode: false,
  origin: 'agent',
}

const TEST_ID_SOURCE: JobIdSource = {
  jobIdFor: (kind, key) => asJobId(`test_${kind}_${key}`),
}

function handoff(overrides: Partial<CompletedRunHandoff> = {}): CompletedRunHandoff {
  return {
    schemaVersion: CURRENT_HANDOFF_SCHEMA_VERSION,
    runId: RUN_ID,
    scope: { tier: 'product', key: 'storefront' },
    buildOrdinal: 4,
    executionContext: 'local-headless',
    aggregateVerdict: 'failed',
    configDigests: { suiteConfigDigest: 'suite-digest', testConfigDigest: 'test-digest' },
    startedAt: 1_000,
    endedAt: 2_000,
    tests: [],
    ...overrides,
  } as CompletedRunHandoff
}

/**
 * The digest over one scene: a runs port serving this handoff, an EMPTY chain reader, an empty
 * inbox, and neither an analysis nor a quarantine dep.
 *
 * The empty chain is the excluded run's real durable state — the invocation core enqueued
 * nothing — which is exactly why the fact cannot come from there.
 */
async function digestFor(document: CompletedRunHandoff): Promise<RunDigest> {
  return await digestOver({ get: () => document, list: [document], postProcessing: true })
}

/**
 * The same scene with its two variables exposed (425-14 · WR-04): what each successive
 * `runs.get` serves, and whether a post-processing reader is bound at all.
 */
async function digestOver(scene: {
  get: () => CompletedRunHandoff
  list: readonly CompletedRunHandoff[]
  postProcessing: boolean
}): Promise<RunDigest> {
  const deps: FunctionDeps = {
    runs: {
      list: () => Promise.resolve([...scene.list]),
      get: () => Promise.resolve(scene.get()),
      readEvents: () => Promise.resolve([]),
      readStepEvidence: () => Promise.resolve({ kind: 'run-not-recorded' } as const),
    },
    knowledge: {
      listBundles: () => Promise.resolve([]),
      inspectRecords: () => Promise.resolve([]),
      diffSince: () => Promise.resolve([]),
      showRecord: ({ recordId }: { recordId: string }) =>
        Promise.resolve({ kind: 'not-found', schemaVersion: 1, recordId } as const),
    },
    entities: {
      resolve: () => Promise.resolve({ kind: 'none' as const, reason: 'no-match' as const }),
      get: () => Promise.resolve(undefined),
    },
    config: {
      getMasked: () => Promise.resolve({
        schemaVersion: 1,
        configPath: 'agent-qa.config.yaml',
        entries: [],
      }),
    },
    ...(scene.postProcessing
      ? {
          postProcessing: {
            idSource: TEST_ID_SOURCE,
            readChain: () => Promise.resolve(undefined),
          },
        }
      : {}),
    proposalsInbox: { list: () => Promise.resolve([]) },
  } as unknown as FunctionDeps

  const registry = createFunctionRegistry({
    deps,
    resolveExecutionContext: () => 'local-headless',
    auditSink: { appendExecutionAudit() {}, appendGuardrailAudit() {} },
  })
  return await invokeFunction(
    registry,
    RUNS_DIGEST_FUNCTION_ID,
    { runId: RUN_ID },
    CALLER,
  ) as RunDigest
}

/** The one rendered line this cell is about. */
function chainLine(digest: RunDigest): string {
  const line = digest.lines.find((text) => text.startsWith('chain — '))
  expect(line, `no chain line in:\n${digest.lines.join('\n')}`).toBeDefined()
  return line!
}

describe('DIGEST-CHAIN-EXCLUDED', () => {
  it('carries the fact on chain and prints it in place of the two chip words', async () => {
    const digest = await digestFor(handoff({ excludedFromOutcomes: true } as never))

    expect(digest.chain).toEqual({
      analysis: 'pending',
      curation: 'pending',
      exclusion: { reason: 'outcome-excluded' },
    })
    expect(chainLine(digest))
      .toBe('chain — analysis: excluded (outcome-excluded) · curation: excluded (outcome-excluded)')
  })

  it('renders the gate-run reason as itself, so the word is not a constant', async () => {
    const digest = await digestFor(handoff({ gateRun: true } as never))

    expect(digest.chain).toHaveProperty('exclusion', { reason: 'gate-run' })
    expect(chainLine(digest))
      .toBe('chain — analysis: excluded (gate-run) · curation: excluded (gate-run)')
  })

  it('leaves an ordinary run with no exclusion key and its shipped chain line unchanged',
    async () => {
      const digest = await digestFor(handoff())

      expect(digest.chain).toEqual({ analysis: 'pending', curation: 'pending' })
      expect('exclusion' in digest.chain).toBe(false)
      expect(chainLine(digest)).toBe('chain — analysis: pending · curation: pending')
    })
})

// ONE PRODUCER ON THE BOUND PATH (425-14 · WR-04, law 6). The digest loads the handoff first, for
// its own not-found refusal; `runs.postprocessing` loads it second and folds the exclusion. Serving
// a plain handoff to the first load and a gate run to every later one makes the two derivations
// disagree, so the chain arm shows which one was published.
describe('DIGEST-EXCLUSION-FROM-THE-STATUS', () => {
  it('publishes the exclusion the post-processing read folded, not a second derivation', async () => {
    let loads = 0
    const plain = handoff()
    const gate = handoff({ gateRun: true } as never)
    const digest = await digestOver({
      get: () => (loads++ === 0 ? plain : gate),
      list: [plain],
      postProcessing: true,
    })

    expect(
      digest.chain,
      'two derivations of one fact can disagree, and law 6 is the claim that only one of them is '
        + 'published: the chain arm must carry the fold `runs.postprocessing` made',
    ).toEqual({ analysis: 'pending', curation: 'pending', exclusion: { reason: 'gate-run' } })
    expect(chainLine(digest))
      .toBe('chain — analysis: excluded (gate-run) · curation: excluded (gate-run)')
  })
})

// THE UNBOUND COMPOSITION. A host with no post-processing reader ran no fold, so the digest answers
// from the handoff it already loaded — dropping the fact there would tell a reader their gate run
// was simply pending.
describe('DIGEST-EXCLUSION-WITHOUT-A-READER', () => {
  it('still answers the exclusion from its own handoff when no reader is bound', async () => {
    const gate = handoff({ gateRun: true } as never)
    const digest = await digestOver({ get: () => gate, list: [gate], postProcessing: false })

    expect(digest.chain).toHaveProperty('exclusion', { reason: 'gate-run' })
    expect(chainLine(digest))
      .toBe('chain — analysis: excluded (gate-run) · curation: excluded (gate-run)')
  })

  it('leaves an ordinary run with no exclusion key and the shipped two-word line', async () => {
    const plain = handoff()
    const digest = await digestOver({ get: () => plain, list: [plain], postProcessing: false })

    expect(digest.chain).toEqual({ analysis: 'pending', curation: 'pending' })
    expect('exclusion' in digest.chain).toBe(false)
    expect(chainLine(digest)).toBe('chain — analysis: pending · curation: pending')
  })
})
