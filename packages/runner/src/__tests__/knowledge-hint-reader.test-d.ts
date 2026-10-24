import { expectTypeOf } from 'vitest'
import type { RecordBody } from '@vostride/agent-qa-schema'
import type { KnowledgeHintReader } from '../knowledge-hint-reader.js'

declare const reader: KnowledgeHintReader

// @ts-expect-error add is not a member of the read-only reader.
reader.add

// @ts-expect-error confirm is not a member of the read-only reader.
reader.confirm

// @ts-expect-error supersede is not a member of the read-only reader.
reader.supersede

// @ts-expect-error deprecate is not a member of the read-only reader.
reader.deprecate

// @ts-expect-error commit is not a member of the read-only reader.
reader.commit

// @ts-expect-error promote is not a member of the read-only reader.
reader.promote

expectTypeOf<keyof KnowledgeHintReader>().toEqualTypeOf<
  'getRunBrief' | 'search' | 'read' | 'getCautions' | 'getProcedure' | 'emitCanaryOutcome'
>()
expectTypeOf(reader.read).returns.toEqualTypeOf<RecordBody | undefined>()
