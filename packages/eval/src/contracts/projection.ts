// D-04 contract projection: a point-in-time RECORD of the frozen measurement constitutions,
// destined for the committed gate-set root's contracts/ dir (matcher-config.v<N>.json /
// judge-config.v<N>.json — one file per version, never overwritten; version-suffixed naming
// makes collisions structurally impossible across version bumps). The projection is one-way
// (code object -> snapshot): runtime scoring reads the frozen code objects only, never a
// contracts file — snapshot, not injection (370's discipline).

import { JUDGE_CONFIG } from '../judge/config'
import type { JudgeConfig } from '../judge/config'
import { MATCHER_CONFIG } from '../match/config'
import type { MatcherConfig } from '../match/config'

export const CONTRACT_PROJECTION_SCHEMA_VERSION = 1

export interface ContractProjection {
  schemaVersion: typeof CONTRACT_PROJECTION_SCHEMA_VERSION
  kind: 'matcher-config' | 'judge-config'
  version: number
  config: MatcherConfig | JudgeConfig
}

export function projectMatcherConfigContract(): ContractProjection {
  return {
    schemaVersion: CONTRACT_PROJECTION_SCHEMA_VERSION,
    kind: 'matcher-config',
    version: MATCHER_CONFIG.matcherVersion,
    config: MATCHER_CONFIG,
  }
}

/** Complete frozen constitution, including lineage, cap and reserved score pooling. */
export function projectJudgeConfigContract(): ContractProjection & {
  kind: 'judge-config'
  config: JudgeConfig
} {
  return {
    schemaVersion: CONTRACT_PROJECTION_SCHEMA_VERSION,
    kind: 'judge-config',
    version: JUDGE_CONFIG.judgeVersion,
    config: JUDGE_CONFIG,
  }
}

export function contractFileName(projection: ContractProjection): string {
  return `${projection.kind}.v${projection.version}.json`
}
