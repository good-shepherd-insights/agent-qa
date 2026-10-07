// C436-OUTCOME-EVIDENCE (436 D-28, SC1): model-free acceptance through the real runner loop and a
// real headless Chromium. A scripted planner and verifier drive executeStep over WebPlatformAdapter
// against loopback fixture pages whose outcomes are known. Every cell also checks that nothing of
// the deleted screen-change machinery wrote evidence and that the loop dispatched exactly what the
// planner planned (no loop-initiated retry).

import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { screenIdentityHash } from '@vostride/agent-qa-schema'
import type { DownloadEvidence } from '@vostride/agent-qa-schema'
import type { PlannerConfig, StepResult } from '@vostride/agent-qa-runner'
import { WebPlatformAdapter } from '../adapter.js'
import { ORDERS_CSV_BYTES, startOutcomePages } from './fixtures/436-outcome-pages.js'
import type { OutcomePages } from './fixtures/436-outcome-pages.js'
import {
  act,
  memoryCache,
  refFor,
  runScriptedStep,
  scriptedPlanner,
  scriptedVerifier,
} from './fixtures/436-scripted-loop.js'
import type { ScriptedPlanner, ScriptedStepRun, VerifierInput, VerifierVerdict } from './fixtures/436-scripted-loop.js'

const LIMITS: PlannerConfig = { maxActions: 30, maxPlanningTurns: 30, previousStepCount: 0 }
const ORDERS_SHA256 = createHash('sha256').update(ORDERS_CSV_BYTES).digest('hex')
const ORDERS_DOWNLOAD: DownloadEvidence = {
  suggestedFilename: 'orders.csv',
  extension: '.csv',
  size: Buffer.byteLength(ORDERS_CSV_BYTES),
  sha256: ORDERS_SHA256,
  state: 'completed',
}

let pages: OutcomePages | undefined
let adapter: WebPlatformAdapter | undefined

afterEach(async () => {
  await adapter?.cleanup()
  adapter = undefined
  await pages?.close()
  pages = undefined
}, 60_000)

async function open(path: string): Promise<{ web: WebPlatformAdapter; site: OutcomePages }> {
  const site = await startOutcomePages()
  pages = site
  const created = new WebPlatformAdapter()
  try {
    await created.setup({ platform: 'web', browser: { name: 'chromium', headless: true } })
  } catch (error) {
    throw new Error('Real Chromium required: run `pnpm exec playwright install chromium`', { cause: error })
  }
  adapter = created
  await created.getPage()!.goto(site.url(path))
  return { web: created, site }
}

/** No progress-subsystem evidence, and every dispatch was one the planner (or the cache) planned. */
function expectOutcomeOnly(run: ScriptedStepRun, plannedActions: number): void {
  const evidence = run.result.evidence
  expect(evidence, 'the loop recorded step evidence').toBeDefined()
  expect(evidence!.stagnation).toBeUndefined()
  expect(evidence!.cycle).toBeUndefined()
  for (const subAction of evidence!.subActions) expect(subAction.localEffect).toBeUndefined()
  expect(run.executed).toHaveLength(plannedActions)
  expect(evidence!.limitUsage?.actionsUsed).toBe(plannedActions)
}

function liveActions(planner: ScriptedPlanner): number {
  return planner.plannedActions
}

function sameIdentity(result: StepResult, index: number): void {
  const subAction = result.evidence!.subActions[index]
  expect(subAction.stateAfter, 'the verifier re-observation is the stateAfter').toBeDefined()
  expect(screenIdentityHash(subAction.stateAfter!)).toBe(screenIdentityHash(subAction.stateBefore))
}

function downloadsCheck(expected: number) {
  return (input: VerifierInput): VerifierVerdict => {
    const downloads = input.operationEvidence?.downloads ?? []
    const matching = downloads.filter((d) =>
      d.state === 'completed'
      && d.suggestedFilename === 'orders.csv'
      && d.extension === '.csv'
      && d.sha256 === ORDERS_SHA256)
    return matching.length === expected && downloads.length === expected
      ? { pass: true, reason: `orders.csv was downloaded ${String(expected)} time(s) with the served digest` }
      : { pass: false, reason: 'orders.csv was not downloaded' }
  }
}

const EXPORT_STEP = 'Export the orders as CSV'
const exportCsv = (screen: Parameters<typeof refFor>[0]) =>
  act({ type: 'click', ref: refFor(screen, 'button', 'Export CSV') }, true, 'Export the orders as CSV')

describe('C436-OUTCOME-EVIDENCE', () => {
  it('a download on an unchanged page passes on its name, extension and digest', async () => {
    const { web } = await open('/download')
    const planner = scriptedPlanner([exportCsv])
    const verifier = scriptedVerifier(downloadsCheck(1))

    const run = await runScriptedStep({ adapter: web, instruction: EXPORT_STEP, planner, verifier, plannerConfig: LIMITS })

    expect(run.result.status).toBe('passed')
    expect(verifier.calls).toBe(1)
    expect(verifier.inputs[0].operationEvidence?.downloads).toEqual([ORDERS_DOWNLOAD])
    expect(run.result.evidence!.subActions[0].operationEvidence?.downloads).toEqual([ORDERS_DOWNLOAD])
    sameIdentity(run.result, 0)
    expectOutcomeOnly(run, liveActions(planner))
  }, 60_000)

  it('the same download passes from the cache', async () => {
    const { web } = await open('/download')
    const cache = memoryCache()
    const first = await runScriptedStep({
      adapter: web,
      instruction: EXPORT_STEP,
      planner: scriptedPlanner([exportCsv]),
      verifier: scriptedVerifier(downloadsCheck(1)),
      cache,
      plannerConfig: LIMITS,
    })
    expect(first.result.status).toBe('passed')
    expect(cache.sets).toHaveLength(1)

    await web.getPage()!.reload()
    const planner = scriptedPlanner([exportCsv])
    const verifier = scriptedVerifier(downloadsCheck(1))
    const run = await runScriptedStep({ adapter: web, instruction: EXPORT_STEP, planner, verifier, cache, plannerConfig: LIMITS })

    expect(run.result.status).toBe('passed')
    expect(planner.calls).toBe(0)
    expect(cache.gets.at(-1)?.hit).toBe(true)
    expect(run.result.evidence!.limitUsage?.planningCallsUsed).toBe(0)
    expect(run.result.evidence!.subActions[0].operationEvidence?.downloads).toEqual([ORDERS_DOWNLOAD])
    expect(verifier.inputs[0].operationEvidence?.downloads?.[0]?.sha256).toBe(
      first.result.evidence!.subActions[0].operationEvidence?.downloads?.[0]?.sha256,
    )
    sameIdentity(run.result, 0)
    expectOutcomeOnly(run, 1)
  }, 60_000)

  it('the same download passes after a verifier rejection', async () => {
    const { web } = await open('/download')
    const planner = scriptedPlanner([
      (screen) => act({ type: 'click', ref: refFor(screen, 'button', 'Prepare export') }, true, 'Prepare the export'),
      exportCsv,
    ])
    const verifier = scriptedVerifier(downloadsCheck(1))

    const run = await runScriptedStep({ adapter: web, instruction: EXPORT_STEP, planner, verifier, plannerConfig: LIMITS })

    expect(run.result.status).toBe('passed')
    expect(planner.calls).toBe(2)
    expect(verifier.calls).toBe(2)
    expect(verifier.inputs[0].operationEvidence).toBeUndefined()
    expect(verifier.inputs[1].operationEvidence?.downloads).toEqual([ORDERS_DOWNLOAD])
    const [prepare, exported] = run.result.evidence!.subActions
    expect(prepare.operationEvidence).toBeUndefined()
    expect(exported.operationEvidence?.downloads).toEqual([ORDERS_DOWNLOAD])
    sameIdentity(run.result, 0)
    sameIdentity(run.result, 1)
    expectOutcomeOnly(run, liveActions(planner))
  }, 60_000)

  it('downloading the same file twice records two identical digests', async () => {
    const { web } = await open('/download')
    const planner = scriptedPlanner([
      (screen) => act({ type: 'click', ref: refFor(screen, 'button', 'Export CSV') }, false, 'First copy'),
      (screen) => act({ type: 'click', ref: refFor(screen, 'button', 'Export CSV') }, true, 'Second copy'),
    ])
    const verifier = scriptedVerifier(downloadsCheck(2))

    const run = await runScriptedStep({
      adapter: web,
      instruction: 'Export the orders as CSV twice',
      planner,
      verifier,
      plannerConfig: LIMITS,
    })

    expect(run.result.status).toBe('passed')
    expect(verifier.inputs[0].operationEvidence?.downloads).toEqual([ORDERS_DOWNLOAD, ORDERS_DOWNLOAD])
    const digests = run.result.evidence!.subActions.map((s) => s.operationEvidence?.downloads?.[0]?.sha256)
    expect(digests).toEqual([ORDERS_SHA256, ORDERS_SHA256])
    expectOutcomeOnly(run, liveActions(planner))
  }, 60_000)
})
