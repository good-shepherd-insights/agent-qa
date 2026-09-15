import { AsyncLocalStorage } from 'node:async_hooks'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

import { createFunctionRegistry, invokeFunction, RUNS_MARK_FUNCTION_ID, type FunctionDeps, type FunctionRegistry } from '@vostride/agent-qa-agent'
import { asRunId, type RunsMarkInput, type RunsMarkOutcome } from '@vostride/agent-qa-schema'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { mintRunTriggerConfirmScope } from '../../chat/confirm-registry.js'
import type { AgentHost } from '../../chat/host.js'
import { DashboardDatabase } from '../../db/database.js'
import { startServer } from '../../server/server.js'
import { markRun, registerRunMarkRoute } from '../run-mark-routes.js'

const RUN_ID = asRunId('run-mark-route')
const NOTE = 'private note with "quotes"'
const outcome: RunsMarkOutcome = { kind: 'marked', receipt: {
  schemaVersion: 1, markId: 'mark_0123456789ab', runId: RUN_ID, runSlug: 'run-mark-route',
  testIndex: 0, kind: 'false-fail', origin: 'user', ordinal: 1, markedAt: 0,
  note: '<SECRET_0>', disposition: { kind: 'quarantined', class: 'flake' },
  gold: [], evidence: { confirmed: 0, overturned: 0 },
} }
const closers: Array<() => Promise<void>> = []
afterEach(async () => { for (const close of closers.splice(0)) await close() })

function fixture() {
  const scope = mintRunTriggerConfirmScope()
  const frames = new AsyncLocalStorage<string>()
  const mark = vi.fn(async (_input: RunsMarkInput) => outcome)
  const ask = vi.fn(() => true)
  const deps: FunctionDeps = {
    runs: { list: async () => [], get: async () => undefined, readEvents: async () => [], readStepEvidence: async () => ({ kind: 'run-not-recorded' }) },
    knowledge: { listBundles: async () => [], inspectRecords: async () => [], diffSince: async () => [], showRecord: async ({ recordId }) => ({ kind: 'not-found', schemaVersion: 1, recordId }) },
    entities: { resolve: async () => ({ kind: 'none', reason: 'no-match' }), get: async () => undefined },
    config: { getMasked: async () => ({ schemaVersion: 1, configPath: 'agent-qa.config.yaml', entries: [] }) },
    feedback: { mark, marksFor: async () => [] },
  }
  const registry = createFunctionRegistry({ deps, confirm: { surface: 'browser-click', ask },
    resolveExecutionContext: () => frames.getStore() === scope ? 'local-interactive' : 'local-headless',
    auditSink: { appendExecutionAudit() {}, appendGuardrailAudit() {} },
  })
  const enter = <T>(id: string, run: () => T): T => frames.run(id, run)
  const host: AgentHost = {
    agentAskFunctionId: 'test:ask', runsPostProcessingFunctionId: 'test:post',
    runsEventsFunctionId: 'test:events', runsDetailFunctionId: 'test:detail',
    runsEvidenceFunctionId: 'test:evidence',
    runsArtifactFunctionId: 'test:artifact', analysisGetFunctionId: 'test:analysis',
    runsKnowledgeFunctionId: 'test:knowledge',
    runsMarksHistoryFunctionId: 'test:marks-history', runsMarkPreviewFunctionId: 'test:mark-preview',
    foldFunctionResult: () => ({ verdict: { status: 'executed', outcome: 'fixture' }, foldLines: [] }),
    listDeclarations: () => [], onSessionEvent: () => () => undefined,
    registry, runsMarkFunctionId: RUNS_MARK_FUNCTION_ID, enterRunTriggerScope: enter,
    caller: { surface: 'dashboard', grantedScopes: ['knowledge-write'], safeMode: false, origin: 'human' },
    invokeFunction: (handle, id, input, caller) => invokeFunction(handle as FunctionRegistry, id, input, caller),
    unmaskForDisplay: (text: string) => text.replaceAll('<SECRET_0>', NOTE),
  }
  return { host, scope, enter, mark, ask }
}

async function socket(host?: AgentHost) {
  const db = new DashboardDatabase({ dbPath: ':memory:' })
  const started = await startServer({ db, port: 0, ...(host === undefined ? {} : { agentHost: host }) })
  closers.push(async () => { started.close(); await new Promise<void>(resolve => started.server.close(() => resolve())); db.close() })
  return `http://127.0.0.1:${String((started.server.address() as AddressInfo).port)}/api/runs/${RUN_ID}/mark`
}

describe('markRun delegates to the shared gate and feedback port', () => {
  it('classifies cross-realm denials and unexpected errors without echoing their note-bearing messages', async () => {
    const f = fixture()
    const invokeFunction = vi.fn(async () => {
      throw { name: 'FunctionDeniedError', message: NOTE, reason: NOTE, neutralReason: NOTE,
        remedies: [{ kind: 'answer-confirm' }, { kind: 'present-bearer-scope' }] }
    })
    const denied = await markRun({ ...f.host, invokeFunction }, RUN_ID, { kind: 'false-fail', note: NOTE })
    expect(denied).toMatchObject({ status: 403, body: { error: 'mark_denied', remedies: [{ kind: 'answer-confirm' }] } })
    expect(JSON.stringify(denied)).not.toContain(NOTE)
    invokeFunction.mockImplementation(async () => { throw new Error(NOTE) })
    expect(await markRun({ ...f.host, invokeFunction }, RUN_ID, { kind: 'false-fail', note: NOTE })).toEqual({
      kind: 'refused', status: 500, body: { error: 'read_failed', reason: 'Error' },
    })
  })

  it('enters the named frame, asks, and forwards all input fields', async () => {
    const f = fixture()
    const body = { kind: 'false-fail', note: NOTE, correctedExpectation: 'must fail', stepIndex: 2, testId: 'member',
      correctedAction: { type: 'click', ref: 'e-correct' } }
    expect(await markRun(f.host, RUN_ID, body, { confirmScope: f.scope, enter: f.enter })).toEqual({ kind: 'ok', body: outcome })
    expect(f.ask).toHaveBeenCalledOnce()
    expect(f.mark).toHaveBeenCalledExactlyOnceWith({ ...body, runId: RUN_ID })
  })

  it('denies without a frame or with an unwatched scope; only browser remedies survive', async () => {
    const f = fixture()
    for (const frame of [{}, { confirmScope: mintRunTriggerConfirmScope(), enter: f.enter }]) {
      const result = await markRun(f.host, RUN_ID, { kind: 'false-fail', note: NOTE }, frame)
      expect(result).toMatchObject({ kind: 'refused', status: 403, body: { error: 'mark_denied', remedies: [{ kind: 'answer-confirm' }] } })
      expect(JSON.stringify(result)).not.toContain('present-bearer-scope')
      expect(JSON.stringify(result)).not.toContain(NOTE)
    }
    expect(f.mark).not.toHaveBeenCalled()
    expect(f.ask).not.toHaveBeenCalled()
  })

  it.each([null, [], 'text', { kind: 'confirmed-pass' }, { kind: 'false-fail', runId: 'other' }, { kind: 'false-pass', stepIndex: -1 }, { kind: 'false-fail', caller: { origin: 'human' } }])('refuses invalid input before dispatch: %j', async body => {
    const f = fixture()
    expect(await markRun(f.host, RUN_ID, body)).toMatchObject({ status: 400, body: { error: 'invalid_mark_input' } })
    expect(f.mark).not.toHaveBeenCalled()
  })
})

describe('registered POST /api/runs/:id/mark', () => {
  it('keeps a machine-boundary success masked and never calls the display seam', async () => {
    const f = fixture()
    const unmaskForDisplay = vi.fn((text: string) => text)
    const server = createServer((req, res) => registerRunMarkRoute(req, res, {
      host: { ...f.host, unmaskForDisplay }, runId: RUN_ID, enterRunTriggerScope: f.enter,
    }))
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    closers.push(() => new Promise<void>(resolve => server.close(() => resolve())))
    const response = await fetch(`http://127.0.0.1:${String((server.address() as AddressInfo).port)}`, {
      method: 'POST', body: JSON.stringify({ kind: 'false-fail', confirmScope: f.scope }),
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(outcome)
    expect(unmaskForDisplay).not.toHaveBeenCalled()
  })

  it('reaches the real router and restores successful receipt text before JSON serialization', async () => {
    const f = fixture()
    const response = await fetch(await socket(f.host), { method: 'POST', body: JSON.stringify({ kind: 'false-fail', confirmScope: f.scope }) })
    expect(response.status).toBe(200)
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
    expect(await response.json()).toEqual({ ...outcome, receipt: { ...outcome.receipt, note: NOTE } })
    expect(f.ask).toHaveBeenCalledOnce()
  })

  it.each(['chat:abc', null, 7])('rejects invalid confirmScope %j', async confirmScope => {
    const f = fixture()
    const response = await fetch(await socket(f.host), { method: 'POST', body: JSON.stringify({ kind: 'false-fail', note: NOTE, confirmScope }) })
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'confirmScope must be a confirm scope minted by this server' })
    expect(f.mark).not.toHaveBeenCalled()
  })

  it('refuses cross-site writes before parsing or dispatch', async () => {
    const f = fixture()
    const response = await fetch(await socket(f.host), { method: 'POST', headers: { Origin: 'https://evil.example' }, body: NOTE })
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'cross_site_refused' })
    expect(f.mark).not.toHaveBeenCalled()
  })

  it('returns the typed channel-less denial and rejects malformed JSON without reflection', async () => {
    const url = await socket(fixture().host)
    const denied = await fetch(url, { method: 'POST', body: JSON.stringify({ kind: 'false-fail', note: NOTE }) })
    expect(denied.status).toBe(403)
    expect(await denied.json()).toMatchObject({ error: 'mark_denied', remedies: [{ kind: 'answer-confirm' }] })
    const malformed = await fetch(url, { method: 'POST', body: NOTE })
    expect(malformed.status).toBe(400)
    expect(await malformed.json()).toEqual({ error: 'invalid_mark_input' })
  })

  it('reports an absent composed host', async () => {
    const response = await fetch(await socket(), { method: 'POST', body: '{}' })
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'agent_host_unavailable' })
  })
})
