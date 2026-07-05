// RED scaffold (Wave 0, Phase 358 · CYCLE-01 · D-05/D-06 · Pattern 1). Pins the per-verb
// intended-effect oracle table with signal-presence degradation BEFORE any progress module
// exists. `evaluateLocalEffect` is a PURE diff function over (action N's stateBefore, the
// fresh settled observation) — it takes NO action-history input, so byte-identical repeats
// are each judged only on their own diff (CYCLE-01 never-flag-on-repetition is structural).
//
// RED BY DESIGN: `../progress/oracle` does not exist until Plan 04. The failing reason must
// be exactly the unresolved import (missing module) — never a fixture/type defect. The five
// §12.16(a) rows plus the hash fallback are pinned to the exact API names Plan 04 implements:
//   evaluateLocalEffect({ action, anchor?, stateBefore, stateAfter, prevHash, currentHash,
//                         actionResult? }) → { verbClass, oracle, achieved }
// where `oracle` names which row fired ('scroll' | 'tap' | 'navigate' | 'fill' |
// 'hash-fallback') — the D-07 localEffect vocabulary. A row with no signal degrades to the
// hash fallback (D-06); the fill row's §12.11 re-read probe lands via
// `actionResult.metadata.fillReread = { expected, actual }` (Phase 359 populates it; hash
// fallback until then).
import { describe, it, expect } from 'vitest'
import { screenIdentityHash, type ScreenState } from '@vostride/agent-qa-schema'
import type { ActionResult } from '../../platform.js'
// Plan-04 progress module — intentionally unresolved today (the RED reason for this suite):
import { evaluateLocalEffect, type LocalEffectResult } from '../progress/oracle.js'
import { buildAgentScreenState, type LooseElement } from './screen-fixtures.js'

const VIEWPORT = { coordSpace: 'viewport' as const, viewportWidth: 390, viewportHeight: 844 }

function state(elements: LooseElement[], overrides: Parameters<typeof buildAgentScreenState>[0] = {}): ScreenState {
  return buildAgentScreenState({
    elements,
    metadata: { ...VIEWPORT, ...(overrides.metadata ?? {}) },
    ...overrides,
  })
}

const listItem = (name: string, y: number): LooseElement => ({
  role: 'button',
  name,
  bounds: { x: 20, y, width: 350, height: 44 },
})

function hashes(before: ScreenState, after: ScreenState): { prevHash: string; currentHash: string } {
  return { prevHash: screenIdentityHash(before), currentHash: screenIdentityHash(after) }
}

describe('evaluateLocalEffect — scroll row (§12.12 changed-tree = progress)', () => {
  it('achieved when metadata.scroll offset delta moved', () => {
    const before = state([listItem('Row A', 100)], { metadata: { ...VIEWPORT, scroll: { offsetX: 0, offsetY: 0, contentWidth: 390, contentHeight: 2000 } } })
    const after = state([listItem('Row A', 100)], { metadata: { ...VIEWPORT, scroll: { offsetX: 0, offsetY: 600, contentWidth: 390, contentHeight: 2000 } } })
    const res: LocalEffectResult = evaluateLocalEffect({ action: { type: 'scroll', scrollType: 'vertical', value: 600 }, stateBefore: before, stateAfter: after, ...hashes(before, after) })
    expect(res.verbClass).toBe('scroll')
    expect(res.oracle).toBe('scroll')
    expect(res.achieved).toBe(true)
  })

  it('achieved when offsets are unchanged but the visible element set changed (virtualized list)', () => {
    const scroll = { offsetX: 0, offsetY: 0, contentWidth: 390, contentHeight: 2000 }
    const before = state([listItem('Row 1', 100), listItem('Row 2', 150)], { metadata: { ...VIEWPORT, scroll } })
    const after = state([listItem('Row 9', 100), listItem('Row 10', 150)], { metadata: { ...VIEWPORT, scroll } })
    const res = evaluateLocalEffect({ action: { type: 'scroll', scrollType: 'vertical', value: 600 }, stateBefore: before, stateAfter: after, ...hashes(before, after) })
    expect(res.oracle).toBe('scroll')
    expect(res.achieved).toBe(true)
  })

  it('degrades to hash fallback when no scroll signal changed', () => {
    const scroll = { offsetX: 0, offsetY: 0, contentWidth: 390, contentHeight: 844 }
    const before = state([listItem('Row A', 100)], { metadata: { ...VIEWPORT, scroll } })
    const after = state([listItem('Row A', 100)], { metadata: { ...VIEWPORT, scroll } })
    const res = evaluateLocalEffect({ action: { type: 'scroll', scrollType: 'vertical', value: 600 }, stateBefore: before, stateAfter: after, ...hashes(before, after) })
    expect(res.oracle).toBe('hash-fallback')
    expect(res.achieved).toBe(false)
  })
})

describe('evaluateLocalEffect — tap/click checkable row', () => {
  const anchor = { role: 'checkbox', nameNormalized: 'accept terms', ordinal: 0 }
  const checkbox = (checked: boolean): LooseElement => ({ role: 'checkbox', name: 'Accept terms', bounds: { x: 20, y: 100, width: 40, height: 40 }, state: { checked } })

  it('achieved when the target checked state flips', () => {
    const before = state([checkbox(false)])
    const after = state([checkbox(true)])
    const res = evaluateLocalEffect({ action: { type: 'tap', ref: 'e1' }, anchor, stateBefore: before, stateAfter: after, ...hashes(before, after) })
    expect(res.verbClass).toBe('tap')
    expect(res.oracle).toBe('tap')
    expect(res.achieved).toBe(true)
  })

  it('achieved when the anchored target is no longer resolvable (dismissed)', () => {
    const before = state([checkbox(false)])
    const after = state([listItem('Something else', 300)])
    const res = evaluateLocalEffect({ action: { type: 'tap', ref: 'e1' }, anchor, stateBefore: before, stateAfter: after, ...hashes(before, after) })
    expect(res.oracle).toBe('tap')
    expect(res.achieved).toBe(true)
  })

  it('degrades to hash fallback when the target is non-checkable and unchanged', () => {
    const label = (): LooseElement => ({ role: 'text', name: 'Static label', bounds: { x: 20, y: 100, width: 200, height: 20 } })
    const before = state([label()])
    const after = state([label()])
    const res = evaluateLocalEffect({ action: { type: 'tap', ref: 'e1' }, anchor: { role: 'text', nameNormalized: 'static label', ordinal: 0 }, stateBefore: before, stateAfter: after, ...hashes(before, after) })
    expect(res.oracle).toBe('hash-fallback')
    expect(res.achieved).toBe(false)
  })
})

describe('evaluateLocalEffect — navigate row', () => {
  it('achieved when ScreenState.url changed', () => {
    const before = state([listItem('Home', 100)], { url: 'https://example.test/a' })
    const after = state([listItem('Home', 100)], { url: 'https://example.test/b' })
    const res = evaluateLocalEffect({ action: { type: 'navigate', url: 'https://example.test/b' }, stateBefore: before, stateAfter: after, ...hashes(before, after) })
    expect(res.verbClass).toBe('navigate')
    expect(res.oracle).toBe('navigate')
    expect(res.achieved).toBe(true)
  })

  it('degrades to hash fallback when url is absent on both states (Android native, Open Q1)', () => {
    const before = state([listItem('Home', 100)])
    const after = state([listItem('Home', 100)])
    const res = evaluateLocalEffect({ action: { type: 'navigate', url: 'about:blank' }, stateBefore: before, stateAfter: after, ...hashes(before, after) })
    expect(res.oracle).toBe('hash-fallback')
    expect(res.achieved).toBe(false)
  })
})

describe('evaluateLocalEffect — fill row (§12.11 re-read probe; Phase 359 populates)', () => {
  const field = (value: string): LooseElement => ({ role: 'textbox', name: 'Email', value, bounds: { x: 20, y: 100, width: 300, height: 44 } })

  it('achieved when the re-read annotation value matches', () => {
    const before = state([field('')])
    const after = state([field('a@b.co')])
    const actionResult: ActionResult = { success: true, metadata: { fillReread: { expected: 'a@b.co', actual: 'a@b.co' } } }
    const res = evaluateLocalEffect({ action: { type: 'fill', ref: 'e1', value: 'a@b.co' }, stateBefore: before, stateAfter: after, actionResult, ...hashes(before, after) })
    expect(res.verbClass).toBe('fill')
    expect(res.oracle).toBe('fill')
    expect(res.achieved).toBe(true)
  })

  it('absent when the re-read annotation value mismatches', () => {
    const before = state([field('')])
    const after = state([field('typo')])
    const actionResult: ActionResult = { success: true, metadata: { fillReread: { expected: 'a@b.co', actual: 'typo' } } }
    const res = evaluateLocalEffect({ action: { type: 'fill', ref: 'e1', value: 'a@b.co' }, stateBefore: before, stateAfter: after, actionResult, ...hashes(before, after) })
    expect(res.oracle).toBe('fill')
    expect(res.achieved).toBe(false)
  })

  it('degrades to hash fallback when no re-read annotation is present', () => {
    const before = state([field('')])
    const after = state([field('a@b.co')])
    const res = evaluateLocalEffect({ action: { type: 'fill', ref: 'e1', value: 'a@b.co' }, stateBefore: before, stateAfter: after, actionResult: { success: true }, ...hashes(before, after) })
    expect(res.oracle).toBe('hash-fallback')
    expect(res.achieved).toBe(true) // hashes differ ⇒ progress via the fallback
  })
})

describe('evaluateLocalEffect — hash fallback row', () => {
  it('achieved when prevHash !== currentHash, absent when equal', () => {
    const before = state([listItem('X', 100)])
    const changed = state([listItem('Y', 100)])
    const same = state([listItem('X', 100)])
    const achieved = evaluateLocalEffect({ action: { type: 'keypress', keys: ['Enter'] }, stateBefore: before, stateAfter: changed, ...hashes(before, changed) })
    const absent = evaluateLocalEffect({ action: { type: 'keypress', keys: ['Enter'] }, stateBefore: before, stateAfter: same, ...hashes(before, same) })
    expect(achieved.oracle).toBe('hash-fallback')
    expect(achieved.achieved).toBe(true)
    expect(absent.oracle).toBe('hash-fallback')
    expect(absent.achieved).toBe(false)
  })
})

describe('evaluateLocalEffect — no action-history input (CYCLE-01 structural)', () => {
  it('judges two byte-identical consecutive actions only on their own diff', () => {
    const s1 = state([listItem('Row A', 100)])
    const s2 = state([listItem('Row B', 100)]) // first action produced an effect
    const s3 = state([listItem('Row B', 100)]) // second identical action produced none

    const first = evaluateLocalEffect({ action: { type: 'tap', ref: 'e1' }, stateBefore: s1, stateAfter: s2, ...hashes(s1, s2) })
    const second = evaluateLocalEffect({ action: { type: 'tap', ref: 'e1' }, stateBefore: s2, stateAfter: s3, ...hashes(s2, s3) })

    // The second call never "remembers" the first — repetition alone is never a flag; the
    // absence is purely the second diff being empty.
    expect(first.achieved).toBe(true)
    expect(second.achieved).toBe(false)
  })
})
