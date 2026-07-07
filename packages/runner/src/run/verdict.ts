// SESSION-04 verdict-derivation core (D-14/D-15/D-16). Pure, total, no imports
// beyond types + the single-sourced isTestTimeoutMessage matcher. The shell (Plan 06)
// and CLI (Plans 10/11) consume these so the orchestration layers carry zero verdict
// logic. Every branch here is pinned by run/__tests__/verdict.test.ts.

import type { MemberTestOutcome, RunStatus } from '@vostride/agent-qa-schema'
import type { TestResult } from '../result.js'
import { isTestTimeoutMessage } from '../loop/abort.js'

// Re-export the single-sourced matcher so verdict consumers (and the Wave-0 table)
// import the timeout signal from the same module as the derivations it feeds.
export { isTestTimeoutMessage }

/**
 * Derive the member-level outcome for one completed test (D-16). Pure total function.
 *
 * - status `skipped` ⇒ `'skipped'` (member-neutral; passed through)
 * - status `cancelled` ⇒ `'cancelled'`
 * - status `passed` ⇒ `'healed'` when ANY step carries selfHeal evidence, else `'passed'`.
 *   The live heal signal is StepEvidence.selfHeal *presence* — a step-status read would
 *   never fire (RESEARCH Pitfall 5), so we never inspect a step status string here.
 * - status `failed` ⇒ `'timeout'` when ANY failed step's `error` is the test-deadline
 *   message (isTestTimeoutMessage), else `'failed'`.
 *
 * Core's TestStatus and the executor port stay untouched by this derivation (D-16).
 */
export function deriveMemberOutcome(result: TestResult): MemberTestOutcome {
  switch (result.status) {
    case 'skipped':
      return 'skipped'
    case 'cancelled':
      return 'cancelled'
    case 'passed':
      return result.steps.some((s) => s.evidence?.selfHeal !== undefined) ? 'healed' : 'passed'
    case 'failed':
      return result.steps.some((s) => s.status === 'failed' && s.error !== undefined && isTestTimeoutMessage(s.error))
        ? 'timeout'
        : 'failed'
  }
}

/**
 * Fold member outcomes into the aggregate run verdict — the ratified spec §2.1 ordered
 * rule with the D-15 neutral-skipped clause. EVALUATED IN ORDER:
 *
 *  1. `runCancelled` ⇒ `'cancelled'` (a whole-run cancel wins over everything)
 *  2. `runBudgetExpired` ⇒ `'timeout'` (reserved for the whole-run wall-clock budget;
 *     a member 'timeout' is NOT this — it falls to the failed branch below)
 *  3. any member `'failed'` or `'timeout'` ⇒ `'failed'`
 *  4. any member `'cancelled'` (none failed) ⇒ `'cancelled'`
 *  5. any member `'healed'` (none failed) ⇒ `'healed'`
 *  6. else ⇒ `'passed'`
 *
 * `'skipped'` members are neutral throughout — an all-skipped (or empty) run is
 * vacuously `'passed'` (D-15, the reconciled clause; matches every test runner).
 */
export function deriveAggregateVerdict(input: {
  runCancelled: boolean
  runBudgetExpired: boolean
  outcomes: readonly MemberTestOutcome[]
}): RunStatus {
  if (input.runCancelled) return 'cancelled'
  if (input.runBudgetExpired) return 'timeout'
  if (input.outcomes.some((o) => o === 'failed' || o === 'timeout')) return 'failed'
  if (input.outcomes.some((o) => o === 'cancelled')) return 'cancelled'
  if (input.outcomes.some((o) => o === 'healed')) return 'healed'
  return 'passed'
}

/**
 * Map an aggregate verdict to a process exit code (D-14). Pure and pinned:
 * passed/healed ⇒ 0 (healed is ratified as a pass — the annotation lives in output and
 * the handoff, never the exit code), failed/timeout ⇒ 1, cancelled ⇒ 130 (existing SIGINT
 * convention). Exit 2 stays reserved for config/setup errors and is NOT produced here.
 */
export function mapVerdictToExitCode(verdict: RunStatus): number {
  switch (verdict) {
    case 'passed':
    case 'healed':
      return 0
    case 'failed':
    case 'timeout':
      return 1
    case 'cancelled':
      return 130
  }
}
