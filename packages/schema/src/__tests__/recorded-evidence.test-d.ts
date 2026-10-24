import { expectTypeOf } from 'vitest'
import type { Decision } from '../handoff/step-evidence'
import type { SubActionEvidence } from '../handoff/sub-action-evidence'
import type { ArtifactRef } from '../ids/artifact-ref'
import type { ActionResult, RecordedActionResult } from '../result/index'

expectTypeOf<Omit<RecordedActionResult, 'screenshot'>>().toEqualTypeOf<
  Omit<ActionResult, 'screenshot'>
>()
expectTypeOf<RecordedActionResult['screenshot']>().toEqualTypeOf<undefined>()

// @ts-expect-error inline screenshot bytes are not assignable to recorded evidence.
const recorded: RecordedActionResult = { success: true, screenshot: new Uint8Array() }

const liveActionResultWithScreenshot: ActionResult = { success: true, screenshot: new Uint8Array() }

// @ts-expect-error live ActionResult values with screenshot bytes are not assignable to recorded evidence.
const recordedFromLive: RecordedActionResult = liveActionResultWithScreenshot

expectTypeOf<SubActionEvidence['result']>().toEqualTypeOf<RecordedActionResult>()
expectTypeOf<Decision['result']>().toEqualTypeOf<RecordedActionResult>()
expectTypeOf<SubActionEvidence['decisionScreenshotRef']>().toEqualTypeOf<ArtifactRef | undefined>()

void recorded
void recordedFromLive
