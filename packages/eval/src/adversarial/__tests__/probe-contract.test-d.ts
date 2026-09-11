// The compile-time half of the 422-04 probe contract.
//
// THE ASSERTIONS SIT INSIDE `test` BLOCKS ON PURPOSE. A `.test-d.ts` whose assertions are all
// top-level still TYPECHECKS, but vitest reports "no tests" for it — and a type oracle that
// executes nothing is indistinguishable from one that was never wired up. Every cell below is
// counted, so a run that reports zero is a real failure rather than a silent pass.
//
// THE SETS ARE HAND-SPELLED, not derived from the runtime lists. `expectTypeOf<X>().toEqualTypeOf
// <(typeof XS)[number]>()` is satisfied by any list that happens to match however both change;
// a second, INDEPENDENT spelling is what REDs when the union moves. The runtime cells in
// `probe-contract.test.ts` pin the other direction.
//
// THE NEVER-BARS ARE THE ORACLE'S TEETH. `Extract<T, 'x'>` reading `never` is the only assertion
// that REDs when someone later adds `'x'`, and the words chosen are the plausible near-misses: a
// seventh generator kind that would widen the closed six, a probe kind spelled after the phase
// that built it, and a provenance word that would turn a refusal into a grade.
//
// THE NEGATIVE CONTROLS ARE THE ORACLE'S OWN PROOF THAT IT BITES. Each `@ts-expect-error` states
// a claim that is FALSE; TypeScript errors on the suppression comment itself if the claim ever
// becomes true, so a vacuous pin cannot hide here.

import { describe, expectTypeOf, test } from 'vitest'

import {
  GENERATOR_KINDS,
  GENERATOR_PROVENANCES,
  PROBE_GENERATOR_KINDS,
} from '../../labels/corpus-entry'
import type {
  AuthoringModel,
  CorpusGenerator,
  GeneratorKind,
  GeneratorProvenance,
  ProbeGeneratorKind,
} from '../../labels/corpus-entry'
import { PROBE_INAPPLICABILITIES, PROBE_REFUSALS } from '../probes'
import type {
  GenerationRequest,
  ProbeAuthorPort,
  ProbeDerivation,
  ProbeInapplicability,
  ProbeRefusal,
  ProbeSurface,
  ProbeText,
} from '../probes'

describe('the two probe generator kinds', () => {
  test('are exactly the two members 414 declared and 422 gave a producer', () => {
    expectTypeOf<ProbeGeneratorKind>().toEqualTypeOf<'judge-targeted' | 'optimized-trigger'>()
  })

  test('are closed in both directions against the runtime list', () => {
    expectTypeOf<
      Exclude<ProbeGeneratorKind, (typeof PROBE_GENERATOR_KINDS)[number]>
    >().toEqualTypeOf<never>()
    expectTypeOf<
      Exclude<(typeof PROBE_GENERATOR_KINDS)[number], ProbeGeneratorKind>
    >().toEqualTypeOf<never>()
  })

  test('are a strict subset of the unchanged six-member generator union', () => {
    // D-05: 422 does NOT widen GeneratorKind. Six, hand-spelled.
    expectTypeOf<GeneratorKind>().toEqualTypeOf<
      | 'fuzz-selector'
      | 'fuzz-label'
      | 'fuzz-error'
      | 'injection-name'
      | 'optimized-trigger'
      | 'judge-targeted'
    >()
    expectTypeOf<Exclude<ProbeGeneratorKind, GeneratorKind>>().toEqualTypeOf<never>()
    expectTypeOf<Exclude<GeneratorKind, (typeof GENERATOR_KINDS)[number]>>().toEqualTypeOf<never>()
  })

  test('bar the near-misses a later plan might reach for', () => {
    // A table family is not a probe kind, however much both mint adversarial entries.
    expectTypeOf<Extract<ProbeGeneratorKind, 'fuzz-label'>>().toEqualTypeOf<never>()
    expectTypeOf<Extract<ProbeGeneratorKind, 'injection-name'>>().toEqualTypeOf<never>()
    // A seventh generator kind named after the mechanism rather than the field perturbed.
    expectTypeOf<Extract<GeneratorKind, 'probe-authored'>>().toEqualTypeOf<never>()
    expectTypeOf<Extract<GeneratorKind, 'llm-derived'>>().toEqualTypeOf<never>()
  })

  test('negative controls: the oracle bites', () => {
    // @ts-expect-error — a probe kind is NOT the whole generator union.
    expectTypeOf<ProbeGeneratorKind>().toEqualTypeOf<GeneratorKind>()
    // @ts-expect-error — 'fuzz-label' is a real member, so extracting it is not never.
    expectTypeOf<Extract<GeneratorKind, 'fuzz-label'>>().toEqualTypeOf<never>()
  })
})

describe('the generator provenance disposition', () => {
  test('is the four hand-spelled words, closed in both directions', () => {
    expectTypeOf<GeneratorProvenance>().toEqualTypeOf<'absent' | 'table' | 'probe' | 'malformed'>()
    expectTypeOf<
      Exclude<GeneratorProvenance, (typeof GENERATOR_PROVENANCES)[number]>
    >().toEqualTypeOf<never>()
    expectTypeOf<
      Exclude<(typeof GENERATOR_PROVENANCES)[number], GeneratorProvenance>
    >().toEqualTypeOf<never>()
  })

  test('bars a word that would turn a refusal into a quality grade', () => {
    // `malformed` is a REFUSAL, not a ranking: there is no 'partial' that is admissible-but-worse
    // and no 'legacy' that means something different from `absent`.
    expectTypeOf<Extract<GeneratorProvenance, 'partial'>>().toEqualTypeOf<never>()
    expectTypeOf<Extract<GeneratorProvenance, 'legacy'>>().toEqualTypeOf<never>()
    expectTypeOf<Extract<GeneratorProvenance, 'unverified'>>().toEqualTypeOf<never>()
  })
})

describe('the persisted probe provenance fields', () => {
  test('name exactly the model identity 422 records and nothing more', () => {
    expectTypeOf<keyof AuthoringModel>().toEqualTypeOf<'id' | 'family'>()
    expectTypeOf<AuthoringModel['id']>().toEqualTypeOf<string>()
    expectTypeOf<AuthoringModel['family']>().toEqualTypeOf<string>()
  })

  test('are ADDITIVE-OPTIONAL on the generator, so pre-422 bytes still type', () => {
    expectTypeOf<CorpusGenerator['authoringModel']>().toEqualTypeOf<AuthoringModel | undefined>()
    expectTypeOf<CorpusGenerator['promptVersion']>().toEqualTypeOf<number | undefined>()
    // The pre-422 triple stayed optional too — widening one must not quietly require the other.
    expectTypeOf<CorpusGenerator['tableVersion']>().toEqualTypeOf<number | undefined>()
    // A generator naming only the three original fields is still a CorpusGenerator.
    expectTypeOf<{
      kind: GeneratorKind
      seedCassetteId: string
      generatorVersion: number
    }>().toExtend<CorpusGenerator>()
  })

  test('negative control: the fields are optional, not required', () => {
    // @ts-expect-error — `authoringModel` alone is not the whole optional type.
    expectTypeOf<CorpusGenerator['authoringModel']>().toEqualTypeOf<AuthoringModel>()
  })
})

describe('the probe request contract', () => {
  test('carries exactly the seven fields D-10/D-11 authorize', () => {
    expectTypeOf<keyof GenerationRequest>().toEqualTypeOf<
      | 'seedCassetteId'
      | 'kind'
      | 'promptVersion'
      | 'promptHash'
      | 'authoringModel'
      | 'surface'
      | 'goldAnchor'
    >()
    // The request is a DTO over the two probe kinds only — it can never name a table family.
    expectTypeOf<GenerationRequest['kind']>().toEqualTypeOf<ProbeGeneratorKind>()
  })

  test('keeps the captured surface a plain strings DTO', () => {
    expectTypeOf<keyof ProbeSurface>().toEqualTypeOf<'role' | 'name' | 'siblingNames'>()
    expectTypeOf<ProbeSurface['siblingNames']>().toEqualTypeOf<readonly string[]>()
  })

  test('exposes exactly one asynchronous authoring method and no model handle', () => {
    expectTypeOf<keyof ProbeAuthorPort>().toEqualTypeOf<'author'>()
    expectTypeOf<ProbeAuthorPort['author']>().parameters.toEqualTypeOf<[GenerationRequest]>()
    expectTypeOf<ProbeAuthorPort['author']>().returns.toEqualTypeOf<Promise<ProbeText>>()
  })

  test('negative control: the request is not open-ended', () => {
    // @ts-expect-error — a request carrying the authored text would make it non-pure.
    expectTypeOf<GenerationRequest['text']>().toEqualTypeOf<string>()
  })
})

describe('the probe outcome vocabularies', () => {
  test('are closed in both directions against their runtime lists', () => {
    expectTypeOf<
      Exclude<ProbeInapplicability, (typeof PROBE_INAPPLICABILITIES)[number]>
    >().toEqualTypeOf<never>()
    expectTypeOf<
      Exclude<(typeof PROBE_INAPPLICABILITIES)[number], ProbeInapplicability>
    >().toEqualTypeOf<never>()
    expectTypeOf<Exclude<ProbeRefusal, (typeof PROBE_REFUSALS)[number]>>().toEqualTypeOf<never>()
    expectTypeOf<Exclude<(typeof PROBE_REFUSALS)[number], ProbeRefusal>>().toEqualTypeOf<never>()
  })

  test('keep a derivation either derived or refused, never silently absent', () => {
    expectTypeOf<ProbeDerivation['outcome']>().toEqualTypeOf<'derived' | 'refused'>()
    expectTypeOf<Extract<ProbeDerivation, { outcome: 'skipped' }>>().toEqualTypeOf<never>()
    // A refusal always names a reason from the closed set — there is no untyped escape hatch.
    expectTypeOf<Extract<ProbeDerivation, { outcome: 'refused' }>['reason']>().toEqualTypeOf<
      ProbeRefusal
    >()
  })

  test('bar an inapplicability that would launder a caller gap into a seed gap', () => {
    // Family exclusion is the CLI preflight's (D-09); this package must never be able to say it.
    expectTypeOf<Extract<ProbeInapplicability, 'planner-family'>>().toEqualTypeOf<never>()
    expectTypeOf<Extract<ProbeInapplicability, 'no-probe-model'>>().toEqualTypeOf<never>()
  })

  test('negative control: the refusal set is non-empty', () => {
    // @ts-expect-error — 'probe-text-empty' is a real refusal, so extracting it is not never.
    expectTypeOf<Extract<ProbeRefusal, 'probe-text-empty'>>().toEqualTypeOf<never>()
  })
})
