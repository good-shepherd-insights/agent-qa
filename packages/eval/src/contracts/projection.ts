// Contract projection: a point-in-time RECORD of the frozen measurement constitutions, destined
// for the committed gate-set root's contracts/ dir (matcher-config.v<N>.json /
// judge-config.v<N>.json, where N is the matcher or judge version; never overwritten). The name
// carries the config version and not schemaVersion, so a schemaVersion change at the same config
// version lands on the same file and re-seeding reports a write-once conflict. The projection is
// one-way (code object -> snapshot): runtime scoring reads the frozen code objects only, never a
// contracts file.

import { JUDGE_CONFIG } from '../judge/config'
import type { JudgeConfig } from '../judge/config'
import { MATCHER_CONFIG } from '../match/config'
import type { MatcherConfig } from '../match/config'

export const CONTRACT_PROJECTION_SCHEMA_VERSION = 2

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
