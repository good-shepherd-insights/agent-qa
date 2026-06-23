import { expectTypeOf } from 'vitest'
import { asRecordId } from '../ids/record-id'
import type { Verdict, VerdictEvidence } from '../verdict/verdict'

type AllClasses =
  | 'app_bug'
  | 'test_bug'
  | 'environment'
  | 'flake'
  | 'config_error'
  | 'llm_error'

type TestBugSubtype =
  | 'stale_selector'
  | 'outdated_flow'
  | 'bad_assertion'
  | 'wrong_expected_value'

const evidence: VerdictEvidence = {
  citedSteps: [0, 2],
  citedAnchors: [{ t: 'el', role: 'button', name: 'Submit' }],
  citedArtifacts: [{ id: 'screenshot-after', sha: 'a'.repeat(64) }],
  rationale: 'The observed assertion target no longer matches the expected UI.',
}

expectTypeOf<Verdict['class']>().toEqualTypeOf<AllClasses>()

type TestBugVerdict = Extract<Verdict, { class: 'test_bug' }>
expectTypeOf<TestBugVerdict['subtype']>().toEqualTypeOf<TestBugSubtype | undefined>()

type FlakeVerdict = Extract<Verdict, { class: 'flake' }>
expectTypeOf<keyof FlakeVerdict>().toEqualTypeOf<
  'class' | 'confidence' | 'evidence' | 'attribution' | 'memoryMisdirectionRuledOut' | 'perTest'
>()

const valid: Verdict = {
  class: 'test_bug',
  subtype: 'stale_selector',
  confidence: 0.9,
  evidence,
  attribution: {
    records: [asRecordId('record-1')],
    anchors: [{ t: 'page', route: '/checkout' }],
  },
  memoryMisdirectionRuledOut: true,
  perTest: 0,
}
expectTypeOf<typeof valid.evidence>().toEqualTypeOf<VerdictEvidence>()

const flake: FlakeVerdict = {
  class: 'flake',
  confidence: 0.6,
  evidence,
  memoryMisdirectionRuledOut: true,
  perTest: 1,
}

// @ts-expect-error non-test_bug verdict arms carry no subtype.
flake.subtype

const invalidOther: Verdict = {
  // @ts-expect-error Verdict is a closed union with no `other` arm or free-form class string.
  class: 'other',
  confidence: 1,
  evidence,
  memoryMisdirectionRuledOut: true,
  perTest: 0,
}

// @ts-expect-error memoryMisdirectionRuledOut is required on every Verdict arm.
const missingMisdirectionGuard: Verdict = {
  class: 'flake',
  confidence: 1,
  evidence,
  perTest: 0,
}

const bareStringEvidence: Verdict = {
  class: 'llm_error',
  confidence: 0.2,
  // @ts-expect-error evidence must be structured VerdictEvidence, never a bare rationale string.
  evidence: 'the model guessed',
  memoryMisdirectionRuledOut: true,
  perTest: 0,
}

void valid
void flake
void invalidOther
void missingMisdirectionGuard
void bareStringEvidence
