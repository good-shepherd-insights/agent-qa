import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { RunEventEnvelope, RunEventType } from '@vostride/agent-qa-schema'
import { DashboardDatabase } from '../../db/database.js'
import { createDashboardRunIngest, type DashboardRunIngest } from '../dashboard-subscriber.js'
import type { RunIdentityMember } from '../run-row-identity.js'

// 444 D-07 (the artifact half of 433 REVIEW WR-01): a multi-test run's artifact lists each member's
// own source and config, in member order, and presents no one member's as the run's.

let db: DashboardDatabase
let seq = 0

beforeEach(() => {
  db = new DashboardDatabase({ dbPath: ':memory:' })
  seq = 0
})

afterEach(() => {
  db.close()
})

const RUN_ID = 'r_artifact-members-alpha-bravo-charlie-delta-echo'

function ev(type: RunEventType, payload: Record<string, unknown> = {}): RunEventEnvelope {
  return { seq: ++seq, ts: seq, runId: RUN_ID, type, payload } as RunEventEnvelope
}

const LOGIN: RunIdentityMember = { name: 'Login', testId: 't_login', filePath: 'tests/login.yaml' }
const CHECKOUT: RunIdentityMember = { name: 'Checkout', testId: 't_checkout', filePath: 'tests/checkout.yaml' }

const LOGIN_YAML = 'name: Login\ntest-id: t_login\ntarget: staging\nsteps:\n  - Click Sign in\n'
const CHECKOUT_YAML = 'name: Checkout\ntest-id: t_checkout\ntarget: shop\nsteps:\n  - Click Pay\n'

function testSnapshot(member: RunIdentityMember, rawYaml: string, target: string) {
  return {
    config: {
      rawConfigContent: 'targets: {}\n',
      effectiveConfig: { use: { timeout: { step: target === 'staging' ? 30000 : 45000 } } },
      model: { planner: { provider: 'openai', model: 'gpt-test' } },
      runtime: { platform: 'web', targetName: target },
      timeouts: { step: target === 'staging' ? 30000 : 45000 },
    },
    source: {
      kind: 'test' as const,
      testId: member.testId,
      name: member.name,
      filePath: `/work/${member.filePath}`,
      rawYaml,
      resolvedDefinition: { name: member.name },
      loadStatus: 'loaded' as const,
    },
  }
}

function startTwoTestRun(): DashboardRunIngest {
  const first = testSnapshot(LOGIN, LOGIN_YAML, 'staging')
  const ingest = createDashboardRunIngest({
    db,
    runId: RUN_ID,
    configSnapshot: first.config,
    sourceSnapshot: first.source,
    members: [LOGIN, CHECKOUT],
  })
  ingest.handler(ev('runStarted', { memberTestCount: 2 }))
  ingest.handler(ev('testStarted', { testIndex: 0, testId: LOGIN.testId, name: LOGIN.name, filePath: LOGIN.filePath }))
  ingest.handler(ev('testStarted', { testIndex: 1, testId: CHECKOUT.testId, name: CHECKOUT.name, filePath: CHECKOUT.filePath }))
  return ingest
}

function storedPayload(): Record<string, any> {
  const artifact = db.getRunArtifact(RUN_ID)
  expect(artifact, 'the run has an artifact').not.toBeNull()
  return artifact!.payload as unknown as Record<string, any>
}

describe('C444-ARTIFACT-MEMBERS', () => {
  it("a two-test run's source lists both members with their own YAML and config", () => {
    const ingest = startTwoTestRun()
    ingest.stageSnapshots(testSnapshot(LOGIN, LOGIN_YAML, 'staging'))
    ingest.stageSnapshots(testSnapshot(CHECKOUT, CHECKOUT_YAML, 'shop'))

    const payload = storedPayload()
    expect(payload.source.kind).toBe('tests')
    const members = payload.source.members as Array<Record<string, any>>
    expect(members.map((member) => member.index)).toEqual([0, 1])
    expect(members[0]).toMatchObject({
      index: 0,
      ref: { test: '/work/tests/login.yaml', id: 't_login' },
      testId: 't_login',
      name: 'Login',
      rawYaml: LOGIN_YAML,
      resolvedDefinition: { name: 'Login' },
      loadStatus: 'loaded',
    })
    expect(members[0].config.runtime.targetName).toBe('staging')
    expect(members[1]).toMatchObject({ index: 1, testId: 't_checkout', name: 'Checkout', rawYaml: CHECKOUT_YAML })
    expect(members[1].config.runtime.targetName).toBe('shop')
    expect(payload.source.rawYaml).toBeUndefined()
    expect(payload.config).toBeUndefined()
  })

  it('members are listed in member order whatever order their snapshots arrive in', () => {
    const ingest = startTwoTestRun()
    ingest.stageSnapshots(testSnapshot(CHECKOUT, CHECKOUT_YAML, 'shop'))
    ingest.stageSnapshots(testSnapshot(LOGIN, LOGIN_YAML, 'staging'))

    const members = storedPayload().source.members as Array<Record<string, any>>
    expect(members.map((member) => member.name)).toEqual(['Login', 'Checkout'])
    expect(members.map((member) => member.index)).toEqual([0, 1])
    expect(members.map((member) => member.rawYaml)).toEqual([LOGIN_YAML, CHECKOUT_YAML])
    expect(members.map((member) => member.config.runtime.targetName)).toEqual(['staging', 'shop'])
  })
})
