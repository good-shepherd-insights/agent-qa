// Plan 12 mutation anchors: packages/eval/src/gate/__tests__/release-gate.test-d.ts
// F-05 gate coverage: line 18, column 1; timeout exclusion: line 19, column 1.
// F-09 axis coverage: line 20, column 1; recovery exclusion: line 21, column 1.
// F-10 split coverage: line 22, column 1; synthetic exclusion: line 23, column 1.
// F-11 seed-policy coverage: line 24, column 1.
// Each anchor identifies its expectTypeOf statement; runtime cells are in gate-closed-sets.test.ts.
import { expectTypeOf } from 'vitest'
import { SEED_POLICIES } from '../../baseline/profile-key'
import type { SeedPolicy } from '../../baseline/profile-key'
import { FLOOR_AXES } from '../../stats/decision-vector'
import type { FloorAxis } from '../../stats/decision-vector'
import { FLOOR_SPLITS } from '../floor-artefact'
import type { FloorSplit } from '../floor-artefact'
import { GATE_INCONCLUSIVE_REASONS } from '../release-gate'
import type { GateInconclusiveReason } from '../release-gate'

// Array coverage and plausible-but-unshipped members must both remain never.
expectTypeOf<Exclude<GateInconclusiveReason, (typeof GATE_INCONCLUSIVE_REASONS)[number]>>().toEqualTypeOf<never>()
expectTypeOf<Extract<GateInconclusiveReason, 'timeout'>>().toEqualTypeOf<never>()
expectTypeOf<Exclude<FloorAxis, (typeof FLOOR_AXES)[number]>>().toEqualTypeOf<never>()
expectTypeOf<Extract<FloorAxis, 'recovery'>>().toEqualTypeOf<never>()
expectTypeOf<Exclude<FloorSplit, (typeof FLOOR_SPLITS)[number]>>().toEqualTypeOf<never>()
expectTypeOf<Extract<FloorSplit, 'synthetic'>>().toEqualTypeOf<never>()
expectTypeOf<Exclude<SeedPolicy, (typeof SEED_POLICIES)[number]>>().toEqualTypeOf<never>()
