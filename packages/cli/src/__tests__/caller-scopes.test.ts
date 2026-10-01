// The two CLI-host caller records' capability grants (394-13, WTST-01 · WINDOWS 101).
//
// WHY THIS FILE EXISTS. `authoring.draft.write` and `authoring.draft.edit` are REGISTERED and
// BOUND on this host, and both were still refused by name at `invoke.ts`'s scope check — because
// neither `CLI_FUNCTION_CALLER` nor `DAEMON_FUNCTION_CALLER` listed `test-write`, the sixth scope
// 394-01 minted. Every op-level test in `packages/agent` passed throughout: an op's own suite
// constructs its own caller, so a composition that withholds a grant is invisible to all of them.
// The refusal that reached a person named a scope and said nothing about authoring at all.
//
// 2026-09-30 (432-13, D-14/D-15): THERE IS NO OP GATE. Cells 2 and 4 are re-spelled: the scope
// check still passes for both holders of `test-write`, and the invocation now reaches the BINDING
// check (this registry binds nothing) instead of a confirm or a fail-closed refusal.
//
// WHAT THE CELLS BELOW MEASURE, AND WHAT THEY DELIBERATELY DO NOT. They measure WHICH CALLERS
// REACH DISPATCH, and where the call then stops — never a claim that a grant widened it. Cell 1
// pins the CLI's grants set-equal to the vocabulary; cell 2 drives `authoring.draft.write` from the
// CLI's interactive context to the confirm. Cell 3 pins LIST MEMBERSHIP on the daemon record (its
// own comment argues why membership rather than set equality); cell 4 drives the write op from the
// daemon's composed `local-headless` context and asserts the GATE refuses it, by name, for its
// tier; cell 5 drives `authoring.draft.edit` from that same context and asserts the gate ALLOWS it
// — the second holder of `test-write` is `mutating-local`, and server.ts argues why that allowance
// is intended. The scope is the POWER's legibility; D-03's two decision points (that confirm and
// 391's inbox accept) remain the only controls there are.

import {
  AUTHORING_DRAFT_EDIT_FUNCTION_ID,
  AUTHORING_DRAFT_WRITE_FUNCTION_ID,
  createFunctionRegistry,
  FunctionNotBoundError,
  FunctionScopeError,
  invokeFunction,
} from '@vostride/agent-qa-agent'
import type { FunctionDeps } from '@vostride/agent-qa-agent'
import { FunctionScopeSchema } from '@vostride/agent-qa-schema'
import type {
  AuthoringDraftEditInput,
  AuthoringDraftWriteInput,
  ExecutionContext,
} from '@vostride/agent-qa-schema'
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
 * The edit op's equivalent brief. Same posture as `BRIEF`: nothing here is resolved, because the
 * edit cell reads the control points, not the edit.
 */
const EDIT_BRIEF: AuthoringDraftEditInput = {
  testRef: 'tests/checkout.yaml::adds an item to the cart',
  intent: 'also assert the cart badge reads 1',
}

/** A registry over NO dependencies, at a chosen execution context (432-13: nothing asks). */
function benchAt(ctx: ExecutionContext) {
  return createFunctionRegistry({
    deps: {} as unknown as FunctionDeps,
    resolveExecutionContext: () => ctx,
    auditSink: { appendGuardrailAudit() {} },
  })
}

async function errorFrom(
  ctx: ExecutionContext,
  caller: Parameters<typeof invokeFunction>[3],
  functionId: string,
  input: unknown,
): Promise<unknown> {
  try {
    await invokeFunction(benchAt(ctx), functionId, input, caller)
  } catch (error: unknown) {
    return error
  }
  throw new Error('the invocation was expected to end in an error and did not')
}

async function refusalFrom(
  ctx: ExecutionContext,
  caller: Parameters<typeof invokeFunction>[3],
): Promise<unknown> {
  return errorFrom(ctx, caller, AUTHORING_DRAFT_WRITE_FUNCTION_ID, BRIEF)
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

  // RE-SPELLED 2026-09-30 (432-13) from 'reaches the gate for authoring.draft.write — the refusal
  // is the confirm, not the scope list'. The scope check still passes; with no gate the call
  // reaches the binding check, which this dependency-free registry refuses by name.
  it('reaches the binding check for authoring.draft.write — the scope list passes, nothing asks', async () => {
    const error = await refusalFrom('local-interactive', CLI_FUNCTION_CALLER)

    expect(error).not.toBeInstanceOf(FunctionScopeError)
    expect(error).toBeInstanceOf(FunctionNotBoundError)
  })
})

describe('DAEMON_FUNCTION_CALLER', () => {
  it('holds test-write', () => {
    // MEMBERSHIP, not set equality, and the asymmetry with the CLI cell above is deliberate: the
    // daemon's header enumerates a per-scope rationale rather than stating a full-grants rule, so
    // its pin is per-scope too. A seventh scope arriving must be argued for here, not inherited.
    expect(DAEMON_FUNCTION_CALLER.grantedScopes).toContain('test-write')
  })

  // RE-SPELLED 2026-09-30 (432-13, D-14/D-15) from 'is still refused for authoring.draft.write —
  // by the gate, for its tier'. There is no fail-closed arm: the daemon's `local-headless` call
  // passes the scope check and reaches the binding check exactly as the CLI's does.
  it('C432-INVOKE-DIRECT: reaches the binding check for authoring.draft.write from local-headless', async () => {
    const error = await refusalFrom('local-headless', DAEMON_FUNCTION_CALLER)

    expect(error).not.toBeInstanceOf(FunctionScopeError)
    expect(error).toBeInstanceOf(FunctionNotBoundError)
  })

  it('is ALLOWED past both control points for authoring.draft.edit — the second holder of test-write', async () => {
    // THE PIN FOR THE ONE THING THE GRANT DID WIDEN. `test-write` has a second holder,
    // `authoring.draft.edit`, and it is `mutating-local` — a tier `requiresFailClosed` does not
    // refuse — so on this record the edit op became agent-origin reachable. server.ts argues why
    // that is intended (the op only STAGES a proposal; per D-05 the human inbox accept is the
    // consent point, and 391 fixed that an accept is a decision and never a grant). This cell is
    // that decision's pin: it asserts PASSAGE by excluding both control points' error classes, and
    // then names the outcome the op's own body produces on a registry with no `draftShelf` — so an
    // unrelated crash cannot satisfy it. Raise the tier, or add `requiresHumanOrigin`, and this
    // reds by name instead of the posture changing in silence.
    const error = await errorFrom(
      'local-headless',
      DAEMON_FUNCTION_CALLER,
      AUTHORING_DRAFT_EDIT_FUNCTION_ID,
      EDIT_BRIEF,
    )

    expect(error).not.toBeInstanceOf(FunctionScopeError)
    expect(error).toBeInstanceOf(FunctionNotBoundError)
  })
})
