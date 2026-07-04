// The bounded planning tool-loop (net-new, D-06/D-07/D-08/D-09).
//
// Per planning turn the model may make up to K non-action tool calls — each is
// executed, its result appended as a tool message, the conversation continues — and
// the turn terminates when the model emits exactly one action tool call. K is an
// internal runner constant (default 2), injectable via options for tests, and NEVER
// user-facing config (D-06): it is not threaded through LoopPorts or any config schema.
//
// Zero non-action tools ship in 353 (D-07). The always-send-all law holds: the full
// v45 action slice is always sent, plus any caller-registered non-action tools; the
// surface never shrinks or gates. The machinery is proven with test-registered fakes.
//
// Degenerate-response policy (D-08):
//   (a) K exhausted + another non-action call ⇒ append a structured budget-exhausted
//       tool-result telling the model it must now choose exactly one action, continue
//       the turn; a further non-action-only response ⇒ a structured planning failure.
//   (b) text-only response (no tool call) ⇒ exactly one re-prompt with
//       toolChoice:'required', then a structured planning failure.
//   (c) multiple tool calls in one response ⇒ process non-action calls in order until
//       the first action call, discard anything after it, log the discard.
//
// This module contains NO `throw` statement: every degenerate model output returns a
// structured failure that feeds the failure-context/replan path (T-353-04). The only
// throws that surface are the abort propagation from generateText and the untouched
// zod schemaInvalid grounding error from toolCallToActionPlan (D-09 / T-353-05).
import { generateText } from 'ai'
import type { LanguageModel, ModelMessage, SystemModelMessage, Tool, ToolCallPart, ToolResultPart, ToolSet } from 'ai'
import type { ActionPlan } from './types.js'
import type { TokenUsage } from '../result.js'
import type { LoopScopedLogger } from './ports.js'
import { toolCallToActionPlan } from '../tools/builder.js'
import type { ToolRegistry } from '../tools/registry.js'

/**
 * K — the per-turn non-action tool-call budget (D-06). Internal runner constant;
 * injectable via ExecutePlanningTurnOptions.budget for tests only. Do NOT promote to
 * user-facing config or thread through LoopPorts / any config schema.
 */
export const DEFAULT_NON_ACTION_TOOL_BUDGET = 2

const BUDGET_EXHAUSTED_MESSAGE =
  'Tool budget exhausted — you must now choose exactly one action tool.'

/**
 * A caller-registered non-action tool. `tool` is the `ai` definition merged into the
 * always-send-all slice; `execute` runs the call and returns a JSON-serializable
 * result appended to the conversation as a tool message. Zero of these ship in 353;
 * tests register fakes to exercise the machinery (D-07).
 */
export interface NonActionToolHandler {
  tool: Tool
  execute(args: Record<string, unknown>): Promise<unknown> | unknown
}

export type NonActionToolMap = Record<string, NonActionToolHandler>

/**
 * An ordered record of one executed non-action tool call within a planning turn
 * (§B1). Kept in-memory on the turn result for M1b's cassette extractor; NO schema
 * field is minted for it in this phase (Deferred Ideas fence).
 */
export interface ToolExchange {
  tool: string
  args: Record<string, unknown>
  result: unknown
}

export type PlanningTurnFailureReason =
  | 'no_action_tool_called'
  | 'non_action_tool_budget_exhausted'

export interface PlanningTurnSuccess {
  ok: true
  plan: ActionPlan
  exchanges: ToolExchange[]
  tokenUsage?: TokenUsage
}

export interface PlanningTurnFailure {
  ok: false
  reason: PlanningTurnFailureReason
  message: string
  exchanges: ToolExchange[]
  tokenUsage?: TokenUsage
}

export type PlanningTurnResult = PlanningTurnSuccess | PlanningTurnFailure

export interface ExecutePlanningTurnOptions {
  model: LanguageModel
  /** Registry backing toolCallToActionPlan (the turn's termination projection). */
  registry: ToolRegistry
  /** The full v45 action slice (buildTools output) — always sent (always-send-all). */
  actionTools: ToolSet
  /**
   * System prompt — a single string, or the Phase 355 [stable, context, volatile]
   * tier array the caller assembles (D-15). Passed through to generateText untouched;
   * the tool-loop applies no clamp/degrade policy of its own.
   */
  system: string | Array<SystemModelMessage>
  /** The initial user message(s): text and optional image, built by the caller. */
  messages: ModelMessage[]
  /** Caller-registered non-action tools. Empty in production (D-07). */
  nonActionTools?: NonActionToolMap
  /** K override for tests (D-06). Defaults to DEFAULT_NON_ACTION_TOOL_BUDGET. */
  budget?: number
  /**
   * Dynamic output cap (CTXB-04) computed by the caller's clamp helper and passed
   * through to generateText. `undefined` is a valid no-op passthrough — the tool-loop
   * computes no clamp of its own (D-15/Pitfall 5).
   */
  maxOutputTokens?: number
  abortSignal?: AbortSignal
  logger?: LoopScopedLogger
}

/** Defensive tool-call arg extraction across SDK key variants (v1 planner.ts:104-110). */
function extractArgs(tc: unknown): Record<string, unknown> {
  const t = tc as Record<string, unknown>
  const raw = t.args ?? t.input ?? t.arguments ?? t.toolInput
  return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
}

function assistantToolCallMessage(
  toolCalls: { toolCallId: string; toolName: string }[],
): ModelMessage {
  const content: ToolCallPart[] = toolCalls.map(tc => ({
    type: 'tool-call',
    toolCallId: tc.toolCallId,
    toolName: tc.toolName,
    input: extractArgs(tc),
  }))
  return { role: 'assistant', content }
}

function jsonResultPart(
  tc: { toolCallId: string; toolName: string },
  result: unknown,
): ToolResultPart {
  return {
    type: 'tool-result',
    toolCallId: tc.toolCallId,
    toolName: tc.toolName,
    output: { type: 'json', value: result as never },
  }
}

function errorResultPart(
  tc: { toolCallId: string; toolName: string },
  message: string,
): ToolResultPart {
  return {
    type: 'tool-result',
    toolCallId: tc.toolCallId,
    toolName: tc.toolName,
    output: { type: 'error-text', value: message },
  }
}

export async function executePlanningTurn(
  options: ExecutePlanningTurnOptions,
): Promise<PlanningTurnResult> {
  const budgetLimit = options.budget ?? DEFAULT_NON_ACTION_TOOL_BUDGET
  const nonActionTools = options.nonActionTools ?? {}

  // Always-send-all: the full v45 action slice plus any caller-registered non-action
  // tools. The surface never shrinks or gates (D-07).
  const combinedTools: ToolSet = { ...options.actionTools }
  for (const [id, handler] of Object.entries(nonActionTools)) {
    combinedTools[id] = handler.tool
  }

  const messages: ModelMessage[] = [...options.messages]
  const exchanges: ToolExchange[] = []
  let budget = budgetLimit
  let promptTokens = 0
  let completionTokens = 0
  let usageSeen = false
  let rePromptedForNoTool = false
  let budgetErrorInjected = false

  const tokenUsage = (): TokenUsage | undefined =>
    usageSeen
      ? { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens }
      : undefined

  // Iteration backstop: at most K executed non-action calls, plus the exhaustion
  // re-prompt, the no-tool re-prompt, and the terminating action response.
  const maxIterations = budgetLimit + 4

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    // generateText errors (including abort) propagate to the caller untouched.
    const result = await generateText({
      model: options.model,
      maxRetries: 0,
      maxOutputTokens: options.maxOutputTokens,
      tools: combinedTools,
      toolChoice: 'required',
      system: options.system,
      abortSignal: options.abortSignal,
      messages,
    })

    if (result.usage) {
      usageSeen = true
      promptTokens += result.usage.inputTokens ?? 0
      completionTokens += result.usage.outputTokens ?? 0
    }

    const toolCalls = result.toolCalls ?? []

    // D-08(b): text-only response — one re-prompt, then planning failure.
    if (toolCalls.length === 0) {
      if (!rePromptedForNoTool) {
        rePromptedForNoTool = true
        messages.push({
          role: 'user',
          content: 'You did not call a tool. You must call exactly one action tool to proceed.',
        })
        continue
      }
      return {
        ok: false,
        reason: 'no_action_tool_called',
        message: 'Model produced no action tool call after a re-prompt.',
        exchanges,
        tokenUsage: tokenUsage(),
      }
    }

    // Scan tool calls in order until the first action call (D-08c).
    const toolResultParts: ToolResultPart[] = []
    let actionCall: { name: string; args: Record<string, unknown> } | undefined
    let discardedAfterAction = 0
    let sawOverBudgetNonAction = false

    for (let i = 0; i < toolCalls.length; i++) {
      const tc = toolCalls[i]
      const name = tc.toolName
      const args = extractArgs(tc)

      // Action tool → terminate. Membership in the non-action map is the classifier;
      // everything else (the always-sent v45 slice) is an action.
      if (!(name in nonActionTools)) {
        actionCall = { name, args }
        discardedAfterAction = toolCalls.length - i - 1
        break
      }

      // Non-action tool.
      if (budget <= 0) {
        // D-08(a): over budget — inject the structured error, do not execute.
        sawOverBudgetNonAction = true
        toolResultParts.push(errorResultPart(tc, BUDGET_EXHAUSTED_MESSAGE))
        continue
      }
      const execResult = await nonActionTools[name].execute(args)
      exchanges.push({ tool: name, args, result: execResult })
      toolResultParts.push(jsonResultPart(tc, execResult))
      budget -= 1
    }

    if (actionCall) {
      if (discardedAfterAction > 0) {
        options.logger?.warn('Discarded tool calls after the first action call', {
          discarded: discardedAfterAction,
          action: actionCall.name,
        })
      }
      // toolCallToActionPlan validates via zod; the schemaInvalid grounding error is
      // preserved untouched (D-09 / T-353-05) and propagates if the args are malformed.
      const plan = toolCallToActionPlan(actionCall.name, actionCall.args, options.registry) as ActionPlan
      return { ok: true, plan, exchanges, tokenUsage: tokenUsage() }
    }

    // No action this response — append the model's tool calls and their results so the
    // conversation stays coherent, then continue the turn.
    messages.push(assistantToolCallMessage(toolCalls))
    if (toolResultParts.length > 0) {
      messages.push({ role: 'tool', content: toolResultParts })
    }

    if (sawOverBudgetNonAction) {
      // D-08(a): first over-budget response injects the error and continues; a further
      // non-action-only response is a planning failure.
      if (budgetErrorInjected) {
        return {
          ok: false,
          reason: 'non_action_tool_budget_exhausted',
          message: BUDGET_EXHAUSTED_MESSAGE,
          exchanges,
          tokenUsage: tokenUsage(),
        }
      }
      budgetErrorInjected = true
    }
  }

  // Iteration backstop reached — treated as a budget-exhaustion failure, never a throw.
  return {
    ok: false,
    reason: 'non_action_tool_budget_exhausted',
    message: 'Planning turn exceeded its iteration backstop.',
    exchanges,
    tokenUsage: tokenUsage(),
  }
}
