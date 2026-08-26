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

import { describe, expect, it } from 'vitest'

import { startRun } from '../shell.js'
import type { MemberTestExecutor, RunConfig } from '../shell.js'
import type { EventLogPort, HandoffStorePort } from '../ports.js'
import type {
  MaskingContext,
  RunEventEnvelope,
  ScopeKey,
  StepEvidence,
} from '@vostride/agent-qa-schema'
import { makeEmptyServedBrief } from '../../loop/evidence.js'

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

function configWith(masking: MaskingContext, eventLog: EventLogPort): RunConfig {
  return {
    runId: 'run-mask' as RunConfig['runId'],
    scope: SCOPE,
    executionContext: 'local-headless',
    buildOrdinal: 7,
    configDigests: { suiteConfigDigest: 'suite-d', testConfigDigest: 'test-d' },
    members: [{ testId: 'a', name: 'test a', filePath: 'a.test.ts' }],
    executor: secretExecutor,
    masking,
    ports: { handoffStore: makeHandoffStore(), eventLog },
  }
}

async function runOnce(masking: MaskingContext): Promise<{
  envelopes: RunEventEnvelope[]
  logLines: RunEventEnvelope[]
  handoffJson: string
  types: Set<string>
}> {
  const log = makeCapturingEventLog()
  const session = startRun(configWith(masking, log.port))
  const envelopes: RunEventEnvelope[] = []
  session.subscribe(1, event => envelopes.push(event))
  const { handoff } = await session.done
  return {
    envelopes,
    logLines: log.lines,
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
    // (c) the handoff (synthesized-evidence fields the shell masks) is secret-free.
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
