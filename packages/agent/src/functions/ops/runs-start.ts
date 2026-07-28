// `runs.start` — the full contract, deliberately unbound (Phase 384, D-09/D-10).
//
// Everything about this capability is real EXCEPT its implementation: the input contract
// (including the D-10 `gateRun` carrier), the acknowledgment it will resolve, the scope it
// costs, and the risk descriptor the gate classifies. What is missing is the binding, and
// `bindingStatus: 'unbound'` says so out loud — a catalog lists it, a coverage check counts
// it as covered-but-unbound, and an invocation refuses by name instead of behaving as
// though the capability never existed.
//
// 386 binds it when `composeLocalAgent()` becomes the composition root. Nothing declared
// here changes then; only `bindingStatus` flips.

import { RunStartAcknowledgementSchema, RunsStartInputSchema } from '@vostride/agent-qa-schema'
import type { RunStartAcknowledgement, RunsStartInput } from '@vostride/agent-qa-schema'

import { FunctionNotBoundError } from '../spec.js'
import type { FunctionSpec } from '../spec.js'

export const RUNS_START_FUNCTION_ID = 'runs.start'

export const runsStartSpec: FunctionSpec<RunsStartInput, RunStartAcknowledgement> = {
  id: RUNS_START_FUNCTION_ID,
  summary: 'Start a test run and acknowledge the run a caller can then read or stream.',
  requiredScopes: ['run'],
  resultKind: 'unary',
  bindingStatus: 'unbound',
  input: RunsStartInputSchema,
  output: RunStartAcknowledgementSchema,
  // Pitfall 10, and every field here is load-bearing:
  //   `recognized: true` with NO `readOnly` puts the classifier's floor at mutating-local;
  //   `declaredTier` states that tier explicitly rather than relying on the floor alone;
  //   the name tokens (fn · runs · start) hit neither destructive lexicon, so nothing
  //   raises the tier above what is declared.
  // The tier is the whole point: `mutating-local` allows in EVERY execution context by
  // ratified spec, while `mutating-shared` would ask — and an ask in a fail-closed context
  // is a deny, which would leave the future authoring loop unable to start a run in CI.
  // Starting a run really is local: it spends this machine's resources and writes into
  // this project's run directory. It touches nothing another party shares.
  risk: {
    name: `fn:${RUNS_START_FUNCTION_ID}`,
    recognized: true,
    declaredTier: 'mutating-local',
  },
  invoke() {
    // Unreachable through `invokeFunction`, which refuses on the DECLARATION before it
    // ever dispatches. Kept as the guard for an in-layer caller holding the spec directly,
    // so the unbound state has no back door at all.
    return Promise.reject(new FunctionNotBoundError(RUNS_START_FUNCTION_ID))
  },
}
