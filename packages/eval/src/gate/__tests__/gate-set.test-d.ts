// The compile-time half of the 414 gate-set bar (Task 1 Test 8).
//
// The never-bar that carries ROOT-08 SC3: `CandidateProvenance` has EXACTLY
// three keys. A path field cannot be added to it without REDing this file, so
// "exclusion never keys on a path" is a type property, not a code review note.
//
// The other two bars close the verdict vocabulary: every `ExclusionReason` is
// named by `EXCLUSION_REASONS` (the reverse direction of `satisfies`), and the
// `unprovenanced-candidate` arm carries no gate set — a refused candidate
// cannot be read as "here are your entries, none excluded" (D-11).
import { expectTypeOf } from 'vitest'

import type {
  CandidateProvenance,
  ExclusionReason,
  GateSetVerdict,
} from '../gate-set'
import { EXCLUSION_REASONS } from '../gate-set'

// ROOT-08 SC3, structurally: three keys, no path, no fourth key of any name.
expectTypeOf<keyof CandidateProvenance>().toEqualTypeOf<
  'runIds' | 'receiptDigests' | 'capturedAtOrdinals'
>()

// Every reason the type names is named by the array (the reverse of `satisfies`).
expectTypeOf<Exclude<ExclusionReason, (typeof EXCLUSION_REASONS)[number]>>().toEqualTypeOf<never>()

// The reason vocabulary is closed: a plausible-but-unshipped member is never.
expectTypeOf<Extract<ExclusionReason, 'path-contributed'>>().toEqualTypeOf<never>()

// D-11: the refusal arm is the verdict and nothing else — no gate set, no
// excluded[], no counts to mistake for "measured zero".
expectTypeOf<
  Extract<GateSetVerdict, { verdict: 'unprovenanced-candidate' }>
>().not.toHaveProperty('gateEntries')
expectTypeOf<
  Extract<GateSetVerdict, { verdict: 'unprovenanced-candidate' }>
>().not.toHaveProperty('excluded')
expectTypeOf<
  Extract<GateSetVerdict, { verdict: 'unprovenanced-candidate' }>
>().not.toHaveProperty('counts')

// The empty-gate-set arm carries the minimum it was judged against, so a
// reader never has to guess which floor produced the verdict (D-12).
expectTypeOf<Extract<GateSetVerdict, { verdict: 'empty-gate-set' }>>().toHaveProperty(
  'minimumGateSet',
)

// An `ok` verdict has no `reason` to confuse with an exclusion reason.
expectTypeOf<Extract<GateSetVerdict, { verdict: 'ok' }>>().not.toHaveProperty('reason')
