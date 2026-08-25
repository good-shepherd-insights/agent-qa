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
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  DASHBOARD_ANCHORED_BUILDS,
  buildFreshness,
  cleanupTempRoots,
  reserveEphemeralPort,
  runServiceFixtureProject,
  spawnDashboard,
} from './spawned-chat.js'
import type { SpawnedDashboard } from './spawned-chat.js'

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
