// 427 · D-02, D-07 — the Knowledge tab's closed sets, pinned in both directions (v54 bar). A member
// added to the union alone compiles everywhere and is never painted; this bar catches that half.

import { expectTypeOf, test } from 'vitest'
import type { InspectRecordView, RunKnowledgeRecordContent } from '@vostride/agent-qa-schema'
import {
  KNOWLEDGE_SECTIONS,
  RECORD_KIND_LABELS,
  USE_VERBS,
  USE_VERB_PHRASES,
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
