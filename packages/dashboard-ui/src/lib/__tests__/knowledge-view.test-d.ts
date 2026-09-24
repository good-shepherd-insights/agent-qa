// 427 · D-02, D-07 — the Knowledge tab's closed sets, pinned in both directions (v54 bar). A member
// added to the union alone compiles everywhere and is never painted; this bar catches that half.

import { expectTypeOf, test } from 'vitest'
import type { BundleStatus as SchemaBundleStatus, InspectRecordView, RunKnowledgeRecordContent } from '@vostride/agent-qa-schema'
import {
  ANCHOR_PHRASE_TYPES,
  CURRENT_STATUS_WORDS,
  KNOWLEDGE_SECTIONS,
  RECORD_KIND_LABELS,
  SINCE_STATUS_TAGS,
  USE_VERBS,
  USE_VERB_PHRASES,
  type AnchorPhraseType,
  type BundleStatus,
  type KnowledgeSection,
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
