import { expectTypeOf, test } from 'vitest'
import type { RunArtifactKind } from '@vostride/agent-qa-schema'
import { CAPTURE_STATES, RUN_ARTIFACT_KIND_LABELS, type CaptureState } from '../drawer-view'

test('C424-CAPTURE-STATES-EXACT', () => {
  type Expected = 'sealed' | 'unsealed'
  expectTypeOf<CaptureState>().toEqualTypeOf<Expected>()
  expectTypeOf<(typeof CAPTURE_STATES)[number]>().toEqualTypeOf<Expected>()
  expectTypeOf<Exclude<CaptureState, (typeof CAPTURE_STATES)[number]>>().toEqualTypeOf<never>()
  expectTypeOf<Exclude<(typeof CAPTURE_STATES)[number], CaptureState>>().toEqualTypeOf<never>()
})

test('DRAWER-KIND-NARROWED', () => {
  expectTypeOf<RunArtifactKind>().toEqualTypeOf<'test' | 'unknown'>()
  expectTypeOf<keyof typeof RUN_ARTIFACT_KIND_LABELS>().toEqualTypeOf<RunArtifactKind>()
})
