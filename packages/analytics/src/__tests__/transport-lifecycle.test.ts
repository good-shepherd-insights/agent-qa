// The transport's flush/shutdown split, measured on ONE composition (Phase 398 plan 15 · CR-01).
//
// WHY THIS FILE EXISTS, AND WHY NOTHING ELSE COULD SEE THE DEFECT. Every other cell that builds a
// PostHog transport constructs a fresh one per send (`masking-seam.test.ts`, `network-differential
// .test.ts`), so a flush that tears the client down looks identical to a flush that flushes: the
// composition is discarded straight afterwards either way. The claim `port.ts:49-51` makes is about
// what happens to the SECOND event on the SAME composition, so that is what this cell drives.

import { describe, expect, it } from 'vitest'

import { createAnalyticsPort } from '../port.js'
import { createPosthogTransport } from '../transports.js'
import type { PosthogAnalyticsClient } from '../transports.js'

interface CountingClient extends PosthogAnalyticsClient {
  readonly capturedEvents: string[]
  /** The client's shutdown count observed AT each capture — the ordinal fact, recorded not inferred. */
  readonly shutdownCountAtCapture: number[]
  readonly counts: { capture: number; flush: number; shutdown: number }
}

function countingClient(): CountingClient {
  const counts = { capture: 0, flush: 0, shutdown: 0 }
  const capturedEvents: string[] = []
  const shutdownCountAtCapture: number[] = []
  return {
    counts,
    capturedEvents,
    shutdownCountAtCapture,
    capture(input) {
      counts.capture += 1
      capturedEvents.push(input.event)
      shutdownCountAtCapture.push(counts.shutdown)
    },
    flush() {
      counts.flush += 1
    },
    shutdown() {
      counts.shutdown += 1
    },
  }
}

/** The SHIPPED transport under the SHIPPED port — the seam a user's events actually cross. */
function composeOverCountingClient(): { client: CountingClient; port: ReturnType<typeof createAnalyticsPort> } {
  const client = countingClient()
  const transport = createPosthogTransport({
    projectKey: 'phc_test_key',
    host: 'https://analytics.invalid',
    client,
  })
  return {
    client,
    port: createAnalyticsPort({
      transport,
      identity: () => ({ distinctId: 'u_lifecycle' }),
    }),
  }
}

describe('the transport lifecycle on ONE composition (398-15, CR-01)', () => {
  it('flushes the client at each boundary and shuts it down exactly once, at the end', async () => {
    const { client, port } = composeOverCountingClient()

    port.capture({ name: 'agent-qa.explain.answered', properties: { cited_row_count: 1 } })
    await port.flush()
    port.capture({ name: 'agent-qa.explain.answered', properties: { cited_row_count: 2 } })
    await port.flush()
    await port.shutdown()

    expect(
      client.counts.flush,
      "the transport's per-boundary flush did not reach the client's own flush — a flush that calls "
      + 'shutdown is a mid-session teardown, which is the failure mode port.ts:49-51 names',
    ).toBe(2)
    expect(
      client.counts.shutdown,
      'the client was shut down more than once (or not at exit): shutdown is reserved for the '
      + `single teardown, and this composition saw ${client.counts.shutdown}`,
    ).toBe(1)
    expect(client.capturedEvents).toEqual([
      'agent-qa.explain.answered',
      'agent-qa.explain.answered',
    ])
    // THE ORDINAL FACT, asserted directly rather than inferred from the totals: the second event
    // was handed to a client that had not been torn down between the two flushes.
    expect(
      client.shutdownCountAtCapture,
      'an event reached a client that had already been shut down — the mid-session teardown is '
      + `still there: shutdown counts observed at each capture were [${client.shutdownCountAtCapture.join(', ')}]`,
    ).toEqual([0, 0])
  })

  it('preserves EDGE ANLY-01/empty: a flush with nothing captured touches the client not at all', async () => {
    const { client, port } = composeOverCountingClient()

    await port.flush()

    expect(client.counts).toEqual({ capture: 0, flush: 0, shutdown: 0 })
  })
})
