// The planner's action vocabulary (Phase 392 plan 04, D-07 / D-08 / D-10).
//
// THE TOOLSET IS THE REGISTRY WALK. Every registered op projects 1:1 to a tool, plus exactly two
// orchestration meta-tools, and nothing else exists. That is the always-send-all law expressed as
// code rather than as a policy: the model is shown everything this host can do, so a curated subset
// — the shape that quietly decides on a person's behalf which capabilities are worth mentioning —
// has nowhere to live. It is also what makes 393-395's arrival free: an op registered there appears
// here without anyone editing this file, and 397's chat-equals-registry conformance becomes a walk
// rather than a hand-maintained list.
//
// NO TOOL CARRIES AN EXECUTE CALLBACK, and that omission is the load-bearing line in this file.
// `generateText` runs a tool exactly when the tool has a function to run; with none present it
// returns the model's plan in `result.toolCalls` and enacts nothing. D-10 requires reconciliation
// to complete BEFORE the first side effect, and this is the version of that requirement the SDK
// cannot get wrong — there is no callback to invoke, so there is no ordering to remember.
//
// THE WALK CONSUMES DECLARATIONS, NEVER SPECS. A declaration is capability-free by construction
// (384 BL-01): scalars plus inert JSON-Schema projections, with no live validator and no
// implementation anywhere on it. So this module holds no dispatch path, and the chat subtree still
// has exactly one way to run anything — the `ChatInvokeBinding` its composition supplies. The
// projections it reads are the same views 396's MCP tool listing will consume, which is the point:
// one description of a capability, rendered by every surface that describes capabilities.

import { jsonSchema, tool } from 'ai'
import type { Tool, ToolSet } from 'ai'
import { z } from 'zod'

import type { FunctionCaller } from '@vostride/agent-qa-schema'

import type { FunctionDeclaration } from '../functions/spec.js'
import {
  ANSWER_ONLY_TOOL_NAME,
  ChatToolNameError,
  MARK_UNHANDLED_TOOL_NAME,
  toToolName,
} from './tool-names.js'

/**
 * What the projection needs of a registry: the listing, and nothing else.
 *
 * `FunctionRegistry` satisfies this structurally, and the composition root hands one over. Naming
 * the narrower shape here is what keeps the chat subtree's reach honest — this module cannot
 * acquire the registry's internals seam even by accident, because the type it holds does not have
 * one. The claim "chat can propose only what the registry declares" is then a fact about what this
 * function was given rather than a rule about what it chose to do with it.
 */
export interface PlannerToolSource {
  list(caller: FunctionCaller): readonly FunctionDeclaration[]
}

/**
 * `answer_only`'s contract: WHICH clause is being answered, and the prose (CHAT-01, CR-03).
 *
 * THE `clause` FIELD IS REQUIRED, and it mirrors `mark_unhandled`'s for the same reason: a turn is
 * made of clauses, so a claim about a turn cannot stand in for a claim about one of them. Without
 * it, one call answering one question consumed every OTHER clause the merge had no binding for —
 * an unroutable action erased with no receipt and no refusal (392-VERIFICATION CR-03).
 */
export const ANSWER_ONLY_INPUT_SCHEMA = z.object({
  // NON-EMPTY for the same reason `text` is, one field over (392-15, WR-01). `reconcile.ts` has
  // rejected `clause: ""` since the field was required — a claim that names nothing covers nothing
  // — while the contract the model was SHOWN still admitted it. The two halves of one field cannot
  // be allowed to disagree in the direction that lets the model emit a call the reader will refuse.
  clause: z
    .string()
    .min(1)
    .describe(
      'The part of the request, quoted verbatim from the clauses you were given, that this '
      + 'answer is about.',
    ),
  // NON-EMPTY, and that is the model-facing half of the coverage predicate (392-14). `z.string()`
  // admitted `""`, so the one call that erases a clause — naming it, answering nothing — was
  // inside the contract the model was shown. The reader in `reconcile.ts` moved in the SAME commit
  // and is deliberately one notch stricter (it also rejects whitespace-only prose): the two halves
  // of a claim's meaning cannot be allowed to disagree in the direction that completes more.
  text: z
    .string()
    .min(1)
    .describe('The answer, in prose, for a turn that asks for information.'),
})

/** `mark_unhandled`'s contract: WHICH clause, and WHY nothing here can carry it out (D-08). */
export const MARK_UNHANDLED_INPUT_SCHEMA = z.object({
  clause: z
    .string()
    .describe('The part of the request, quoted from what the person typed, that cannot be done.'),
  reason: z.string().describe('Which capability would be needed, in one sentence.'),
})

const ANSWER_ONLY_DESCRIPTION =
  'Answer the person in prose and perform no action. Use this when the request asks for '
  + 'information rather than for something to happen. ONE CALL PER CLAUSE you are answering, '
  + 'naming that clause in `clause` copied verbatim from the list you were given: this call '
  + 'covers the clause it names and no other, and any clause left neither named here nor bound '
  + 'to a tool refuses the whole turn.'

const MARK_UNHANDLED_DESCRIPTION =
  'Declare that a part of the request cannot be carried out with the tools available. Naming it '
  + 'here refuses the whole turn without performing any of it, which is the correct outcome — '
  + 'never substitute a different tool that looks close.'

/**
 * Build the model's entire action vocabulary from the capabilities this host declares.
 *
 * The caller is the PLANNER's caller, minted at the composition root with agent origin (Pitfall 1).
 * It matters here only through the registry's own safe-mode listing filter; the equivalence between
 * this set and the walk holds for whichever caller a host supplies, because both sides read the
 * same listing.
 */
export function projectPlannerTools(source: PlannerToolSource, caller: FunctionCaller): ToolSet {
  const tools: Record<string, Tool> = {}

  for (const declaration of source.list(caller)) {
    const name = toToolName(declaration.id)
    if (Object.hasOwn(tools, name)) {
      // Unreachable while `toToolName` stays injective over the id grammar, and asserted anyway:
      // a silent last-wins here would drop a capability from the model's vocabulary and leave the
      // walk-equivalence test comparing two sets that both lost the same member.
      throw new ChatToolNameError(
        declaration.id,
        `projects onto "${name}", which another registered capability already occupies`,
      )
    }
    tools[name] = tool({
      // `dynamic` is the literal truth about these tools rather than a convenience: their input
      // shapes are known at runtime, off the registry this host composed, and not at the time this
      // module is written. It also makes the read-back uniform — every action call comes back with
      // an unknown input the reconciler validates through the function layer's real contract.
      type: 'dynamic',
      description: declaration.summary,
      // The declaration's own inert projection, handed over as-is. Deriving a second schema here
      // would be a second description of a contract the layer already publishes, free to disagree
      // with the validator `invokeFunction` actually enforces with.
      inputSchema: jsonSchema(declaration.input as never),
      // NO `execute`. See the file header — this absence is the mechanism, not an oversight.
    })
  }

  tools[ANSWER_ONLY_TOOL_NAME] = tool({
    description: ANSWER_ONLY_DESCRIPTION,
    inputSchema: ANSWER_ONLY_INPUT_SCHEMA,
  })
  tools[MARK_UNHANDLED_TOOL_NAME] = tool({
    description: MARK_UNHANDLED_DESCRIPTION,
    inputSchema: MARK_UNHANDLED_INPUT_SCHEMA,
  })

  return tools
}
