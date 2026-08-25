// THE FRAME PROXY'S STATE MACHINE (403-02 Task 2 · D-02/D-04/D-06/D-16 · T-403-03/04/06/07/11).
//
// EVERY SOCKET-LEVEL CELL DRIVES THE PRODUCTION FRAME. `startServer({ db, port: 0,
// runServiceAttach, liveView })` is what a person's `agent-qa dashboard` runs; the upgrade arm, the
// `?runId=` read, the `createFrameProxy` construction and the embed route are all in `server.ts`,
// not in the proxy module. A suite that called `createFrameProxy` directly would prove the proxy
// works and leave the wiring unmeasured — WINDOWS' "green that never ran". The ONE exception is the
// slow-viewer cell, which needs a socket whose `bufferedAmount` it controls; it says so at the site.
//
// THE VALIDATOR IS THE REAL ONE. `validateLiveUrlToken` from `@vostride/agent-qa-agent`, bound to a
// signer this file constructs — so `bad_signature`, `expired` and `scope_mismatch` are the function
// layer's own verdicts travelling through the proxy, not names this file invented. `agent` is a
// devDependency of this package for exactly this fixture; the package SOURCE still imports nothing
// from it (validate:arch drops `__tests__` from its scan, and the run-service routes' no-agent rule
// is about the shipped bundle).
//
// WHAT IS PLANTED: the `RunSession`. That is the designed injection seam — `runServiceAttach` is a
// first-class `startServer` option — and it is the only way to script a frame source deterministically.

import { createHmac, timingSafeEqual } from 'node:crypto'
import type { AddressInfo } from 'node:net'

import {
  LIVE_URL_SCOPE,
  type LiveFrame,
  type LiveFrameSubscription,
  type LiveStreamDeclaration,
  type LiveUrlClaims,
  type LiveUrlSigner,
  type RunCompletion,
  type RunSession,
} from '@vostride/agent-qa-schema'
import { mintLiveUrlToken, validateLiveUrlToken } from '@vostride/agent-qa-agent'
import WebSocket from 'ws'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DashboardDatabase } from '../db/database.js'
import { LIVE_EMBED_EXPIRED_MESSAGE, LIVE_EMBED_STATES } from '../live-view/embed-page.js'
import { createFrameProxy } from '../live-view/frame-proxy.js'
import {
  LIVE_VIEW_HELLO_MAX_BYTES,
  LIVE_VIEW_REFUSAL_CLOSE_CODE,
  LIVE_VIEW_SLOW_VIEWER_BYTES,
  LIVE_VIEW_WS_PATH,
} from '../live-view/protocol.js'
import { startServer } from '../server/server.js'

// ---- The signer, and the tokens a viewer presents ----------------------------------------------

const SIGNING_KEY = 'zz-403-02-frame-proxy-signing-key'

/** The `cli/src/composition/live-url-signer.ts` shape, constructed here so no key is ever shared. */
const signer: LiveUrlSigner = {
  sign: (data) => createHmac('sha256', SIGNING_KEY).update(data).digest('base64url'),
  equals: (a, b) => {
    const left = Buffer.from(a)
    const right = Buffer.from(b)
    return left.length === right.length && timingSafeEqual(left, right)
  },
}

function tokenFor(input: Partial<LiveUrlClaims> & { runId: string }): string {
  const now = Date.now()
  return mintLiveUrlToken(signer, {
    runId: input.runId,
    handle: input.handle ?? 0,
    scope: input.scope ?? LIVE_URL_SCOPE,
    iat: input.iat ?? now,
    exp: input.exp ?? now + 60_000,
  } as LiveUrlClaims)
}

// ---- The planted run session -------------------------------------------------------------------

interface PlantedSession {
  readonly session: RunSession
  /** Push one frame to every attached frame subscriber. */
  emit(frame: LiveFrame): void
  /** Resolve `session.done`, which is what makes the proxy say `ended`. */
  finish(): void
  /**
   * The hub's `register(handle, undefined)` shape, exercised through the seam: the handle's stream
   * ends, its subscriber set is cleared, and every subscriber's `onEnd` is called. The RUN is
   * untouched — `done` is still pending, which is the whole point of CR-03.
   */
  endStream(): void
  readonly acked: number[]
  readonly unsubscribes: number
  readonly cancels: number
  readonly subscribeCalls: number
}

function plantSession(input: {
  runId: string
  stream?: LiveStreamDeclaration
}): PlantedSession {
  const sinks = new Set<(frame: LiveFrame) => void>()
  const ends = new Set<() => void>()
  const acked: number[] = []
  let unsubscribes = 0
  let cancels = 0
  let subscribeCalls = 0
  let finish: () => void = () => {}
  const done = new Promise<RunCompletion>((resolve) => {
    finish = () => { resolve({ verdict: 'passed' } as unknown as RunCompletion) }
  })
  const stream = input.stream ?? { kind: 'cdp-screencast' }
  const session = {
    id: input.runId,
    status: 'running',
    executionContext: 'local-headless',
    subscribe: () => () => undefined,
    subscribeFrames: (
      _handle: number,
      onFrame: (frame: LiveFrame) => void,
      onEnd?: () => void,
    ): LiveFrameSubscription | undefined => {
      subscribeCalls += 1
      sinks.add(onFrame)
      if (onEnd !== undefined) ends.add(onEnd)
      return {
        ack: (frameId: number) => { acked.push(frameId) },
        unsubscribe: () => {
          unsubscribes += 1
          sinks.delete(onFrame)
          if (onEnd !== undefined) ends.delete(onEnd)
        },
      }
    },
    streamCapabilityOf: (): LiveStreamDeclaration => stream,
    cancel: () => { cancels += 1 },
    done,
  } as unknown as RunSession
  return {
    session,
    emit: (frame) => { for (const sink of [...sinks]) sink(frame) },
    finish: () => { finish() },
    endStream: () => {
      const leaving = [...ends]
      ends.clear()
      sinks.clear()
      for (const onEnd of leaving) onEnd()
    },
    get acked() { return acked },
    get unsubscribes() { return unsubscribes },
    get cancels() { return cancels },
    get subscribeCalls() { return subscribeCalls },
  }
}

// ---- The production frame ----------------------------------------------------------------------

interface Frame {
  readonly origin: string
  readonly wsOrigin: string
  readonly attach: ReturnType<typeof vi.fn>
  close(): void
}

const openFrames: Frame[] = []
const openSockets: WebSocket[] = []

async function productionFrame(sessions: Record<string, RunSession>): Promise<Frame> {
  const db = new DashboardDatabase({ dbPath: ':memory:' })
  const attach = vi.fn((runId: string): RunSession | undefined => sessions[runId])
  const started = await startServer({
    db,
    port: 0,
    runServiceAttach: attach,
    liveView: {
      // BY REFERENCE. A `validate` this file re-implemented would be a second opinion about what a
      // valid token is, which is the exact drift the one-pair rule exists to prevent.
      validate: (token, expectation) => validateLiveUrlToken(signer, token, expectation),
      mintLiveUrl: async () => { throw new Error('this fixture does not mint') },
    },
  })
  const port = (started.server.address() as AddressInfo).port
  const frame: Frame = {
    origin: `http://127.0.0.1:${String(port)}`,
    wsOrigin: `ws://127.0.0.1:${String(port)}`,
    attach,
    close: () => { started.close(); db.close() },
  }
  openFrames.push(frame)
  return frame
}

afterEach(() => {
  while (openSockets.length > 0) {
    const socket = openSockets.pop()
    try { socket?.close() } catch { /* already gone */ }
  }
  while (openFrames.length > 0) openFrames.pop()?.close()
})

// ---- Speaking the protocol ---------------------------------------------------------------------

interface ServerText {
  readonly type?: string
  readonly reason?: string
  readonly stream?: { kind?: string }
  readonly runId?: string
  readonly handle?: number
  readonly expiresAt?: number
  readonly id?: number
  readonly width?: number
  readonly height?: number
}

interface Viewer {
  readonly texts: ServerText[]
  readonly binaries: Buffer[]
  /** Every message in arrival order, so a `frame` header's binary partner is provably adjacent. */
  readonly order: string[]
  send(value: unknown): void
  sendRaw(data: string | Buffer, options?: { binary?: boolean }): void
  /** Resolve once a text message of one of these types has arrived. */
  waitFor(types: readonly string[], budgetMs?: number): Promise<ServerText>
  waitForBinaries(count: number, budgetMs?: number): Promise<void>
  waitForClose(budgetMs?: number): Promise<number | undefined>
  close(): void
  readonly closeCode: number | undefined
}

async function openViewer(frame: Frame, query: string): Promise<Viewer> {
  const socket = new WebSocket(`${frame.wsOrigin}${LIVE_VIEW_WS_PATH}${query}`)
  openSockets.push(socket)
  const texts: ServerText[] = []
  const binaries: Buffer[] = []
  const order: string[] = []
  let closeCode: number | undefined
  let closed = false
  const listeners = new Set<() => void>()
  const wake = (): void => { for (const listener of [...listeners]) listener() }

  socket.on('message', (data: Buffer, isBinary: boolean) => {
    if (isBinary) { binaries.push(Buffer.from(data)); order.push('binary') }
    else {
      try { texts.push(JSON.parse(data.toString('utf8')) as ServerText) } catch { texts.push({}) }
      order.push(`text:${texts[texts.length - 1]?.type ?? '?'}`)
    }
    wake()
  })
  socket.on('close', (code: number) => { closeCode = code; closed = true; wake() })
  socket.on('error', () => { closed = true; wake() })

  await new Promise<void>((resolve, reject) => {
    socket.once('open', () => { resolve() })
    socket.once('error', (error: Error) => { reject(error) })
    socket.once('close', () => { resolve() })
  })

  const until = (predicate: () => boolean, budgetMs: number, what: string): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      const check = (): void => {
        if (predicate()) { cleanup(); resolve(); return }
        if (closed) { cleanup(); resolve(); return }
      }
      const budget = setTimeout(() => {
        cleanup()
        reject(new Error(`${what}: nothing arrived within ${String(budgetMs)} ms. seen=${order.join('|')}`))
      }, budgetMs)
      const cleanup = (): void => { clearTimeout(budget); listeners.delete(check) }
      listeners.add(check)
      check()
    })

  return {
    texts,
    binaries,
    order,
    send: (value) => { socket.send(JSON.stringify(value)) },
    sendRaw: (data, options) => { socket.send(data, { binary: options?.binary ?? false }) },
    waitFor: async (types, budgetMs = 5_000) => {
      await until(() => texts.some((text) => types.includes(text.type ?? '')), budgetMs, `waiting for ${types.join('/')}`)
      const found = texts.find((text) => types.includes(text.type ?? ''))
      expect(found, `no ${types.join('/')} arrived. seen=${order.join('|')} closeCode=${String(closeCode)}`)
        .toBeDefined()
      return found as ServerText
    },
    waitForBinaries: (count, budgetMs = 5_000) =>
      until(() => binaries.length >= count, budgetMs, `waiting for ${String(count)} binary message(s)`),
    waitForClose: async (budgetMs = 5_000) => {
      await until(() => closed, budgetMs, 'waiting for close')
      return closeCode
    },
    close: () => { socket.close() },
    get closeCode() { return closeCode },
  }
}

const jpeg = (id: number): LiveFrame => ({
  id,
  bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, id, 0x00, 0xff, 0xd9]),
  metadata: { width: 640, height: 360 },
})

// ---- The cells ---------------------------------------------------------------------------------

describe('the frame proxy through the production startServer frame (403 D-06/D-16)', () => {
  it('(1) hello → ready → frame header + binary JPEG → ack reaches the run session', async () => {
    const planted = plantSession({ runId: 'r1' })
    const frame = await productionFrame({ r1: planted.session })
    const viewer = await openViewer(frame, '?runId=r1')
    viewer.send({ type: 'hello', token: tokenFor({ runId: 'r1', handle: 3 }) })

    const ready = await viewer.waitFor(['ready'])
    expect(ready.type).toBe('ready')
    expect(ready.runId).toBe('r1')
    expect(ready.handle, 'the handle comes from the CLAIMS, not from the query').toBe(3)
    expect(ready.stream?.kind).toBe('cdp-screencast')
    expect(typeof ready.expiresAt).toBe('number')

    planted.emit(jpeg(11))
    await viewer.waitForBinaries(1)
    const header = viewer.texts.find((text) => text.type === 'frame')
    expect(header, 'a frame is a TEXT header followed by ONE binary message').toBeDefined()
    expect(header?.id).toBe(11)
    expect(header?.width).toBe(640)
    expect(header?.height).toBe(360)
    expect([...(viewer.binaries[0] as Buffer)], 'the viewer receives the producer\'s own bytes')
      .toEqual([...jpeg(11).bytes])
    expect(viewer.order.slice(-2), 'the binary follows its header immediately')
      .toEqual(['text:frame', 'binary'])

    viewer.send({ type: 'ack', id: 11 })
    await vi.waitFor(() => { expect(planted.acked).toEqual([11]) })
  })

  it('(2) refuses a BINARY first message as malformed, before attach, with close 4400', async () => {
    const planted = plantSession({ runId: 'r1' })
    const frame = await productionFrame({ r1: planted.session })
    const viewer = await openViewer(frame, '?runId=r1')
    viewer.sendRaw(Buffer.from([0x01, 0x02, 0x03]), { binary: true })
    const refused = await viewer.waitFor(['refused'])
    expect(refused.reason).toBe('malformed')
    expect(await viewer.waitForClose()).toBe(LIVE_VIEW_REFUSAL_CLOSE_CODE)
    expect(frame.attach, 'a refused handshake must never reach the run registry').not.toHaveBeenCalled()
  })

  it('(3) refuses an OVERSIZED first message as malformed, measured in BYTES', async () => {
    // The cap is a BYTE cap. A JS string's `.length` counts UTF-16 code units, so a hello padded
    // with multi-byte characters is under the character cap and over the byte cap — which is the
    // direction that matters, because the byte count is what the socket actually buffers (T-403-11).
    const planted = plantSession({ runId: 'r1' })
    const frame = await productionFrame({ r1: planted.session })

    const plainViewer = await openViewer(frame, '?runId=r1')
    plainViewer.sendRaw(JSON.stringify({ type: 'hello', token: 'x'.repeat(5_000) }))
    expect((await plainViewer.waitFor(['refused'])).reason).toBe('malformed')
    expect(await plainViewer.waitForClose()).toBe(LIVE_VIEW_REFUSAL_CLOSE_CODE)

    // Under the CHARACTER cap, over the BYTE cap — AND CARRYING A VALID TOKEN. The valid token is
    // what makes this cell discriminate: a padded hello with a GARBAGE token is refused
    // `malformed` by the validator anyway, so it would be green under either cap and prove
    // nothing. With a real token, a character-length cap lets this message through to `ready`
    // while a byte cap refuses it — which is exactly the difference under test.
    const pad = '€'.repeat(1_400)
    const body = JSON.stringify({ type: 'hello', token: tokenFor({ runId: 'r1' }), pad })
    expect(body.length, 'the fixture must be under the character cap for this cell to discriminate')
      .toBeLessThan(LIVE_VIEW_HELLO_MAX_BYTES)
    expect(Buffer.byteLength(body), 'and over the byte cap').toBeGreaterThan(LIVE_VIEW_HELLO_MAX_BYTES)
    const wideViewer = await openViewer(frame, '?runId=r1')
    wideViewer.sendRaw(body)
    const wideAnswer = await wideViewer.waitFor(['refused', 'ready'])
    expect(
      wideAnswer.type,
      'a hello over the BYTE cap must be refused even though it is under the character cap — the '
      + 'byte count is what the socket actually buffers, so a character cap is not the cap',
    ).toBe('refused')
    expect(wideAnswer.reason).toBe('malformed')
    expect(await wideViewer.waitForClose()).toBe(LIVE_VIEW_REFUSAL_CLOSE_CODE)
    expect(frame.attach).not.toHaveBeenCalled()
  })

  it('(4) refuses non-JSON and a non-hello first message as malformed, before attach', async () => {
    const planted = plantSession({ runId: 'r1' })
    const frame = await productionFrame({ r1: planted.session })

    const garbage = await openViewer(frame, '?runId=r1')
    garbage.sendRaw('this is not json')
    expect((await garbage.waitFor(['refused'])).reason).toBe('malformed')
    expect(await garbage.waitForClose()).toBe(LIVE_VIEW_REFUSAL_CLOSE_CODE)

    const outOfOrder = await openViewer(frame, '?runId=r1')
    outOfOrder.send({ type: 'ack', id: 1 })
    expect(
      (await outOfOrder.waitFor(['refused'])).reason,
      'an `ack` before `hello` is a viewer trying to skip the handshake',
    ).toBe('malformed')
    expect(await outOfOrder.waitForClose()).toBe(LIVE_VIEW_REFUSAL_CLOSE_CODE)

    const notAnObject = await openViewer(frame, '?runId=r1')
    notAnObject.sendRaw('"a bare string"')
    expect((await notAnObject.waitFor(['refused'])).reason).toBe('malformed')

    expect(frame.attach).not.toHaveBeenCalled()
  })

  it('(5) refuses a TAMPERED signature by name — bad_signature — before attach', async () => {
    const planted = plantSession({ runId: 'r1' })
    const frame = await productionFrame({ r1: planted.session })
    const token = tokenFor({ runId: 'r1' })
    const tampered = `${token.slice(0, -4)}${token.endsWith('AAAA') ? 'BBBB' : 'AAAA'}`
    const viewer = await openViewer(frame, '?runId=r1')
    viewer.send({ type: 'hello', token: tampered })
    expect((await viewer.waitFor(['refused'])).reason).toBe('bad_signature')
    expect(await viewer.waitForClose()).toBe(LIVE_VIEW_REFUSAL_CLOSE_CODE)
    expect(frame.attach, 'a forged token must never reach the run registry').not.toHaveBeenCalled()
  })

  it('(6) refuses an EXPIRED token by name — expired — before attach', async () => {
    const planted = plantSession({ runId: 'r1' })
    const frame = await productionFrame({ r1: planted.session })
    const viewer = await openViewer(frame, '?runId=r1')
    viewer.send({ type: 'hello', token: tokenFor({ runId: 'r1', exp: Date.now() - 1_000 }) })
    expect((await viewer.waitFor(['refused'])).reason).toBe('expired')
    expect(await viewer.waitForClose()).toBe(LIVE_VIEW_REFUSAL_CLOSE_CODE)
    expect(frame.attach).not.toHaveBeenCalled()
  })

  it('(7) refuses a token minted for ANOTHER run — scope_mismatch — before attach (T-403-03)', async () => {
    const one = plantSession({ runId: 'r1' })
    const two = plantSession({ runId: 'r2' })
    const frame = await productionFrame({ r1: one.session, r2: two.session })
    const viewer = await openViewer(frame, '?runId=r1')
    viewer.send({ type: 'hello', token: tokenFor({ runId: 'r2' }) })
    expect(
      (await viewer.waitFor(['refused'])).reason,
      'a valid token for r2 presented on r1\'s socket is the cross-run read this refusal exists for',
    ).toBe('scope_mismatch')
    expect(await viewer.waitForClose()).toBe(LIVE_VIEW_REFUSAL_CLOSE_CODE)
    expect(frame.attach).not.toHaveBeenCalled()
  })

  it('(8) refuses a token whose scope is not `view` — scope_mismatch — before attach', async () => {
    const planted = plantSession({ runId: 'r1' })
    const frame = await productionFrame({ r1: planted.session })
    const viewer = await openViewer(frame, '?runId=r1')
    viewer.send({ type: 'hello', token: tokenFor({ runId: 'r1', scope: 'control' as LiveUrlClaims['scope'] }) })
    expect((await viewer.waitFor(['refused'])).reason).toBe('scope_mismatch')
    expect(frame.attach).not.toHaveBeenCalled()
  })

  it('(9) refuses a VALID token for a run this process never started — unknown_run', async () => {
    // The one refusal where `attach` IS called: attach is the lookup, and its `undefined` is the
    // answer. Refusing before it would mean refusing without asking.
    const frame = await productionFrame({})
    const viewer = await openViewer(frame, '?runId=r_gone')
    viewer.send({ type: 'hello', token: tokenFor({ runId: 'r_gone' }) })
    expect((await viewer.waitFor(['refused'])).reason).toBe('unknown_run')
    expect(await viewer.waitForClose()).toBe(LIVE_VIEW_REFUSAL_CLOSE_CODE)
    expect(frame.attach, 'attach is the lookup this refusal reports').toHaveBeenCalledWith('r_gone')
  })

  it('(10) an upgrade with NO runId is destroyed — no socket, no ready, no refusal', async () => {
    const planted = plantSession({ runId: 'r1' })
    const frame = await productionFrame({ r1: planted.session })
    const socket = new WebSocket(`${frame.wsOrigin}${LIVE_VIEW_WS_PATH}`)
    openSockets.push(socket)
    const outcome = await new Promise<string>((resolve) => {
      socket.once('open', () => { resolve('open') })
      socket.once('error', () => { resolve('error') })
      socket.once('close', () => { resolve('close') })
    })
    expect(outcome, 'a socket that never names a run is refused at the upgrade, before the proxy exists')
      .not.toBe('open')
    expect(frame.attach).not.toHaveBeenCalled()
  })

  it('(11) `stream: { kind: none }` is READY with no frames — an honest absence, not an error', async () => {
    const planted = plantSession({ runId: 'r1', stream: { kind: 'none' } })
    const frame = await productionFrame({ r1: planted.session })
    const viewer = await openViewer(frame, '?runId=r1')
    viewer.send({ type: 'hello', token: tokenFor({ runId: 'r1' }) })
    const ready = await viewer.waitFor(['ready'])
    expect(ready.stream?.kind).toBe('none')
    expect(
      planted.subscribeCalls,
      'no painter, and no frame subscription either — a handle with no stream is not subscribed to',
    ).toBe(0)
    planted.emit(jpeg(1))
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(viewer.binaries, 'a none-stream socket carries no pixels').toEqual([])
    expect(viewer.closeCode, 'and it stays OPEN so the page can still receive `ended`').toBeUndefined()
  })

  it('(12) `session.done` resolving sends `ended { runFinished }` and closes 1000', async () => {
    const planted = plantSession({ runId: 'r1' })
    const frame = await productionFrame({ r1: planted.session })
    const viewer = await openViewer(frame, '?runId=r1')
    viewer.send({ type: 'hello', token: tokenFor({ runId: 'r1' }) })
    await viewer.waitFor(['ready'])
    planted.finish()
    const ended = await viewer.waitFor(['ended'])
    expect(ended.reason).toBe('runFinished')
    expect(await viewer.waitForClose()).toBe(1000)
  })

  it('(23) a member FINISHING sends `ended { handleFinished }` on the still-open socket (CR-03)', async () => {
    // CR-03. A multi-member run settles one member at a time, and `shell.ts` withdraws that
    // handle's declaration the instant its race settles. Before this cell the hub dropped the
    // handle's subscriber set without a word, so this viewer sat on `data-embed-state="live"` over
    // a frozen last frame until the WHOLE run ended — a stale picture claiming to be live, which is
    // the one thing the embed page's own law ("every absence is named") forbids.
    //
    // EVERY ABSENCE HERE IS PRECEDED BY A PRESENCE. `ready` with a real declared kind, one
    // subscription, and one painted JPEG are asserted BEFORE the end is triggered — otherwise
    // "the viewer was told the stream ended" and "the viewer was never streaming" read identically.
    const planted = plantSession({ runId: 'r1' })
    const frame = await productionFrame({ r1: planted.session })
    const viewer = await openViewer(frame, '?runId=r1')
    viewer.send({ type: 'hello', token: tokenFor({ runId: 'r1', handle: 2 }) })

    const ready = await viewer.waitFor(['ready'])
    expect(ready.stream?.kind, 'the witness: this viewer really is watching a declared stream')
      .toBe('cdp-screencast')
    expect(planted.subscribeCalls, 'and it really did subscribe to the frames').toBe(1)

    planted.emit(jpeg(7))
    await viewer.waitForBinaries(1)
    expect(viewer.binaries.length, 'the witness: pixels really flowed before the end was declared')
      .toBe(1)

    // THE MEMBER FINISHES. The run does NOT — `session.done` is still pending below.
    planted.endStream()

    const first = await viewer.waitFor(['ended'])
    expect(first.reason, 'a finished member is named, not left frozen and labelled live')
      .toBe('handleFinished')
    expect(
      viewer.closeCode,
      'and the socket STAYS OPEN — `runFinished` is a different fact and is still coming',
    ).toBeUndefined()

    // NOW the run ends. Both facts arrive, in order, on the one socket.
    planted.finish()
    expect(await viewer.waitForClose()).toBe(1000)
    expect(
      viewer.texts.filter((text) => text.type === 'ended').map((text) => text.reason),
      'two ends, each by its own name, in the order they happened',
    ).toEqual(['handleFinished', 'runFinished'])
    expect(viewer.order.join('|')).toBe('text:ready|text:frame|binary|text:ended|text:ended')
    expect(planted.cancels, 'and nothing about this touched the run (D-16)').toBe(0)
  })

  it('(13) THE EXPIRY DEADLINE: a socket whose token lapses mid-stream is refused BY NAME', async () => {
    const planted = plantSession({ runId: 'r1' })
    const frame = await productionFrame({ r1: planted.session })
    const viewer = await openViewer(frame, '?runId=r1')
    // A REAL short TTL against REAL timers — the deadline is armed off the claims' own `exp`, so a
    // 300 ms token is the honest way to watch it fire without waiting five minutes.
    viewer.send({ type: 'hello', token: tokenFor({ runId: 'r1', exp: Date.now() + 300 }) })
    await viewer.waitFor(['ready'])
    const refused = await viewer.waitFor(['refused'], 3_000)
    expect(
      refused.reason,
      'an expiring socket is REFUSED BY NAME so the page can say "link expired" — never dropped',
    ).toBe('expired')
    expect(await viewer.waitForClose()).toBe(LIVE_VIEW_REFUSAL_CLOSE_CODE)
  })

  it('(14) `renew` with a later token extends the socket PAST the first token\'s exp (D-02)', async () => {
    const planted = plantSession({ runId: 'r1' })
    const frame = await productionFrame({ r1: planted.session })
    const viewer = await openViewer(frame, '?runId=r1')
    const firstExp = Date.now() + 400
    viewer.send({ type: 'hello', token: tokenFor({ runId: 'r1', exp: firstExp }) })
    await viewer.waitFor(['ready'])

    await new Promise((resolve) => setTimeout(resolve, 150))
    const secondExp = Date.now() + 30_000
    viewer.send({ type: 'renew', token: tokenFor({ runId: 'r1', exp: secondExp }) })
    const renewed = await viewer.waitFor(['renewed'])
    expect(renewed.expiresAt).toBe(secondExp)

    // Past the FIRST token's expiry, and the socket is still carrying frames.
    await new Promise((resolve) => setTimeout(resolve, 500))
    expect(Date.now(), 'the cell must actually have crossed the first deadline').toBeGreaterThan(firstExp)
    expect(
      viewer.texts.some((text) => text.type === 'refused'),
      'a renewed socket must not be refused on the deadline the renew replaced — that is the '
      + 'silent-re-mint contract D-02 promises the viewer',
    ).toBe(false)
    planted.emit(jpeg(7))
    await viewer.waitForBinaries(1)
    expect(viewer.closeCode).toBeUndefined()
  })

  it('(15) `renew` with a BAD token is refused by name and closes — a renew is not a lesser check', async () => {
    const planted = plantSession({ runId: 'r1' })
    const frame = await productionFrame({ r1: planted.session })
    const viewer = await openViewer(frame, '?runId=r1')
    viewer.send({ type: 'hello', token: tokenFor({ runId: 'r1' }) })
    await viewer.waitFor(['ready'])
    const token = tokenFor({ runId: 'r1' })
    viewer.send({ type: 'renew', token: `${token.slice(0, -4)}${token.endsWith('AAAA') ? 'BBBB' : 'AAAA'}` })
    expect((await viewer.waitFor(['refused'])).reason).toBe('bad_signature')
    expect(await viewer.waitForClose()).toBe(LIVE_VIEW_REFUSAL_CLOSE_CODE)

    const other = await openViewer(frame, '?runId=r1')
    other.send({ type: 'hello', token: tokenFor({ runId: 'r1' }) })
    await other.waitFor(['ready'])
    other.send({ type: 'renew', token: tokenFor({ runId: 'r1', exp: Date.now() - 1 }) })
    expect((await other.waitFor(['refused'])).reason).toBe('expired')
  })

  it('(16) DETACH: closing a viewer socket unsubscribes and touches NOTHING else on the run (D-16)', async () => {
    // T-403-07's cell. The RED bar is an implementation that cancels the run when its last viewer
    // leaves — "attach, don't own" is the law INVK-05 pins, and a viewer that can end a run by
    // closing a tab is a viewer that has become the owner.
    const planted = plantSession({ runId: 'r1' })
    const frame = await productionFrame({ r1: planted.session })
    const viewer = await openViewer(frame, '?runId=r1')
    viewer.send({ type: 'hello', token: tokenFor({ runId: 'r1' }) })
    await viewer.waitFor(['ready'])
    expect(planted.subscribeCalls).toBe(1)

    viewer.close()
    await vi.waitFor(() => { expect(planted.unsubscribes).toBe(1) })
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(planted.unsubscribes, 'exactly one release, not one per timer or listener').toBe(1)
    expect(planted.cancels, 'a detach NEVER cancels the run — cancel stays runs.cancel\'s alone').toBe(0)
    // `done` is still pending: nothing about the run was decided by a window closing.
    const settled = await Promise.race([
      planted.session.done.then(() => 'settled'),
      new Promise<string>((resolve) => setTimeout(() => { resolve('still running') }, 150)),
    ])
    expect(settled, 'the run outlives its viewers').toBe('still running')
  })

  it('(17) TWO VIEWERS on one run each get their own subscription and identical frame ids', async () => {
    const planted = plantSession({ runId: 'r1' })
    const frame = await productionFrame({ r1: planted.session })
    const a = await openViewer(frame, '?runId=r1')
    const b = await openViewer(frame, '?runId=r1')
    a.send({ type: 'hello', token: tokenFor({ runId: 'r1' }) })
    b.send({ type: 'hello', token: tokenFor({ runId: 'r1' }) })
    await a.waitFor(['ready'])
    await b.waitFor(['ready'])
    expect(planted.subscribeCalls, 'the proxy does not share one subscription between sockets').toBe(2)

    planted.emit(jpeg(1))
    planted.emit(jpeg(2))
    await a.waitForBinaries(2)
    await b.waitForBinaries(2)
    const idsOf = (viewer: Viewer): number[] =>
      viewer.texts.filter((text) => text.type === 'frame').map((text) => text.id as number)
    expect(idsOf(a)).toEqual([1, 2])
    expect(idsOf(b), 'two viewers of one stream see the same ids in the same order').toEqual(idsOf(a))

    // One viewer leaving does not disturb the other.
    a.close()
    await vi.waitFor(() => { expect(planted.unsubscribes).toBe(1) })
    planted.emit(jpeg(3))
    await b.waitForBinaries(3)
    expect(idsOf(b)).toEqual([1, 2, 3])
  })

  it('(18) SLOW VIEWER: a backed-up socket is skipped for the frame and acked on its behalf (T-403-06)', async () => {
    // THE ONE CELL THAT DOES NOT USE `startServer`. The claim is about a socket whose
    // `bufferedAmount` is above the drop threshold, and `bufferedAmount` is a read-only property of
    // a real `ws` socket that no amount of production framing lets a test set. The gauge is what is
    // under test here; every OTHER proxy claim in this file is measured through the shipped frame.
    const planted = plantSession({ runId: 'r1' })
    const sent: unknown[] = []
    const handlers = new Map<string, ((...args: unknown[]) => void)[]>()
    let buffered = 0
    const fakeSocket = {
      OPEN: 1,
      get readyState() { return 1 },
      get bufferedAmount() { return buffered },
      send: (data: unknown) => { sent.push(data) },
      close: () => {},
      ping: () => {},
      on(event: string, handler: (...args: unknown[]) => void) {
        handlers.set(event, [...(handlers.get(event) ?? []), handler])
        return this
      },
      once(event: string, handler: (...args: unknown[]) => void) { return this.on(event, handler) },
    }
    const proxy = createFrameProxy({
      validate: (token, expectation) => validateLiveUrlToken(signer, token, expectation),
      attach: () => planted.session,
    })
    proxy(fakeSocket as unknown as WebSocket, 'r1')
    for (const handler of handlers.get('message') ?? []) {
      handler(JSON.stringify({ type: 'hello', token: tokenFor({ runId: 'r1' }) }), false)
    }
    expect(sent.length, 'the fake socket received `ready`').toBe(1)

    // Healthy: the frame is sent as a header + bytes and NOT acked on the viewer's behalf.
    planted.emit(jpeg(1))
    expect(sent.length).toBe(3)
    expect(planted.acked, 'a keeping-up viewer acks for itself').toEqual([])

    // Backed up beyond the threshold: the pixels are dropped and the frame is acked anyway, so the
    // CDP producer keeps flowing for everybody else.
    buffered = LIVE_VIEW_SLOW_VIEWER_BYTES + 1
    planted.emit(jpeg(2))
    expect(sent.length, 'nothing is written to a socket that is already too far behind').toBe(3)
    expect(
      planted.acked,
      'and the frame is acked on its behalf — CDP will not produce frame N+1 until N is acked, so '
      + 'one slow viewer must cost itself frames rather than cost the producer its stream',
    ).toEqual([2])

    // A SECOND viewer on the same session still receives the frame the slow one dropped.
    const healthy: LiveFrame[] = []
    planted.session.subscribeFrames(0, (received) => { healthy.push(received) })
    planted.emit(jpeg(3))
    expect(healthy.map((received) => received.id)).toEqual([3])
  })

  it('(19) the embed page: 200, the four headers, the nonce equality, and a fresh nonce per response', async () => {
    const planted = plantSession({ runId: 'r1' })
    const frame = await productionFrame({ r1: planted.session })
    const response = await fetch(`${frame.origin}/live/r1`)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/html')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('referrer-policy'), 'a fragment token must not ride a Referer out')
      .toBe('no-referrer')
    const csp = response.headers.get('content-security-policy') ?? ''
    expect(csp).toContain("default-src 'none'")
    expect(response.headers.get('x-frame-options'), 'this page EXISTS to be embedded').toBeNull()

    const body = await response.text()
    expect(body).toContain('data-embed-state="connecting"')
    expect(body, 'the canvas must not swallow the host page\'s clicks').toContain('pointer-events')

    const scriptNonce = /<script nonce="([^"]+)">/u.exec(body)?.[1]
    const cspNonce = /script-src 'nonce-([^']+)'/u.exec(csp)?.[1]
    expect(scriptNonce, 'the page serves exactly one nonce\'d inline script').toBeDefined()
    expect(
      scriptNonce,
      'a script whose nonce differs from the CSP\'s is a script the browser refuses to run — the '
      + 'embed would be blank in every host, and no server-side cell would notice',
    ).toBe(cspNonce)

    const second = await fetch(`${frame.origin}/live/r1`)
    const secondBody = await second.text()
    const secondNonce = /<script nonce="([^"]+)">/u.exec(secondBody)?.[1]
    expect(secondNonce, 'a nonce reused across responses is not a nonce').not.toBe(scriptNonce)
  })

  it('(20) the served page carries the EXACT expired copy, in the branch that renders it (D-02, W6)', async () => {
    const planted = plantSession({ runId: 'r1' })
    const frame = await productionFrame({ r1: planted.session })
    const body = await (await fetch(`${frame.origin}/live/r1`)).text()
    const script = /<script nonce="[^"]+">([\s\S]*?)<\/script>/u.exec(body)?.[1] ?? ''
    expect(script.length, 'the served document must contain the embed script').toBeGreaterThan(200)

    // THE LITERAL IS COMPARED TO THE SERVED BYTES, not to another copy of itself: the constant this
    // package exports and the string the page renders are the same string, or a viewer sees copy
    // nobody asserted. The ws-level `expired` refusal (cell 13) is the answer this branch renders;
    // the browser-rendered assertion of the text is 403-01's tracer cell (iii-b).
    expect(script, 'the served script must carry the exported expired message verbatim')
      .toContain(JSON.stringify(LIVE_EMBED_EXPIRED_MESSAGE))
    expect(script).toContain('data-embed-message')

    // And it is the `expired` REASON that assigns it — not some other state that happens to share
    // the words. Both tokens live in the same statement.
    const expiredBranch = /'expired'[^\n]*\n?[^\n]*/gu
    const branches = script.match(expiredBranch) ?? []
    expect(
      branches.some((line) => line.includes(JSON.stringify(LIVE_EMBED_EXPIRED_MESSAGE))),
      `no branch keyed on the 'expired' reason assigns ${JSON.stringify(LIVE_EMBED_EXPIRED_MESSAGE)}`,
    ).toBe(true)
    expect(LIVE_EMBED_STATES, 'and `expired` is a declared state of the page').toContain('expired')
  })

  it('(22) THE FRAME IS THE SHIPPED ONE — asserted on this file\'s own source', async () => {
    /* self-scan:begin */
    // The plan asked for at least six `startServer(` call sites. This file has ONE, inside
    // `productionFrame`, because twenty copies of the same seven-line construction is worse code
    // and no stronger a claim. What the criterion is actually about — "these cells drive the
    // shipped frame, not a router somebody mounted here" — is therefore asserted directly, on the
    // `run-service-anchors.test.ts` idiom: the one construction site is pinned, its users are
    // counted, and the two ways a later edit could quietly swap in a lookalike are refused.
    const { readFileSync } = await import('node:fs')
    const { fileURLToPath } = await import('node:url')
    const here = fileURLToPath(import.meta.url)
    const whole = readFileSync(here, 'utf8')

    // THE DETECTOR MUST NOT BE ITS OWN SUBJECT. This cell's body names every token it hunts for, so
    // a whole-file scan is satisfied by the scan itself — the failure shape 393 named. The sentinels
    // below fence this cell out, and the fence is asserted to have actually cut something.
    const OPEN = '/* self-scan:begin *' + '/'
    const CLOSE = '/* self-scan:end *' + '/'
    const from = whole.indexOf(OPEN)
    const to = whole.indexOf(CLOSE)
    expect(from, 'the self-scan fence must be present').toBeGreaterThan(-1)
    expect(to, 'the self-scan fence must be closed').toBeGreaterThan(from)
    const source = whole.slice(0, from) + whole.slice(to + CLOSE.length)
    expect(
      whole.length - source.length,
      'the fence must actually exclude this cell, or the scan is reading its own vocabulary',
    ).toBeGreaterThan(500)

    const startServerSites = (source.match(/await startServer\(/gu) ?? []).length
    expect(startServerSites, 'the production server is constructed in exactly one place').toBe(1)
    const constructionSite = /async function productionFrame\([\s\S]*?\n\}/u.exec(source)?.[0] ?? ''
    expect(constructionSite, 'and that place is `productionFrame`').toContain('startServer(')
    expect(constructionSite, 'threading the two ports the live view needs off the shipped option')
      .toContain('runServiceAttach')
    expect(constructionSite).toContain('liveView')

    const users = (source.match(/await productionFrame\(/gu) ?? []).length
    expect(users, 'every socket-level cell in this file goes through that one frame').toBeGreaterThanOrEqual(6)

    // The two lookalikes: a bare router mount, or a hand-rolled `WebSocketServer` this file
    // upgrades itself. Either would leave every assertion above reading identically while
    // measuring something `agent-qa dashboard` never runs.
    expect(source.includes('createRouter('), 'no router may be mounted in-process here').toBe(false)
    expect(source.includes('new WebSocketServer('), 'and no upgrade path may be re-implemented here')
      .toBe(false)
    // The ONE sanctioned direct-proxy CALL SITE — the slow-viewer gauge cell, which says at the
    // site why it cannot use the shipped frame. A second one would be a cell quietly opting out.
    expect((source.match(/createFrameProxy\(/gu) ?? []).length, 'exactly one direct-proxy call site')
      .toBe(1)
    /* self-scan:end */
  })

  it('(21) the proxy module holds NO cancel and measures its hello cap in BYTES — pinned in source', async () => {
    const { readFileSync } = await import('node:fs')
    const { fileURLToPath } = await import('node:url')
    const { dirname, join } = await import('node:path')
    const here = dirname(fileURLToPath(import.meta.url))
    const source = readFileSync(join(here, '..', 'live-view', 'frame-proxy.ts'), 'utf8')
    expect(
      source.includes('cancel'),
      'the frame proxy must not name `cancel` at all — the one call a viewer could make that ends '
      + 'somebody else\'s run is a call this module should not be able to make (T-403-07)',
    ).toBe(false)
    expect(
      source,
      'a character-length cap is not a byte cap; the byte count is what the socket buffers',
    ).toContain('Buffer.byteLength')
  })
})
