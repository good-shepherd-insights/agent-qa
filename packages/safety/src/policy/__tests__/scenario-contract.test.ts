import { describe, expect, it, vi } from 'vitest'

import type {
  ExecutionContext,
  RiskActionDescriptor,
  RiskTier,
  TrustCredential,
  TrustScope,
} from '@vostride/agent-qa-schema'
import type { ExecutionAuditRow, GuardrailAuditRow } from '../../ports/audit-sink'
import { evaluate } from '../gate'

class FakeAuditSink {
  readonly executionRows: ExecutionAuditRow[] = []

  appendExecutionAudit(row: ExecutionAuditRow): void {
    this.executionRows.push(row)
  }

  appendGuardrailAudit(_row: GuardrailAuditRow): void {
    throw new Error('gate writes execution audit only')
  }
}

const PROJECT_A = 'project-secret-alpha'
const PROJECT_B = 'project-secret-beta'

const matchingCredential: TrustCredential = {
  scope: { project: PROJECT_A },
}

type ExpectedTrustSource =
  | 'session-trust-mode'
  | 'trust-credential'
  | 'standing-approval'
  | 'tty-prompt'
  | undefined

interface ScenarioCase {
  name: string
  action: RiskActionDescriptor
  ctx: ExecutionContext
  trust?: {
    trustMode?: boolean
    credential?: TrustCredential
    actionScope?: TrustScope
  }
  expectedRiskTier: RiskTier
  expectedVerdict: 'allow' | 'deny'
  expectedOutcome:
    | 'proceeded'
    | 'prompted-approved'
    | 'prompted-denied'
    | 'fail-closed-denied'
    | 'blocked'
  expectedTrustSource?: ExpectedTrustSource
}

function expectSecretFree(rows: readonly ExecutionAuditRow[]): void {
  const serialized = JSON.stringify(rows)

  expect(serialized).not.toContain(PROJECT_A)
  expect(serialized).not.toContain(PROJECT_B)
}

async function evaluateScenario(testCase: ScenarioCase): Promise<ExecutionAuditRow> {
  const sink = new FakeAuditSink()
  const confirm = vi.fn(() => false)
  const result = await evaluate(testCase.action, testCase.ctx, testCase.trust ?? {}, {
    auditSink: sink,
    confirm,
  })

  expect(result).toMatchObject({
    riskTier: testCase.expectedRiskTier,
    verdict: testCase.expectedVerdict,
  })
  expect(sink.executionRows).toHaveLength(1)
  expectSecretFree(sink.executionRows)

  const row = sink.executionRows[0]
  expect(row).toMatchObject({
    action: testCase.action.name,
    riskTier: testCase.expectedRiskTier,
    verdict: testCase.expectedVerdict,
    outcome: testCase.expectedOutcome,
  })
  if (testCase.expectedTrustSource === undefined) {
    expect(row).not.toHaveProperty('trustSource')
  } else {
    expect(row.trustSource).toBe(testCase.expectedTrustSource)
  }
  expect(row).not.toHaveProperty('ts')
  expect(confirm).not.toHaveBeenCalled()

  return row
}

describe('POLICY-05 scenario contract', () => {
  it.each([
    {
      name: 'read-only in cloud with no trust proceeds',
      action: { name: 'inspect_state', recognized: true, readOnly: true },
      ctx: 'cloud',
      expectedRiskTier: 'read-only',
      expectedVerdict: 'allow',
      expectedOutcome: 'proceeded',
    },
    {
      name: 'restricted local-interactive with no trust blocks',
      action: { name: 'run_shell', recognized: true, command: 'rm -rf /tmp/agent-qa' },
      ctx: 'local-interactive',
      expectedRiskTier: 'restricted',
      expectedVerdict: 'deny',
      expectedOutcome: 'blocked',
    },
    {
      name: 'mutating-local local-interactive with no trust proceeds',
      action: { name: 'edit_local_file', recognized: true },
      ctx: 'local-interactive',
      expectedRiskTier: 'mutating-local',
      expectedVerdict: 'allow',
      expectedOutcome: 'proceeded',
    },
    {
      name: 'mutating-local ci with no trust fails closed',
      action: { name: 'edit_local_file', recognized: true },
      ctx: 'ci',
      expectedRiskTier: 'mutating-local',
      expectedVerdict: 'deny',
      expectedOutcome: 'fail-closed-denied',
    },
    {
      name: 'mutating-shared ci with matching credential proceeds',
      action: { name: 'push_to_remote', recognized: true, declaredTier: 'mutating-shared' },
      ctx: 'ci',
      trust: {
        credential: matchingCredential,
        actionScope: { project: PROJECT_A },
      },
      expectedRiskTier: 'mutating-shared',
      expectedVerdict: 'allow',
      expectedOutcome: 'proceeded',
      expectedTrustSource: 'trust-credential',
    },
    {
      name: 'non-interactive cloud-trigger with no token denies fail closed',
      action: { name: 'cloud_trigger_delete_record', recognized: true },
      ctx: 'cloud',
      trust: { actionScope: { project: PROJECT_B } },
      expectedRiskTier: 'destructive',
      expectedVerdict: 'deny',
      expectedOutcome: 'fail-closed-denied',
    },
  ] satisfies readonly ScenarioCase[])('$name', async (testCase) => {
    await evaluateScenario(testCase)
  })
})
