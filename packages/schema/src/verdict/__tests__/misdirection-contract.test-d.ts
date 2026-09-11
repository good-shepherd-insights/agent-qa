// The 422 circularity-evidence vocabularies, and the eight-class floor they did NOT move.
//
// Three closed sets arrive with D-17/D-19/D-20 — two memory trust words, the four CrossCheck
// words REUSED from the gate receipts rather than re-minted, and a single optional backing
// literal — and each is pinned in BOTH directions here: forward, that the runtime list carries
// no member the type lacks, and reverse, that the type carries no member the runtime list
// lacks. A one-directional pin is satisfied by a set that grew, which is exactly the failure a
// closed vocabulary exists to prevent (the v54 reverse-membership bar, 416 D-02).
//
// THE ASSERTIONS SIT INSIDE `test` BLOCKS ON PURPOSE. A `.test-d.ts` whose assertions are all
// top-level still TYPECHECKS, but vitest reports "no tests" for it — and a type oracle that
// executes nothing is indistinguishable from one that was never wired up. Every cell below is
// counted, so a run that reports zero is a real failure rather than a silent pass.
//
// THE NEVER-BARS ARE HAND-SPELLED. `Extract<T, 'x'>` reading `never` is the only assertion that
// REDs when someone later adds `'x'`, and the words chosen are the plausible near-misses: a
// trust word this plan considered and refused, a cross-check spelling another wall already
// forbids, and a backing word that would turn an ABSENCE marker into a quality grade.
//
// THE EIGHT-CLASS FLOOR IS SPELLED BY HAND TOO, not derived from VERDICT_CLASSES. Deriving it
// would make this cell agree with the constant by construction and prove nothing: a ninth class
// added to the constant would flow straight through. The point is a second, INDEPENDENT
// spelling that REDs when the union moves — 422 widened the verdict by exactly two additive
// optional members and moved no class.
//
// The negative controls (`@ts-expect-error`) are the oracle's own proof that it bites: each one
// states a claim that is FALSE, and TypeScript errors on the suppression comment itself if the
// claim ever becomes true — so a vacuous pin cannot hide here.

import { describe, expectTypeOf, test } from 'vitest'

import { CROSS_CHECKS } from '../../knowledge/gate-receipt'
import type { CrossCheck } from '../../knowledge/gate-receipt'
import { MEMORY_ON_PATH_TRUSTS, MISDIRECTION_BACKINGS } from '../misdirection-evidence'
import type {
  MemoryOnPathEntry,
  MemoryOnPathTrust,
  MisdirectionAggregate,
  MisdirectionBacking,
  MisdirectionEvidence,
  MisdirectionRecordResult,
  MisdirectionRootPosture,
} from '../misdirection-evidence'
import { VERDICT_CLASSES } from '../verdict'
import type { Verdict, VerdictClass } from '../verdict'

describe('the two memory trust words', () => {
  test('are closed in both directions', () => {
    expectTypeOf<
      Exclude<MemoryOnPathTrust, (typeof MEMORY_ON_PATH_TRUSTS)[number]>
    >().toEqualTypeOf<never>()
    expectTypeOf<
      Exclude<(typeof MEMORY_ON_PATH_TRUSTS)[number], MemoryOnPathTrust>
    >().toEqualTypeOf<never>()
    expectTypeOf<MemoryOnPathTrust>().toEqualTypeOf<'candidate' | 'low-trust-active'>()
  })

  test('bar the near-misses this plan considered and refused', () => {
    // Trust here is a DECLARED store marker, never a minted grade: no numeric band name, no
    // promotion word, and not the serving mechanism's own name either.
    expectTypeOf<Extract<MemoryOnPathTrust, 'low-trust'>>().toEqualTypeOf<never>()
    expectTypeOf<Extract<MemoryOnPathTrust, 'promoted'>>().toEqualTypeOf<never>()
    expectTypeOf<Extract<MemoryOnPathTrust, 'canary'>>().toEqualTypeOf<never>()
  })

  test('refuse a trust word outside the two — the oracle bites', () => {
    // @ts-expect-error 'canary' is not a memory trust word; the entry below must not compile.
    const bad: MemoryOnPathEntry = { recordId: 'r' as never, trust: 'canary' }
    expectTypeOf(bad).toEqualTypeOf<MemoryOnPathEntry>()
  })
})

describe('the four cross-check words', () => {
  test('are the gate receipts own set, reused and not re-minted', () => {
    expectTypeOf<Exclude<CrossCheck, (typeof CROSS_CHECKS)[number]>>().toEqualTypeOf<never>()
    expectTypeOf<Exclude<(typeof CROSS_CHECKS)[number], CrossCheck>>().toEqualTypeOf<never>()
    expectTypeOf<CrossCheck>().toEqualTypeOf<'flipped' | 'held' | 'inconclusive' | 'not-run'>()
  })

  test('are the exact vocabulary the block and every row speak', () => {
    expectTypeOf<MisdirectionEvidence['crossCheck']>().toEqualTypeOf<CrossCheck>()
    expectTypeOf<MisdirectionRecordResult['crossCheck']>().toEqualTypeOf<CrossCheck>()
  })

  test('were not widened by this plan', () => {
    expectTypeOf<Extract<CrossCheck, 'not_run'>>().toEqualTypeOf<never>()
    expectTypeOf<Extract<CrossCheck, 'unchecked'>>().toEqualTypeOf<never>()
  })
})

describe('the backing literal', () => {
  test('is closed in both directions to one absence marker', () => {
    expectTypeOf<
      Exclude<MisdirectionBacking, (typeof MISDIRECTION_BACKINGS)[number]>
    >().toEqualTypeOf<never>()
    expectTypeOf<
      Exclude<(typeof MISDIRECTION_BACKINGS)[number], MisdirectionBacking>
    >().toEqualTypeOf<never>()
    expectTypeOf<MisdirectionBacking>().toEqualTypeOf<'declared-only'>()
  })

  test('is never a quality grade, and is OPTIONAL on the block', () => {
    expectTypeOf<Extract<MisdirectionBacking, 'measured'>>().toEqualTypeOf<never>()
    expectTypeOf<Extract<MisdirectionBacking, 'cross-checked'>>().toEqualTypeOf<never>()
    expectTypeOf<MisdirectionEvidence['backing']>().toEqualTypeOf<
      MisdirectionBacking | undefined
    >()
  })

  test('names exactly three root postures, and BYOM is not one of them', () => {
    // D-19 turns on ABSENCE versus BREAKAGE, so the posture set spells both; the funding
    // arrangement a reader might call this case is not a posture the validator can check.
    expectTypeOf<MisdirectionRootPosture>().toEqualTypeOf<
      'eval-root' | 'no-eval-root' | 'broken-eval-root'
    >()
    expectTypeOf<Extract<MisdirectionRootPosture, 'byom'>>().toEqualTypeOf<never>()
  })
})

describe('the aggregate arms', () => {
  test('are exactly four, with one holding arm', () => {
    expectTypeOf<MisdirectionAggregate['outcome']>().toEqualTypeOf<
      'held' | 'flipped' | 'unknown' | 'evidence-refused'
    >()
    expectTypeOf<Extract<MisdirectionAggregate['outcome'], 'ruled-out'>>().toEqualTypeOf<never>()
  })

  test('disclose every unresolved sibling by name, never as a bare flag', () => {
    expectTypeOf<keyof Extract<MisdirectionAggregate, { outcome: 'unknown' }>>().toEqualTypeOf<
      'outcome' | 'inconclusive' | 'notRun' | 'unchecked'
    >()
    expectTypeOf<
      Extract<MisdirectionAggregate, { outcome: 'flipped' }>['suspect']
    >().toEqualTypeOf<readonly VerdictSuspect[]>()
  })
})

/** Local alias so the suspect-list element type is named once, at the assertion. */
type VerdictSuspect = MemoryOnPathEntry['recordId']

describe('the verdict floor', () => {
  // A SECOND, independent statement of the closed set (see the header).
  type EightClasses =
    | 'test_bug'
    | 'app_bug'
    | 'environment'
    | 'flake'
    | 'config_error'
    | 'llm_error'
    | 'unknown'
    | 'timeout'

  test('is still exactly the eight classes, hand-spelled', () => {
    expectTypeOf<VerdictClass>().toEqualTypeOf<EightClasses>()
    expectTypeOf<Verdict['class']>().toEqualTypeOf<EightClasses>()
    expectTypeOf<Exclude<VerdictClass, (typeof VERDICT_CLASSES)[number]>>().toEqualTypeOf<never>()
    expectTypeOf<Exclude<(typeof VERDICT_CLASSES)[number], VerdictClass>>().toEqualTypeOf<never>()
  })

  test('grew no ninth class under any name this plan might have reached for', () => {
    expectTypeOf<Extract<VerdictClass, 'memory_error'>>().toEqualTypeOf<never>()
    expectTypeOf<Extract<VerdictClass, 'misdirection'>>().toEqualTypeOf<never>()
    expectTypeOf<Extract<VerdictClass, 'circular'>>().toEqualTypeOf<never>()
  })

  test('gained exactly two additive OPTIONAL members beside the frozen boolean', () => {
    type AppBugVerdict = Extract<Verdict, { class: 'app_bug' }>
    expectTypeOf<AppBugVerdict['memoryMisdirectionRuledOut']>().toEqualTypeOf<boolean>()
    expectTypeOf<AppBugVerdict['memoryOnPath']>().toEqualTypeOf<MemoryOnPathEntry[] | undefined>()
    expectTypeOf<AppBugVerdict['misdirectionRuledOut']>().toEqualTypeOf<
      MisdirectionEvidence | undefined
    >()
  })

  test('refuses a ninth class on a verdict value — the oracle bites', () => {
    // @ts-expect-error 'misdirection' is not a verdict class; this assignment must not compile.
    const bad: Verdict['class'] = 'misdirection'
    expectTypeOf(bad).toEqualTypeOf<VerdictClass>()
  })
})
