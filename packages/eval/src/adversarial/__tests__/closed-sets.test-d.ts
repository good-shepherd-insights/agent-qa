// 422-22-T1 — the COMPILE-TIME half of the adversarial closed-set oracle.
//
// THIS FILE IS AN INDEPENDENT ORACLE, NOT A SECOND VIEW OF `closed-sets.test.ts`. It shares no
// fixture, no helper and no import with the runtime half beyond the production modules both are
// measuring. Two oracles reading one fixture are one oracle; the whole point is that these two
// can disagree with the source and with each other.
//
// EVERY UNION IS SPELLED OUT AS A LITERAL UNION. Not one cell writes
// `expectTypeOf<X>().toEqualTypeOf<(typeof XS)[number]>()` on its own and calls it a pin — that
// assertion is satisfied by any list that happens to match however both sides change, which is
// the tautology this phase tripped over in 422-11 and again in prose. The `Exclude<...>` cells
// beside each literal statement pin the two directions against the runtime list, and the literal
// statement is what REDs when the union itself moves.
//
// THE ASSERTIONS SIT INSIDE `test` BLOCKS ON PURPOSE. A `.test-d.ts` whose assertions are all
// top-level still TYPECHECKS, but vitest reports "no tests" for it — and a type oracle with a
// zero counted total is a failure wearing a pass's clothes. 422-11 shipped exactly that. Every
// cell below is counted.
//
// THE NEVER-BARS ARE THE TEETH. `Extract<T, 'x'>` reading `never` is the only assertion that REDs
// when someone later adds `'x'`, and the words chosen are the plausible near-misses a later plan
// would actually reach for: a synonym for a word already in the set, a status that would turn an
// absence into an answer, and a cap source nobody set.
//
// THE NEGATIVE CONTROLS ARE THE ORACLE'S OWN PROOF THAT IT BITES. Each `@ts-expect-error` states
// a claim that is FALSE, so TypeScript errors on the suppression comment itself if the claim ever
// becomes true — a vacuous pin cannot hide here.

import { describe, expectTypeOf, test } from 'vitest'

import {
  ADVERSARIAL_CAP_SOURCES,
  ADVERSARIAL_PUBLICATIONS,
  ADVERSARIAL_ROW_STATUSES,
  adversarialRowStatus,
  GENERATION_OUTCOMES,
} from '../generate'
import type {
  AdversarialCapSource,
  AdversarialGenerationOutcome,
  AdversarialInapplicability,
  AdversarialPublication,
  AdversarialRowStatus,
  GenerationOutcome,
} from '../generate'
import { PROBE_RESERVATION_STATUSES, probeReservationStatus } from '../probes'
import type { ProbeReservationStatus } from '../probes'
import { ADVERSARIAL_MUTATORS } from '../../labels/corpus-entry'
import type { AdversarialMutator, GeneratorKind } from '../../labels/corpus-entry'
import type { LabelSourceChannel } from '../../cassette/label-leg'

describe('the derivation-outcome discriminant', () => {
  test('is the two words the engine answers with, closed in both directions', () => {
    expectTypeOf<GenerationOutcome>().toEqualTypeOf<'derived' | 'inapplicable'>()
    expectTypeOf<
      Exclude<GenerationOutcome, (typeof GENERATION_OUTCOMES)[number]>
    >().toEqualTypeOf<never>()
    expectTypeOf<
      Exclude<(typeof GENERATION_OUTCOMES)[number], GenerationOutcome>
    >().toEqualTypeOf<never>()
  })

  test('is the outcome union own discriminant, never a parallel declaration', () => {
    // Derived by indexed access rather than re-declared: a third arm added to the outcome union
    // widens this type automatically, and the literal statement above then REDs by name. A
    // second hand-written union here would silently keep saying two.
    expectTypeOf<AdversarialGenerationOutcome['kind']>().toEqualTypeOf<GenerationOutcome>()
  })

  test('bars the synonyms a later plan would reach for', () => {
    // The corpus addresses a variant by a DERIVED id; `generated` would be a second word for the
    // same fact, and `skipped` was the pre-422 shape the typed inapplicability row replaced.
    expectTypeOf<Extract<GenerationOutcome, 'generated'>>().toEqualTypeOf<never>()
    expectTypeOf<Extract<GenerationOutcome, 'skipped'>>().toEqualTypeOf<never>()
    expectTypeOf<Extract<GenerationOutcome, 'refused'>>().toEqualTypeOf<never>()
  })

  test('negative control: the discriminant is not the whole outcome', () => {
    // @ts-expect-error — an outcome is a record, not its own discriminant string.
    expectTypeOf<GenerationOutcome>().toEqualTypeOf<AdversarialGenerationOutcome>()
  })
})

describe('the staging-report row status', () => {
  test('is exactly the six terminal words, closed in both directions', () => {
    expectTypeOf<AdversarialRowStatus>().toEqualTypeOf<
      'staged' | 'unchanged' | 'refusal' | 'inapplicable' | 'interrupted' | 'failed'
    >()
    expectTypeOf<
      Exclude<AdversarialRowStatus, (typeof ADVERSARIAL_ROW_STATUSES)[number]>
    >().toEqualTypeOf<never>()
    expectTypeOf<
      Exclude<(typeof ADVERSARIAL_ROW_STATUSES)[number], AdversarialRowStatus>
    >().toEqualTypeOf<never>()
  })

  test('is exactly the four publication answers, closed in both directions', () => {
    expectTypeOf<AdversarialPublication>().toEqualTypeOf<
      'published' | 'refused' | 'interrupted' | 'failed'
    >()
    expectTypeOf<
      Exclude<AdversarialPublication, (typeof ADVERSARIAL_PUBLICATIONS)[number]>
    >().toEqualTypeOf<never>()
    expectTypeOf<
      Exclude<(typeof ADVERSARIAL_PUBLICATIONS)[number], AdversarialPublication>
    >().toEqualTypeOf<never>()
  })

  test('bars a row word that would report a judgement rather than an outcome', () => {
    // A report row says what HAPPENED. There is no `pending` (the report is written after the
    // refresh settles), no `error` (a failure to publish is `failed` and a policy block is
    // `refusal`, and collapsing them would lose which one happened), and no `skipped` — the
    // pre-422 word whose whole problem was that it named no reason.
    expectTypeOf<Extract<AdversarialRowStatus, 'pending'>>().toEqualTypeOf<never>()
    expectTypeOf<Extract<AdversarialRowStatus, 'error'>>().toEqualTypeOf<never>()
    expectTypeOf<Extract<AdversarialRowStatus, 'skipped'>>().toEqualTypeOf<never>()
    expectTypeOf<Extract<AdversarialRowStatus, 'derived'>>().toEqualTypeOf<never>()
  })

  test('maps outcome plus publication onto a row word and nothing else', () => {
    expectTypeOf(adversarialRowStatus).returns.toEqualTypeOf<AdversarialRowStatus>()
    expectTypeOf(adversarialRowStatus).parameters.toEqualTypeOf<
      [{ outcome: AdversarialGenerationOutcome; publication?: AdversarialPublication }]
    >()
  })

  test('negative control: row status and publication are different vocabularies', () => {
    // @ts-expect-error — `refusal` is a row word and `refused` a publication word; they are
    // deliberately not the same set, so the two types must not be equal.
    expectTypeOf<AdversarialRowStatus>().toEqualTypeOf<AdversarialPublication>()
  })
})

describe('the cap source', () => {
  test('is exactly the three origins, closed in both directions', () => {
    expectTypeOf<AdversarialCapSource>().toEqualTypeOf<'default' | 'config' | 'flag'>()
    expectTypeOf<
      Exclude<AdversarialCapSource, (typeof ADVERSARIAL_CAP_SOURCES)[number]>
    >().toEqualTypeOf<never>()
    expectTypeOf<
      Exclude<(typeof ADVERSARIAL_CAP_SOURCES)[number], AdversarialCapSource>
    >().toEqualTypeOf<never>()
  })

  test('bars an origin that would make a cap unattributable', () => {
    // Every cap this build resolves came from exactly one of three places, and `unknown` would
    // let a refresh record a bound nobody can trace to a decision.
    expectTypeOf<Extract<AdversarialCapSource, 'unknown'>>().toEqualTypeOf<never>()
    expectTypeOf<Extract<AdversarialCapSource, 'env'>>().toEqualTypeOf<never>()
    expectTypeOf<Extract<AdversarialCapSource, 'cli'>>().toEqualTypeOf<never>()
  })
})

describe('the probe reservation status', () => {
  test('is exactly the three durable states, closed in both directions', () => {
    expectTypeOf<ProbeReservationStatus>().toEqualTypeOf<
      'unattempted' | 'interrupted' | 'completed'
    >()
    expectTypeOf<
      Exclude<ProbeReservationStatus, (typeof PROBE_RESERVATION_STATUSES)[number]>
    >().toEqualTypeOf<never>()
    expectTypeOf<
      Exclude<(typeof PROBE_RESERVATION_STATUSES)[number], ProbeReservationStatus>
    >().toEqualTypeOf<never>()
  })

  test('bars a word that would let a lost call read as a free one', () => {
    // The states are derived from two files on disk, so there is no word for "in progress" that
    // a crashed process could have left behind, and no `failed` — a provider error is a recorded
    // completion whose outcome says so, which is a charge, not an absence.
    expectTypeOf<Extract<ProbeReservationStatus, 'pending'>>().toEqualTypeOf<never>()
    expectTypeOf<Extract<ProbeReservationStatus, 'in-flight'>>().toEqualTypeOf<never>()
    expectTypeOf<Extract<ProbeReservationStatus, 'failed'>>().toEqualTypeOf<never>()
  })

  test('takes the two disk facts and returns one word', () => {
    expectTypeOf(probeReservationStatus).returns.toEqualTypeOf<ProbeReservationStatus>()
    expectTypeOf(probeReservationStatus).parameters.toEqualTypeOf<
      [{ reservationRecorded: boolean; completionRecorded: boolean }]
    >()
  })

  test('negative control: the status set is non-empty', () => {
    // @ts-expect-error — 'completed' is a real member, so extracting it is not never.
    expectTypeOf<Extract<ProbeReservationStatus, 'completed'>>().toEqualTypeOf<never>()
  })
})

describe('the vocabularies 422 did not move', () => {
  // A SECOND, independent statement of the eleven frozen families, as a union.
  type ElevenFamilies =
    | 'confusable'
    | 'invisible'
    | 'tag-block'
    | 'injection-template'
    | 'benign-case'
    | 'benign-whitespace'
    | 'benign-punctuation'
    | 'benign-digit'
    | 'benign-truncate'
    | 'benign-plural'
    | 'benign-synonym'

  test('keep the eleven frozen mutation families, hand-spelled', () => {
    expectTypeOf<AdversarialMutator>().toEqualTypeOf<ElevenFamilies>()
    expectTypeOf<
      Exclude<AdversarialMutator, (typeof ADVERSARIAL_MUTATORS)[number]>
    >().toEqualTypeOf<never>()
    expectTypeOf<
      Exclude<(typeof ADVERSARIAL_MUTATORS)[number], AdversarialMutator>
    >().toEqualTypeOf<never>()
  })

  test('keep the six generator kinds and the four label channels', () => {
    expectTypeOf<GeneratorKind>().toEqualTypeOf<
      | 'fuzz-selector'
      | 'fuzz-label'
      | 'fuzz-error'
      | 'injection-name'
      | 'optimized-trigger'
      | 'judge-targeted'
    >()
    expectTypeOf<LabelSourceChannel>().toEqualTypeOf<
      'recorded-verdict' | 'user-mark' | 'overturned-verdict' | 'self-heal-pair'
    >()
  })

  test('keep the mutation family and the generator kind separate vocabularies', () => {
    // D-05: the family rides BESIDE the six-member kind union rather than widening it, so
    // neither set may name a member of the other.
    expectTypeOf<Extract<AdversarialMutator, GeneratorKind>>().toEqualTypeOf<never>()
    expectTypeOf<Extract<GeneratorKind, AdversarialMutator>>().toEqualTypeOf<never>()
  })

  test('keep every inapplicability a STATEMENT about a seed or a family', () => {
    // The row exists so a refresh that stages nothing can say why. A `reason` that named the
    // caller's own gap would launder a host problem into a seed problem — exactly the direction
    // 422-04 barred on the probe half.
    expectTypeOf<Extract<AdversarialInapplicability, 'no-probe-model'>>().toEqualTypeOf<never>()
    expectTypeOf<Extract<AdversarialInapplicability, 'planner-family'>>().toEqualTypeOf<never>()
    expectTypeOf<Extract<AdversarialInapplicability, 'unknown'>>().toEqualTypeOf<never>()
  })

  test('negative control: the family union is not the kind union', () => {
    // @ts-expect-error — eleven families are not six generator kinds.
    expectTypeOf<AdversarialMutator>().toEqualTypeOf<GeneratorKind>()
  })
})
