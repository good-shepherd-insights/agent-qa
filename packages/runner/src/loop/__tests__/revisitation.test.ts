// RED scaffold (Wave 0, Phase 358 · CYCLE-03 · Pattern 4 · Pitfall 4). Pins the W=5
// revisitation window + the combined intervention rule BEFORE the progress module exists.
// The spec-locked rule: NEVER intervene on repetition alone — only when a state is REVISITED
// AND there was NO confirmed task progress across the window. The revisitation key is the
// settle hash + the semantic component (state.url ?? '') — Android native (no url) degrades
// to hash-only (Open Q1); the combined rule keeps that degradation safe.
//
// RED BY DESIGN: `../progress/revisitation` does not exist until Plan 04 — the unresolved
// import IS the intended failure. Pinned API:
//   DEFAULT_REVISITATION_WINDOW === 5
//   buildRevisitationKey(hash, state) → hash + sep + (state.url ?? '')
//   new RevisitationWindow({ window? }).record({ key, progress }) → { flagged }
import { describe, it, expect } from 'vitest'
import type { ScreenState } from '@vostride/agent-qa-schema'
// Plan-04 progress module — intentionally unresolved today (the RED reason for this suite):
import {
  RevisitationWindow,
  buildRevisitationKey,
  DEFAULT_REVISITATION_WINDOW,
} from '../progress/revisitation.js'
import { buildAgentScreenState } from './screen-fixtures.js'

function withUrl(url?: string): ScreenState {
  return buildAgentScreenState(url === undefined ? {} : { url })
}

function feed(seq: { key: string; progress: boolean }[], window = DEFAULT_REVISITATION_WINDOW): boolean {
  const win = new RevisitationWindow({ window })
  let flaggedAny = false
  for (const step of seq) {
    if (win.record(step).flagged) flaggedAny = true
  }
  return flaggedAny
}

describe('DEFAULT_REVISITATION_WINDOW', () => {
  it('is the config-free constant 5', () => {
    expect(DEFAULT_REVISITATION_WINDOW).toBe(5)
  })
})

describe('buildRevisitationKey — hash + semantic component (Open Q1 degradation)', () => {
  it('same hash + different urls ⇒ different keys', () => {
    const a = buildRevisitationKey('HASH', withUrl('https://x.test/a'))
    const b = buildRevisitationKey('HASH', withUrl('https://x.test/b'))
    expect(a).not.toBe(b)
  })

  it('Android native (no url) degrades to hash-only', () => {
    const key = buildRevisitationKey('HASH', withUrl(undefined))
    const sameHashSamePage = buildRevisitationKey('HASH', withUrl(undefined))
    expect(key).toBe(sameHashSamePage)
    expect(key).toContain('HASH')
  })
})

describe('RevisitationWindow — combined rule (revisited AND no progress)', () => {
  it('flags a revisit with zero confirmed progress across the window', () => {
    const flagged = feed([
      { key: 'A', progress: false },
      { key: 'B', progress: false },
      { key: 'A', progress: false }, // A revisited, no progress anywhere in the window
    ])
    expect(flagged).toBe(true)
  })

  it('never flags a revisit when ANY confirmed progress occurred inside the window', () => {
    const flagged = feed([
      { key: 'A', progress: false },
      { key: 'B', progress: true }, // confirmed task progress in-window
      { key: 'A', progress: false }, // A revisited but progress happened ⇒ never a flag
    ])
    expect(flagged).toBe(false)
  })

  it('never flags on repetition alone — all-distinct keys never trip regardless of count', () => {
    const flagged = feed([
      { key: 'A', progress: false },
      { key: 'B', progress: false },
      { key: 'C', progress: false },
      { key: 'D', progress: false },
      { key: 'E', progress: false },
      { key: 'F', progress: false },
    ])
    expect(flagged).toBe(false)
  })

  it('Pitfall 4: hash-identical keys across genuinely different pages with per-iteration progress never flag', () => {
    // The settle hash quantizes into regions, so paginated deletes can hash-collide; the
    // combined rule saves us because each iteration confirms progress.
    const flagged = feed([
      { key: 'HASH', progress: true },
      { key: 'HASH', progress: true },
      { key: 'HASH', progress: true },
      { key: 'HASH', progress: true },
      { key: 'HASH', progress: true },
      { key: 'HASH', progress: true },
    ])
    expect(flagged).toBe(false)
  })
})
