// RED scaffold (Wave 0, Phase 359 · EXEC-01 · D-06/D-07/D-08 · Pattern 2 · spec §12.11/§7.1).
// Pins the pure fill re-read comparator BEFORE Plan 03 implements it. The comparator is the
// platform-neutral verdict machine the three adapters call after clear→type→RE-READ: exact
// compare, then whitespace/digits normalization, then honest failure with the §7.1
// self-correcting error; secure fields verify non-emptiness only and NEVER echo the raw value.
//
// RED BY DESIGN: `../fill-verify.js` does not exist until Plan 03 — the unresolved import IS
// the intended failure (vitest strips types, so the runtime module-resolution error fails the
// whole suite; `tsc -p .` stays green via the @ts-expect-error directive that Plan 03 removes).
//
// Pinned contract (Plan 03 implements to it exactly):
//   compareFillReread({ expected: string; actual: string; secure: boolean })
//     → { ok: boolean; meta: { expected: string; actual: string }; selfCorrectingError?: string }
//   - ok=true on exact / whitespace-collapsed / digits-only-equal / secure-nonempty.
//   - ok=false ⇒ selfCorrectingError = `field reads "<actual>" after typing "<expected>" — re-observe and retry`.
//   - meta.expected/meta.actual are sentinel forms for secure fields (NEVER the raw value).
//   - meta sorted keys are EXACTLY ["actual","expected"] (the 358 oracle byte-pin, D-04).
import { describe, it, expect } from 'vitest'
// Plan-03 fill comparator — intentionally unresolved today (the RED reason for this suite):
// @ts-expect-error module lands in Plan 03 (remove this directive then)
import { compareFillReread } from '../fill-verify.js'

describe('compareFillReread — exact and normalized matches (D-06)', () => {
  it('(1) exact match passes', () => {
    const r = compareFillReread({ expected: 'hello world', actual: 'hello world', secure: false })
    expect(r.ok).toBe(true)
  })

  it('(2) a whitespace-only difference passes via collapse-and-trim normalization', () => {
    const r = compareFillReread({ expected: 'foo bar', actual: 'foo  bar', secure: false })
    expect(r.ok).toBe(true)
  })

  it('(3a) digits-only expected passes despite auto-formatting spaces (card fixture)', () => {
    const r = compareFillReread({
      expected: '4242424242424242',
      actual: '4242 4242 4242 4242',
      secure: false,
    })
    expect(r.ok).toBe(true)
  })

  it('(3b) a non-digit expected with a differing actual does NOT pass through digits normalization', () => {
    const r = compareFillReread({ expected: 'hello', actual: 'h3llo', secure: false })
    expect(r.ok).toBe(false)
  })
})

describe('compareFillReread — real mismatch mints the §7.1 self-correcting error (D-08)', () => {
  it('(4) a genuine value-loss returns not-ok with the exact lowercase/em-dash/imperative form', () => {
    const r = compareFillReread({ expected: 'hello', actual: 'world', secure: false })
    expect(r.ok).toBe(false)
    expect(r.selfCorrectingError).toBe('field reads "world" after typing "hello" — re-observe and retry')
  })
})

const SECRET = 'hunter2-SUPER-secret'
const SECRET_LEN8 = 'passw0rd'

describe('compareFillReread — secure fields verify length only, never leak the value (D-06, T-359-02)', () => {

  it('(5) secure with a non-empty actual passes AND the raw value never appears in the result', () => {
    const r = compareFillReread({ expected: SECRET, actual: SECRET, secure: true })
    expect(r.ok).toBe(true)
    // The whole serialized verdict — meta included — must carry only sentinel forms.
    expect(JSON.stringify(r)).not.toContain(SECRET)
  })

  it('(6) secure with an empty actual fails (nothing landed)', () => {
    const r = compareFillReread({ expected: SECRET, actual: '', secure: true })
    expect(r.ok).toBe(false)
  })
})

describe('compareFillReread — the fillReread meta byte-pin (D-04, 358 oracle seam)', () => {
  it('(7) meta sorted keys are exactly ["actual","expected"] with string values', () => {
    const r = compareFillReread({ expected: 'abc', actual: 'abc', secure: false })
    const meta = r.meta as Record<string, unknown>
    expect(Object.keys(meta).sort()).toEqual(['actual', 'expected'])
    expect(typeof meta['expected']).toBe('string')
    expect(typeof meta['actual']).toBe('string')
  })

  it('(7b) the secure meta keeps the same two-key shape (sentinels, not raw values)', () => {
    const r = compareFillReread({ expected: SECRET_LEN8, actual: SECRET_LEN8, secure: true })
    const meta = r.meta as Record<string, unknown>
    expect(Object.keys(meta).sort()).toEqual(['actual', 'expected'])
    expect(typeof meta['expected']).toBe('string')
    expect(typeof meta['actual']).toBe('string')
    expect(JSON.stringify(meta)).not.toContain(SECRET_LEN8)
  })
})
