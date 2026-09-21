import { buildTimelineModel, type TimelineModel, type Playhead } from './playhead'
import { memberDisplayName, memberHandleLabel, type RunDetailGroup } from './run-detail-view'

export interface SuiteTimelineMember {
  group: RunDetailGroup
  model: TimelineModel
  label: string
  start: number
  end: number
}

export interface SuiteTimelineModel extends TimelineModel {
  members: readonly SuiteTimelineMember[]
}

export interface SuiteClock {
  offsetMs?: number
  totalMs?: number
}

/** Clock scope follows visible members, using decoded media facts only. */
export function suiteClock(model: SuiteTimelineModel, durations: ReadonlyMap<number, number>, testIndex: number): SuiteClock {
  let elapsed: number | undefined = 0
  let offsetMs: number | undefined
  for (const member of model.members) {
    if (member.model.testIndex === testIndex) offsetMs = elapsed
    const duration = durations.get(member.model.testIndex)
    elapsed = elapsed !== undefined && duration !== undefined && Number.isFinite(duration) && duration > 0
      ? elapsed + duration : undefined
  }
  return { offsetMs, totalMs: elapsed }
}

/** Global positions are presentation coordinates. Recorded offsets always stay member-local. */
export function buildSuiteTimeline(groups: readonly RunDetailGroup[]): SuiteTimelineModel {
  const models = groups.map(buildTimelineModel)
  const timed = models.length > 0 && models.every(model => model.axis === 'time')
  const weights = models.map(model => timed ? model.extent : Math.max(1,
    model.segments.reduce((sum, segment) => sum + Math.max(1, segment.subActions.length), 0)))
  const extent = weights.reduce((sum, weight) => sum + weight, 0)
  let cursor = 0
  let ordinal = 0
  const members = groups.map((group, index) => {
    const start = extent === 0 ? index / groups.length : cursor / extent
    cursor += weights[index]!
    const end = extent === 0 ? (index + 1) / groups.length : cursor / extent
    return { group, model: models[index]!, start, end,
      label: `${memberHandleLabel(group.member.testIndex)} · ${memberDisplayName(group.member)}` }
  })
  const segments = members.flatMap(member => member.model.segments.map(segment => ({
    ...segment,
    start: member.start + segment.start * (member.end - member.start),
    end: member.start + segment.end * (member.end - member.start),
    markers: segment.markers.map(marker => ({ ...marker, ordinal: ++ordinal,
      position: member.start + marker.position * (member.end - member.start) })),
  })))
  return { testIndex: models[0]?.testIndex ?? 0, axis: timed ? 'time' : 'ordinal', extent,
    members, segments, markers: segments.flatMap(segment => segment.markers),
    playhead: models[0]?.playhead ?? null }
}

export function suiteSeek(model: SuiteTimelineModel, fraction: number, address?: Playhead) {
  const position = Math.max(0, Math.min(1, fraction))
  const member = (address && model.members.find(entry => entry.model.testIndex === address.testIndex))
    || model.members.find(entry => position < entry.end) || model.members.at(-1)
  if (!member) return undefined
  const local = member.end === member.start ? 0 : Math.max(0, Math.min(1, (position - member.start) / (member.end - member.start)))
  const markers = member.model.markers
  const marker = markers.filter(entry => entry.position <= local).at(-1) ?? markers[0]
  const playhead: Playhead | null = marker ?? member.model.playhead
  return { member, playhead, localFraction: member.model.axis === 'time' ? local : undefined }
}

export function suiteProgress(model: SuiteTimelineModel, testIndex: number, seconds: number): number | undefined {
  const member = model.members.find(entry => entry.model.testIndex === testIndex)
  if (!member || member.model.axis !== 'time' || !Number.isFinite(seconds)) return undefined
  const fraction = member.model.extent === 0 ? 0 : Math.max(0, Math.min(1, seconds * 1000 / member.model.extent))
  return member.start + fraction * (member.end - member.start)
}
