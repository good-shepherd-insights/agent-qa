import { actionSentenceText, buildActionSentence, RESULT_WORDS } from './action-vocabulary'
import { copyTextOf } from './display-text'
import { formatOffset, type TimelineMarker, type TimelineModel } from './playhead'

export const TIMELINE_COPY = {
  slider: 'Test timeline',
  signals: 'Step signals',
  results: RESULT_WORDS,
} as const

export type MarkerDensity = 'glyph' | 'tick' | 'scroll'
export const MARKER_DENSITIES = ['glyph', 'tick', 'scroll'] as const satisfies readonly MarkerDensity[]
export const TICK_SLOT_PX = 16
export const SCROLL_SLOT_PX = 8

export function markerDensity(slotWidth: number): MarkerDensity {
  return slotWidth < SCROLL_SLOT_PX ? 'scroll' : slotWidth < TICK_SLOT_PX ? 'tick' : 'glyph'
}

export function timelineValueText(marker: TimelineMarker, total: number): string {
  const time = formatOffset(marker.recordingOffsetMs)
  return copyTextOf(`Step ${marker.stepIndex + 1}, sub-action ${marker.ordinal} of ${total}: ${actionSentenceText(buildActionSentence(marker.subAction))}, ${RESULT_WORDS[marker.result]}${time === undefined ? '' : `, ${time}`}`)
}

export function timelineReadout(model: TimelineModel, marker: TimelineMarker | undefined, short = false, position?: number): string {
  const ordinal = marker?.ordinal ?? 0
  const total = model.markers.length
  if (short) return `#${ordinal}/${total}`
  const offset = model.axis === 'time' ? formatOffset(position === undefined ? marker?.recordingOffsetMs : position * model.extent) : undefined
  return `#${ordinal} of ${total}${offset === undefined ? '' : ` · ${offset} / ${formatOffset(model.extent)}`}`
}
