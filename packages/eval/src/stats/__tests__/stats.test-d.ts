// Plan 12 F-12 never-bar anchors (1-based diagnostic locations):
// packages/eval/src/stats/__tests__/stats.test-d.ts:10:5
// packages/eval/src/stats/__tests__/stats.test-d.ts:12:59
import { expectTypeOf } from 'vitest'
import { GENERALIZATION_VERDICTS } from '../generalization'
import type { GeneralizationVerdict } from '../generalization'

expectTypeOf<
  Exclude<GeneralizationVerdict, (typeof GENERALIZATION_VERDICTS)[number]>
>().toEqualTypeOf<never>()

expectTypeOf<Extract<GeneralizationVerdict, 'unknown'>>().toEqualTypeOf<never>()
