import type { RunDetailSubAction } from '@vostride/agent-qa-schema'
import { validRecordedAnnotation } from '@vostride/agent-qa-schema'
import type { StepAnnotation } from './api'

/** Adapt recorded geometry without inferring coordinates from the planned target. */
export function frameAnnotation(sub: RunDetailSubAction | undefined): StepAnnotation | undefined {
  const annotation = sub?.result.annotation
  if (!annotation || !sub) return undefined
  const base = {
    type: sub.plannedAction.type,
    viewport: annotation.viewport,
    direction: annotation.direction,
    failureHighlight: annotation.failureHighlight,
  }
  switch (annotation.kind) {
    case 'point': return { ...base, clickPoint: annotation.point, boundingBox: annotation.point.boundingBox }
    case 'region': return { ...base, boundingBox: annotation.region.boundingBox }
    case 'path': return { ...base, startPoint: annotation.path.start, endPoint: annotation.path.end }
    case 'pinch': return { ...base, startPoint: annotation.pinch.center, pinchScale: annotation.pinch.scale > 1 ? 'out' : 'in' }
  }
}

/** Completion offsets are deliberately irrelevant to video overlay visibility. */
export function videoAnnotation(sub: RunDetailSubAction, timeMs: number, width: number, height: number): StepAnnotation | undefined {
  const annotation = sub.result.annotation
  const witness = annotation?.recording
  if (!annotation || !witness || !validRecordedAnnotation(annotation) || !Number.isFinite(timeMs)
    || width !== witness.width || height !== witness.height
    || timeMs < witness.startMs || timeMs >= witness.endMs) return undefined
  return frameAnnotation(sub)
}

/** A review seek lands within the measured action; persisted completion offsets stay intact. */
export function videoActionOffset(sub: RunDetailSubAction): number | undefined {
  const annotation = sub.result.annotation
  const witness = annotation?.recording
  return annotation && witness && validRecordedAnnotation(annotation) && witness.endMs > witness.startMs
    ? (witness.startMs + witness.endMs) / 2 : sub.recordingOffsetMs
}

/** A labelled review cue, never an extension of the recorded execution interval.
 * Unknown next-action geometry/timing cannot prove scene continuity, so withhold the hold. */
export function videoActionCue(actions: readonly RunDetailSubAction[], timeMs: number, width: number, height: number): { annotation: StepAnnotation; recent: boolean } | undefined {
  for (const [index, sub] of actions.entries()) {
    const active = videoAnnotation(sub, timeMs, width, height)
    if (active) return { annotation: active, recent: false }
    const witness = sub.result.annotation?.recording
    const next = actions[index + 1]
    const nextWitness = next?.result.annotation?.recording
    if (!witness || (next && (!nextWitness || !validRecordedAnnotation(next.result.annotation!)))) continue
    const until = Math.min(witness.endMs + 350, nextWitness?.startMs ?? Infinity)
    if (timeMs >= witness.endMs && timeMs < until) {
      const annotation = videoAnnotation(sub, (witness.startMs + witness.endMs) / 2, width, height)
      if (annotation) return { annotation, recent: true }
    }
  }
  return undefined
}
