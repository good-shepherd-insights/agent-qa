// RED scaffold (Wave 0, Phase 358 · CYCLE-02 · D-03 · Pattern 3 · LOOP-02). Pins the
// identity-keyed bounded stagnation tree BEFORE the progress module exists. These are
// bounded, per-(anchor,class), reset-on-progress, spec-derived counters — EXPLICITLY NOT a
// resurrected blanket per-step attempt cap (LOOP-02 law). The three distinction cases below
// make that visible: per-(anchor,class) counting, reset-on-progress, and other-anchor-
// unaffected. Bounds are internal exported constants (353's K=2 precedent), injectable via
// constructor options for tests only — never LoopPorts / config.
//
// RED BY DESIGN: `../progress/stagnation-tree` does not exist until Plan 04 — the unresolved
// import IS the intended failure. Pinned API:
//   DEFAULT_STAGNATION_CLASS_BOUND === 2, DEFAULT_STAGNATION_ANCHOR_BOUND === 4
//   buildAnchorKey({ role, nameNormalized, ordinal }) → string
//   new StagnationTree({ classBound?, anchorBound? })
//     .recordNoEffect(anchorKey, class) → { classCount, totalCount, classExhausted, terminal }
//     .reset(anchorKey); .snapshot() → StagnationEvidence-shaped entries
import { describe, it, expect } from 'vitest'
// Plan-04 progress module — intentionally unresolved today (the RED reason for this suite):
import {
  StagnationTree,
  buildAnchorKey,
  DEFAULT_STAGNATION_CLASS_BOUND,
  DEFAULT_STAGNATION_ANCHOR_BOUND,
} from '../progress/stagnation-tree.js'

const A = buildAnchorKey({ role: 'button', nameNormalized: 'delete', ordinal: 0 })
const B = buildAnchorKey({ role: 'button', nameNormalized: 'delete', ordinal: 1 })

describe('DEFAULT bound constants (353 K=2 precedent)', () => {
  it('exports 2 per rung-class and 4 total per anchor (D-03)', () => {
    expect(DEFAULT_STAGNATION_CLASS_BOUND).toBe(2)
    expect(DEFAULT_STAGNATION_ANCHOR_BOUND).toBe(4)
  })
})

describe('StagnationTree — per-(anchor,class) counting (LOOP-02 distinction #1)', () => {
  it('increments per (anchorKey, class); a class exhausts at the class bound', () => {
    const tree = new StagnationTree()
    const first = tree.recordNoEffect(A, 'off-screen')
    expect(first.classCount).toBe(1)
    expect(first.classExhausted).toBe(false)
    const second = tree.recordNoEffect(A, 'off-screen')
    expect(second.classCount).toBe(2)
    expect(second.classExhausted).toBe(true)
    // A DIFFERENT class on the same anchor tracks independently — not a blanket counter.
    const other = tree.recordNoEffect(A, 'obstruction')
    expect(other.classCount).toBe(1)
    expect(other.classExhausted).toBe(false)
  })

  it('reaches terminal at the anchor bound (4 total, spread across classes)', () => {
    const tree = new StagnationTree()
    tree.recordNoEffect(A, 'off-screen')
    tree.recordNoEffect(A, 'off-screen')
    tree.recordNoEffect(A, 'obstruction')
    const terminal = tree.recordNoEffect(A, 'obstruction')
    expect(terminal.totalCount).toBe(4)
    expect(terminal.terminal).toBe(true)
  })
})

describe('StagnationTree — reset-on-progress (LOOP-02 distinction #2)', () => {
  it('reset(anchorKey) clears BOTH per-class and total counts for that anchor', () => {
    const tree = new StagnationTree()
    tree.recordNoEffect(A, 'off-screen')
    tree.recordNoEffect(A, 'obstruction')
    tree.reset(A)
    const afterReset = tree.recordNoEffect(A, 'off-screen')
    expect(afterReset.classCount).toBe(1) // per-class count started fresh
    expect(afterReset.totalCount).toBe(1) // total count started fresh
    expect(afterReset.terminal).toBe(false)
  })
})

describe('StagnationTree — other-anchor-unaffected (LOOP-02 distinction #3)', () => {
  it('a different anchor is completely unaffected by another anchor’s increments', () => {
    const tree = new StagnationTree()
    tree.recordNoEffect(A, 'off-screen')
    tree.recordNoEffect(A, 'off-screen')
    tree.recordNoEffect(A, 'obstruction')
    tree.recordNoEffect(A, 'obstruction') // A is now terminal
    const b = tree.recordNoEffect(B, 'off-screen')
    expect(b.classCount).toBe(1)
    expect(b.totalCount).toBe(1)
    expect(b.terminal).toBe(false)
  })
})

describe('StagnationTree — injectable bounds for tests', () => {
  it('honors constructor-supplied classBound/anchorBound overrides', () => {
    const tree = new StagnationTree({ classBound: 1, anchorBound: 1 })
    const res = tree.recordNoEffect(A, 'off-screen')
    expect(res.classExhausted).toBe(true)
    expect(res.terminal).toBe(true)
  })
})

describe('buildAnchorKey — identity is role|nameNormalized|ordinal, never description/ref', () => {
  it('is stable across description/ref churn while identity is fixed', () => {
    const k1 = buildAnchorKey({ role: 'button', nameNormalized: 'delete', ordinal: 0, description: 'the red trash icon', ref: 'e17' } as never)
    const k2 = buildAnchorKey({ role: 'button', nameNormalized: 'delete', ordinal: 0, description: 'trash button top-right', ref: 'e42' } as never)
    expect(k1).toBe(k2)
    // A different ordinal is a different element.
    expect(buildAnchorKey({ role: 'button', nameNormalized: 'delete', ordinal: 1 })).not.toBe(k1)
  })
})

describe('StagnationTree — snapshot() for the D-07 terminal-fail evidence block', () => {
  it('emits per-anchor state (anchorKey + per-class counts + total)', () => {
    const tree = new StagnationTree()
    tree.recordNoEffect(A, 'off-screen')
    tree.recordNoEffect(A, 'off-screen')
    tree.recordNoEffect(A, 'obstruction')
    const snap = tree.snapshot()
    const entry = snap.find((e) => e.anchorKey === A)
    expect(entry).toBeDefined()
    expect(entry?.total).toBe(3)
    expect(entry?.perClass['off-screen']).toBe(2)
    expect(entry?.perClass['obstruction']).toBe(1)
  })
})
