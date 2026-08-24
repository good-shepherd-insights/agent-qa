// THE COMPARE DISCIPLINE, MEASURED RATHER THAN GREPPED (Phase 402 plan 06, D-05 · T-402-20).
//
// WHY THIS FILE EXISTS SEPARATELY FROM `run-service-auth-hardening.test.ts`. It replaces
// `node:crypto` for the whole module graph it loads, which is a thing a file may do only if it
// loads almost nothing: the hardening suite boots a database, a dashboard host and a TCP server,
// all of which hash. So the behavioural half of the compare pin lives here, where the only module
// under the mock is the one being measured, and the hardening file states the same claim's SOURCE
// half. Each file's header names the other.
//
// WHY A CALL COUNT AND NOT A SOURCE GREP. This phase has now paid twice for a symbol grep that an
// IMPORT LINE satisfied — 402-01's `grep -c "timingSafeEqual"` answered 2, and 402-03's
// `resolveEffectiveWorkers` pin passed a mutation that replaced the whole expression with a
// literal. A count of `timingSafeEqual` INVOCATIONS observed at run time cannot be satisfied by an
// import, a comment, a JSDoc mention or a dead function: it is the number of times the constant-
// time primitive actually ran while a header was being verified.
//
// WHAT THE THREE NUMBERS DECIDE, stated so a reader knows which mutation each one catches:
//
//   N entries, the FIRST one matching  -> N compares. A `break`/early `return` on hit reads 1.
//   N entries, none matching           -> N compares. The count is match-position-independent.
//   0 entries                          -> 0 compares, and the verdict is still a refusal.
//
// And across all three: the count is never 0 while entries exist, which is what reds an inlined
// `===` — a comparison that never reaches the primitive at all. A SECOND compare site reads 2N.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** Every `timingSafeEqual` invocation this file's module graph makes, in call order. */
const compareCalls: { length: number }[] = []

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>()
  return {
    ...actual,
    timingSafeEqual: (a: NodeJS.ArrayBufferView, b: NodeJS.ArrayBufferView): boolean => {
      compareCalls.push({ length: a.byteLength })
      return actual.timingSafeEqual(a, b)
    },
  }
})

const { matchServiceBearer } = await import('../composition/run-service-token-resolution.js')

const scope = { project: 'acme' } as const

function entries(...values: readonly string[]): {
  name: string
  tokenEnvVar: string
  value: string
  trustScope: { project: string }
}[] {
  return values.map((value, index) => ({
    name: `entry-${String(index)}`,
    tokenEnvVar: `VAR_${String(index)}`,
    value,
    trustScope: scope,
  }))
}

beforeEach(() => { compareCalls.length = 0 })
afterEach(() => { compareCalls.length = 0 })

describe('the constant-time compare is REACHED, once per declared entry (T-402-20)', () => {
  it('compares EVERY entry when the FIRST one matches — the scan does not short-circuit', () => {
    const tokens = entries('first-value-aaaa', 'second-value-bbbb', 'third-value-cccc')
    const verdict = matchServiceBearer('Bearer first-value-aaaa', tokens)

    expect(verdict).toEqual({ kind: 'token', clientId: 'entry-0', trustScope: scope })
    // THE DISCRIMINATING NUMBER. A `break` after the hit reads 1 here and stays green on every
    // other cell in this repository, because the VERDICT is identical either way — the only
    // observable difference is how many comparisons a caller's timing can see.
    expect(compareCalls.length).toBe(tokens.length)
  })

  it('compares EVERY entry when the LAST one matches — the count is position-independent', () => {
    const tokens = entries('first-value-aaaa', 'second-value-bbbb', 'third-value-cccc')
    const verdict = matchServiceBearer('Bearer third-value-cccc', tokens)

    expect(verdict).toEqual({ kind: 'token', clientId: 'entry-2', trustScope: scope })
    expect(compareCalls.length).toBe(tokens.length)
  })

  it('compares EVERY entry when NONE matches', () => {
    const tokens = entries('first-value-aaaa', 'second-value-bbbb', 'third-value-cccc')
    expect(matchServiceBearer('Bearer nothing-like-it', tokens))
      .toEqual({ kind: 'refused', reason: 'invalid_token' })
    expect(compareCalls.length).toBe(tokens.length)
  })

  it('is ONE compare per entry and not two — a second compare site reads twice the entry count', () => {
    for (const count of [1, 2, 3, 5]) {
      compareCalls.length = 0
      const tokens = entries(...Array.from({ length: count }, (_, i) => `value-number-${String(i)}`))
      matchServiceBearer('Bearer value-number-0', tokens)
      // EXACT, on both sides: fewer means a short circuit, more means a second site. Asserted
      // across four list lengths so a constant cannot satisfy it.
      expect(compareCalls.length).toBe(count)
    }
  })

  it('hashes BOTH sides to a fixed width, so the primitive never sees a length difference', () => {
    // `timingSafeEqual` THROWS on unequal lengths, so a bare call over raw secrets would turn every
    // wrong-length token into a 500 and would leak the declared length through the difference.
    matchServiceBearer('Bearer a', entries('a-much-longer-declared-value-here'))
    expect(compareCalls.length).toBe(1)
    // sha256 — 32 bytes, whatever the inputs were.
    expect(compareCalls[0]?.length).toBe(32)
  })

  it('reaches the primitive ZERO times when no entry is declared, and still refuses', () => {
    expect(matchServiceBearer('Bearer anything', []))
      .toEqual({ kind: 'refused', reason: 'invalid_token' })
    expect(compareCalls.length).toBe(0)
  })

  it('reaches the primitive ZERO times for a header that never parsed', () => {
    const tokens = entries('first-value-aaaa', 'second-value-bbbb')
    expect(matchServiceBearer(undefined, tokens))
      .toEqual({ kind: 'refused', reason: 'missing_authorization' })
    expect(matchServiceBearer('Basic abc', tokens))
      .toEqual({ kind: 'refused', reason: 'malformed_authorization' })
    // A malformed header is refused on its own SHAPE, so no credential is ever hashed for it.
    expect(compareCalls.length).toBe(0)
  })
})
