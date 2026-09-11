// 422 D-18: ablating an ORDINARY candidate — one the run served on channel 1 without ever
// flagging it a canary — through the real two-arm replay arbiter.
//
// This is the one seam in the phase that DELETES user-visible state, so every cell here is
// written from the refusing side first. Removal requires POSITIVE proof: the run's own recorded
// member outcome, whose failing step is recomputed rather than declared. Absent proof, empty
// proof and malformed proof all leave the memory exactly where it was — and they say three
// different things about why, because "removed nothing" with one voice is a fact no reader can
// act on.
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  asRecordId,
  asRef,
  sha256hex,
  type PerTestOutcome,
  type ServedBrief,
  type StepEvidence,
} from '@vostride/agent-qa-schema'
import { createMaskingContext } from '@vostride/agent-qa-safety'
import {
  applyBriefDelta,
  canonicalJson,
  canonicalizeInputLeg,
  computeDecisionIdentity,
  deriveSampleSeeds,
  type LeafCassette,
} from '@vostride/agent-qa-eval'
import * as evalLocal from '../index.js'
import { resolveActiveRecordRemoval } from '../replay-gate-composition.js'
import { writeGate1Fixture } from './fixtures/gate1-fixtures.js'
import {
  actionGenerateResult,
  makeReplayHandoff,
  noneAuth,
  respondingStub,
  stubProfile,
} from './fixtures/replay-fixtures.js'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** A gate fixture whose target decision served ONE pre-promotion, never-canary brief line. */
function ordinaryCandidate() {
  const root = mkdtempSync(join(tmpdir(), 'ordinary-candidate-'))
  roots.push(root)
  const f = writeGate1Fixture(root, { proofBrief: true })
  const target = f.selected.find((row) => row.cassette.id === f.targetId)!
  const line = target.cassette.input.servedBrief.channel1[0]!
  line.status = 'candidate'
  line.servedAsCanary = false
  target.cassette.receipt.promptInputHash = sha256hex(canonicalizeInputLeg(target.cassette.input))
  return { root, f, target, line }
}

/**
 * The run's own member outcome, shaped as the arbiter receives it. Overrides exist so a cell
 * can hand over evidence that is present but WRONG — the point of the guard.
 */
function authorizationFor(
  target: { cassette: LeafCassette },
  overrides: {
    recordId?: string
    runId?: string
    testId?: string
    pass?: boolean
    stepIndex?: number
    brief?: ServedBrief
    steps?: readonly StepEvidence[]
  } = {},
): evalLocal.FailingPathCandidateAuthorization {
  const { cassette } = target
  const base = makeReplayHandoff().tests[0]!
  const step: StepEvidence = {
    ...base.steps[0]!,
    stepIndex: overrides.stepIndex ?? cassette.stepIndex,
    servedBrief: overrides.brief ?? cassette.input.servedBrief,
    verifierVerdict: {
      pass: overrides.pass ?? false,
      reasoning: 'the recorded state did not advance',
    },
  }
  const perTest: PerTestOutcome = {
    ...base,
    testId: overrides.testId ?? cassette.input.testId,
    outcome: 'failed',
    steps: overrides.steps === undefined ? [step] : [...overrides.steps],
  }
  return {
    recordId: overrides.recordId ?? cassette.input.servedBrief.channel1[0]!.id,
    runId: overrides.runId ?? cassette.runId,
    perTest,
  }
}

function sampleOf(target: { cassette: LeafCassette }, ref: string) {
  const action = { type: 'click' as const, ref: asRef(ref) }
  return {
    sampleIndex: 0,
    durationMs: 0,
    outcome: {
      kind: 'decision' as const,
      action,
      identity: computeDecisionIdentity(action, target.cassette.input.stateBefore.elements),
    },
  }
}

interface AblateOptions {
  authorization?: evalLocal.FailingPathCandidateAuthorization
  servedCanary?: true
  recordId?: string
  k?: number
  always?: string
  existingWithout?: string
  dir?: string
  cassettes?: readonly Parameters<typeof evalLocal.removalFlipsOutcome>[0]['cassettes'][number][]
}

/** Drive the real arbiter; the stub answers gold only while the candidate line is in the prompt. */
async function ablate(fixture: ReturnType<typeof ordinaryCandidate>, options: AblateOptions = {}) {
  const { f, target, line } = fixture
  const needle = line.summary.replaceAll('"', '\\"')
  const stub = respondingStub((call) =>
    actionGenerateResult(
      'web',
      options.always ?? (JSON.stringify(call.prompt).includes(needle) ? 'e-continue' : 'e-other'),
    ),
  )
  const result = await evalLocal.removalFlipsOutcome({
    recordId: options.recordId ?? line.id,
    mode: {
      kind: 'active-record',
      ...(options.servedCanary === true ? { servedCanary: true as const } : {}),
    },
    ...(options.authorization === undefined
      ? {}
      : { failingPathCandidate: options.authorization }),
    cassettes: options.cassettes ?? [target],
    k: options.k ?? 3,
    baseSeed: 11,
    existing: {
      withRecord: sampleOf(target, 'e-continue'),
      withoutRecord: sampleOf(target, options.existingWithout ?? 'e-other'),
    },
    replay: {
      profile: stubProfile(),
      auth: noneAuth,
      modelOverrides: { languageModels: stub.languageModels },
      maskingContextFactory: createMaskingContext,
    },
    gate1Dir: join(f.agentQaRoot, options.dir ?? 'ordinary-removal'),
  })
  return { result, stub, needle }
}

function digestTree(dir: string): string {
  const hash = createHash('sha256')
  const files = readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .sort()
  for (const file of files) {
    hash.update(file.slice(dir.length))
    hash.update(readFileSync(file))
  }
  return hash.digest('hex')
}

describe('D-18 ordinary-candidate ablation through the two-arm replay arbiter', () => {
  it('exports the authorization resolver beside the arbiter it guards', () => {
    expect(Reflect.get(evalLocal, 'resolveFailingPathCandidate')).toBeTypeOf('function')
  })

  it('ablates a non-canary candidate cited on the run’s verified failing step', async () => {
    const fixture = ordinaryCandidate()
    const { result, stub } = await ablate(fixture, {
      authorization: authorizationFor(fixture.target),
    })
    expect(result.crossCheck).toBe('flipped')
    expect(result.perTarget).toEqual([
      { cassetteId: fixture.target.cassette.id, crossCheck: 'flipped' },
    ])
    expect(result.notices).toEqual([])
    expect(stub.captured).toHaveLength(4)
  })

  it('reports held when both arms keep reaching gold without the record', async () => {
    const fixture = ordinaryCandidate()
    const { result } = await ablate(fixture, {
      authorization: authorizationFor(fixture.target),
      always: 'e-continue',
      existingWithout: 'e-continue',
    })
    expect(result.crossCheck).toBe('held')
    expect(result.notices).toEqual([])
  })

  it('reuses the run decision as with-record sample one, replaying one fewer per arm', async () => {
    const fixture = ordinaryCandidate()
    const k = 5
    const { result, stub, needle } = await ablate(fixture, {
      authorization: authorizationFor(fixture.target),
      k,
    })
    const withRecordCalls = stub.captured.filter((call) =>
      JSON.stringify(call.prompt).includes(needle),
    )
    // Sample one is the run's OWN decision, so the with-record arm replays k-1, not k.
    expect(withRecordCalls).toHaveLength(k - 1)
    expect(result.detail.filter((row) => row.withRecord)).toHaveLength(k)
    expect(result.modelCalls).toBe(2 * (k - 1))
    expect(result.screens).toBe(2 * (k - 1))
    expect(result.seeds).toEqual([11, ...deriveSampleSeeds(11, k)])
    expect(result.seedHonored).toBe(true)
  })

  it('removes NOTHING when no authorization is offered', async () => {
    const fixture = ordinaryCandidate()
    const { result, stub } = await ablate(fixture)
    expect(result.crossCheck).toBe('inconclusive')
    expect(stub.captured).toHaveLength(0)
    expect(result.notices.join('\n')).toContain(
      'candidate removal requires an explicit failing-path authorization',
    )
  })

  it('removes NOTHING when the authorization records no step at all', async () => {
    const fixture = ordinaryCandidate()
    const { result, stub } = await ablate(fixture, {
      authorization: authorizationFor(fixture.target, { steps: [] }),
    })
    expect(result.crossCheck).toBe('inconclusive')
    expect(stub.captured).toHaveLength(0)
    expect(result.notices.join('\n')).toContain('failing-path authorization records no step')
  })

  it('removes NOTHING when the authorization is malformed', async () => {
    const fixture = ordinaryCandidate()
    const malformed = {
      recordId: fixture.line.id,
      runId: fixture.target.cassette.runId,
      perTest: { testId: 7, steps: 'not-an-array' },
    } as unknown as evalLocal.FailingPathCandidateAuthorization
    const { result, stub } = await ablate(fixture, { authorization: malformed })
    expect(result.crossCheck).toBe('inconclusive')
    expect(stub.captured).toHaveLength(0)
    expect(result.notices.join('\n')).toContain('failing-path authorization is malformed')
  })

  it('states absent, empty and malformed proof as three DIFFERENT refusals', async () => {
    const fixture = ordinaryCandidate()
    const malformed = { recordId: fixture.line.id } as unknown as
      evalLocal.FailingPathCandidateAuthorization
    const reasons: string[] = []
    for (const authorization of [
      undefined,
      authorizationFor(fixture.target, { steps: [] }),
      malformed,
    ]) {
      const { result } = await ablate(fixture, {
        ...(authorization === undefined ? {} : { authorization }),
        dir: `refusal-${reasons.length}`,
      })
      expect(result.crossCheck).toBe('inconclusive')
      expect(result.notices).toHaveLength(1)
      reasons.push(result.notices[0]!)
      // The channel-1 line the caller tried to ablate is still exactly where the run left it.
      expect(fixture.target.cassette.input.servedBrief.channel1).toHaveLength(1)
      expect(fixture.target.cassette.input.servedBrief.channel1[0]!.id).toBe(fixture.line.id)
    }
    expect(new Set(reasons).size).toBe(3)
    for (const reason of reasons) expect(reason).toContain('brief-line-not-found:')
  })

  it('writes nothing into the committed corpus while ablating', async () => {
    const fixture = ordinaryCandidate()
    const before = digestTree(fixture.f.committedRoot)
    const { result } = await ablate(fixture, { authorization: authorizationFor(fixture.target) })
    expect(result.crossCheck).toBe('flipped')
    expect(digestTree(fixture.f.committedRoot)).toBe(before)
  })
})

describe('D-18 refusals stay narrow and always precede replay spend', () => {
  /** Each case mutates the decision or the proof, then asserts a TYPED refusal and zero calls. */
  const refusals: {
    name: string
    reason: string
    prepare: (fixture: ReturnType<typeof ordinaryCandidate>) => AblateOptions
  }[] = [
    {
      name: 'no reproducible proof turn covers the decision',
      reason: 'active record requires a reproducible proof turn',
      prepare: (fixture) => {
        const proof = fixture.target.cassette.input.servedBrief.proof!
        const first = proof.promptTurns[0]!
        proof.promptTurns = [
          { ...first, turnOrdinal: 5 },
          { ...first, turnOrdinal: 6, learnedL2: `${first.learnedL2} (other turn)` },
        ]
        return { authorization: authorizationFor(fixture.target) }
      },
    },
    {
      name: 'the rendered line appears twice in the proof turn',
      reason: 'active record rendered line is absent or ambiguous',
      prepare: (fixture) => {
        const turn = fixture.target.cassette.input.servedBrief.proof!.promptTurns[0]!
        turn.learnedL2 = `${turn.learnedL2}\n${turn.learnedL2}`
        return { authorization: authorizationFor(fixture.target) }
      },
    },
    {
      name: 'the authorization names a record other than the one being removed',
      reason: 'failing-path authorization names another record',
      prepare: (fixture) => ({
        authorization: authorizationFor(fixture.target, { recordId: 'some-other-record' }),
      }),
    },
    {
      name: 'the authorization names another run',
      reason: 'failing-path authorization names another run or member',
      prepare: (fixture) => ({
        authorization: authorizationFor(fixture.target, { runId: 'r_not-this-run' }),
      }),
    },
    {
      name: 'the authorization names another member test',
      reason: 'failing-path authorization names another run or member',
      prepare: (fixture) => ({
        authorization: authorizationFor(fixture.target, { testId: 'another-member' }),
      }),
    },
    {
      name: 'the served line sits on an unsupported tier',
      reason: 'active record brief line unavailable',
      prepare: (fixture) => {
        fixture.line.tier = 'L9'
        return { authorization: authorizationFor(fixture.target) }
      },
    },
    {
      name: 'the cited step passed its verifier',
      reason: 'failing-path authorization cites a verified-passing step',
      prepare: (fixture) => ({
        authorization: authorizationFor(fixture.target, { pass: true }),
      }),
    },
    {
      name: 'the cited step is not the decision being ablated',
      reason: 'failing-path authorization cites a step other than the removal target',
      prepare: (fixture) => ({
        authorization: authorizationFor(fixture.target, { stepIndex: 4 }),
      }),
    },
    {
      name: 'the failing step never served the record',
      reason: 'failing-path record was not served on the failing step',
      prepare: (fixture) => {
        const brief = structuredClone(fixture.target.cassette.input.servedBrief)
        brief.channel1 = []
        return { authorization: authorizationFor(fixture.target, { brief }) }
      },
    },
    {
      name: 'the record is a probation canary rather than an ordinary candidate',
      reason: 'failing-path record is not an ordinary candidate',
      prepare: (fixture) => {
        const brief = structuredClone(fixture.target.cassette.input.servedBrief)
        brief.channel1[0]!.status = 'active'
        brief.channel1[0]!.servedAsCanary = true
        return { authorization: authorizationFor(fixture.target, { brief }) }
      },
    },
    {
      name: 'the authorization carries a lookalike brief, not the replayed one',
      reason: 'failing-path authorization cites a different brief than the replayed decision',
      prepare: (fixture) => {
        const brief = structuredClone(fixture.target.cassette.input.servedBrief)
        // Same record, still a candidate — but one extra served line the decision never had.
        brief.channel1.push({
          ...structuredClone(brief.channel1[0]!),
          id: asRecordId('forged-sibling-line'),
        })
        return { authorization: authorizationFor(fixture.target, { brief }) }
      },
    },
  ]

  it.each(refusals)('refuses before any replay call when $name', async ({ reason, prepare }) => {
    const fixture = ordinaryCandidate()
    const options = prepare(fixture)
    fixture.target.cassette.receipt.promptInputHash = sha256hex(
      canonicalizeInputLeg(fixture.target.cassette.input),
    )
    const { result, stub } = await ablate(fixture, options)
    expect(result.crossCheck).toBe('inconclusive')
    expect(result.perTarget).toEqual([
      { cassetteId: fixture.target.cassette.id, crossCheck: 'inconclusive' },
    ])
    expect(result.notices.join('\n')).toContain(reason)
    expect(stub.captured).toHaveLength(0)
    expect(result.modelCalls).toBe(0)
    expect(result.screens).toBe(0)
    // The record the caller tried to ablate is still exactly where the run served it.
    expect(fixture.target.cassette.input.servedBrief.channel1.map((row) => row.id)).toContain(
      fixture.line.id,
    )
  })

  it('gives every refusal its own words', () => {
    expect(new Set(refusals.map((row) => row.reason)).size).toBe(refusals.length - 1)
  })

  it('changes exactly the authorized line and nothing else in the replayed input', () => {
    const fixture = ordinaryCandidate()
    const { cassette } = fixture.target
    const removal = resolveActiveRecordRemoval({
      cassette,
      recordId: fixture.line.id,
      failingPathCandidate: authorizationFor(fixture.target),
    })
    expect(removal.kind).toBe('removed')
    if (removal.kind !== 'removed') return
    const without = applyBriefDelta(cassette.input, removal.delta)
    const stripBrief = (leg: typeof cassette.input) => ({ ...leg, servedBrief: undefined })
    expect(canonicalJson(stripBrief(without))).toBe(canonicalJson(stripBrief(cassette.input)))
    const stripLines = (brief: ServedBrief) => ({
      ...brief,
      channel1: undefined,
      proof: brief.proof === undefined ? undefined : { ...brief.proof, promptTurns: undefined },
    })
    expect(canonicalJson(stripLines(without.servedBrief))).toBe(
      canonicalJson(stripLines(cassette.input.servedBrief)),
    )
    expect(without.servedBrief.channel1).toEqual([])
    expect(cassette.input.servedBrief.channel1).toHaveLength(1)
    const before = cassette.input.servedBrief.proof!.promptTurns
    const after = without.servedBrief.proof!.promptTurns
    expect(after).toHaveLength(before.length)
    for (const [index, turn] of before.entries()) {
      const lines = turn.learnedL2 === '' ? [] : turn.learnedL2.split('\n')
      const remaining = lines.filter((_, position) => position !== removal.delta.position)
      expect(lines).toContain(removal.delta.renderedLine)
      expect(after[index]!.learnedL2).toBe(remaining.join('\n'))
      expect(canonicalJson({ ...turn, learnedL2: null })).toBe(
        canonicalJson({ ...after[index]!, learnedL2: null }),
      )
    }
  })

  it('answers each decision identity separately when one candidate rode two of them', async () => {
    const root = mkdtempSync(join(tmpdir(), 'two-decisions-'))
    roots.push(root)
    const f = writeGate1Fixture(root, { proofBrief: true, targetDecisions: 2 })
    const targets = f.selected.filter((row) => row.cassette.runId === f.injection.target!.runId)
    expect(targets).toHaveLength(2)
    expect(new Set(targets.map((row) => row.cassette.decisionOrdinal)).size).toBe(2)
    const line = targets[0]!.cassette.input.servedBrief.channel1[0]!
    const needle = line.summary.replaceAll('"', '\\"')
    for (const row of targets) {
      const own = row.cassette.input.servedBrief.channel1[0]!
      own.status = 'candidate'
      own.servedAsCanary = false
      row.cassette.receipt.promptInputHash = sha256hex(canonicalizeInputLeg(row.cassette.input))
    }
    // The sibling decision keeps reaching gold with or without the record; the first does not.
    const stub = respondingStub((call) => {
      const prompt = JSON.stringify(call.prompt)
      return actionGenerateResult(
        'web',
        prompt.includes('gate1-target-sibling-1') || prompt.includes(needle)
          ? 'e-continue'
          : 'e-other',
      )
    })
    const sampleFor = (row: (typeof targets)[number], ref: string) => {
      const action = { type: 'click' as const, ref: asRef(ref) }
      return {
        sampleIndex: 0,
        durationMs: 0,
        outcome: {
          kind: 'decision' as const,
          action,
          identity: computeDecisionIdentity(action, row.cassette.input.stateBefore.elements),
        },
      }
    }
    const result = await evalLocal.removalFlipsOutcome({
      recordId: line.id,
      mode: { kind: 'active-record' },
      failingPathCandidate: authorizationFor(targets[0]!),
      cassettes: targets.map((row) => ({
        ...row,
        existing: {
          withRecord: sampleFor(row, 'e-continue'),
          withoutRecord: sampleFor(
            row,
            row.cassette.decisionOrdinal === targets[0]!.cassette.decisionOrdinal
              ? 'e-other'
              : 'e-continue',
          ),
        },
      })),
      k: 3,
      baseSeed: 11,
      replay: {
        profile: stubProfile(),
        auth: noneAuth,
        modelOverrides: { languageModels: stub.languageModels },
        maskingContextFactory: createMaskingContext,
      },
      gate1Dir: join(f.agentQaRoot, 'two-decisions'),
    })
    expect(result.perTarget).toHaveLength(2)
    expect(new Set(result.perTarget.map((row) => row.cassetteId)).size).toBe(2)
    // Two decisions, two answers — the arbiter never folds one into the other.
    expect(new Set(result.perTarget.map((row) => row.crossCheck))).toEqual(
      new Set(['flipped', 'held']),
    )
  })
})
