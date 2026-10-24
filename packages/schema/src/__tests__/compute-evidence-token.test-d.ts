import { expectTypeOf } from 'vitest'
import { computeEvidenceToken } from '../ids/compute-evidence-token'
import type { EvidenceToken } from '../ids/record-id'

expectTypeOf(computeEvidenceToken).returns.toEqualTypeOf<EvidenceToken>()
expectTypeOf(computeEvidenceToken).parameter(0).toMatchTypeOf<{
  attributingObservationId: string
  anchor: string
  buildOrdinal: number
}>()
