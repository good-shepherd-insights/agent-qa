// Pure fill re-read comparator (Phase 359 · EXEC-01 · D-06/D-07/D-08 · spec §12.11/§7.1).
//
// CRITICAL: provider-neutral + storage-neutral. No driver imports, no node:* imports — the
// platform-neutral verdict machine the three adapters call after clear→type→RE-READ. Exact
// compare first, then whitespace-collapse, then digits-only re-compare (auto-formatting inputs
// like card numbers); a genuine value-loss mints the §7.1 self-correcting error. Secure fields
// verify non-emptiness only and NEVER echo the raw value — meta carries length sentinels so the
// 358 oracle's expected===actual comparison still yields an honest verdict without leaking
// (T-359-02). No internal retry (D-08) — the comparator only reports; the 358 ladder mediates.

import type { FillRereadMeta } from './metadata.js'

export interface FillVerifyInput {
  expected: string
  actual: string
  secure: boolean
}

export interface FillVerifyResult {
  ok: boolean
  meta: FillRereadMeta
  selfCorrectingError?: string
}

export function compareFillReread(input: FillVerifyInput): FillVerifyResult {
  const { expected, actual, secure } = input

  if (secure) {
    const ok = actual.length > 0
    const expectedSentinel = `<len:${expected.length}>`
    // On a hit, mirror the sentinel so the oracle's expected===actual read stays honest;
    // on a miss (nothing landed) let the length sentinels differ so the mismatch propagates.
    const actualSentinel = ok ? expectedSentinel : `<len:${actual.length}>`
    return buildResult(ok, expectedSentinel, actualSentinel)
  }

  return matches(expected, actual)
    ? buildResult(true, expected, actual)
    : buildResult(false, expected, actual)
}

function matches(expected: string, actual: string): boolean {
  if (actual === expected) return true
  const collapse = (s: string): string => s.replace(/\s+/g, ' ').trim()
  if (collapse(actual) === collapse(expected)) return true
  // Digits-only normalization applies ONLY when the typed text (minus whitespace) is all digits
  // — card/OTP/date auto-formatting inserts separators the field owns.
  if (/^\d+$/.test(expected.replace(/\s/g, ''))) {
    const digits = (s: string): string => s.replace(/\D+/g, '')
    if (digits(actual) === digits(expected)) return true
  }
  return false
}

function buildResult(ok: boolean, metaExpected: string, metaActual: string): FillVerifyResult {
  const meta: FillRereadMeta = { expected: metaExpected, actual: metaActual }
  if (ok) return { ok: true, meta }
  return {
    ok: false,
    meta,
    selfCorrectingError: `field reads "${metaActual}" after typing "${metaExpected}" — re-observe and retry`,
  }
}
