// 2026-09-06, D-06: captured BEFORE the first 416 production edit. Pins v51 outcome
// bytes, trust, status and candidate verdict across all three real promotion doors.
// Plan 06 adds assertions that gates.jsonl and its manifest key are the only new parts.
// No test-runner update path: an existing reference is NEVER rewritten.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { asEvidenceToken, canonicalJson, evaluatePromotionGate, type CanaryOutcome,
  type PromotionGateVerdict } from '@vostride/agent-qa-schema'
import { describe, expect, it, vi } from 'vitest'
import { deriveBundleTrust } from '../../bundle-read.js'
import { assemblePromotionGateInput } from '../commit.js'
import { createPromotionFloorFixture } from './fixtures/promotion-floor-fixture.js'

// Observe the actual gate input at the synchronous decision boundary. The wrapper delegates
// unchanged to the real predicate; drain and canary evaluate inside their own held sections.
vi.mock('@vostride/agent-qa-schema', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@vostride/agent-qa-schema')>()
  return { ...actual, evaluatePromotionGate: vi.fn(actual.evaluatePromotionGate) }
})
function project(verdict: PromotionGateVerdict) {
  return verdict.verdict === 'hold' ? { verdict: verdict.verdict, reason: verdict.reason }
    : { verdict: verdict.verdict }
}
const scenarios = [
  'fact/door3-drain', 'caution/door3-drain',
  'fact/door1-promote', 'caution/door1-promote',
  'fact/door2-canary', 'caution/door2-canary',
] as const
type Scenario = typeof scenarios[number]
async function capture(scenario: Scenario) {
  const root = mkdtempSync(join(tmpdir(), '416-v51-reference-'))
  const knowledgeRoot = join(root, 'agent-qa-knowledge')
  const fixture = createPromotionFloorFixture({ knowledgeRoot, auditBaseDir: join(root, '.agent-qa') })
  const gate = vi.mocked(evaluatePromotionGate)
  gate.mockClear()
  try {
    const caution = scenario.startsWith('caution/')
    const seed = scenario.replaceAll('/', '-')
    let refusal: { door2: 'refused'; reason: string } | undefined
    if (scenario.endsWith('door3-drain')) {
      await fixture.drainWithoutModel(caution ? fixture.cautionProjection(seed) : fixture.selectorProjection(seed))
    } else {
      const { draft, published } = caution ? fixture.publishHeldCaution(seed) : fixture.publishHeldCandidate(seed)
      if (scenario.endsWith('door1-promote')) {
        const store = fixture.promotionStore(43)
        await store.commit([{ kind: 'Confirm', origin: 'agent', scope: draft.scope,
          citedIds: [published.id], targetId: published.id,
          evidenceToken: asEvidenceToken('held-checkout-confirm'),
          authorship: { path: 'deterministic-fallback', executionContext: 'local-interactive' } }])
        const { dir, bundle } = fixture.onlyBundle()
        evaluatePromotionGate(assemblePromotionGateInput({ knowledgeRoot, bundleDir: dir, bundle }))
        await store.promote(published.id)
      } else {
        const sourceRunId = 'run-canary-disposition'
        const outcome: CanaryOutcome = { candidateId: published.id, runOutcome: 'positive',
          runId: sourceRunId, testId: 'checkout::happy-path', testIndex: 0, buildOrdinal: 43,
          stepIndex: 2, briefDigest: 'brief-digest-canary-disposition',
          attribution: 'The served checkout hypothesis was exercised by the attributed step.',
          exercisedAnchor: draft.anchors[0]! }
        try { await fixture.canaryStore(43, sourceRunId).recordCanaryOutcome(outcome) }
        catch (error) {
          if (!caution) throw error
          if (!(error instanceof Error) || !('reason' in error) || typeof error.reason !== 'string') throw error
          refusal = { door2: 'refused', reason: error.reason }
        }
      }
    }
    const candidates = gate.mock.calls.flatMap(([input], index) =>
      input.status === 'candidate' ? [gate.mock.results[index]!] : [])
    const last = candidates.at(-1)
    if (last?.type !== 'return') throw new Error(`${scenario}: no candidate gate decision captured`)
    const verdictBefore = project(last.value as PromotionGateVerdict)
    const { dir, bundle } = fixture.onlyBundle()
    const trust = deriveBundleTrust(bundle)
    if (scenario === 'caution/door2-canary' && trust.status === 'candidate' && verdictBefore.verdict === 'hold') {
      refusal = { door2: 'refused', reason: verdictBefore.reason! }
    }
    return { outcomes: readFileSync(join(dir, 'evidence/outcomes.jsonl'), 'utf8'),
      trust: canonicalJson(trust), status: trust.status, verdictBefore,
      promotedEvents: bundle.events.filter(event => event.type === 'promoted').length,
      ...(refusal === undefined ? {} : refusal) }
  } finally { rmSync(root, { recursive: true, force: true }) }
}
describe('416 v51 reference across the three real doors', () => {
  it('compares each scenario to the immutable pristine reference', async () => {
    const actual: Record<string, Awaited<ReturnType<typeof capture>>> = {}
    for (const scenario of scenarios) actual[scenario] = await capture(scenario)
    const file = fileURLToPath(new URL('./fixtures/416-v51-reference.json', import.meta.url))
    if (!existsSync(file)) {
      if (process.env.V51_REFERENCE_WRITE !== '1') throw new Error('416-v51-reference.json is absent; run once with V51_REFERENCE_WRITE=1 on the PRISTINE pre-416 tree')
      writeFileSync(file, JSON.stringify(JSON.parse(canonicalJson(actual)), null, 2) + '\n')
    }
    const expected = JSON.parse(readFileSync(file, 'utf8'))
    for (const scenario of scenarios) expect(actual[scenario], scenario).toEqual(expected[scenario])
  })
})

