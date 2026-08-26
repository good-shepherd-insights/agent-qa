// The DEDICATED post-processing channel: the relay and `GET /api/runs/:id/post-processing/stream`
// (Phase 404 plan 05, D-16/D-17 · LIFE-04).
//
// WHY A SECOND SSE AND NOT A WIDENED RUN STREAM. D-16: the run stream's contract is "closes at
// `runFinished`", and every chip envelope this channel carries is appended AFTER that line. A door
// that held the run stream open for them would change what `runFinished` means for every consumer
// already reading it — including the live-view page and the conformance corpus that compares two
// doors byte for byte. So the chips get their own door, and `routes.run-stream.test.ts` staying
// green is the structural proof that the old one was not touched (T-404-03).
//
// EVERY PUSH IS A TRIGGER, NEVER A PAINT (D-17). The relayed envelope is a hint that the DURABLE
// answer moved; the answer itself is the `snapshot` frame, which is the read route's body. That is
// why the terminal arm below RE-READS rather than deriving a terminal state from the envelope it
// just wrote: a chip derived from an envelope would be a second projection of chip truth, free to
// disagree with `runs.postprocessing` — the exact drift D-16 and 388 D-14 rule out by name.
//
// THE STREAM CELLS PUBLISH ONLY AFTER THE SNAPSHOT IS IN HAND. The relay keeps NO history (the
// page's snapshot-then-poll is the floor), so a cell that published before the subscription existed
// would be measuring the miss rather than the relay — and would do it flakily.

import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'

import type {
  PostProcessingStatus,
  RunEventEnvelope,
} from '@vostride/agent-qa-schema'
import { afterEach, describe, expect, it } from 'vitest'

import { DashboardDatabase } from '../db/database.js'
import type { AgentHost, AgentRegistryHandle } from '../chat/host.js'
import {
  createPostProcessingRelay,
  type PostProcessingRelay,
} from '../execution/post-processing-relay.js'
import { startServer } from '../server/server.js'

const PP_ID = 'test:planted-post-processing-op'
const EVENTS_ID = 'test:planted-events-op'
const RUN_ID = 'r_pp_stream'

const envelope = (
  seq: number,
  type: RunEventEnvelope['type'],
  payload: RunEventEnvelope['payload'],
  runId = RUN_ID,
): RunEventEnvelope => ({ seq, ts: seq * 10, runId, type, payload })

const chips = (
  analysis: PostProcessingStatus['chips']['analysis'],
  curation: PostProcessingStatus['chips']['curation'],
  runId = RUN_ID,
): PostProcessingStatus => ({ runId, chips: { analysis, curation } })

// ---- The relay, on its own ------------------------------------------------------------------

describe('createPostProcessingRelay — the in-process listener registry (D-16)', () => {
  it('delivers to listeners of the envelope OWN runId and to nobody else (T-404-02)', () => {
    const relay = createPostProcessingRelay()
    const mine: RunEventEnvelope[] = []
    const theirs: RunEventEnvelope[] = []
    relay.subscribe('r_mine', (event) => mine.push(event))
    relay.subscribe('r_theirs', (event) => theirs.push(event))

    const chip = envelope(9, 'analysisCompleted', { runId: 'r_mine' }, 'r_mine')
    relay.publish(chip)

    expect(mine, 'the run the envelope names').toEqual([chip])
    expect(theirs, "a foreign run's chip never reaches this run's listeners").toEqual([])
  })

  it('keys on the ENVELOPE, not on the publisher — a mis-addressed chip reaches nobody', () => {
    // The emitter has its own drop-guard for outcomes that belong to another chain; this is the
    // second wall, and it is the one that holds when a caller publishes something it should not.
    const relay = createPostProcessingRelay()
    const seen: RunEventEnvelope[] = []
    relay.subscribe(RUN_ID, (event) => seen.push(event))

    relay.publish(envelope(1, 'curationStarted', { runId: 'r_other' }, 'r_other'))

    expect(seen).toEqual([])
  })

  it('drops a THROWING listener for that delivery and still serves the others (T-404-14)', () => {
    const relay = createPostProcessingRelay()
    const after: RunEventEnvelope[] = []
    relay.subscribe(RUN_ID, () => { throw new Error('a viewer fault') })
    relay.subscribe(RUN_ID, (event) => after.push(event))

    const chip = envelope(2, 'analysisStarted', { runId: RUN_ID })
    expect(() => { relay.publish(chip) }, 'the publisher is the emitter thread; it may not be thrown at').not.toThrow()
    expect(after, 'the listener registered after the throwing one still received it').toEqual([chip])
  })

  it('publishing with no listeners is a no-op, and the disposer removes exactly one', () => {
    const relay = createPostProcessingRelay()
    expect(relay.listenerCount(RUN_ID)).toBe(0)
    expect(() => { relay.publish(envelope(1, 'curationCompleted', { runId: RUN_ID })) }).not.toThrow()

    const first = relay.subscribe(RUN_ID, () => undefined)
    const second = relay.subscribe(RUN_ID, () => undefined)
    expect(relay.listenerCount(RUN_ID)).toBe(2)
    first()
    expect(relay.listenerCount(RUN_ID)).toBe(1)
    first()
    expect(relay.listenerCount(RUN_ID), 'the disposer is idempotent').toBe(1)
    second()
    expect(relay.listenerCount(RUN_ID)).toBe(0)
  })

  it('keeps NO history — a listener registered after a publish misses it (the planner assumption)', () => {
    // Stated as a cell rather than left implicit: the page's next read is what makes the miss
    // harmless, and a relay that buffered would be a second, weaker copy of the durable record.
    const relay = createPostProcessingRelay()
    relay.publish(envelope(1, 'analysisCompleted', { runId: RUN_ID }))
    const late: RunEventEnvelope[] = []
    relay.subscribe(RUN_ID, (event) => late.push(event))
    expect(late).toEqual([])
  })
})

// ---- The stream door, at the production frame ------------------------------------------------

const REGISTRY: AgentRegistryHandle = { planted: 'registry' } as AgentRegistryHandle
const CALLER = { id: 'planted-caller', grantedScopes: ['read'] } as unknown as AgentHost['caller']

interface Fixture {
  readonly port: number
  readonly relay: PostProcessingRelay
  /** Move what the ops answer, so a re-read can see a chain that has since gone terminal. */
  setStatus(next: PostProcessingStatus): void
  setEvents(next: readonly RunEventEnvelope[]): void
}

const servers: Server[] = []
const closers: Array<() => void> = []

afterEach(async () => {
  while (closers.length > 0) closers.pop()?.()
  while (servers.length > 0) {
    const server = servers.pop()
    await new Promise<void>((closed) => server?.close(() => closed()))
  }
})

async function serve(options: {
  readonly status: PostProcessingStatus
  readonly events?: readonly RunEventEnvelope[]
  readonly withHost?: boolean
  readonly withRelay?: boolean
}): Promise<Fixture> {
  let status = options.status
  let events = options.events ?? []
  const relay = createPostProcessingRelay()
  const host: AgentHost = {
    registry: REGISTRY,
    caller: CALLER,
    agentAskFunctionId: 'test:planted-ask-op',
    runsPostProcessingFunctionId: PP_ID,
    runsEventsFunctionId: EVENTS_ID,
    invokeFunction: (_registry, functionId): Promise<unknown> => {
      if (functionId === PP_ID) return Promise.resolve(status)
      if (functionId === EVENTS_ID) {
        const replay = async function* (): AsyncGenerator<RunEventEnvelope> {
          for (const one of events) yield one
        }
        return Promise.resolve(replay())
      }
      throw new Error(`the fixture was asked for an id it does not plant: ${functionId}`)
    },
    foldFunctionResult: () => ({ verdict: { status: 'executed', outcome: 'planted' }, foldLines: [] }),
    listDeclarations: () => [],
    onSessionEvent: () => () => undefined,
    unmaskForDisplay: (text) => text,
  }
  const db = new DashboardDatabase({ dbPath: ':memory:' })
  const started = await startServer({
    db,
    port: 0,
    ...(options.withHost === false ? {} : { agentHost: host }),
    ...(options.withRelay === false ? {} : { postProcessingRelay: relay }),
  })
  closers.push(started.close)
  return {
    port: (started.server.address() as AddressInfo).port,
    relay,
    setStatus: (next) => { status = next },
    setEvents: (next) => { events = next },
  }
}

/** One SSE frame at a time; `''` means the socket ended. */
class Frames {
  private buffer = ''
  private readonly decoder = new TextDecoder()
  constructor(private readonly reader: ReadableStreamDefaultReader<Uint8Array>) {}

  async next(what: string): Promise<string> {
    const deadline = new Promise<never>((_resolve, reject) => {
      setTimeout(() => { reject(new Error(`timed out waiting for ${what}`)) }, 4_000).unref()
    })
    return Promise.race([this.pump(), deadline])
  }

  private async pump(): Promise<string> {
    for (;;) {
      const at = this.buffer.indexOf('\n\n')
      if (at >= 0) {
        const frame = this.buffer.slice(0, at + 2)
        this.buffer = this.buffer.slice(at + 2)
        return frame
      }
      const chunk = await this.reader.read()
      if (chunk.done) {
        const rest = this.buffer
        this.buffer = ''
        return rest
      }
      this.buffer += this.decoder.decode(chunk.value, { stream: true })
    }
  }

  cancel(): void { void this.reader.cancel().catch(() => undefined) }
}

interface Opened {
  readonly status: number
  readonly contentType: string | null
  readonly body: string
  readonly frames?: Frames
  readonly abort: AbortController
}

async function open(port: number, path = `/api/runs/${RUN_ID}/post-processing/stream`): Promise<Opened> {
  const abort = new AbortController()
  const response = await fetch(`http://127.0.0.1:${String(port)}${path}`, { signal: abort.signal })
  const contentType = response.headers.get('content-type')
  if (response.status !== 200 || !(contentType ?? '').includes('text/event-stream')) {
    return { status: response.status, contentType, body: await response.text(), abort }
  }
  return {
    status: response.status,
    contentType,
    body: '',
    frames: new Frames(response.body!.getReader()),
    abort,
  }
}

const nameOf = (frame: string): string => /^event: (.+)$/mu.exec(frame)?.[1] ?? ''
const idOf = (frame: string): string | undefined => /^id: (.+)$/mu.exec(frame)?.[1]
const dataOf = (frame: string): unknown => JSON.parse(/^data: (.+)$/mu.exec(frame)?.[1] ?? 'null')

async function waitUntil(predicate: () => boolean, what: string): Promise<void> {
  const until = Date.now() + 4_000
  while (Date.now() < until) {
    if (predicate()) return
    await new Promise<void>((tick) => { setTimeout(tick, 10).unref() })
  }
  throw new Error(`timed out waiting for ${what}`)
}

describe('the stream opens with a snapshot and relays until the chain is terminal (LIFE-04)', () => {
  it('snapshot first, then every relayed envelope with the seq AS the id, then a final snapshot and close', async () => {
    const running = chips('running', 'pending')
    const fixture = await serve({
      status: running,
      events: [envelope(1, 'runFinished', { aggregateVerdict: 'passed', disposition: 'drained', finalSeq: 1 })],
    })

    const stream = await open(fixture.port)
    expect(stream.status, stream.body).toBe(200)
    expect(stream.contentType).toContain('text/event-stream')
    const frames = stream.frames!

    const first = await frames.next('the opening snapshot')
    expect(nameOf(first), 'a distinctly named frame — NOT a bus event type (T-404-03)').toBe('snapshot')
    expect(dataOf(first), 'the snapshot IS the read route body').toEqual({
      status: running,
      disposition: 'drained',
      failures: {},
    })
    expect(idOf(first), 'the snapshot carries no seq — it is not an envelope').toBeUndefined()

    await waitUntil(() => fixture.relay.listenerCount(RUN_ID) === 1, 'the stream to subscribe')

    const started = envelope(41, 'curationStarted', { runId: RUN_ID })
    fixture.relay.publish(started)
    const relayed = await frames.next('the relayed curationStarted')
    expect(nameOf(relayed), 'the event name IS the envelope type').toBe('curationStarted')
    expect(idOf(relayed), 'the id IS the seq').toBe('41')
    expect(dataOf(relayed), 'the envelope travels whole — no projection').toEqual(started)

    // The chain goes terminal. The envelope is the TRIGGER; the re-read is the answer.
    const terminal = chips('done', 'done')
    fixture.setStatus(terminal)
    const completed = envelope(42, 'curationCompleted', { runId: RUN_ID })
    fixture.relay.publish(completed)

    const echoed = await frames.next('the relayed curationCompleted')
    expect(nameOf(echoed)).toBe('curationCompleted')
    expect(idOf(echoed)).toBe('42')

    const last = await frames.next('the final snapshot')
    expect(nameOf(last), 'the door re-read and answered with the DURABLE state').toBe('snapshot')
    expect(dataOf(last)).toEqual({ status: terminal, disposition: 'drained', failures: {} })

    expect(await frames.next('the socket to end'), 'nothing more will ever arrive').toBe('')
    await waitUntil(() => fixture.relay.listenerCount(RUN_ID) === 0, 'the subscription to be torn down')
  }, 20_000)

  it('stays open on a chain whose runFinished is not durable yet — no disposition is not a close', async () => {
    // Opened at the verdict, before the shell wrote `runFinished`. The page is exactly where the
    // live channel is worth having, so this is the one arm that must NOT 204.
    const fixture = await serve({ status: chips('pending', 'pending'), events: [] })

    const stream = await open(fixture.port)
    expect(stream.status, stream.body).toBe(200)
    const first = await stream.frames!.next('the opening snapshot')
    expect(nameOf(first)).toBe('snapshot')
    expect(dataOf(first), 'no disposition, and the door still opened').toEqual({
      status: chips('pending', 'pending'),
      failures: {},
    })
    await waitUntil(() => fixture.relay.listenerCount(RUN_ID) === 1, 'the stream to subscribe')
    stream.abort.abort()
  }, 20_000)

  it('tears the subscription down when the client goes away', async () => {
    const fixture = await serve({ status: chips('running', 'pending'), events: [] })
    const stream = await open(fixture.port)
    await stream.frames!.next('the opening snapshot')
    await waitUntil(() => fixture.relay.listenerCount(RUN_ID) === 1, 'the stream to subscribe')

    stream.abort.abort()

    await waitUntil(() => fixture.relay.listenerCount(RUN_ID) === 0, 'the listener to be released')
  }, 20_000)
})

describe('the stream 204s rather than letting a browser reconnect forever (D-16, Pitfall 6)', () => {
  it('204 with no body when the chain is ALREADY terminal at open', async () => {
    const fixture = await serve({
      status: chips('done', 'failed'),
      events: [envelope(1, 'runFinished', { aggregateVerdict: 'passed', disposition: 'drained', finalSeq: 1 })],
    })

    const answer = await open(fixture.port)
    expect(answer.status, answer.body).toBe(204)
    expect(answer.body, 'a 204 carries none').toBe('')
    expect(fixture.relay.listenerCount(RUN_ID), 'and subscribes to nothing').toBe(0)
  })

  it("204 when the run says 'handedOff' — this process is not the drainer, so no frame can arrive", async () => {
    const fixture = await serve({
      status: chips('pending', 'pending'),
      events: [envelope(1, 'runFinished', { aggregateVerdict: 'passed', disposition: 'handedOff', finalSeq: 1 })],
    })

    const answer = await open(fixture.port)
    expect(answer.status, answer.body).toBe(204)
    expect(fixture.relay.listenerCount(RUN_ID)).toBe(0)
  })

  it("204 when the run says 'detached' — nothing in this process will ever pump that chain", async () => {
    const fixture = await serve({
      status: chips('pending', 'pending'),
      events: [envelope(1, 'runFinished', { aggregateVerdict: 'passed', disposition: 'detached', finalSeq: 1 })],
    })

    const answer = await open(fixture.port)
    expect(answer.status, answer.body).toBe(204)
    expect(fixture.relay.listenerCount(RUN_ID)).toBe(0)
  })
})

describe('the stream refuses BEFORE the head, by name', () => {
  it('503 post_processing_relay_unavailable when this server was started without a relay', async () => {
    const fixture = await serve({ status: chips('pending', 'pending'), withRelay: false })
    const answer = await open(fixture.port)
    expect(answer.status, answer.body).toBe(503)
    expect(answer.contentType).toContain('application/json')
    expect(JSON.parse(answer.body)).toEqual({ error: 'post_processing_relay_unavailable' })
  })

  it('503 agent_host_unavailable when this server was started without a host', async () => {
    const fixture = await serve({ status: chips('pending', 'pending'), withHost: false })
    const answer = await open(fixture.port)
    expect(answer.status, answer.body).toBe(503)
    expect(JSON.parse(answer.body)).toEqual({ error: 'agent_host_unavailable' })
  })

  it('400 invalid_run_id, with no stream opened', async () => {
    const fixture = await serve({ status: chips('pending', 'pending') })
    const answer = await open(
      fixture.port,
      `/api/runs/${encodeURIComponent('a/b')}/post-processing/stream`,
    )
    expect(answer.status, answer.body).toBe(400)
    expect(JSON.parse(answer.body)).toEqual({ error: 'invalid_run_id' })
    expect(answer.contentType, 'never a half-open text/event-stream').not.toContain('text/event-stream')
  })
})
