// RE-SPELLED 2026-10-01 (432-19, D-15/D-16/D-17). The POLICY-05 scenario contract drove `evaluate`
// over the classic scenarios and pinned three things per case: the classified risk tier, the gate's
// verdict and outcome, and one secret-free execution-audit row. The gate and the execution audit are
// deleted, so each case keeps its name and its CLASSIFICATION half (eval still scores side effects
// with `classifyRisk`) and its verdict half becomes the deletion's own claim: the first-party
// tool-call point allows the action in that context, no trust input changes that, and no audit row
// of any kind is written for it.
//
// TWO CASES CHANGE TIER, ON PURPOSE (D-16). They classified a shell COMMAND (`rm -rf`, `sudo rm`)
// through the deleted command-pattern list; the classifier now reads the action name only, so
// `run_shell` classifies by its name to the recognized floor. Their names say so.

import { describe, expect, it } from 'vitest'

import type {
  ExecutionContext,
  RiskActionDescriptor,
  RiskTier,
} from '@vostride/agent-qa-schema'
import { registerFirstPartySafetyHooks } from '../../hooks/first-party'
import type { AuditSink, GuardrailAuditRow } from '../../ports/audit-sink'
import { classifyRisk } from '../risk-classifier'

class RecordingAuditSink implements AuditSink {
  readonly rows: GuardrailAuditRow[] = []

  appendGuardrailAudit(row: GuardrailAuditRow): void {
    this.rows.push(row)
  }
}

const PROJECT_A = 'project-secret-alpha'
const PROJECT_B = 'project-secret-beta'

// 2026-10-02 (432-39, D-02/D-12): the trust-credential DTOs are deleted from the schema, so the
// retired trust input a stale composition would still hand over is spelled here, by shape. It is
// smuggled past the hook options (`as never`) exactly as before, and nothing reads it.
interface RetiredTrustScope {
  project?: string
  org?: string
}
interface RetiredTrustCredential {
  scope: RetiredTrustScope
}

const matchingCredential: RetiredTrustCredential = {
  scope: { project: PROJECT_A },
}

interface ScenarioCase {
  name: string
  action: RiskActionDescriptor
  ctx: ExecutionContext
  trust?: {
    trustMode?: boolean
    credential?: RetiredTrustCredential
    actionScope?: RetiredTrustScope
  }
  expectedRiskTier: RiskTier
}

async function runScenario(testCase: ScenarioCase): Promise<void> {
  // The classification half, unchanged in meaning: what eval's side-effect axis reads.
  expect(classifyRisk(testCase.action).riskTier).toBe(testCase.expectedRiskTier)

  // The verdict half, now absence: the retired trust inputs and the context are handed over as a
  // stale composition would, and the tool-call point still allows without a word.
  const sink = new RecordingAuditSink()
  const { registry } = registerFirstPartySafetyHooks({
    auditSink: sink,
    ...(testCase.trust === undefined ? {} : { trust: testCase.trust }),
    resolveExecutionContext: () => testCase.ctx,
  } as never)
  const answer = await registry.runToolCallAsync(testCase.action)

  expect(answer).toEqual({ action: 'allow', call: testCase.action })
  expect(sink.rows).toEqual([])
  expect(JSON.stringify(answer)).not.toContain(PROJECT_A)
  expect(JSON.stringify(answer)).not.toContain(PROJECT_B)
}

describe('POLICY-05 scenario contract', () => {
  it.each([
    {
      name: 'read-only in cloud with no trust proceeds',
      action: { name: 'inspect_state', recognized: true, readOnly: true },
      ctx: 'cloud',
      expectedRiskTier: 'read-only',
    },
    {
      name: 'a shell command is not a risk signal: run_shell classifies by its name and proceeds (D-16)',
      // 2026-10-02 (432-42): `command` left the descriptor type; the legacy payload rides a smuggle.
      action: { name: 'run_shell', recognized: true, ...({ command: 'rm -rf /tmp/agent-qa' } as object) },
      ctx: 'local-interactive',
      expectedRiskTier: 'mutating-local',
    },
    {
      name: 'mutating-local local-interactive with no trust proceeds',
      action: { name: 'edit_local_file', recognized: true },
      ctx: 'local-interactive',
      expectedRiskTier: 'mutating-local',
    },
    {
      name: 'mutating-local ci with no trust proceeds',
      action: { name: 'edit_local_file', recognized: true },
      ctx: 'ci',
      expectedRiskTier: 'mutating-local',
    },
    {
      name: 'mutating-shared ci proceeds with or without a credential (no ask, D-15)',
      action: { name: 'push_to_remote', recognized: true, declaredTier: 'mutating-shared' },
      ctx: 'ci',
      trust: {
        credential: matchingCredential,
        actionScope: { project: PROJECT_A },
      },
      expectedRiskTier: 'mutating-shared',
    },
    {
      name: 'non-interactive cloud-trigger with no token proceeds; nothing fails closed (D-15)',
      action: { name: 'cloud_trigger_delete_record', recognized: true },
      ctx: 'cloud',
      trust: { actionScope: { project: PROJECT_B } },
      expectedRiskTier: 'destructive',
    },
  ] satisfies readonly ScenarioCase[])('$name', async (testCase) => {
    await runScenario(testCase)
  })

  describe('destructive lexicon coverage', () => {
    it.each([
      {
        name: 'soft lexicon action classifies destructive and proceeds',
        action: { name: 'delete_record', recognized: true },
        ctx: 'cloud',
        expectedRiskTier: 'destructive',
      },
      {
        name: 'a hard command is not a risk signal: run_shell with sudo classifies by its name (D-16)',
        // 2026-10-02 (432-42): `command` left the descriptor type; the legacy payload rides a smuggle.
        action: { name: 'run_shell', recognized: true, ...({ command: 'sudo rm -rf /tmp/agent-qa' } as object) },
        ctx: 'local-interactive',
        trust: {
          trustMode: true,
          credential: matchingCredential,
          actionScope: { project: PROJECT_A },
        },
        expectedRiskTier: 'mutating-local',
      },
      {
        name: 'a hard NAME verb still classifies restricted (the name signal eval reads)',
        action: { name: 'sudo_reboot', recognized: true },
        ctx: 'local-interactive',
        expectedRiskTier: 'restricted',
      },
    ] satisfies readonly ScenarioCase[])('$name', async (testCase) => {
      await runScenario(testCase)
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
        name: 'a project A credential and a project B action proceed alike: no scope is checked',
        action: scopedAction,
        ctx: 'ci',
        trust: {
          credential: matchingCredential,
          actionScope: { project: PROJECT_B },
        },
        expectedRiskTier: 'mutating-shared',
      },
      {
        name: 'a project A credential and a project A action proceed alike',
        action: scopedAction,
        ctx: 'ci',
        trust: {
          credential: matchingCredential,
          actionScope: { project: PROJECT_A },
        },
        expectedRiskTier: 'mutating-shared',
      },
    ] satisfies readonly ScenarioCase[])('$name', async (testCase) => {
      await runScenario(testCase)
    })
  })

  describe('standing approvals and sovereignty', () => {
    it('no standing approval is read: an ask-tier action proceeds with none', async () => {
      await runScenario({
        name: 'file_issue in project A',
        action: { name: 'file_issue', recognized: true, declaredTier: 'destructive' },
        ctx: 'ci',
        trust: { actionScope: { project: PROJECT_A } },
        expectedRiskTier: 'destructive',
      })
    })

    it('a restricted name still classifies restricted, and nothing blocks it in-run (D-15)', async () => {
      await runScenario({
        name: 'restricted action with every retired trust source',
        action: { name: 'sudo', recognized: true },
        ctx: 'local-interactive',
        trust: {
          trustMode: true,
          credential: matchingCredential,
          actionScope: { project: PROJECT_A },
        },
        expectedRiskTier: 'restricted',
      })
    })
  })
})
