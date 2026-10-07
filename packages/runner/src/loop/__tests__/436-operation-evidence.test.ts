// C436-OPERATION-EVIDENCE (436 D-16, D-22, D-23): operation evidence an adapter attaches to an
// action reaches that sub-action, the planner's history and the verifier, masked; the adapter's
// metadata key does not persist.
import { describe, expect, it } from 'vitest'
import { APP_OBSERVED_DATA_CLOSE, APP_OBSERVED_DATA_OPEN } from '@vostride/agent-qa-safety'
import type {
  DownloadEvidence,
  OperationEvidence,
  StepEvidence,
  SubActionEvidence,
} from '@vostride/agent-qa-schema'
import type { Action, ActionResult, PlatformAdapter } from '../../platform.js'
import { makeScreenState } from '../../testing/screen-fixtures.js'
import { readDownloadMeta } from '../../compound/metadata.js'
import { executeStep } from '../index.js'
import type { LoopEventEmitPort, LoopPorts } from '../ports.js'
import { buildVerificationPrompt, composeTurnMessages, renderOperationEvidence } from '../prompts.js'
import type { ActionPlan, Planner, StepContext, Verifier } from '../types.js'
import { makeActionPlan, makeAdapter, makeStepContext } from './loop-harness.js'

const REPORT: DownloadEvidence = {
  suggestedFilename: 'report-secret.csv',
  extension: '.csv',
  size: 18,
  sha256: 'a'.repeat(64),
  state: 'completed',
}

const masking = {
  mask: (text: string) => text.replaceAll('secret', '[MASKED]'),
  unmask: (text: string) => text,
}

function scriptedPlanner(plans: ActionPlan[], contexts: StepContext[]): Planner {
  let call = 0
  return {
    async plan(_step, _screen, context) {
      contexts.push({ ...context, subActionHistory: [...(context.subActionHistory ?? [])] })
      const plan = plans[Math.min(call, plans.length - 1)]!
      call++
      return { plan }
    },
  }
}

const passingVerifier: Verifier = {
  async verify() {
    return { verification: { success: true, reasoning: 'Requested outcome observed', isAppError: false } }
  },
}

function recordingEvents(recorded: SubActionEvidence[]): LoopEventEmitPort {
  return {
    stepFinalized() {},
    subActionRecorded(evidence) { recorded.push(structuredClone(evidence)) },
  }
}

function ports(overrides: Partial<LoopPorts> & Pick<LoopPorts, 'adapter' | 'planner'>): LoopPorts {
  return { plannerConfig: { maxActions: 20, maxPlanningTurns: 20, previousStepCount: 0 }, masking, ...overrides }
}

function twoClicks(): ActionPlan[] {
  return [
    makeActionPlan({ reasoning: 'Export the report', action: { type: 'click', ref: 'e1' }, stepComplete: false }),
    makeActionPlan({ reasoning: 'Confirm the export', action: { type: 'click', ref: 'e1' }, stepComplete: true }),
  ]
}

async function runDownloadStep(first: ActionResult, verifier: Verifier = passingVerifier): Promise<{
  evidence: StepEvidence
  emitted: SubActionEvidence[]
  contexts: StepContext[]
  status: string
}> {
  const contexts: StepContext[] = []
  const emitted: SubActionEvidence[] = []
  const result = await executeStep(
    'Export the report',
    ports({
      adapter: makeAdapter({ executeResults: [first, { success: true }] }),
      planner: scriptedPlanner(twoClicks(), contexts),
      verifier,
      events: recordingEvents(emitted),
    }),
    makeStepContext({ stepInstruction: 'Export the report' }),
  )
  return { evidence: result.evidence!, emitted, contexts, status: result.status }
}

describe('C436-OPERATION-EVIDENCE', () => {
  it('the sub-action carries masked download evidence and the recorded result no longer carries the metadata key', async () => {
    const { evidence, emitted, status } = await runDownloadStep({
      success: true,
      metadata: { download: [REPORT], keep: 'me' },
    })

    expect(status).toBe('passed')
    const [first, second] = evidence.subActions
    expect(first!.operationEvidence).toEqual({
      downloads: [{ ...REPORT, suggestedFilename: 'report-[MASKED].csv' }],
    })
    expect(first!.result.metadata).toEqual({ keep: 'me' })
    expect(second).not.toHaveProperty('operationEvidence')
    expect(emitted[0]!.operationEvidence?.downloads?.[0]?.suggestedFilename).toBe('report-[MASKED].csv')
    expect(emitted[0]!.result.metadata).not.toHaveProperty('download')
    expect(JSON.stringify(evidence)).not.toContain('report-secret')
  })

  it('a download-only metadata block leaves no metadata on the recorded result', async () => {
    const { evidence } = await runDownloadStep({ success: true, metadata: { download: [REPORT] } })
    expect(evidence.subActions[0]!.result).not.toHaveProperty('metadata')
  })

  it('the history renders one wrapped Operation evidence line', async () => {
    const { contexts } = await runDownloadStep({ success: true, metadata: { download: [REPORT] } })

    const history = contexts[1]!.subActionHistory!
    expect(history).toHaveLength(1)
    expect(history[0]!.evidence).toBe([
      APP_OBSERVED_DATA_OPEN,
      `Download "report-[MASKED].csv" (.csv): completed, 18 bytes, sha256 ${'a'.repeat(64)}`,
      APP_OBSERVED_DATA_CLOSE,
    ].join('\n'))

    const turn = composeTurnMessages(contexts[1]!, makeScreenState())
      .map((message) => String(message.content))
      .join('\n')
    const lines = turn.split('\n').filter((line) => line.startsWith('    Operation evidence: '))
    expect(lines).toEqual([`    Operation evidence: ${APP_OBSERVED_DATA_OPEN}`])
  })

  it('no evidence means no line and no key', async () => {
    const { evidence, contexts } = await runDownloadStep({ success: true })

    expect(evidence.subActions.every((sub) => !('operationEvidence' in sub))).toBe(true)
    expect(contexts[1]!.subActionHistory![0]).not.toHaveProperty('evidence')
    const turn = composeTurnMessages(contexts[1]!, makeScreenState())
      .map((message) => String(message.content))
      .join('\n')
    expect(turn).not.toContain('Operation evidence')
  })

  it('a failed, canceled or unfinished download is rendered as such, never as completed', async () => {
    const failed: OperationEvidence = {
      downloads: [
        { suggestedFilename: 'a.zip', extension: '.zip', state: 'failed', failure: 'Network error' },
        { suggestedFilename: 'b', extension: '', state: 'canceled', failure: 'canceled' },
        { suggestedFilename: 'c.iso', extension: '.iso', state: 'unfinished' },
      ],
    }
    const { evidence, contexts } = await runDownloadStep({ success: true, metadata: { download: failed.downloads } })

    expect(evidence.subActions[0]!.operationEvidence).toEqual(failed)
    const rendered = contexts[1]!.subActionHistory![0]!.evidence!
    expect(rendered).toContain('Download "a.zip" (.zip): failed: Network error')
    expect(rendered).toContain('Download "b" (no extension): canceled: canceled')
    expect(rendered).toContain('Download "c.iso" (.iso): unfinished, not finished within the time limit')
    expect(rendered).not.toContain('completed')
  })

  it('readDownloadMeta keeps well-formed entries in order and drops the rest', () => {
    expect(readDownloadMeta({ metadata: { download: 'report.csv' } })).toBeUndefined()
    expect(readDownloadMeta({ metadata: {} })).toBeUndefined()
    expect(readDownloadMeta({
      metadata: {
        download: [
          REPORT,
          { suggestedFilename: 'x.csv', extension: '.csv', state: 'completed' },
          { suggestedFilename: 'y.csv', extension: '.csv', state: 'downloaded' },
          { suggestedFilename: 'z.csv', extension: '.csv', state: 'unfinished', path: '/tmp/z' },
        ],
      },
    })).toEqual([REPORT, { suggestedFilename: 'z.csv', extension: '.csv', state: 'unfinished' }])
  })
})

const SECOND: DownloadEvidence = {
  suggestedFilename: 'invoice.pdf',
  extension: '.pdf',
  size: 2048,
  sha256: 'b'.repeat(64),
  state: 'completed',
}

function recordingVerifier(calls: unknown[][], pass: boolean): Verifier {
  return {
    async verify(...args: unknown[]) {
      calls.push(args)
      return {
        verification: pass
          ? { success: true, reasoning: 'Requested outcome observed', isAppError: false }
          : { success: false, reasoning: 'The requested download is not evidenced', isAppError: false },
      }
    },
  } as Verifier
}

function withSupport(adapter: PlatformAdapter, support: PlatformAdapter['operationCaptureSupport']): PlatformAdapter {
  return Object.assign(adapter, { operationCaptureSupport: support })
}

async function runWith(adapter: PlatformAdapter, verifier: Verifier, maxActions = 20) {
  return executeStep(
    'Export the report',
    ports({
      adapter,
      planner: scriptedPlanner(twoClicks(), []),
      verifier,
      plannerConfig: { maxActions, maxPlanningTurns: 20, previousStepCount: 0 },
    }),
    makeStepContext({ stepInstruction: 'Export the report' }),
  )
}

describe('C436-OPERATION-EVIDENCE verifier input and availability', () => {
  it("the verifier receives the step's accumulated operation evidence", async () => {
    const calls: unknown[][] = []
    const adapter = makeAdapter({
      executeResults: [
        { success: true, metadata: { download: [REPORT] } },
        { success: true, metadata: { download: [SECOND] } },
      ],
    })
    const result = await runWith(adapter, recordingVerifier(calls, true))

    expect(result.status).toBe('passed')
    expect(calls).toHaveLength(1)
    expect(calls[0]![9]).toEqual({
      downloads: [{ ...REPORT, suggestedFilename: 'report-[MASKED].csv' }, SECOND],
    })
  })

  it('a step with no operation evidence passes no trailing verifier argument', async () => {
    const calls: unknown[][] = []
    await runWith(makeAdapter(), recordingVerifier(calls, true))
    expect(calls[0]![9]).toBeUndefined()
  })

  it('buildVerificationPrompt renders an Operation evidence section only when evidence exists', () => {
    const screen = makeScreenState()
    const action: Action = { type: 'click', ref: 'e1' } as Action
    const evidence: OperationEvidence = { downloads: [SECOND] }
    const without = buildVerificationPrompt('Export the report', screen, screen, action)
    const withNone = buildVerificationPrompt('Export the report', screen, screen, action, false, undefined, undefined, undefined, undefined)
    const withEvidence = buildVerificationPrompt('Export the report', screen, screen, action, false, undefined, undefined, undefined, evidence)

    expect(withNone).toBe(without)
    expect(without).not.toContain('Operation evidence')
    expect(withEvidence.startsWith(without)).toBe(true)
    expect(withEvidence.slice(without.length)).toBe(['',
      '',
      'Operation evidence from the actions taken in this step:',
      APP_OBSERVED_DATA_OPEN,
      renderOperationEvidence(evidence),
      APP_OBSERVED_DATA_CLOSE,
    ].join('\n'))
  })

  it('an adapter without capture support records operationCapture unavailable with its reason', async () => {
    const plain = await runWith(makeAdapter(), recordingVerifier([], true))
    expect(plain.evidence!.operationCapture).toEqual({
      download: 'unavailable',
      clipboard: 'unavailable',
      reason: 'platform',
    })

    for (const browser of ['firefox', 'webkit']) {
      const unsupported = withSupport(makeAdapter(), { download: false, clipboard: false, reason: browser })
      const result = await runWith(unsupported, recordingVerifier([], true))
      expect(result.evidence!.operationCapture).toEqual({
        download: 'unavailable',
        clipboard: 'unavailable',
        reason: browser,
      })
    }
  })

  it('a Chromium web adapter records both captures available', async () => {
    const chromium = withSupport(makeAdapter(), { download: true, clipboard: true })
    const result = await runWith(chromium, recordingVerifier([], true))
    expect(result.evidence!.operationCapture).toEqual({ download: 'available', clipboard: 'available' })
  })

  it('unavailable evidence never makes a step pass', async () => {
    const calls: unknown[][] = []
    const result = await runWith(makeAdapter(), recordingVerifier(calls, false), 4)

    expect(result.status).not.toBe('passed')
    expect(result.evidence!.operationCapture?.download).toBe('unavailable')
    expect(calls.length).toBeGreaterThan(0)
    expect(calls.every((args) => args[9] === undefined)).toBe(true)
    expect(result.evidence!.verifierVerdict.pass).toBe(false)
  })
})
