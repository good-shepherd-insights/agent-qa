// 2026-10-07, 436-08 (D-05, D-28, reconciliation 4): the CLI's own config loader refuses a config
// carrying the old refilling planner key, with the plain message that names its replacements.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { stringify } from 'yaml'

import { resolveConfig } from '../config.js'

const OLD_KEY = 'maxSubActions'

function configWithPlanner(planner: Record<string, unknown>): Record<string, unknown> {
  return {
    workspace: {
      testMatch: ['tests/**/*.yaml'],
      suiteMatch: ['suites/**/*.suite.yaml'],
      hooksFile: 'hooks.yaml',
      envFile: '.env',
      secretsFile: '.env.secrets.local',
    },
    registry: {
      llms: [{
        name: 'default',
        provider: 'openai-compatible',
        model: 'gpt-4o',
        baseURL: 'https://api.openai.com/v1',
      }],
    },
    use: {
      browser: { name: 'chromium', headless: true },
      mobile: { appState: 'preserve' },
      planner,
      llm: 'default',
    },
  }
}

describe('C436-RETIRED-PLANNER-KEY', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'agent-qa-436-retired-planner-key-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('the CLI config loader refuses the retired key with the plain message', async () => {
    const configPath = join(dir, 'agent-qa.config.yaml')
    writeFileSync(configPath, stringify(configWithPlanner({ [OLD_KEY]: 10, previousStepCount: 5 })))

    const error = await resolveConfig({ configPath, loadAuthPlugins: false }).then(
      () => undefined,
      (err: unknown) => err,
    )
    expect(error).toBeInstanceOf(Error)
    const text = (error as Error).message
    expect(text).toContain('Config validation failed')
    expect(text).toContain(`use.planner.${OLD_KEY}`)
    expect(text).toContain('use.planner.maxActions (default 30)')
    expect(text).toContain('use.planner.maxPlanningTurns (default 30)')
    expect(text).toContain('refilling iteration count')
    expect(text).not.toContain('Unrecognized key')
  })

  it('the same config with the new pair loads', async () => {
    const configPath = join(dir, 'agent-qa.config.yaml')
    writeFileSync(
      configPath,
      stringify(configWithPlanner({ maxActions: 12, maxPlanningTurns: 14, previousStepCount: 5 })),
    )

    const config = await resolveConfig({ configPath, loadAuthPlugins: false })
    expect(config.use?.planner).toEqual({ maxActions: 12, maxPlanningTurns: 14, previousStepCount: 5 })
  })
})
