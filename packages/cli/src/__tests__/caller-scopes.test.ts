// The two CLI-host caller records' capability grants (394-13, WTST-01 · WINDOWS 101).
//
// WHY THIS FILE EXISTS. `authoring.draft.write` and `authoring.draft.edit` are REGISTERED and
// BOUND on this host, and both were still refused by name at `invoke.ts`'s scope check — because
// neither `CLI_FUNCTION_CALLER` nor `DAEMON_FUNCTION_CALLER` listed `test-write`, the sixth scope
// 394-01 minted. Every op-level test in `packages/agent` passed throughout: an op's own suite
// constructs its own caller, so a composition that withholds a grant is invisible to all of them.
// The refusal that reached a person named a scope and said nothing about authoring at all.
//
// WHAT THE CELLS BELOW MEASURE, AND WHAT THEY DELIBERATELY DO NOT. They measure WHICH CALLERS
// REACH THE GATE. They do not measure, and must never be read as, a widening of what the gate
// permits: cells 3 and 4 drive the same op from the daemon's own composed context and assert it is
// still refused — by the gate, by name, for its tier. The scope is the POWER's legibility; D-03's
// two decision points (this confirm and 391's inbox accept) remain the only controls there are.

import {
  AUTHORING_DRAFT_WRITE_FUNCTION_ID,
  createFunctionRegistry,
  FunctionDeniedError,
  FunctionScopeError,
  invokeFunction,
} from '@vostride/agent-qa-agent'
import type { FunctionDeps } from '@vostride/agent-qa-agent'
import { NO_STANDING_APPROVALS } from '@vostride/agent-qa-safety'
import { FunctionScopeSchema } from '@vostride/agent-qa-schema'
import type { AuthoringDraftWriteInput, ExecutionContext } from '@vostride/agent-qa-schema'
import { describe, expect, it } from 'vitest'

import { CLI_FUNCTION_CALLER } from '../composition/local-agent-host.js'
import { DAEMON_FUNCTION_CALLER } from '../daemon/server.js'

/**
 * A brief the op's `.strict()` input contract accepts, and nothing more.
 *
 * The loop never runs in this file: `authoring.draft.write` is `mutating-shared`, so the gate
 * answers before the binding check and long before dispatch. That is what lets the registry below
 * carry no dependencies at all — a fixture that had to stand up a model and a shelf would be
 * measuring those, not the scope check.
 */
const BRIEF: AuthoringDraftWriteInput = {
  intent: 'write a test for the checkout flow',
  scope: { tier: 'product', key: 'demo-shop' },
}

/**
 * A registry over NO dependencies, at a chosen execution context.
 *
 * `confirm` is threaded so the interactive cell can drive the ask arm to a decision a person
 * could have made, rather than relying on `evaluate()`'s default deny-confirm and then claiming
 * the prompt was reached.
 */
function benchAt(ctx: ExecutionContext, confirm?: () => boolean) {
  return createFunctionRegistry({
    deps: {} as unknown as FunctionDeps,
    resolveExecutionContext: () => ctx,
    standingApprovalReader: () => NO_STANDING_APPROVALS,
    auditSink: { appendExecutionAudit() {}, appendGuardrailAudit() {} },
    ...(confirm === undefined ? {} : { confirm }),
  })
}

async function refusalFrom(
  ctx: ExecutionContext,
  caller: Parameters<typeof invokeFunction>[3],
  confirm?: () => boolean,
): Promise<unknown> {
  try {
    await invokeFunction(benchAt(ctx, confirm), AUTHORING_DRAFT_WRITE_FUNCTION_ID, BRIEF, caller)
  } catch (error: unknown) {
    return error
  }
  throw new Error('the invocation was expected to be refused and was not')
}

describe('CLI_FUNCTION_CALLER', () => {
  it('grants the whole scope vocabulary, member for member', () => {
    // SET EQUALITY, NOT A MEMBERSHIP CHECK, and the difference is the whole point. The constant's
    // own header states a FULL-LOCAL-GRANTS rule — an operator at their own terminal already holds
    // every power the CLI can exercise, so a withheld scope is theatre. A hand-extended list
    // re-rots the next time a scope is minted; equality with the vocabulary is that rule made
    // mechanical, and it reds on the omission rather than on the six names anyone thought to type.
    expect([...CLI_FUNCTION_CALLER.grantedScopes].sort()).toEqual(
      [...FunctionScopeSchema.options].sort(),
    )
  })

  it('reaches the gate for authoring.draft.write — the refusal is the confirm, not the scope list', async () => {
    // The person declines at the prompt. What matters is WHICH refusal arrives: a
    // `FunctionDeniedError` carrying `prompted-denied` means the scope check passed and the
    // invocation reached D-03's first decision point, which is where the fan-out preview is read
    // and the decision is a person's. A `FunctionScopeError` here would mean the loop is
    // unreachable from the CLI for a reason that has nothing to do with authoring.
    const error = await refusalFrom('local-interactive', CLI_FUNCTION_CALLER, () => false)

    expect(error).not.toBeInstanceOf(FunctionScopeError)
    expect(error).toBeInstanceOf(FunctionDeniedError)
    expect((error as FunctionDeniedError).reason).toContain('prompted-denied')
    expect((error as FunctionDeniedError).reason).toContain('mutating-shared')
  })
})

describe('DAEMON_FUNCTION_CALLER', () => {
  it('holds test-write', () => {
    // MEMBERSHIP, not set equality, and the asymmetry with the CLI cell above is deliberate: the
    // daemon's header enumerates a per-scope rationale rather than stating a full-grants rule, so
    // its pin is per-scope too. A seventh scope arriving must be argued for here, not inherited.
    expect(DAEMON_FUNCTION_CALLER.grantedScopes).toContain('test-write')
  })

  it('is still refused for authoring.draft.write — by the gate, for its tier', async () => {
    // THE GRANT IS NOT AN ESCALATION, MEASURED RATHER THAN ARGUED. `local-headless` is the context
    // the daemon composes (`daemon-endpoint.test.ts` mints the same one), and `resolveAsk` reaches
    // `requiresFailClosed` before it reaches any confirm — so a background job holding the scope
    // is refused exactly as it was before, with the gate's own reason naming the tier and the ways
    // out. What the grant changed is the HONESTY of the refusal, not its verdict.
    const error = await refusalFrom('local-headless', DAEMON_FUNCTION_CALLER)

    expect(error).not.toBeInstanceOf(FunctionScopeError)
    expect(error).toBeInstanceOf(FunctionDeniedError)
    expect((error as FunctionDeniedError).reason).toContain('fail-closed')
    expect((error as FunctionDeniedError).reason).toContain('declared tier: mutating-shared')
    expect((error as FunctionDeniedError).reason).toContain('--trust-session')
  })
})
