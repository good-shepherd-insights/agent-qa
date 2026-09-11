// The 422 circularity-evidence vocabularies, and the eight-class floor they did NOT move.
//
// Three closed sets arrive with D-17/D-19/D-20 — two memory trust words, the four CrossCheck
// words REUSED from the gate receipts rather than re-minted, and a single optional backing
// literal — and each is pinned in BOTH directions here: forward, that the runtime list carries
// no member the type lacks, and reverse, that the type carries no member the runtime list
// lacks. A one-directional pin is satisfied by a set that grew, which is exactly the failure a
// closed vocabulary exists to prevent (the v54 reverse-membership bar, 416 D-02).
//
// The NEVER-BARS are hand-spelled on purpose. `Extract<T, 'x'>` reading `never` is the only
// assertion that REDs when someone later adds `'x'`, and the words chosen are the plausible
// near-misses: a trust word this plan considered and refused, a cross-check spelling the wall
// already forbids, and a backing word that would turn an ABSENCE marker into a quality grade.
//
// THE EIGHT-CLASS FLOOR IS SPELLED BY HAND, not derived from VERDICT_CLASSES. Deriving it
// would make this cell agree with the constant by construction and prove nothing: a ninth
// class added to the constant would flow straight through. The whole point is a second,
// independent spelling that REDs when the union moves — 422 widened the verdict by exactly two
// additive optional members and moved no class.

import { expectTypeOf } from 'vitest'

import {
  MEMORY_ON_PATH_TRUSTS,
  MISDIRECTION_BACKINGS,
} from '../misdirection-evidence'
import type {
  MemoryOnPathEntry,
  MemoryOnPathTrust,
  MisdirectionAggregate,
  MisdirectionBacking,
  MisdirectionEvidence,
  MisdirectionRecordResult,
  MisdirectionRootPosture,
} from '../misdirection-evidence'
import { CROSS_CHECKS } from '../../knowledge/gate-receipt'
import type { CrossCheck } from '../../knowledge/gate-receipt'
import { VERDICT_CLASSES } from '../verdict'
import type { Verdict, VerdictClass } from '../verdict'

// ---------------------------------------------------------------------------------------
// The two memory trust words
// ---------------------------------------------------------------------------------------

expectTypeOf<
  Exclude<MemoryOnPathTrust, (typeof MEMORY_ON_PATH_TRUSTS)[number]>
>().toEqualTypeOf<never>()
expectTypeOf<
  Exclude<(typeof MEMORY_ON_PATH_TRUSTS)[number], MemoryOnPathTrust>
>().toEqualTypeOf<never>()
expectTypeOf<MemoryOnPathTrust>().toEqualTypeOf<'candidate' | 'low-trust-active'>()
// Near-misses this plan considered and refused: trust is a DECLARED store marker, never a
// minted grade, so neither a numeric band name nor a promotion word joins the set.
expectTypeOf<Extract<MemoryOnPathTrust, 'low-trust'>>().toEqualTypeOf<never>()
expectTypeOf<Extract<MemoryOnPathTrust, 'promoted'>>().toEqualTypeOf<never>()
expectTypeOf<Extract<MemoryOnPathTrust, 'canary'>>().toEqualTypeOf<never>()

// ---------------------------------------------------------------------------------------
// The four cross-check words, REUSED and not re-minted
// ---------------------------------------------------------------------------------------

expectTypeOf<Exclude<CrossCheck, (typeof CROSS_CHECKS)[number]>>().toEqualTypeOf<never>()
expectTypeOf<Exclude<(typeof CROSS_CHECKS)[number], CrossCheck>>().toEqualTypeOf<never>()
expectTypeOf<CrossCheck>().toEqualTypeOf<'flipped' | 'held' | 'inconclusive' | 'not-run'>()
// The evidence block and every row speak the receipts' vocabulary, never a fifth private copy.
expectTypeOf<MisdirectionEvidence['crossCheck']>().toEqualTypeOf<CrossCheck>()
expectTypeOf<MisdirectionRecordResult['crossCheck']>().toEqualTypeOf<CrossCheck>()
// 412's wall already forbids the underscore spelling; this plan did not widen the set either.
expectTypeOf<Extract<CrossCheck, 'not_run'>>().toEqualTypeOf<never>()
expectTypeOf<Extract<CrossCheck, 'unchecked'>>().toEqualTypeOf<never>()

// ---------------------------------------------------------------------------------------
// The single optional backing literal — an ABSENCE marker, never a grade
// ---------------------------------------------------------------------------------------

expectTypeOf<
  Exclude<MisdirectionBacking, (typeof MISDIRECTION_BACKINGS)[number]>
>().toEqualTypeOf<never>()
expectTypeOf<
  Exclude<(typeof MISDIRECTION_BACKINGS)[number], MisdirectionBacking>
>().toEqualTypeOf<never>()
expectTypeOf<MisdirectionBacking>().toEqualTypeOf<'declared-only'>()
expectTypeOf<Extract<MisdirectionBacking, 'measured'>>().toEqualTypeOf<never>()
expectTypeOf<Extract<MisdirectionBacking, 'cross-checked'>>().toEqualTypeOf<never>()
// The block's member is OPTIONAL: an ordinary gated run carries no backing word at all.
expectTypeOf<MisdirectionEvidence['backing']>().toEqualTypeOf<MisdirectionBacking | undefined>()

// D-19's three postures, and the one that is not an exemption.
expectTypeOf<MisdirectionRootPosture>().toEqualTypeOf<
  'eval-root' | 'no-eval-root' | 'broken-eval-root'
>()
expectTypeOf<Extract<MisdirectionRootPosture, 'byom'>>().toEqualTypeOf<never>()

// ---------------------------------------------------------------------------------------
// The aggregate's four arms, and the ONE that permits a no-trust-change class
// ---------------------------------------------------------------------------------------

expectTypeOf<MisdirectionAggregate['outcome']>().toEqualTypeOf<
  'held' | 'flipped' | 'unknown' | 'evidence-refused'
>()
expectTypeOf<Extract<MisdirectionAggregate['outcome'], 'ruled-out'>>().toEqualTypeOf<never>()
// The unknown arm DISCLOSES its unresolved siblings — all three lists, never a bare flag.
expectTypeOf<
  keyof Extract<MisdirectionAggregate, { outcome: 'unknown' }>
>().toEqualTypeOf<'outcome' | 'inconclusive' | 'notRun' | 'unchecked'>()

// ---------------------------------------------------------------------------------------
// The verdict floor: eight classes, unchanged, plus exactly two additive optional members
// ---------------------------------------------------------------------------------------

// Hand-spelled — a SECOND, independent statement of the closed set (see the header).
type EightClasses =
  | 'test_bug'
  | 'app_bug'
  | 'environment'
  | 'flake'
  | 'config_error'
  | 'llm_error'
  | 'unknown'
  | 'timeout'

expectTypeOf<VerdictClass>().toEqualTypeOf<EightClasses>()
expectTypeOf<Verdict['class']>().toEqualTypeOf<EightClasses>()
expectTypeOf<Exclude<VerdictClass, (typeof VERDICT_CLASSES)[number]>>().toEqualTypeOf<never>()
expectTypeOf<Exclude<(typeof VERDICT_CLASSES)[number], VerdictClass>>().toEqualTypeOf<never>()
// The never-bar: a ninth class REDs here, whichever plausible name it arrives under.
expectTypeOf<Extract<VerdictClass, 'memory_error'>>().toEqualTypeOf<never>()
expectTypeOf<Extract<VerdictClass, 'misdirection'>>().toEqualTypeOf<never>()
expectTypeOf<Extract<VerdictClass, 'circular'>>().toEqualTypeOf<never>()

// The two new members are OPTIONAL, and the frozen boolean beside them is untouched.
type AppBugVerdict = Extract<Verdict, { class: 'app_bug' }>
expectTypeOf<AppBugVerdict['memoryMisdirectionRuledOut']>().toEqualTypeOf<boolean>()
expectTypeOf<AppBugVerdict['memoryOnPath']>().toEqualTypeOf<MemoryOnPathEntry[] | undefined>()
expectTypeOf<AppBugVerdict['misdirectionRuledOut']>().toEqualTypeOf<
  MisdirectionEvidence | undefined
>()
