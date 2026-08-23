import { describe, expect, it, vi } from 'vitest'

import type {
  ExecutionContext,
  RiskActionDescriptor,
  RiskTier,
  StandingApprovalGrant,
  TrustCredential,
  TrustScope,
} from '@vostride/agent-qa-schema'
import type { ExecutionAuditRow, GuardrailAuditRow } from '../../ports/audit-sink'
import type { StandingApprovalReader } from '../../ports/policy-ports'
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
  | 'browser-click'
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
  reader?: StandingApprovalReader
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
  const ask = vi.fn(() => false)
  const result = await evaluate(testCase.action, testCase.ctx, testCase.trust ?? {}, {
    auditSink: sink,
    // Every scenario below resolves BEFORE the confirm rung, which is what `ask` never having been
    // called asserts at the foot of this helper. The surface it declares is therefore arbitrary —
    // and declaring one at all is the point: post-G-401-17 there is no way to bind a confirm
    // channel here without saying who answers on it, not even for a port nothing ever calls.
    confirm: { surface: 'tty-prompt', ask },
    reader: testCase.reader,
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
  expect(ask).not.toHaveBeenCalled()

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
      // §2.1 (Ratified 2026-07-05): mutating-local allows in every execution
      // context — ordinary in-test verbs are unaffected in ci (D-15 guarantee).
      name: 'mutating-local ci with no trust proceeds',
      action: { name: 'edit_local_file', recognized: true },
      ctx: 'ci',
      expectedRiskTier: 'mutating-local',
      expectedVerdict: 'allow',
      expectedOutcome: 'proceeded',
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

  describe('destructive lexicon coverage', () => {
    it.each([
      {
        name: 'soft lexicon action classifies destructive and fails closed',
        action: { name: 'delete_record', recognized: true },
        ctx: 'cloud',
        expectedRiskTier: 'destructive',
        expectedVerdict: 'deny',
        expectedOutcome: 'fail-closed-denied',
      },
      {
        name: 'hard command lexicon action classifies restricted and blocks',
        action: { name: 'run_shell', recognized: true, command: 'sudo rm -rf /tmp/agent-qa' },
        ctx: 'local-interactive',
        trust: {
          trustMode: true,
          credential: matchingCredential,
          actionScope: { project: PROJECT_A },
        },
        expectedRiskTier: 'restricted',
        expectedVerdict: 'deny',
        expectedOutcome: 'blocked',
      },
    ] satisfies readonly ScenarioCase[])('$name', async (testCase) => {
      await evaluateScenario(testCase)
    })
  })

  describe('scoped trust invariant', () => {
    const scopedAction: RiskActionDescriptor = {
      name: 'push_to_remote_scope_check',
      recognized: true,
      declaredTier: 'mutating-shared',
    }

    it.each([
      {
        name: 'project A credential does not authorize project B action',
        action: scopedAction,
        ctx: 'ci',
        trust: {
          credential: matchingCredential,
          actionScope: { project: PROJECT_B },
        },
        expectedRiskTier: 'mutating-shared',
        expectedVerdict: 'deny',
        expectedOutcome: 'fail-closed-denied',
      },
      {
        name: 'project A credential authorizes project A action',
        action: scopedAction,
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
    ] satisfies readonly ScenarioCase[])('$name', async (testCase) => {
      await evaluateScenario(testCase)
    })
  })

  describe('standing approvals and sovereignty', () => {
    const standingApproval: StandingApprovalGrant = {
      actionClass: 'file_issue',
      scope: { project: PROJECT_A },
    }
    const reader: StandingApprovalReader = {
      grantsFor: () => [standingApproval],
    }

    it('lets a matching standing approval stop prompting for its action class', async () => {
      // Post-§2.1, mutating-local allows outright and never reaches resolveAsk, so
      // standing-approval coverage is pinned on an ask-tier (destructive) action.
      await evaluateScenario({
        name: 'standing approval covers file_issue in project A',
        action: { name: 'file_issue', recognized: true, declaredTier: 'destructive' },
        ctx: 'ci',
        trust: { actionScope: { project: PROJECT_A } },
        reader,
        expectedRiskTier: 'destructive',
        expectedVerdict: 'allow',
        expectedOutcome: 'proceeded',
        expectedTrustSource: 'standing-approval',
      })
    })

    it('keeps restricted actions blocked despite grant, credential, and trust mode', async () => {
      await evaluateScenario({
        name: 'restricted action is sovereign over all trust sources',
        action: { name: 'sudo', recognized: true },
        ctx: 'local-interactive',
        trust: {
          trustMode: true,
          credential: matchingCredential,
          actionScope: { project: PROJECT_A },
        },
        reader,
        expectedRiskTier: 'restricted',
        expectedVerdict: 'deny',
        expectedOutcome: 'blocked',
      })
    })
  })
})
