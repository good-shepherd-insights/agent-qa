// THE SPAWNED-BINARY LIVE-VIEW ANCHORS (403-01 Task 5 · LIVE-02 / D-04 / D-14 — WINDOWS #264).
//
// EVERY CLAIM HERE IS ABOUT THE SHIPPED PROCESS. `live-view-tracer.test.ts` proves the frame path
// in-process with a real browser; this file proves the COMPOSITION and the CARRIAGE on the actual
// `agent-qa dashboard` binary, in the ZERO-TOKEN posture — deliberately, because that is the
// default a project gets and it is exactly the arm in which #264 hid: the session registry used to
// be built inside `composeRunServicePorts`, which runs only when a credential is declared, so a
// default dashboard streamed nothing and could mint nothing.
//
// THE LOG-SCAN IS THE STRUCTURAL GUARANTEE (Pitfall 2). The masker is seeded once per run, so a
// token minted mid-run is not masked by that run — which means "the token never lands anywhere
// durable" cannot be an assertion about masking. It has to be a scan of the real channels: the
// child's own stdout and stderr, every byte of every file the project wrote (the SQLite database
// included), the SSE bytes, and the durable run record. With a POSITIVE CONTROL, because a scanner
// that reads nothing reports no leak.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { RunsLiveUrlResultSchema } from '@vostride/agent-qa-schema'
import { chromium } from 'playwright-core'
import type { Browser, Page } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  DASHBOARD_ANCHORED_BUILDS,
  REBUILD_INSTRUCTION as SPAWNED_REBUILD_INSTRUCTION,
  buildFreshness,
  cleanupTempRoots,
  dashboardUiDist,
  reserveEphemeralPort,
  runServiceFixtureProject,
  spawnDashboard,
} from './spawned-chat.js'
import type { SpawnedDashboard } from './spawned-chat.js'
import {
  openIdStream,
  plantLiveRun,
  publishTo,
  startLiveViewHarness,
} from './live-view-fixture.js'
import type { LiveViewHarness, PlantedLiveRun } from './live-view-fixture.js'

/** What `spawnDashboard` returns: the door plus its own readiness statement. */
type ReadySpawnedDashboard = SpawnedDashboard & { readonly ready: boolean }

const REBUILD_INSTRUCTION =
  'these anchors drive the BUILT binary: run `pnpm -r build` from the agent-qa root first.'

/** How long the run has to become attachable before this file gives up and says so. */
const ATTACH_BUDGET_MS = 60_000
/** How long an SSE read or a socket exchange may take. */
const WIRE_BUDGET_MS = 30_000

interface Fixture {
  readonly dashboard: ReadySpawnedDashboard
  readonly root: string
  readonly runId: string
  /** The SSE bytes cell 2 captured, re-scanned by cell 5 after the mint. */
  sseBytes: string
}

let fixture: Fixture | undefined

function held(): Fixture {
  if (fixture === undefined) throw new Error('the live-view anchors fixture never came up')
  return fixture
}

/** Quote the child's own streams in every failure — a spawned cell's message is its diagnosis. */
function childContext(dashboard: SpawnedDashboard): string {
  return `child stdout: ${JSON.stringify(dashboard.stdout().slice(-1200))}; `
    + `child stderr: ${JSON.stringify(dashboard.stderr().slice(-1200))}`
}

/** Every file under `dir`, recursively, as raw bytes. The scan reads BYTES, never a re-encoding. */
function everyFileUnder(dir: string, into: { path: string; bytes: Buffer }[] = []): { path: string; bytes: Buffer }[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return into
  }
  for (const entry of entries) {
    const full = join(dir, entry)
    let info
    try {
      info = statSync(full)
    } catch {
      continue
    }
    if (info.isDirectory()) {
      everyFileUnder(full, into)
      continue
    }
    if (!info.isFile()) continue
    try {
      into.push({ path: full, bytes: readFileSync(full) })
    } catch {
      /* an unreadable file is not a hiding place this scan can be blamed for */
    }
  }
  return into
}

async function readSse(url: string, budgetMs = WIRE_BUDGET_MS): Promise<{ status: number; contentType: string | null; body: string }> {
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, budgetMs)
  try {
    const response = await fetch(url, { signal: controller.signal })
    const contentType = response.headers.get('content-type')
    if (response.body === null || !(contentType ?? '').includes('text/event-stream')) {
      return { status: response.status, contentType, body: await response.text().catch(() => '') }
    }
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let body = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      body += decoder.decode(value, { stream: true })
      if (body.includes('event: runFinished')) break
    }
    await reader.cancel().catch(() => undefined)
    return { status: response.status, contentType, body }
  } finally {
    clearTimeout(timer)
  }
}

/** One socket exchange: send a hello, collect the server's text messages, report the close code. */
async function speakToFrameSocket(input: {
  origin: string
  runId: string
  token: string
  /** Stop once one of these types has arrived (or the socket closes / the budget expires). */
  until: readonly string[]
}): Promise<{ messages: { type?: string; reason?: string; stream?: { kind?: string } }[]; closeCode?: number }> {
  const wsUrl = `${input.origin.replace(/^http/u, 'ws')}/api/live-view/ws?runId=${encodeURIComponent(input.runId)}`
  const socket = new WebSocket(wsUrl)
  const messages: { type?: string; reason?: string; stream?: { kind?: string } }[] = []
  let closeCode: number | undefined
  await new Promise<void>((settle) => {
    const budget = setTimeout(() => { try { socket.close() } catch { /* ignore */ } settle() }, WIRE_BUDGET_MS)
    const finish = (): void => { clearTimeout(budget); settle() }
    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({ type: 'hello', token: input.token }))
    })
    socket.addEventListener('message', (event: MessageEvent) => {
      if (typeof event.data !== 'string') return
      try {
        const parsed = JSON.parse(event.data) as { type?: string }
        messages.push(parsed)
        if (typeof parsed.type === 'string' && input.until.includes(parsed.type)) {
          try { socket.close() } catch { /* ignore */ }
        }
      } catch { /* a non-JSON text frame is not a message this protocol defines */ }
    })
    socket.addEventListener('close', (event: CloseEvent) => { closeCode = event.code; finish() })
    socket.addEventListener('error', () => { finish() })
  })
  return { messages, ...(closeCode === undefined ? {} : { closeCode }) }
}

beforeAll(async () => {
  // FIRST, AND BEFORE ANYTHING IS SPAWNED: a stale build measures the previous commit.
  expect(buildFreshness(DASHBOARD_ANCHORED_BUILDS), REBUILD_INSTRUCTION)
    .toEqual({ missing: [], stale: [] })

  // THE ZERO-TOKEN POSTURE, DELIBERATELY. `declareToken: false` is the default shipped project and
  // the arm WINDOWS #264 lived in — a token-declaring fixture is how it stayed invisible.
  const project = runServiceFixtureProject('live-view', false)
  const port = await reserveEphemeralPort()
  const dashboard = await spawnDashboard(project.root, project.configPath, port)
  expect(
    dashboard.ready,
    `the built \`agent-qa dashboard\` never reported that it was listening. ${childContext(dashboard)}`,
  ).toBe(true)

  const trigger = await fetch(`${dashboard.origin}/api/runs/trigger`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file: 'tests/probe.test.yaml' }),
  })
  const triggerBody = await trigger.text()
  expect(trigger.status, `the trigger route refused: ${triggerBody}. ${childContext(dashboard)}`)
    .toBe(202)
  const runId = (JSON.parse(triggerBody) as { runId?: string }).runId
  expect(typeof runId, `the trigger ack named no run: ${triggerBody}`).toBe('string')

  // The queue starts the run asynchronously, so the session is registered a moment later. Poll the
  // mint route — bounded — rather than sleeping a number somebody guessed.
  const deadline = Date.now() + ATTACH_BUDGET_MS
  let attachable = false
  while (Date.now() < deadline) {
    const probe = await fetch(`${dashboard.origin}/api/runs/${encodeURIComponent(runId as string)}/live-url`)
    if (probe.status === 200) { attachable = true; await probe.text(); break }
    await probe.text().catch(() => undefined)
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  expect(
    attachable,
    `the spawned dashboard never made run ${String(runId)} attachable — the session registry is `
    + `composed only on the token arm if #264 has regressed. ${childContext(dashboard)}`,
  ).toBe(true)

  fixture = { dashboard, root: project.root, runId: runId as string, sseBytes: '' }
}, 180_000)

afterAll(async () => {
  const open = fixture
  fixture = undefined
  if (open !== undefined) await open.dashboard.stop()
  cleanupTempRoots()
})

describe('the shipped zero-token dashboard serves a live view (403 D-14, LIVE-02)', () => {
  it('(2) streams the run — NOT the 503 a dashboard with no session registry answers', async () => {
    const f = held()
    const reading = await readSse(`${f.dashboard.origin}/api/run-stream/${encodeURIComponent(f.runId)}`)
    expect(
      reading.status,
      'a zero-token dashboard used to answer 503 "This server was started without a run service '
      + `to stream from" for a run it was executing (WINDOWS #264). ${childContext(f.dashboard)}`,
    ).toBe(200)
    expect(reading.contentType).toContain('text/event-stream')
    expect(reading.body, 'the bounded reader must observe the run reach its end')
      .toContain('event: runFinished')
    f.sseBytes = reading.body
  }, 60_000)

  it('(3) mints a liveUrl declaring the HONEST none capability for a browserless run', async () => {
    const f = held()
    const response = await fetch(`${f.dashboard.origin}/api/runs/${encodeURIComponent(f.runId)}/live-url`)
    const raw = await response.text()
    expect(response.status, `${raw}. ${childContext(f.dashboard)}`).toBe(200)
    const result = RunsLiveUrlResultSchema.parse(JSON.parse(raw))
    // The minted origin is the SERVER'S OWN (`http://localhost:<port>`, the command's `boundOrigin`),
    // not the address this test happens to dial. Asserting the server's spelling is the point: a
    // liveUrl is a link a person is handed, so what matters is the origin the process believes it
    // is serving on.
    expect(result.liveUrl).toBe(
      `http://localhost:${String(f.dashboard.port)}/live/${f.runId}#${result.liveUrl.split('#')[1] ?? ''}`,
    )
    expect(result.liveUrl.split('#')[1]?.startsWith('v1.')).toBe(true)
    expect(
      result.stream.kind,
      'this run had no browser, so the declaration is `none` — not an error, and not a guess',
    ).toBe('none')
    expect(result.handle).toBe(0)
  }, 60_000)

  it('(4) answers the frame socket by name: ready+ended, bad_signature, scope_mismatch', async () => {
    const f = held()
    const raw = await (await fetch(`${f.dashboard.origin}/api/runs/${encodeURIComponent(f.runId)}/live-url`)).text()
    const token = RunsLiveUrlResultSchema.parse(JSON.parse(raw)).liveUrl.split('#')[1] as string

    const accepted = await speakToFrameSocket({
      origin: f.dashboard.origin, runId: f.runId, token, until: ['ended'],
    })
    const ready = accepted.messages.find((m) => m.type === 'ready')
    expect(ready, `no ready frame arrived. ${childContext(f.dashboard)}`).toBeDefined()
    expect(ready?.stream?.kind).toBe('none')
    expect(
      accepted.messages.some((m) => m.type === 'ended'),
      'the run is over, so the socket says so rather than hanging open silently',
    ).toBe(true)

    const tampered = `${token.slice(0, -4)}${token.endsWith('AAAA') ? 'BBBB' : 'AAAA'}`
    const forged = await speakToFrameSocket({
      origin: f.dashboard.origin, runId: f.runId, token: tampered, until: ['refused'],
    })
    expect(forged.messages.find((m) => m.type === 'refused')?.reason).toBe('bad_signature')
    expect(forged.closeCode, 'a refusal closes with the live-view refusal code').toBe(4400)

    // T-403-03: a VALID token presented on ANOTHER run's socket. The claims name the run they were
    // minted for, so cross-run confusion is refused by name rather than silently attaching.
    const crossed = await speakToFrameSocket({
      origin: f.dashboard.origin, runId: 'r_some_other_run', token, until: ['refused'],
    })
    expect(crossed.messages.find((m) => m.type === 'refused')?.reason).toBe('scope_mismatch')
    expect(crossed.closeCode).toBe(4400)
  }, 90_000)

  it('(5) THE LOG-SCAN: the token is in no log, no file, no database byte and no SSE frame', async () => {
    const f = held()
    const raw = await (await fetch(`${f.dashboard.origin}/api/runs/${encodeURIComponent(f.runId)}/live-url`)).text()
    const result = RunsLiveUrlResultSchema.parse(JSON.parse(raw))
    const token = result.liveUrl.split('#')[1] as string
    const claimsPart = token.split('.')[1] as string
    expect(claimsPart.length, 'the scan needs a substantial needle to be meaningful')
      .toBeGreaterThan(20)

    // THE POSITIVE CONTROL, FIRST. A scanner that reads nothing reports no leak, so before
    // asserting an absence this cell proves it can see a presence: an invalid handle is refused by
    // name, and the refusal WORD is in the very bytes the scan will read below.
    const invalid = await fetch(`${f.dashboard.origin}/api/runs/${encodeURIComponent(f.runId)}/live-url?handle=notanumber`)
    const invalidBody = await invalid.text()
    expect(invalid.status).toBe(400)
    expect(invalidBody, 'the control: this scanner reads response bytes and can find a word in them')
      .toContain('invalid_handle')

    // Give the child a moment to flush anything it was going to write.
    await new Promise((resolve) => setTimeout(resolve, 500))

    const runRecord = await (await fetch(`${f.dashboard.origin}/api/runs/${encodeURIComponent(f.runId)}`)).text()
    const files = everyFileUnder(f.root)
    expect(files.length, 'the file scan found nothing to read — it would report no leak either way')
      .toBeGreaterThan(0)

    const textChannels: [string, string][] = [
      ['the child stdout', f.dashboard.stdout()],
      ['the child stderr', f.dashboard.stderr()],
      ['the captured SSE frames', f.sseBytes],
      ['the durable run record', runRecord],
      ['the invalid-handle refusal body', invalidBody],
    ]
    for (const [name, channel] of textChannels) {
      expect(channel, `${name} carries the whole liveUrl token`).not.toContain(token)
      expect(channel, `${name} carries the token's claims body`).not.toContain(claimsPart)
    }
    for (const file of files) {
      const bytes = file.bytes.toString('latin1')
      expect(bytes, `${file.path} carries the whole liveUrl token`).not.toContain(token)
      expect(bytes, `${file.path} carries the token's claims body`).not.toContain(claimsPart)
    }
  }, 120_000)

  it('(6) serves the embed document itself, with a nonce CSP and no token in the body', async () => {
    const f = held()
    const response = await fetch(`${f.dashboard.origin}/live/${encodeURIComponent(f.runId)}`)
    const body = await response.text()
    expect(response.status, `${body}. ${childContext(f.dashboard)}`).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/html')
    expect(response.headers.get('content-security-policy')).toContain('nonce-')
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    // A `<script src=` pointing anywhere would be a second origin this document depends on, which
    // the CSP forbids and which an embedding host has no way to audit.
    expect(body, 'the embed page is self-contained').not.toContain('<script src=')
    expect(body, 'the fragment never reaches the server, so a served document cannot carry it')
      .not.toContain('v1.')
    // And it is the LIVE VIEW, not the SPA fallback wearing its URL (Pitfall 10).
    expect(body).toContain('data-embed-state')
  }, 60_000)
})

// ---- INVK-05 ON REAL SOCKETS, AND THE SHIPPED BINARY'S OWN LIVE PAGE (403-06 Task 2) ----------
//
// WHAT THE CELLS ABOVE DO NOT MEASURE. They drive ONE reader at a time, and every claim INVK-05
// makes is about MORE THAN ONE: several surfaces attached at once, one of them walking away
// mid-run, one of them coming back with a resume point, and a run that carries on regardless. A
// single-reader fixture is structurally blind to all four — 388 paid for that lesson by name
// ("single-run fixtures cannot see a cross-instance attribution defect, and ~35 differentials
// didn't"), and the same shape applies to a single-VIEWER fixture here.
//
// THE FRAME IS THE PRODUCTION ONE. `startLiveViewHarness` composes the shipped `startServer` with
// the shipped door, the shipped registry, the shipped mint and the built UI — see
// `live-view-fixture.ts`. A bare router mounted in this file would answer every request below
// identically while proving nothing about the process a person runs.
//
// THE `cancel` SPY IS THE WHOLE OF T-403-07. Attach is not ownership: no count of viewers
// arriving, leaving or dying may reach the run. The only way to measure "nobody called it" is to
// hold the function that would have been called, which is why the session is planted.

/**
 * The words `data-terminal-state` can carry for a run that ENDED.
 *
 * SPELLED HERE RATHER THAN IMPORTED, because the attribute carries dashboard-ui's own
 * `normalizeRunStatus` output — a strictly wider vocabulary than the schema's `RunStatus`, living
 * in a `.ts` behind that package's `@/` aliases. What matters to this cell is that the page named
 * a word from a CLOSED set rather than whatever the run happened to produce, so the set is stated
 * and a word outside it is a red.
 */
const TERMINAL_RUN_WORDS = [
  'passed', 'failed', 'timeout', 'cancelled', 'flaky', 'healed', 'skipped',
] as const

describe('INVK-05 on real sockets: two surfaces, a mid-run resume, and a detach that owns nothing', () => {
  let harness: LiveViewHarness | undefined
  let browser: Browser | undefined
  const runs: PlantedLiveRun[] = []

  function harnessHeld(): LiveViewHarness {
    if (harness === undefined) throw new Error('the in-process live-view harness never came up')
    return harness
  }

  /** A planted run registered with the harness, remembered so `afterAll` can close its bus. */
  function plant(runId: string): PlantedLiveRun {
    const run = plantLiveRun({ runId, heartbeatMs: 60_000, capability: { kind: 'none' } })
    runs.push(run)
    harnessHeld().plant(run)
    return run
  }

  beforeAll(async () => {
    // The same freshness refusal the file's own `beforeAll` makes, restated here because this
    // describe serves the BUILT bundle through `uiDir` and a stale one would certify last week.
    expect(buildFreshness(DASHBOARD_ANCHORED_BUILDS), SPAWNED_REBUILD_INSTRUCTION)
      .toEqual({ missing: [], stale: [] })
    harness = await startLiveViewHarness({ label: 'invk05', uiDir: dashboardUiDist() })
    try {
      browser = await chromium.launch({ headless: true })
    } catch (error) {
      throw new Error(
        'these cells drive the BUILT dashboard UI in a real Chromium: run '
        + '`pnpm exec playwright install chromium` and re-run. THEY MUST NOT BE SKIPPED WHEN THE '
        + `BROWSER IS ABSENT. underlying error: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }, 180_000)

  afterAll(async () => {
    await browser?.close()
    browser = undefined
    await harness?.close()
    harness = undefined
    for (const run of runs) run.close()
    runs.length = 0
  })

  it('(7) two readers and a mid-run resume observe one seq set — no duplicate, no gap', async () => {
    const run = plant('r_two')
    const url = `${harnessHeld().origin}/api/run-stream/r_two`

    const a = openIdStream(url)
    publishTo(run, 'runStarted', { busSchemaVersion: 1, memberTestCount: 1, handles: [0] })
    publishTo(run, 'testStarted', { testId: 't0', testIndex: 0, name: 'the two-surface member', totalSteps: 3 })
    await a.waitForIdCount(2)

    // B ATTACHES WHILE A IS ALREADY WATCHING. Both are served by the same session; neither is
    // told about the other, and neither may cost the other an envelope.
    const b = openIdStream(url)
    await b.waitForIdCount(2)

    for (let i = 0; i < 30; i += 1) {
      if (i % 3 === 0) publishTo(run, 'stepStarted', { testIndex: 0, stepIndex: i % 3, stepText: `step ${String(i)}` })
      else if (i % 3 === 1) publishTo(run, 'subActionRecorded', { testIndex: 0, stepIndex: i % 3, subActionIndex: i })
      else publishTo(run, 'heartbeat', {})
      if (i === 8) await b.waitForIdCount(8)
    }
    await b.waitForIdCount(8)

    // B WALKS AWAY MID-RUN. A real socket abort, not an unsubscribe call: what a person closing a
    // tab does to this door.
    const seenByB = b.ids()
    const lastSeenByB = Math.max(...seenByB)
    b.abort()
    await b.finished

    for (let i = 0; i < 10; i += 1) publishTo(run, 'heartbeat', {})

    // AND COMES BACK WITH A RESUME POINT. `Last-Event-ID` names the last envelope B ALREADY saw,
    // so the door opens the replay at the next one — `subscribe(N + 1)`, never `subscribe(N)`,
    // which would re-deliver an envelope B has already rendered.
    const b2 = openIdStream(url, { lastEventId: lastSeenByB })
    await b2.waitForIdCount(1)

    for (let i = 0; i < 10; i += 1) publishTo(run, 'stepStarted', { testIndex: 0, stepIndex: i % 3, stepText: `late ${String(i)}` })
    publishTo(run, 'stepFinalized', { testIndex: 0, stepIndex: 0, status: 'passed', durationMs: 5 })
    publishTo(run, 'verdict', { verdict: 'passed' })
    const finalSeq = publishTo(run, 'runFinished', { aggregateVerdict: 'passed', disposition: 'detached', finalSeq: run.bus.currentSeq + 1 }).seq

    await a.waitForEvent('runFinished')
    await b2.waitForEvent('runFinished')
    await a.finished
    await b2.finished

    const everySeq = Array.from({ length: finalSeq }, (_, index) => index + 1)
    expect(a.ids(), 'the firehose reader saw the run\'s whole seq set').toEqual(everySeq)

    const bUnion = [...seenByB, ...b2.ids()]
    expect([...bUnion].sort((x, y) => x - y), 'the resumed reader\'s union IS the whole seq set')
      .toEqual(everySeq)
    expect(new Set(bUnion).size, `no envelope was delivered twice: ${JSON.stringify(bUnion)}`)
      .toBe(bUnion.length)
    expect(b2.ids()[0], 'the resume opens at lastSeen + 1 — one id later, never the same one again')
      .toBe(lastSeenByB + 1)
    expect(Math.min(...b2.ids()), 'and nothing at or below the resume point is re-sent')
      .toBeGreaterThan(lastSeenByB)

    expect(a.endedByServer(), 'the door closed A on its own terms at runFinished').toBe(true)
    expect(b2.endedByServer(), 'and closed the resumed reader the same way').toBe(true)
    expect(run.cancelCalls(), 'T-403-07: no reader, arriving or leaving, ever ended the run').toBe(0)

    // AND THE PRECEDENCE, ON THE SAME RETAINED RUN. A client can name a resume point twice — the
    // `Last-Event-ID` header a browser sends for free, and the `?lastEventId=` a page composes on
    // its first attach — and the two can DISAGREE. The door resolves that with one rule (the
    // header wins) and this is where it is measured on a socket rather than in a unit: a query
    // that won here would replay from near the beginning and hand this viewer fifty envelopes it
    // had already rendered.
    const contested = openIdStream(`${url}?lastEventId=1`, { lastEventId: finalSeq - 3 })
    await contested.waitForEvent('runFinished')
    await contested.finished
    expect(contested.ids()[0], 'the Last-Event-ID header wins over the ?lastEventId= query')
      .toBe(finalSeq - 2)
    expect(contested.ids(), 'so the query\'s own resume point is NOT what was served')
      .not.toContain(2)

    // LOGGED, so the plan's SUMMARY quotes measured numbers rather than the ones this cell hoped
    // for. Run with `--reporter=verbose` to read them off a green run.
    console.log(`(7) B last-seen id ${String(lastSeenByB)}, first resumed id ${String(b2.ids()[0] ?? -1)}, final seq ${String(finalSeq)}, contested-resume first id ${String(contested.ids()[0] ?? -1)}`)
  }, 120_000)

  it('(8) D-16: a detach owns nothing — the run keeps going and a later viewer sees all of it', async () => {
    const run = plant('r_three')
    const url = `${harnessHeld().origin}/api/run-stream/r_three`

    const early = openIdStream(url)
    publishTo(run, 'runStarted', { busSchemaVersion: 1, memberTestCount: 1, handles: [0] })
    publishTo(run, 'testStarted', { testId: 't0', testIndex: 0, name: 'the abandoned member', totalSteps: 2 })
    publishTo(run, 'stepStarted', { testIndex: 0, stepIndex: 0, stepText: 'a step nobody is watching' })
    await early.waitForIdCount(3)
    early.abort()
    await early.finished

    // THE RUN CARRIES ON, and the only proof of that is envelopes published after the last viewer
    // left, delivered to somebody who was not there when they happened.
    const afterDetach: number[] = []
    for (let i = 0; i < 5; i += 1) {
      afterDetach.push(publishTo(run, 'subActionRecorded', { testIndex: 0, stepIndex: 0, subActionIndex: i }).seq)
    }
    expect(run.cancelCalls(), 'the last detach did not cancel the run').toBe(0)
    expect(run.isDone(), 'and it did not settle it either — a detach is not a verdict').toBe(false)

    const late = openIdStream(url)
    await late.waitForIdCount(3 + afterDetach.length)
    for (const seq of afterDetach) {
      expect(late.ids(), `seq ${String(seq)} was published after every viewer left and is still served`)
        .toContain(seq)
    }

    publishTo(run, 'verdict', { verdict: 'passed' })
    publishTo(run, 'runFinished', { aggregateVerdict: 'passed', disposition: 'detached', finalSeq: run.bus.currentSeq + 1 })
    await late.waitForEvent('runFinished')
    await late.finished

    expect(late.endedByServer()).toBe(true)
    expect(run.cancelCalls(), 'and nothing in this cell ever reached the run').toBe(0)
    expect(run.isDone(), 'the session settles when the RUN says so, never when a socket does').toBe(false)
    run.finish('passed')
  }, 120_000)

  it('(9) HNST-01 concurrency: two surfaces attached at once render the same row states', async () => {
    const run = plant('r_pair')
    const held = browser
    if (held === undefined) throw new Error('no browser')
    const pageA = await held.newPage()
    const pageB = await held.newPage()
    try {
      publishTo(run, 'runStarted', { busSchemaVersion: 1, memberTestCount: 1, handles: [0] })
      publishTo(run, 'testStarted', { testId: 't0', testIndex: 0, name: 'the shared member', totalSteps: 3 })

      // BOTH ATTACHED BEFORE THE INTERESTING ENVELOPES, so this is a concurrency claim and not two
      // replays of a finished run taken one after the other.
      const url = `${harnessHeld().origin}/runs/r_pair/live`
      await Promise.all([pageA.goto(url), pageB.goto(url)])
      await Promise.all([
        pageA.locator('[data-step-status]').first().waitFor({ state: 'attached', timeout: 30_000 }),
        pageB.locator('[data-step-status]').first().waitFor({ state: 'attached', timeout: 30_000 }),
      ])

      publishTo(run, 'stepStarted', { testIndex: 0, stepIndex: 0, stepText: 'the first step' })
      publishTo(run, 'stepFinalized', { testIndex: 0, stepIndex: 0, status: 'passed', durationMs: 10 })
      publishTo(run, 'stepStarted', { testIndex: 0, stepIndex: 1, stepText: 'the running step' })
      publishTo(run, 'subActionRecorded', { testIndex: 0, stepIndex: 1, subActionIndex: 0 })

      const expected = ['passed', 'running', 'pending']
      const statusesOf = async (page: Page): Promise<string[]> =>
        page.locator('[data-step-status]').evaluateAll(
          (nodes) => nodes.map((node) => node.getAttribute('data-step-status') ?? ''),
        )
      for (const page of [pageA, pageB]) {
        const deadline = Date.now() + 30_000
        for (;;) {
          const seen = await statusesOf(page)
          if (JSON.stringify(seen) === JSON.stringify(expected)) break
          if (Date.now() > deadline) {
            throw new Error(`a surface never reached ${JSON.stringify(expected)}; it shows ${JSON.stringify(seen)}`)
          }
          await page.waitForTimeout(100)
        }
      }
      const [seenA, seenB] = await Promise.all([statusesOf(pageA), statusesOf(pageB)])
      expect(seenA, 'the row states the reducer implies from this seq set').toEqual(expected)
      expect(seenB, 'and the SECOND surface reads the same run identically').toEqual(seenA)
      expect(run.cancelCalls(), 'two viewers are still not an owner').toBe(0)
    } finally {
      await pageA.close()
      await pageB.close()
    }
  }, 150_000)

  it('(10) THE SHIPPED BINARY: a real run\'s live page reaches its honest terminal state', async () => {
    const f = held()
    const heldBrowser = browser
    if (heldBrowser === undefined) throw new Error('no browser')
    const page = await heldBrowser.newPage()
    const attaches: string[] = []
    page.on('request', (request) => {
      if (request.url().includes('/api/run-stream/')) attaches.push(request.url())
    })
    try {
      // THE WHOLE PRODUCTION CHAIN, and nothing planted anywhere in it: the built `agent-qa
      // dashboard` binary, its own queue, its own run, its own bus, its own `uiDir`, driven by a
      // real browser. The run fails fast (its target has no browser), which is the point — the
      // claim is about the honest END of a real run, not about a passing one.
      await page.goto(`${f.dashboard.origin}/runs/${encodeURIComponent(f.runId)}/live`)

      const terminal = page.locator('[data-terminal-state]')
      await terminal.waitFor({ state: 'attached', timeout: 60_000 })
      const verdictWord = await terminal.getAttribute('data-terminal-state')
      expect(
        TERMINAL_RUN_WORDS as readonly string[],
        `the page named a verdict this build has no terminal word for: ${String(verdictWord)}. `
        + childContext(f.dashboard),
      ).toContain(verdictWord)

      // THE PREVIEW IS HONEST EITHER WAY, and which one it is is recorded rather than asserted
      // into: a run with no browser declares `none`, and a run that has ENDED has nothing left to
      // embed. Both are true sentences about this run; a cell that demanded one of them would be
      // asserting about the fixture's timing.
      const previewState = await page.locator('[data-preview-state]').getAttribute('data-preview-state')
      expect(['ended', 'no-stream'], `the preview declared ${String(previewState)}`).toContain(previewState)

      expect(await page.locator('[data-live-pane]').count(), 'two panes on the shipped binary too').toBe(2)

      // HNST-01 ON THE SHIPPED CHAIN. `plannedAction` is a FIELD NAME the bus really carries, so
      // its absence from the served document is a claim about this page and not about a payload
      // shape nothing produces.
      const html = await page.evaluate(() => document.documentElement.outerHTML)
      expect(html.length, 'the positive control — a document was actually read').toBeGreaterThan(500)
      expect(html, 'no provisional payload field is reachable on the shipped surface')
        .not.toContain('plannedAction')

      // The member either says `did not run` or shows rows in final statuses. Both are honest; a
      // pending row under a finished run is the one thing neither of them is.
      const note = await page.locator('[data-member-note]').count()
      const statuses = await page.locator('[data-step-status]').evaluateAll(
        (nodes) => nodes.map((node) => node.getAttribute('data-step-status') ?? ''),
      )
      expect(
        note > 0 || (statuses.length > 0 && !statuses.includes('pending') && !statuses.includes('running')),
        `the member neither said it did not run nor settled its rows: ${JSON.stringify(statuses)}`,
      ).toBe(true)

      // NO RECONNECT LOOP against a retained run the door has finished with.
      const settled = attaches.length
      await page.waitForTimeout(5_000)
      expect(attaches.length, `attaches: ${JSON.stringify(attaches)}`).toBe(settled)

      console.log(`(10) shipped binary: terminal ${String(verdictWord)}, preview ${String(previewState)}, member-note ${String(note)}, statuses ${JSON.stringify(statuses)}`)
    } finally {
      await page.close()
    }
  }, 180_000)
})
