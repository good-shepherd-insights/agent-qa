import { expectTypeOf, test } from 'vitest'
import {
  TIMELINE_AXES, MARKER_RESULTS, MARKER_FRAMES, PLAYER_SOURCES,
  type TimelineAxis, type MarkerResult, type MarkerFrame, type PlayerSource,
} from '../playhead'

test('C424-TIMELINE-AXES-EXACT', () => {
  type Expected = 'time' | 'ordinal'
  expectTypeOf<TimelineAxis>().toEqualTypeOf<Expected>()
  expectTypeOf<(typeof TIMELINE_AXES)[number]>().toEqualTypeOf<Expected>()
  expectTypeOf<Exclude<TimelineAxis, (typeof TIMELINE_AXES)[number]>>().toEqualTypeOf<never>()
  expectTypeOf<Exclude<(typeof TIMELINE_AXES)[number], TimelineAxis>>().toEqualTypeOf<never>()
})

test('C424-MARKER-RESULTS-EXACT', () => {
  type Expected = 'passed' | 'failed' | 'healed'
  expectTypeOf<MarkerResult>().toEqualTypeOf<Expected>()
  expectTypeOf<(typeof MARKER_RESULTS)[number]>().toEqualTypeOf<Expected>()
  expectTypeOf<Exclude<MarkerResult, (typeof MARKER_RESULTS)[number]>>().toEqualTypeOf<never>()
  expectTypeOf<Exclude<(typeof MARKER_RESULTS)[number], MarkerResult>>().toEqualTypeOf<never>()
})

test('C424-MARKER-FRAMES-EXACT', () => {
  type Expected = 'available' | 'absent'
  expectTypeOf<MarkerFrame>().toEqualTypeOf<Expected>()
  expectTypeOf<(typeof MARKER_FRAMES)[number]>().toEqualTypeOf<Expected>()
  expectTypeOf<Exclude<MarkerFrame, (typeof MARKER_FRAMES)[number]>>().toEqualTypeOf<never>()
  expectTypeOf<Exclude<(typeof MARKER_FRAMES)[number], MarkerFrame>>().toEqualTypeOf<never>()
})

test('C424-PLAYER-SOURCES-EXACT', () => {
  type Expected = 'frames' | 'video'
  expectTypeOf<PlayerSource>().toEqualTypeOf<Expected>()
  expectTypeOf<(typeof PLAYER_SOURCES)[number]>().toEqualTypeOf<Expected>()
  expectTypeOf<Exclude<PlayerSource, (typeof PLAYER_SOURCES)[number]>>().toEqualTypeOf<never>()
  expectTypeOf<Exclude<(typeof PLAYER_SOURCES)[number], PlayerSource>>().toEqualTypeOf<never>()
})
