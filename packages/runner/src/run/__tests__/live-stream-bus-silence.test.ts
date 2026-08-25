// LIVE-03: FRAMES FLOW WHILE THE BUS STAYS SILENT (403-02 Task 3 · D-05).
//
// THE CLAIM. A live view is a SIDE CHANNEL. Frames — bytes, geometry, an ack — cross the
// `RunSession` through `subscribeFrames`, and the run event bus publishes nothing about them: no
// new event type, no envelope, and no payload carrying a pixel at any depth. That matters because
// the bus is the durable, replayable, cross-process record of a run: every envelope is written to
// the event log, replayed to late subscribers and served over SSE to anyone with a run-service
// credential. A megabyte of JPEG on that path would be persisted forever, replayed on every
// reconnect, and handed to callers who asked for a step timeline.
//
// WHY A DIFFERENTIAL AND NOT AN ABSENCE CHECK. "No frame events appeared" is satisfied for free by
// a run that produced no frames — a green cell that measured nothing (WINDOWS: "green that never
// ran"). So the SAME run is driven twice: once with no frame subscriber at all, once with a
// subscriber pulling 50 frames through, and the two envelope streams are compared. The frames must
// demonstrably have flowed, and the bus must be byte-identical either way.
//
// AND THE SCANNER CARRIES ITS OWN POSITIVE CONTROL. A sweep for `bytes` and for a base64 JPEG
// prefix is satisfied by a sweep that cannot see anything; the last cell runs the same predicate
// over a planted envelope and requires it to fire.

import { describe, expect, it } from 'vitest'

import { RUN_EVENT_TYPES } from '@vostride/agent-qa-schema'
import type { CompletedRunHandoff, RunEventEnvelope, RunSession } from '@vostride/agent-qa-schema'

import { startRun } from '../shell.js'
import type { MemberTestRunContext, RunConfig } from '../shell.js'
import type { LiveStreamCapability } from '../../platform.js'
import type { EventLogPort, HandoffStorePort } from '../ports.js'
import type { TestResult } from '../../result.js'

function makeHandoffStore(): HandoffStorePort {
  return { async save(_handoff: CompletedRunHandoff) { /* durable write is not this cell's subject */ } }
}

function makeEventLog(): EventLogPort {
  const store: RunEventEnvelope[] = []
  return {
    append(envelope: RunEventEnvelope) { store.push(envelope) },
    read(fromSeq: number) { return store.filter((event) => event.seq >= fromSeq) },
  }
}

/**
 * A JPEG-shaped payload. The first three bytes are a real SOI marker, so its base64 begins `/9j/` —
 * the string a person would grep an event log for after the fact, and the string this cell greps.
 */
function jpegBytes(id: number): Uint8Array {
  const body = new Uint8Array(64)
  body.fill(id & 0xff)
  return new Uint8Array([0xff, 0xd8, 0xff, ...body, 0xff, 0xd9])
}

/** A capability that pushes `count` frames the moment somebody watches, and records its acks. */
function burstCapability(count: number): LiveStreamCapability & { acked: number[]; started: number } {
  const acked: number[] = []
  let started = 0
  return {
    kind: 'cdp-screencast',
    acked,
    get started() { return started },
    async start(onFrame) {
      started += 1
      for (let id = 1; id <= count; id++) onFrame({ id, bytes: jpegBytes(id), metadata: { width: 320, height: 240 } })
    },
    async ack(frameId) { acked.push(frameId) },
    async stop() { /* nothing to tear down in a fake */ },
  } as LiveStreamCapability & { acked: number[]; started: number }
}

interface RunHandle {
  readonly session: RunSession
  readonly envelopes: RunEventEnvelope[]
  readonly capability: ReturnType<typeof burstCapability>
  /** Resolves once the member has registered its capability. */
  readonly registered: Promise<void>
  finish(): void
}

function startInstrumentedRun(frameCount: number): RunHandle {
  const capability = burstCapability(frameCount)
  let markRegistered: () => void = () => {}
  const registered = new Promise<void>((resolve) => { markRegistered = resolve })
  let finish: () => void = () => {}
  const finished = new Promise<void>((resolve) => { finish = resolve })

  const config: RunConfig = {
    runId: 'run-live-03-bus-silence' as RunConfig['runId'],
    scope: { tier: 'suite', key: 'live-view' },
    executionContext: 'local-headless',
    buildOrdinal: 1,
    configDigests: { suiteConfigDigest: 'suite-d', testConfigDigest: 'test-d' },
    members: [{ testId: 'a', name: 'the watched member', filePath: 'a.test.ts' }],
    executor: async (member, ctx: MemberTestRunContext): Promise<TestResult> => {
      ctx.registerLiveStream?.(capability)
      markRegistered()
      await finished
      return { name: member.name, filePath: member.filePath, status: 'passed', steps: [], duration: 1 }
    },
    ports: { handoffStore: makeHandoffStore(), eventLog: makeEventLog() },
  }

  const session = startRun(config)
  const envelopes: RunEventEnvelope[] = []
  session.subscribe(1, (envelope) => { envelopes.push(envelope) })
  return { session, envelopes, capability, registered, finish: () => { finish() } }
}

/** Every key that appears anywhere in a value, at any depth — the ring-3 walk, locally. */
function everyKey(value: unknown, into: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    for (const member of value) everyKey(member, into)
    return into
  }
  if (typeof value === 'object' && value !== null) {
    for (const [key, member] of Object.entries(value)) { into.add(key); everyKey(member, into) }
  }
  return into
}

/** THE PREDICATE, shared by the real sweep and its positive control. */
function pixelResidueIn(envelopes: readonly RunEventEnvelope[]): string[] {
  const found: string[] = []
  const raw = JSON.stringify(envelopes)
  if (raw.includes('"bytes"')) found.push('a `bytes` key appears in the serialized envelopes')
  if (raw.includes('/9j/')) found.push('a base64 JPEG (`/9j/`) appears in the serialized envelopes')
  for (const key of everyKey(envelopes)) {
    if (['bytes', 'frame', 'jpeg', 'screencast', 'pixels', 'image'].includes(key)) {
      found.push(`a pixel-shaped key survived at depth: ${key}`)
    }
  }
  return found
}

const typesOf = (envelopes: readonly RunEventEnvelope[]): string[] => envelopes.map((e) => e.type)

describe('LIVE-03: frames cross the session while the run bus publishes nothing about them', () => {
  it('the bus is BYTE-IDENTICAL whether or not 50 frames flowed through subscribeFrames', async () => {
    // (1) THE CONTROL: the same run, nobody watching. Its envelope stream is the baseline.
    const control = startInstrumentedRun(50)
    await control.registered
    control.finish()
    await control.session.done
    expect(
      control.capability.started,
      'the control must genuinely have had NO viewer — a control that started the producer is not '
      + 'a control',
    ).toBe(0)

    // (2) THE INSTRUMENTED RUN: identical in every respect except that somebody is watching.
    const watched = startInstrumentedRun(50)
    await watched.registered
    const frames: { id: number; bytes: Uint8Array }[] = []
    const subscription = watched.session.subscribeFrames(0, (frame) => {
      frames.push({ id: frame.id, bytes: frame.bytes })
      subscription?.ack(frame.id)
    })
    expect(subscription, 'a live handle must be subscribable').toBeDefined()
    watched.finish()
    await watched.session.done

    expect(frames.length, 'the frames must actually have flowed, or this cell measured nothing')
      .toBe(50)
    expect([...(frames[0] as { bytes: Uint8Array }).bytes].slice(0, 3), 'and they were real JPEG bytes')
      .toEqual([0xff, 0xd8, 0xff])
    expect(watched.capability.acked.length, 'and each was acked back to the producer').toBe(50)

    // (3) THE DIFFERENTIAL. Fifty frames of pixels crossed the session and the bus did not notice.
    expect(
      typesOf(watched.envelopes),
      'a watched run must publish exactly the envelopes an unwatched one does — a frame that '
      + 'reached the bus would be persisted to the event log, replayed on every reconnect, and '
      + 'served to any caller who asked for a step timeline (LIVE-03)',
    ).toEqual(typesOf(control.envelopes))
    expect(watched.envelopes.length).toBe(control.envelopes.length)
  })

  it('no envelope type outside the frozen RUN_EVENT_TYPES, and no pixel residue at any depth', async () => {
    const watched = startInstrumentedRun(50)
    await watched.registered
    const seen: number[] = []
    const subscription = watched.session.subscribeFrames(0, (frame) => {
      seen.push(frame.id)
      subscription?.ack(frame.id)
    })
    watched.finish()
    await watched.session.done
    expect(seen.length, 'the frames must have flowed').toBe(50)

    const frozen = new Set<string>(RUN_EVENT_TYPES)
    for (const envelope of watched.envelopes) {
      expect(
        frozen.has(envelope.type),
        `\`${envelope.type}\` is not a member of the frozen RUN_EVENT_TYPES list — this phase mints `
        + 'no bus event for frames, frame acks or stream lifecycle',
      ).toBe(true)
    }
    expect(
      pixelResidueIn(watched.envelopes),
      'no envelope may carry image bytes, a base64 JPEG, or a pixel-shaped key at any depth',
    ).toEqual([])
  })

  it('THE SCANNER CAN SEE — the same predicate fires on a planted envelope', () => {
    // WINDOWS #253's rule. A sweep whose failing branch is only reachable by breaking the product
    // is a sweep nobody has watched fail; each branch is driven here with the residue it exists for.
    const clean = [{ seq: 1, type: 'runStarted', runId: 'r', payload: { memberTestCount: 1 } }] as unknown as RunEventEnvelope[]
    expect(pixelResidueIn(clean), 'a clean envelope stream reads clean').toEqual([])

    const planted = [{
      seq: 2,
      type: 'stepFinalized',
      runId: 'r',
      payload: { step: { evidence: { bytes: Buffer.from(jpegBytes(1)).toString('base64') } } },
    }] as unknown as RunEventEnvelope[]
    const residue = pixelResidueIn(planted)
    expect(residue.some((line) => line.includes('`bytes` key')), 'the `bytes` branch fires').toBe(true)
    expect(residue.some((line) => line.includes('/9j/')), 'the base64-JPEG branch fires').toBe(true)
    expect(residue.some((line) => line.includes('at depth')), 'the depth walk fires').toBe(true)

    // And a frame smuggled under a name the substring scan would miss is still caught by the walk.
    const renamed = [{ seq: 3, type: 'stepStarted', runId: 'r', payload: { deep: { frame: 'anything' } } }] as unknown as RunEventEnvelope[]
    expect(
      pixelResidueIn(renamed).some((line) => line.includes('at depth: frame')),
      'a pixel-shaped key at depth is caught even when the value is not recognisably an image',
    ).toBe(true)
  })
})
