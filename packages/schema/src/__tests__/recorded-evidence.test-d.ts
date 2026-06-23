import { expectTypeOf } from 'vitest'
import type { Decision } from '../handoff/step-evidence'
import type { SubActionEvidence } from '../handoff/sub-action-evidence'
import type { ArtifactRef } from '../ids/artifact-ref'
import type { ActionResult, RecordedActionResult } from '../result/index'

expectTypeOf<RecordedActionResult>().toEqualTypeOf<Omit<ActionResult, 'screenshot'>>()

// @ts-expect-error inline screenshot bytes are not assignable to recorded evidence.
const recorded: RecordedActionResult = { success: true, screenshot: new Uint8Array() }

expectTypeOf<SubActionEvidence['result']>().toEqualTypeOf<RecordedActionResult>()
expectTypeOf<Decision['result']>().toEqualTypeOf<RecordedActionResult>()
expectTypeOf<SubActionEvidence['decisionScreenshotRef']>().toEqualTypeOf<ArtifactRef | undefined>()

void recorded
