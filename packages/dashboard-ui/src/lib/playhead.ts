import type { RunDetailArtifactRef, RunDetailSubAction } from '@vostride/agent-qa-schema'
import { decisionScreenshotRef, type RunDetailGroup, type RunDetailStepGroup } from './run-detail-view'
import { parseRunDetailStepKey, runDetailStepKey, type Selection } from './selection'
import { videoActionOffset } from './frame-annotation'

export interface Playhead {
  testIndex: number
  stepIndex: number
  subActionIndex: number | null
}

export interface UsableFrame {
  index: number
  ref: RunDetailArtifactRef
  substitution?: { shown: number; total: number }
}

export function frameUsable(ref: RunDetailArtifactRef | undefined): ref is RunDetailArtifactRef {
  return ref !== undefined && ref.evidenceIncomplete !== true && ref.present !== false
}

export function latestUsableFrame(subActions: readonly RunDetailSubAction[]): UsableFrame | undefined {
  for (let position = subActions.length - 1; position >= 0; position--) {
    const subAction = subActions[position]!
    const ref = decisionScreenshotRef(subAction)
    if (!frameUsable(ref)) continue
    return {
      index: subAction.subActionIndex,
      ref,
      ...(position === subActions.length - 1 ? {} : {
        substitution: { shown: position + 1, total: subActions.length },
      }),
    }
  }
  return undefined
}

export function parkTargetForStep(group: RunDetailStepGroup): Playhead {
  return {
    testIndex: group.step.testIndex,
    stepIndex: group.step.stepIndex,
    subActionIndex: latestUsableFrame(group.subActions)?.index
      ?? group.subActions.at(-1)?.subActionIndex ?? null,
  }
}

function validIndex(index: number): boolean {
  return Number.isSafeInteger(index) && index >= 0
}

export function playheadFromSelection(selection: Selection | null | undefined): Playhead | null {
  if (selection?.type !== 'step' && selection?.type !== 'subaction') return null
  const address = parseRunDetailStepKey(selection.stepId)
  if (!address || (selection.type === 'subaction' && !validIndex(selection.subIndex))) return null
  return { ...address, subActionIndex: selection.type === 'subaction' ? selection.subIndex : null }
}

export function selectionFromPlayhead(playhead: Playhead | null | undefined): Selection | null {
  if (!playhead || !validIndex(playhead.testIndex) || !validIndex(playhead.stepIndex)
    || (playhead.subActionIndex !== null && !validIndex(playhead.subActionIndex))) return null
  const stepId = runDetailStepKey(playhead.testIndex, playhead.stepIndex)
  return playhead.subActionIndex === null
    ? { type: 'step', stepId }
    : { type: 'subaction', stepId, subIndex: playhead.subActionIndex }
}

export type TimelineAxis = 'time' | 'ordinal'
export const TIMELINE_AXES = ['time', 'ordinal'] as const satisfies readonly TimelineAxis[]
export type MarkerResult = 'passed' | 'failed' | 'healed'
export const MARKER_RESULTS = ['passed', 'failed', 'healed'] as const satisfies readonly MarkerResult[]
export type MarkerFrame = 'available' | 'absent'
export const MARKER_FRAMES = ['available', 'absent'] as const satisfies readonly MarkerFrame[]
export type PlayerSource = 'frames' | 'video'
export const PLAYER_SOURCES = ['frames', 'video'] as const satisfies readonly PlayerSource[]

export interface TimelineMarker extends Playhead {
  subActionIndex: number
  ordinal: number
  position: number
  result: MarkerResult
  frame: MarkerFrame
  ref?: RunDetailArtifactRef
  recordingOffsetMs?: number
  subAction: RunDetailSubAction
}

export interface TimelineSegment extends RunDetailStepGroup {
  start: number
  end: number
  markers: readonly TimelineMarker[]
}

export interface TimelineModel {
  testIndex: number
  axis: TimelineAxis
  extent: number
  segments: readonly TimelineSegment[]
  markers: readonly TimelineMarker[]
  playhead: Playhead | null
}

export function buildTimelineModel(group: RunDetailGroup): TimelineModel {
  const steps = [...group.steps].sort((a, b) => a.step.stepIndex - b.step.stepIndex).map(entry => ({
    ...entry,
    subActions: [...entry.subActions].sort((a, b) => a.subActionIndex - b.subActionIndex),
  }))
  const recording = group.member.recording
  const duration = recording?.state === 'present' ? recording.durationMs : undefined
  const axis: TimelineAxis = duration !== undefined && Number.isFinite(duration) && duration >= 0
    && steps.every(entry => entry.subActions.every(action => action.recordingOffsetMs !== undefined))
    ? 'time' : 'ordinal'
  const extent = axis === 'time' ? duration! : steps.reduce((sum, entry) => sum + Math.max(1, entry.subActions.length), 0)
  const markers: TimelineMarker[] = []
  let slot = 0
  const segments: TimelineSegment[] = steps.map(entry => {
    const start = slot
    const stepMarkers = entry.subActions.map(subAction => {
      const ref = decisionScreenshotRef(subAction)
      const offset = subAction.recordingOffsetMs
      const playbackOffset = videoActionOffset(subAction)
      const marker: TimelineMarker = {
        testIndex: subAction.testIndex,
        stepIndex: subAction.stepIndex,
        subActionIndex: subAction.subActionIndex,
        ordinal: markers.length + 1,
        position: axis === 'time'
          ? extent === 0 ? (playbackOffset! > 0 ? 1 : 0) : Math.min(1, Math.max(0, playbackOffset! / extent))
          : (slot + 0.5) / extent,
        result: subAction.result.success ? 'passed' : 'failed',
        frame: frameUsable(ref) ? 'available' : 'absent',
        ...(ref ? { ref } : {}),
        ...(offset === undefined ? {} : { recordingOffsetMs: offset }),
        subAction,
      }
      slot++
      markers.push(marker)
      return marker
    })
    if (entry.subActions.length === 0) slot++
    return { ...entry, start: start / extent, end: slot / extent, markers: stepMarkers }
  })
  if (axis === 'time') {
    let nextStart = 1
    for (let index = segments.length - 1; index >= 0; index--) {
      const segment = segments[index]!
      segment.start = segment.markers[0]?.position ?? nextStart
      segment.end = nextStart
      nextStart = segment.start
    }
  }
  return { testIndex: group.member.testIndex, axis, extent, segments, markers,
    playhead: steps[0] ? parkTargetForStep(steps[0]) : null }
}

export const SNAP_THRESHOLD_PX = 12
type MarkerCentre = { marker: TimelineMarker; centrePx: number }

export function nearestMarker(positionPx: number, centres: readonly MarkerCentre[]): TimelineMarker | undefined {
  let nearest: TimelineMarker | undefined
  let distance = Infinity
  for (const centre of centres) {
    const candidateDistance = Math.abs(positionPx - centre.centrePx)
    if (candidateDistance < distance
      || (candidateDistance === distance && nearest && centre.marker.ordinal < nearest.ordinal)) {
      nearest = centre.marker
      distance = candidateDistance
    }
  }
  return nearest
}

export function snapToMarker(positionPx: number, centres: readonly MarkerCentre[]): TimelineMarker | undefined {
  return nearestMarker(positionPx, centres.filter(centre =>
    Math.abs(positionPx - centre.centrePx) <= SNAP_THRESHOLD_PX))
}

export function findMarkerBySha(model: TimelineModel, sha: string): TimelineMarker | undefined {
  return model.markers.find(marker => marker.ref?.sha === sha)
}

export function formatOffset(offsetMs: number | undefined, form: 'readout' | 'popover' = 'readout'): string | undefined {
  if (offsetMs === undefined || !Number.isFinite(offsetMs) || offsetMs < 0) return undefined
  const seconds = Math.floor(offsetMs / 1000)
  const minutes = Math.floor(seconds / 60)
  const tail = String(seconds % 60).padStart(2, '0')
  const time = minutes < 60 ? `${minutes}:${tail}`
    : `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${tail}`
  return form === 'popover' ? `${time}.${Math.floor(offsetMs / 100) % 10}` : time
}
