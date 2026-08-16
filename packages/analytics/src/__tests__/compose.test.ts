import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { composeAnalytics, isDoNotTrack } from '../compose.js'
import { NoopTransport } from '../transports.js'
import type { AnalyticsCapturePayload, AnalyticsTransport } from '../port.js'
import type { PosthogTransportFactory, PosthogTransportOptions } from '../transports.js'

const srcDir = join(dirname(fileURLToPath(import.meta.url)), '..')

/** A transport that records what reached it, so "zero attempts" is observed rather than assumed. */
class CountingSink implements AnalyticsTransport {
  readonly captured: AnalyticsCapturePayload[] = []
  flushCount = 0
  shutdownCount = 0

  capture(payload: AnalyticsCapturePayload): void {
    this.captured.push(payload)
  }

  flush(): void {
    this.flushCount += 1
  }

  shutdown(): void {
    this.shutdownCount += 1
  }
}

class ThrowingTransport implements AnalyticsTransport {
  capture(): void {
    throw new Error('capture exploded')
  }

  flush(): Promise<void> {
    return Promise.reject(new Error('flush exploded'))
  }

  shutdown(): Promise<void> {
    return Promise.reject(new Error('shutdown exploded'))
  }
}

/** Records whether the PostHog transport was CONSTRUCTED at all — the structural half of D-19. */
function spyingPosthogFactory(): { factory: PosthogTransportFactory; calls: PosthogTransportOptions[] } {
  const calls: PosthogTransportOptions[] = []
  return {
    calls,
    factory: (options) => {
      calls.push(options)
      return new CountingSink()
    },
  }
}

const ENABLED_KEY = 'phc_test_key'

function sourceFilesUnderSrc(dir: string = srcDir): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      // `__tests__` is excluded for the same reason `packages/arch`'s own scanner excludes it: a
      // cell that drives the decision has to name the variable the decision reads.
      return entry.name === '__tests__' ? [] : sourceFilesUnderSrc(path)
    }
    // `ownership-contract.ts` is the architectural DECLARATION, not runtime code — it is the file
    // that states the rule, so it names the variable the rule is about. `packages/arch` drops the
    // same file from its own specifier scan for the same reason.
    if (!entry.name.endsWith('.ts') || entry.name === 'ownership-contract.ts') return []
    return [path]
  })
}

describe('composeAnalytics — the one opt-out decision (D-19 / ANLY-01)', () => {
  // THE RESOLUTION TABLE. Two independent inputs, and deny wins over both: either one alone opts
  // out, and neither one can opt back IN over the other. The `''`/`'0'`/`'false'` row is the
  // permissive reading RESEARCH A1 flagged as unratified — pinned here so the choice is a fact
  // about the code rather than about whoever reads the spec next.
  it.each([
    { label: 'DO_NOT_TRACK=1', env: { DO_NOT_TRACK: '1' }, config: undefined, optedOut: true },
    { label: 'DO_NOT_TRACK=true', env: { DO_NOT_TRACK: 'true' }, config: undefined, optedOut: true },
    { label: 'DO_NOT_TRACK=yes', env: { DO_NOT_TRACK: 'yes' }, config: undefined, optedOut: true },
    { label: 'DO_NOT_TRACK=""', env: { DO_NOT_TRACK: '' }, config: undefined, optedOut: false },
    { label: 'DO_NOT_TRACK=0', env: { DO_NOT_TRACK: '0' }, config: undefined, optedOut: false },
    { label: 'DO_NOT_TRACK=false', env: { DO_NOT_TRACK: 'false' }, config: undefined, optedOut: false },
    { label: 'DO_NOT_TRACK absent', env: {}, config: undefined, optedOut: false },
    { label: 'privacy false', env: {}, config: { analytics: { privacy: false } }, optedOut: false },
    { label: 'privacy true alone', env: {}, config: { analytics: { privacy: true } }, optedOut: true },
    {
      label: 'both set — deny wins',
      env: { DO_NOT_TRACK: '1' },
      config: { analytics: { privacy: true } },
      optedOut: true,
    },
    {
      label: 'privacy true while DO_NOT_TRACK=0 — deny still wins',
      env: { DO_NOT_TRACK: '0' },
      config: { analytics: { privacy: true } },
      optedOut: true,
    },
  ])('$label resolves optedOut=$optedOut', ({ env, config, optedOut }) => {
    const sink = new CountingSink()
    const composed = composeAnalytics({ env, config, projectKey: ENABLED_KEY, transportOverride: sink })

    expect(composed.optedOut).toBe(optedOut)
    expect(composed.transportKind).toBe(optedOut ? 'noop' : 'posthog')
    expect(composed.transport instanceof NoopTransport).toBe(optedOut)
  })

  it('names WHICH input opted out, and reports both when both did', () => {
    expect(composeAnalytics({ env: { DO_NOT_TRACK: '1' } }).optOutReasons).toEqual(['do-not-track'])
    expect(composeAnalytics({ config: { analytics: { privacy: true } } }).optOutReasons).toEqual([
      'config-privacy',
    ])
    expect(
      composeAnalytics({
        env: { DO_NOT_TRACK: '1' },
        config: { analytics: { privacy: true } },
      }).optOutReasons,
    ).toEqual(['do-not-track', 'config-privacy'])
    expect(composeAnalytics({ env: {} }).optOutReasons).toEqual([])
  })

  // THE STRUCTURAL CLAIM, and the one a `disabled` boolean cannot make. It is not that the PostHog
  // transport declines to send when opted out — it is that no PostHog transport was ever built, so
  // the process holds no live client for a later code path to find.
  it('opted out constructs NO PostHog transport at all', () => {
    const spy = spyingPosthogFactory()
    const composed = composeAnalytics({
      env: { DO_NOT_TRACK: '1' },
      projectKey: ENABLED_KEY,
      posthogTransportFactory: spy.factory,
    })

    expect(spy.calls).toEqual([])
    expect(composed.transport instanceof NoopTransport).toBe(true)
  })

  it('opted in constructs the PostHog transport exactly once, with the resolved key and host', () => {
    const spy = spyingPosthogFactory()
    composeAnalytics({
      env: {},
      projectKey: ENABLED_KEY,
      projectHost: 'https://sink.invalid',
      posthogTransportFactory: spy.factory,
    })

    expect(spy.calls.length).toBe(1)
    expect(spy.calls[0]?.projectKey).toBe(ENABLED_KEY)
    expect(spy.calls[0]?.host).toBe('https://sink.invalid')
  })

  // A transport handed in by a caller must not be able to undo the decision. If the override were
  // honoured on the opted-out arm it would be a second door onto the wire, which is the exact shape
  // D-19 exists to remove.
  it('an opted-out composition ignores a transport override entirely', async () => {
    const sink = new CountingSink()
    const composed = composeAnalytics({
      env: { DO_NOT_TRACK: '1' },
      projectKey: ENABLED_KEY,
      transportOverride: sink,
    })

    composed.port.capture({ name: 'agent-qa.probe', properties: {} })
    await composed.port.flush()

    expect(sink.captured).toEqual([])
    expect(sink.flushCount).toBe(0)
    expect(composed.transport instanceof NoopTransport).toBe(true)
  })

  // An empty project key is not an opt-out — it is nothing to send TO. Kept distinct because
  // conflating them would report a developer checkout as a user who declined.
  it('an empty project key yields a noop transport without claiming the user opted out', () => {
    const spy = spyingPosthogFactory()
    const composed = composeAnalytics({ env: {}, projectKey: '   ', posthogTransportFactory: spy.factory })

    expect(composed.optedOut).toBe(false)
    expect(composed.optOutReasons).toEqual([])
    expect(composed.transportKind).toBe('noop')
    expect(spy.calls).toEqual([])
  })

  // THE DECISION SITE IS SINGULAR, asserted over the package's own source rather than promised in a
  // comment. A second file reading the variable is a second answer to the question.
  it('no module outside compose.ts reads the opt-out environment variable', () => {
    const readers = sourceFilesUnderSrc()
      .filter((file) => readFileSync(file, 'utf8').includes('DO_NOT_TRACK'))
      .map((file) => file.slice(srcDir.length + 1))

    expect(readers).toEqual(['compose.ts'])
  })
})

describe('isDoNotTrack — the permissive reading, pinned (RESEARCH A1)', () => {
  it.each([
    ['1', true],
    ['true', true],
    ['TRUE', true],
    ['on', true],
    ['  1  ', true],
    ['', false],
    ['   ', false],
    ['0', false],
    ['false', false],
    ['FALSE', false],
    [undefined, false],
  ])('isDoNotTrack(%o) === %s', (value, expected) => {
    expect(isDoNotTrack(value)).toBe(expected)
  })
})

describe('AnalyticsPort — best-effort boundary and the empty queue (T-398-08, edge ANLY-01/empty)', () => {
  it('never throws into the host, whatever the transport does', async () => {
    const composed = composeAnalytics({
      env: {},
      projectKey: ENABLED_KEY,
      transportOverride: new ThrowingTransport(),
    })

    expect(() => composed.port.capture({ name: 'agent-qa.probe', properties: {} })).not.toThrow()
    await expect(composed.port.flush()).resolves.toBeUndefined()
    await expect(composed.port.shutdown()).resolves.toBeUndefined()
  })

  // MEASURED, not assumed (398-03 mutation leg M6). The cell above was VACUOUS for the synchronous
  // guard: `ThrowingTransport.capture` is reached from inside an async body, so its throw is
  // already a rejected promise and the `.catch` handles it — deleting `capture`'s try/catch
  // outright left all 32 cells green. The only thing that can throw SYNCHRONOUSLY out of `capture`
  // is the identity resolver, so that is what this drives. Plan 06 re-homes the real resolver, and
  // the real one reads a file.
  it('swallows a SYNCHRONOUS throw out of the identity resolver', () => {
    const sink = new CountingSink()
    const composed = composeAnalytics({
      env: {},
      projectKey: ENABLED_KEY,
      transportOverride: sink,
      identity: () => {
        throw new Error('identity store unreadable')
      },
    })

    expect(() => composed.port.capture({ name: 'agent-qa.probe', properties: {} })).not.toThrow()
    expect(sink.captured).toEqual([])
  })

  // The other half of the same boundary: a capture whose transport rejects and which is NEVER
  // flushed must not surface as an unhandled rejection. A host that emits on a path it does not
  // await is the normal case, so "nobody called flush" is not an unusual state to be in.
  it('a captured event whose transport rejects, never flushed, raises no unhandled rejection', async () => {
    const seen: unknown[] = []
    const listener = (reason: unknown): void => {
      seen.push(reason)
    }
    process.on('unhandledRejection', listener)
    try {
      const composed = composeAnalytics({
        env: {},
        projectKey: ENABLED_KEY,
        transportOverride: new ThrowingTransport(),
      })
      composed.port.capture({ name: 'agent-qa.probe', properties: {} })
      // Two macrotask turns: Node reports an unhandled rejection at the end of the turn in which
      // the promise settled with no handler attached.
      await new Promise((resolve) => setTimeout(resolve, 0))
      await new Promise((resolve) => setTimeout(resolve, 0))
    } finally {
      process.off('unhandledRejection', listener)
    }

    expect(seen).toEqual([])
  })

  it('flush on an empty queue makes NO call on the transport and still resolves', async () => {
    const sink = new CountingSink()
    const composed = composeAnalytics({ env: {}, projectKey: ENABLED_KEY, transportOverride: sink })

    await expect(composed.port.flush()).resolves.toBeUndefined()

    expect(sink.captured).toEqual([])
    expect(sink.flushCount).toBe(0)
  })

  it('flush after a capture reaches the transport exactly once', async () => {
    const sink = new CountingSink()
    const composed = composeAnalytics({ env: {}, projectKey: ENABLED_KEY, transportOverride: sink })

    composed.port.capture({ name: 'agent-qa.probe', properties: { surface: 'cli' } })
    await composed.port.flush()

    expect(sink.captured.map((payload) => payload.event.name)).toEqual(['agent-qa.probe'])
    expect(sink.captured[0]?.distinctId).toBe('anonymous')
    expect(sink.flushCount).toBe(1)

    // And a second flush with nothing new captured is a no-op again — the counter resets with the
    // queue, so "empty" is a property of the interval rather than of the port's whole lifetime.
    await composed.port.flush()
    expect(sink.flushCount).toBe(1)
  })

  it('shutdown reaches the transport even when nothing was ever captured', async () => {
    const sink = new CountingSink()
    const composed = composeAnalytics({ env: {}, projectKey: ENABLED_KEY, transportOverride: sink })

    await composed.port.shutdown()

    expect(sink.shutdownCount).toBe(1)
    expect(sink.flushCount).toBe(0)
  })
})
