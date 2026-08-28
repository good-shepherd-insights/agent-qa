// D-09 synthetic-masking proof (CONTEXT.md mandates this phase). Drives a full run whose evidence
// carries a planted secret in every string field that can reach durable telemetry — the started
// step text (plan text), the finalized step's verifier reasoning (error/reasoning text), and the
// per-test result the handoff synthesizes evidence from — then proves that a SYNTHETIC
// MaskingContext scrubs the secret from ALL THREE sinks with zero further wiring: the bus payloads,
// the serialized event-log lines, and the CompletedRunHandoff. The IDENTITY context passes the
// secret through unchanged — proving 361 does NOT seed the real context (that is 362's SEAM-01;
// the sink/assembly already route every payload through `masking.mask`, so seeding alone activates
// masking). Also pins the two run-shape invariants: no chip-event type is ever emitted, and
// `runFinished.disposition` is `'detached'`.
//
// WINDOWS #305 · DETL-04: BOTH arms of the handoff assembly mask. The first describe drives an
// evidence-LESS executor, so its handoff carries evidence the shell SYNTHESIZES; the second drives
// an executor whose step CARRIES real §A8 evidence, which `assemblePerTestOutcome` used to copy
// verbatim into the durable artifact. The narration a run records — the verifier's own words, a
// planning turn's stated intent, a captured failure message — now goes through the run's own
// `MaskFn` in both arms, while the structural identity fields (`stepText`, `plannedAction`,
// `interpolatedVariables`) stay byte-identical in both.

import { describe, expect, it } from 'vitest'

import { startRun } from '../shell.js'
import type { MemberTestExecutor, RunConfig } from '../shell.js'
import type { EventLogPort, HandoffStorePort } from '../ports.js'
import type {
  Action,
  CompletedRunHandoff,
  InterpolatedVariable,
  MaskingContext,
  RunEventEnvelope,
  ScopeKey,
  StepEvidence,
} from '@vostride/agent-qa-schema'
import { asRef } from '@vostride/agent-qa-schema'
import { makeEmptyServedBrief } from '../../loop/evidence.js'
import { makeScreenState } from '../../testing/screen-fixtures.js'

const SECRET = 'S3CR3T-hunter2-token'

const SCOPE: ScopeKey = { tier: 'suite', key: 'checkout' }

/** Replaces the planted secret — the shape 362 seeds. */
const SYNTHETIC: MaskingContext = {
  mask: (text: string) => text.replaceAll(SECRET, '[masked]'),
  unmask: (text: string) => text,
}

/** Identity — the pre-362 default: the secret must survive untouched. */
const IDENTITY: MaskingContext = {
  mask: (text: string) => text,
  unmask: (text: string) => text,
}

const CHIP_EVENT_TYPES = [
  'analysisStarted', 'analysisCompleted', 'analysisFailed',
  'curationStarted', 'curationCompleted', 'curationFailed',
] as const

function makeCapturingEventLog(): { port: EventLogPort; lines: RunEventEnvelope[] } {
  const lines: RunEventEnvelope[] = []
  return {
    lines,
    port: {
      append(envelope: RunEventEnvelope) {
        lines.push(envelope)
      },
      read(fromSeq: number) {
        return lines.filter(event => event.seq >= fromSeq)
      },
    },
  }
}

function makeHandoffStore(): HandoffStorePort {
  return { save() {} }
}

// An executor that plants the secret in the live-emitted payloads (stepStarted plan text +
// stepFinalized verifier reasoning) AND in the returned result the handoff synthesizes from
// (step name = plan text, step error = error text — neither carries §A8 evidence, so the shell
// synthesizes masked evidence for it).
const secretExecutor: MemberTestExecutor = async (member, ctx) => {
  ctx.events.stepStarted({ stepIndex: 0, stepText: `open ${SECRET} panel` })
  const evidence: StepEvidence = {
    stepIndex: 0,
    stepText: `open ${SECRET} panel`,
    cacheStatus: 'miss',
    servedBrief: makeEmptyServedBrief(SCOPE, 7),
    subActions: [],
    verifierVerdict: { pass: false, reasoning: `verifier observed ${SECRET}` },
  }
  ctx.events.loopEmitFor(0).stepFinalized(evidence)
  return {
    name: member.testId,
    filePath: `${member.testId}.test.ts`,
    status: 'failed',
    steps: [{ name: `plan ${SECRET} action`, status: 'failed', error: `boom ${SECRET}`, duration: 1 }],
    duration: 1,
  }
}

// An executor whose step CARRIES real §A8 evidence, with the secret planted in the three NARRATION
// places a durable handoff records: the verifier's own words, a planning turn's stated intent, and
// a captured failure message. `assemblePerTestOutcome` copied this arm VERBATIM before WINDOWS
// #305, so the secret reached handoff.json in clear while the same run's failureSummary — routed
// through the SAME MaskFn one frame away — did not.
const realEvidenceExecutor: MemberTestExecutor = async (member, ctx) => {
  const evidence: StepEvidence = {
    stepIndex: 0,
    stepText: 'acknowledge the notice',
    cacheStatus: 'miss',
    servedBrief: makeEmptyServedBrief(SCOPE, 7),
    subActions: [
      {
        plan: `dismiss the banner naming ${SECRET}`,
        plannedAction: { type: 'click', ref: asRef('e2') },
        stateBefore: makeScreenState(),
        result: { success: false, error: `Cannot acknowledge: ${SECRET} rejected` },
      },
    ],
    verifierVerdict: { pass: false, reasoning: `verifier observed ${SECRET}` },
  }
  ctx.events.loopEmitFor(0).stepFinalized(evidence)
  return {
    name: member.testId,
    filePath: `${member.testId}.test.ts`,
    status: 'failed',
    steps: [{ name: evidence.stepText, status: 'failed', duration: 1, evidence }],
    duration: 1,
  }
}

// The G-381-3 carve-out driven end to end: the SAME secret planted in the three STRUCTURAL identity
// fields instead. `interpolatedVariables[].value` is exact-string-matched against `plannedAction`
// by `cli/src/curation/emit-candidates.ts`, so masking either side would break replay — these three
// must survive a masked run byte-identical, which is the inverse assertion below.
const CARVE_OUT_STEP_TEXT = `acknowledge using ${SECRET}`
const CARVE_OUT_ACTION: Action = {
  type: 'fill',
  ref: asRef('e1'),
  text: SECRET,
  clearMode: 'replace',
  submit: false,
}
const CARVE_OUT_VARIABLES: InterpolatedVariable[] = [{ name: 'LOGIN_USER', value: SECRET }]

const carveOutExecutor: MemberTestExecutor = async (member, ctx) => {
  const evidence: StepEvidence = {
    stepIndex: 0,
    stepText: CARVE_OUT_STEP_TEXT,
    cacheStatus: 'miss',
    servedBrief: makeEmptyServedBrief(SCOPE, 7),
    subActions: [
      {
        plan: 'fill the field',
        plannedAction: CARVE_OUT_ACTION,
        stateBefore: makeScreenState(),
        result: { success: true },
      },
    ],
    verifierVerdict: { pass: true, reasoning: 'goal met' },
    interpolatedVariables: CARVE_OUT_VARIABLES,
  }
  ctx.events.loopEmitFor(0).stepFinalized(evidence)
  return {
    name: member.testId,
    filePath: `${member.testId}.test.ts`,
    status: 'passed',
    steps: [{ name: evidence.stepText, status: 'passed', duration: 1, evidence }],
    duration: 1,
  }
}

function configWith(
  masking: MaskingContext,
  eventLog: EventLogPort,
  executor: MemberTestExecutor = secretExecutor,
): RunConfig {
  return {
    runId: 'run-mask' as RunConfig['runId'],
    scope: SCOPE,
    executionContext: 'local-headless',
    buildOrdinal: 7,
    configDigests: { suiteConfigDigest: 'suite-d', testConfigDigest: 'test-d' },
    members: [{ testId: 'a', name: 'test a', filePath: 'a.test.ts' }],
    executor,
    masking,
    ports: { handoffStore: makeHandoffStore(), eventLog },
  }
}

async function runOnce(
  masking: MaskingContext,
  executor: MemberTestExecutor = secretExecutor,
): Promise<{
  envelopes: RunEventEnvelope[]
  logLines: RunEventEnvelope[]
  handoff: CompletedRunHandoff
  handoffJson: string
  types: Set<string>
}> {
  const log = makeCapturingEventLog()
  const session = startRun(configWith(masking, log.port, executor))
  const envelopes: RunEventEnvelope[] = []
  session.subscribe(1, event => envelopes.push(event))
  const { handoff } = await session.done
  return {
    envelopes,
    logLines: log.lines,
    handoff,
    handoffJson: JSON.stringify(handoff),
    types: new Set(envelopes.map(event => event.type)),
  }
}

describe('D-09 synthetic masking proof', () => {
  it('a synthetic MaskingContext scrubs the secret from bus payloads, event-log lines, AND the handoff', async () => {
    const { envelopes, logLines, handoffJson } = await runOnce(SYNTHETIC)

    // (a) every subscribed envelope payload is secret-free.
    for (const envelope of envelopes) {
      expect(JSON.stringify(envelope.payload)).not.toContain(SECRET)
    }
    // (b) every serialized event-log line is secret-free.
    for (const line of logLines) {
      expect(JSON.stringify(line)).not.toContain(SECRET)
    }
    // (c) the handoff is secret-free. This arm's steps carry NO §A8 evidence, so the shell
    // synthesizes it; the real-evidence arm is measured by the WINDOWS #305 describe below.
    expect(handoffJson).not.toContain(SECRET)

    // Sanity: the mask actually fired (redaction marker present in the masked handoff).
    expect(handoffJson).toContain('[masked]')
  })

  it('the identity context passes the secret through unchanged (361 does NOT seed the real context)', async () => {
    const { envelopes, logLines, handoffJson } = await runOnce(IDENTITY)

    expect(envelopes.some(envelope => JSON.stringify(envelope.payload).includes(SECRET))).toBe(true)
    expect(logLines.some(line => JSON.stringify(line).includes(SECRET))).toBe(true)
    expect(handoffJson).toContain(SECRET)
  })

  it('a full run emits no chip-event type and pins runFinished disposition to detached', async () => {
    const { envelopes, types } = await runOnce(IDENTITY)

    for (const chip of CHIP_EVENT_TYPES) {
      expect(types.has(chip)).toBe(false)
    }
    const finished = envelopes.find(event => event.type === 'runFinished')
    expect(finished).toBeDefined()
    expect((finished!.payload as { disposition: string }).disposition).toBe('detached')
  })
})

// WINDOWS #305 · DETL-04 — the REAL-evidence arm of the assembly. Every cell here drives a step
// that CARRIES §A8 evidence, which is the arm `assemblePerTestOutcome` copied verbatim into the
// durable artifact. There is no second detector anywhere in this block: the only masker is the
// run's own `config.masking.mask`, the same object `projectTestFinished` routes `failureSummary`
// through in the same shell frame.
describe('WINDOWS #305 — real step evidence is masked AT REST by the assembly', () => {
  it('masks the verifier reasoning, the sub-action plan and the captured error the handoff records', async () => {
    const { handoffJson, handoff } = await runOnce(SYNTHETIC, realEvidenceExecutor)
    const subAction = handoff.tests[0].steps[0].subActions[0]

    expect(handoffJson).not.toContain(SECRET)
    expect(handoff.tests[0].steps[0].verifierVerdict.reasoning).toBe('verifier observed [masked]')
    expect(subAction.plan).toBe('dismiss the banner naming [masked]')
    expect(subAction.result.error).toBe('Cannot acknowledge: [masked] rejected')
  })

  it('carries the redaction marker rather than dropping the narration', async () => {
    const { handoffJson } = await runOnce(SYNTHETIC, realEvidenceExecutor)

    expect(handoffJson).toContain('[masked]')
  })

  it('the identity context leaves real evidence untouched — SEEDING alone activates masking', async () => {
    const { handoffJson } = await runOnce(IDENTITY, realEvidenceExecutor)

    expect(handoffJson).toContain(SECRET)
  })

  it('leaves stepText, plannedAction and interpolatedVariables byte-identical under a firing mask (G-381-3)', async () => {
    const { handoff } = await runOnce(SYNTHETIC, carveOutExecutor)
    const step = handoff.tests[0].steps[0]

    expect(step.stepText).toBe(CARVE_OUT_STEP_TEXT)
    expect(step.subActions[0].plannedAction).toEqual(CARVE_OUT_ACTION)
    expect(step.interpolatedVariables).toEqual(CARVE_OUT_VARIABLES)
  })
})
