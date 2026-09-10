import { describe, expect, it } from 'vitest'

import { canonicalJson } from '../../canonical-json'
import { JUDGE_CONFIG } from '../../judge/config'
import { MATCHER_CONFIG } from '../../match/config'
import {
  CONTRACT_PROJECTION_SCHEMA_VERSION,
  contractFileName,
  projectJudgeConfigContract,
  projectMatcherConfigContract,
} from '../projection'

describe('contract projection', () => {
  it('projects the matcher constitution verbatim — snapshot can never lag the live frozen object', () => {
    const projection = projectMatcherConfigContract()

    expect(projection.config).toEqual(MATCHER_CONFIG)
    expect(projection.version).toBe(MATCHER_CONFIG.matcherVersion)
    expect(projection.kind).toBe('matcher-config')
  })

  it('projects the judge constitution verbatim — snapshot can never lag the live frozen object', () => {
    const projection = projectJudgeConfigContract()

    expect(projection.config).toEqual(JUDGE_CONFIG)
    expect(projection.version).toBe(JUDGE_CONFIG.judgeVersion)
    expect(projection.kind).toBe('judge-config')
  })

  it('derives D-04 version-suffixed file names', () => {
    expect(contractFileName(projectMatcherConfigContract())).toBe('matcher-config.v1.json')
    expect(contractFileName(projectJudgeConfigContract())).toBe('judge-config.v2.json')
  })

  it('is JSON-serializable and canonically stable', () => {
    for (const projection of [projectMatcherConfigContract(), projectJudgeConfigContract()]) {
      const serialized = canonicalJson(projection)
      expect(JSON.parse(serialized)).toEqual(projection)
      expect(canonicalJson(projection)).toBe(serialized)
    }
    expect(canonicalJson(projectMatcherConfigContract())).toBe(
      canonicalJson(projectMatcherConfigContract()),
    )
    expect(canonicalJson(projectJudgeConfigContract())).toBe(
      canonicalJson(projectJudgeConfigContract()),
    )
  })

  it('stamps schemaVersion 1 on every projection', () => {
    expect(CONTRACT_PROJECTION_SCHEMA_VERSION).toBe(1)
    expect(projectMatcherConfigContract().schemaVersion).toBe(CONTRACT_PROJECTION_SCHEMA_VERSION)
    expect(projectJudgeConfigContract().schemaVersion).toBe(CONTRACT_PROJECTION_SCHEMA_VERSION)
  })
})
