// 427 · D-02, D-07 — the Knowledge tab's closed sets, pinned in both directions (v54 bar). A member
// added to the union alone compiles everywhere and is never painted; this bar catches that half.

import { expectTypeOf, test } from 'vitest'
import type {
  BundleStatus as SchemaBundleStatus,
  CurationBucket,
  InspectRecordView,
  RunKnowledgePlanSource,
  RunKnowledgeRecordContent,
} from '@vostride/agent-qa-schema'
import {
  ANCHOR_PHRASE_TYPES,
  BUCKET_LABELS,
  CURRENT_STATUS_WORDS,
  EFFECT_OUTCOMES,
  EFFECT_SENTENCES,
  EFFECT_TONES,
  EFFECT_TONE_OF,
  KNOWLEDGE_SECTIONS,
  LEDGER_ROW_LABELS,
  REPLAY_STOP_CAUSES,
  RECORD_KIND_LABELS,
  SINCE_STATUS_TAGS,
  SINCE_THEN_DETAILS,
  USE_VERBS,
  USE_VERB_PHRASES,
  type AnchorPhraseType,
  type BundleStatus,
  type EffectOutcome,
  type EffectTone,
  type KnowledgeSection,
  type LearnedChangeKind,
  type LedgerRow,
  type ReplayStopCause,
  type RecordKind,
  type UseVerb,
} from '../knowledge-view'

test('C427-SECTIONS-EXACT', () => {
  type Expected = 'used' | 'effect' | 'changes' | 'retrieval-details'
  expectTypeOf<KnowledgeSection>().toEqualTypeOf<Expected>()
  expectTypeOf<(typeof KNOWLEDGE_SECTIONS)[number]>().toEqualTypeOf<Expected>()
  expectTypeOf<Exclude<KnowledgeSection, (typeof KNOWLEDGE_SECTIONS)[number]>>().toEqualTypeOf<never>()
  expectTypeOf<Exclude<(typeof KNOWLEDGE_SECTIONS)[number], KnowledgeSection>>().toEqualTypeOf<never>()
})

test('C427-USE-VERBS-EXACT', () => {
  type Expected = 'given' | 'opened' | 'caution' | 'replayed' | 'hint'
  expectTypeOf<UseVerb>().toEqualTypeOf<Expected>()
  expectTypeOf<(typeof USE_VERBS)[number]>().toEqualTypeOf<Expected>()
  expectTypeOf<Exclude<UseVerb, (typeof USE_VERBS)[number]>>().toEqualTypeOf<never>()
  expectTypeOf<Exclude<(typeof USE_VERBS)[number], UseVerb>>().toEqualTypeOf<never>()
  expectTypeOf<keyof typeof USE_VERB_PHRASES>().toEqualTypeOf<UseVerb>()
})

test('C427-RECORD-KINDS-EXACT', () => {
  type Expected = 'fact' | 'procedure' | 'caution' | 'unknown' | 'policy'
  expectTypeOf<RecordKind>().toEqualTypeOf<Expected>()
  expectTypeOf<RecordKind>().toEqualTypeOf<InspectRecordView['kind']>()
  expectTypeOf<RunKnowledgeRecordContent['kind']>().toEqualTypeOf<RecordKind>()
  expectTypeOf<keyof typeof RECORD_KIND_LABELS>().toEqualTypeOf<RecordKind>()
})

test('C427-ANCHOR-PHRASE-TYPES-EXACT', () => {
  type Expected = 'platform' | 'page' | 'flow' | 'el' | 'selector' | 'error' | 'unparsed'
  expectTypeOf<AnchorPhraseType>().toEqualTypeOf<Expected>()
  expectTypeOf<(typeof ANCHOR_PHRASE_TYPES)[number]>().toEqualTypeOf<Expected>()
  expectTypeOf<Exclude<AnchorPhraseType, (typeof ANCHOR_PHRASE_TYPES)[number]>>().toEqualTypeOf<never>()
  expectTypeOf<Exclude<(typeof ANCHOR_PHRASE_TYPES)[number], AnchorPhraseType>>().toEqualTypeOf<never>()
})

test('C427-STATUS-WORDS-SHAPE', () => {
  type Expected = 'active' | 'candidate' | 'superseded' | 'deprecated'
  expectTypeOf<BundleStatus>().toEqualTypeOf<Expected>()
  expectTypeOf<BundleStatus>().toEqualTypeOf<SchemaBundleStatus>()
  expectTypeOf<BundleStatus>().toEqualTypeOf<RunKnowledgeRecordContent['currentStatus']>()
  expectTypeOf<keyof typeof SINCE_STATUS_TAGS>().toEqualTypeOf<BundleStatus>()
  expectTypeOf<keyof typeof CURRENT_STATUS_WORDS>().toEqualTypeOf<BundleStatus>()
})

test('C427-EFFECT-OUTCOMES-EXACT', () => {
  type Expected =
    | 'contradicted'
    | 'harmful'
    | 'replay-stopped'
    | 'confirmed'
    | 'helpful'
    | 'replay-complete'
    | 'pending'
    | 'unknown'
  expectTypeOf<EffectOutcome>().toEqualTypeOf<Expected>()
  expectTypeOf<(typeof EFFECT_OUTCOMES)[number]>().toEqualTypeOf<Expected>()
  expectTypeOf<Exclude<EffectOutcome, (typeof EFFECT_OUTCOMES)[number]>>().toEqualTypeOf<never>()
  expectTypeOf<Exclude<(typeof EFFECT_OUTCOMES)[number], EffectOutcome>>().toEqualTypeOf<never>()
  expectTypeOf<keyof typeof EFFECT_TONE_OF>().toEqualTypeOf<EffectOutcome>()
  expectTypeOf<keyof typeof EFFECT_SENTENCES>().toEqualTypeOf<Exclude<EffectOutcome, 'replay-stopped' | 'replay-complete'>>()
})

test('C427-EFFECT-TONES-EXACT', () => {
  type Expected = 'problem' | 'positive' | 'pending' | 'unknown'
  expectTypeOf<EffectTone>().toEqualTypeOf<Expected>()
  expectTypeOf<(typeof EFFECT_TONES)[number]>().toEqualTypeOf<Expected>()
  expectTypeOf<Exclude<EffectTone, (typeof EFFECT_TONES)[number]>>().toEqualTypeOf<never>()
  expectTypeOf<Exclude<(typeof EFFECT_TONES)[number], EffectTone>>().toEqualTypeOf<never>()
  expectTypeOf<(typeof EFFECT_TONE_OF)[EffectOutcome]>().toEqualTypeOf<EffectTone>()
})

test('C427-REPLAY-STOP-CAUSES-EXACT', () => {
  type MissReason = NonNullable<Extract<RunKnowledgePlanSource, { kind: 'procedure-replay' }>['guard']['miss']>['reason']
  expectTypeOf<ReplayStopCause>().toEqualTypeOf<MissReason | 'execution-failure' | 'verifier-rejection'>()
  expectTypeOf<keyof typeof REPLAY_STOP_CAUSES>().toEqualTypeOf<ReplayStopCause>()
})

test('C427-BUCKET-LABELS-SHAPE', () => {
  type Expected = 'added' | 'confirmed' | 'superseded' | 'deprecated' | 'proposed'
  expectTypeOf<CurationBucket>().toEqualTypeOf<Expected>()
  expectTypeOf<keyof typeof BUCKET_LABELS>().toEqualTypeOf<CurationBucket>()
  expectTypeOf<keyof typeof SINCE_THEN_DETAILS>().toEqualTypeOf<LearnedChangeKind>()
  expectTypeOf<keyof typeof LEDGER_ROW_LABELS>().toEqualTypeOf<LedgerRow>()
})
