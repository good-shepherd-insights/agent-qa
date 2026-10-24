// The compile-time half of the 414 D-22 bar on the widened corpus sets.
//
// Each never-bar REDs when a member leaves its TYPE (the runtime cells in
// `corpus-splits.test.ts` RED when a member leaves its ARRAY). Both halves
// are needed: `satisfies` catches an array entry with no type member, these
// bars catch a type member with no array entry, and the runtime cells catch a
// member removed from both.
//
// The last two bars are the ones that matter for D-18/D-19: they pin that the
// proposer-visible type cannot admit a private held-out entry, and that
// `assignSplit` cannot produce an adversarial assignment.
import { expectTypeOf } from 'vitest'
import type {
  CorpusRunLinks,
  CorpusSplit,
  GeneratorKind,
  HeldOutVisibility,
  NaturalCorpusEntry,
  ProposerVisibleCorpusEntry,
} from '../corpus-entry'
import { CORPUS_SPLITS, GENERATOR_KINDS, HELD_OUT_VISIBILITIES } from '../corpus-entry'
import type { assignSplit } from '../split-assignment'

// Every type member is named by its array (the reverse of `satisfies`).
expectTypeOf<Exclude<CorpusSplit, (typeof CORPUS_SPLITS)[number]>>().toEqualTypeOf<never>()
expectTypeOf<
  Exclude<HeldOutVisibility, (typeof HELD_OUT_VISIBILITIES)[number]>
>().toEqualTypeOf<never>()
expectTypeOf<Exclude<GeneratorKind, (typeof GENERATOR_KINDS)[number]>>().toEqualTypeOf<never>()

// The split vocabulary is closed: a plausible-but-unshipped member is never.
expectTypeOf<Extract<CorpusSplit, 'shuffled'>>().toEqualTypeOf<never>()

// D-21 in both directions, at the type level: the natural arm carries
// neither the held-out field nor the adversarial one.
expectTypeOf<Extract<NaturalCorpusEntry, { heldOutVisibility: unknown }>>().toEqualTypeOf<never>()
expectTypeOf<Extract<NaturalCorpusEntry, { generator: unknown }>>().toEqualTypeOf<never>()

// D-18/D-19: the proposer-visible type cannot admit a private held-out entry.
expectTypeOf<
  Extract<ProposerVisibleCorpusEntry, { heldOutVisibility: 'private' }>
>().toEqualTypeOf<never>()

// D-13: run_links carries exactly two keys — no path field can be added
// without REDing here.
expectTypeOf<keyof CorpusRunLinks>().toEqualTypeOf<'runId' | 'runSlug'>()

// assignSplit buckets; it never mints an adversarial entry (422 owns those).
expectTypeOf<
  Extract<ReturnType<typeof assignSplit>, { split: 'adversarial' }>
>().toEqualTypeOf<never>()
