// Runner-owned LLM planner (re-derived from core/src/agent/planner.ts, D-02/D-04).
// Constructed with an injected `LanguageModel` handle — the runner orchestrates via
// the neutral `ai` SDK and never resolves a provider (D-04). v1 semantics preserved
// exactly: the generateText call shape (toolChoice: 'required' over the full v45 tool
// slice), the screenshot-failure fallback (retry once without the image), defensive
// tool-call arg extraction across SDK key variants, and token-usage accumulation.
//
// Phase 355 (CTXB-01/CTXB-02/CTXB-04) rewires the call site off v1's single crammed
// user-string onto: (a) the cache-ordered [stable, context, volatile] system tier array
// carrying the single Anthropic ephemeral cache_control breakpoint (on the context tier),
// (b) the decomposed pinnable turn messages from composeTurnMessages, and (c) the shared
// clamp/degrade/retry-once wrapper (executeClampedCall) fed by an injected TokenAccounting
// port. Zero non-action tools are bound (D-07), so executePlanningTurn behaves as v1's
// one-shot per turn; the screenshot fallback and maxRetries:0 semantics are preserved.
import type { LanguageModel, ModelMessage, SystemModelMessage } from 'ai'
import type { Platform, ScreenState } from '@vostride/agent-qa-schema'
import type { Planner, PlanResult, StepContext } from './types.js'
import type { LoopScopedLogger, TokenAccounting } from './ports.js'
import { buildSystemPrompt, buildContextTier, buildVolatileTier, composeTurnMessages } from './prompts.js'
import { buildTools, defaultRegistry } from '../tools/index.js'
import { executePlanningTurn, type PlanningTurnResult } from './planning-turn.js'

// The text-only fallback note appended to the current-instruction message when the
// screenshot send fails (D-11). Byte-identical to v1's note so the fallback turn matches.
const SCREENSHOT_UNAVAILABLE_NOTE =
  '[Note: Visual screenshot is unavailable for this step. Rely on the accessibility tree and DOM context for element identification.]'

export class LLMPlanner implements Planner {
  private model: LanguageModel
  private platform: Platform
  private logger?: LoopScopedLogger
  private agentRules?: string
  private accounting: TokenAccounting

  // TokenAccounting is a required constructor dependency (D-15 constructor-injection):
  // it is the clamp/degrade/recordUsage seam every planning call rides. The composition
  // roots (CLI/dashboard) inject it in Plan 07. Positional order is preserved so existing
  // call sites keep model/platform/logger/agentRules; `accounting` is the new final arg.
  constructor(
    model: LanguageModel,
    platform: Platform | undefined,
    logger: LoopScopedLogger | undefined,
    agentRules: string | undefined,
    accounting: TokenAccounting,
  ) {
    this.model = model
    this.platform = platform ?? 'web'
    this.logger = logger
    this.agentRules = agentRules
    this.accounting = accounting
  }

  // Cache-ordered [stable, context, volatile] system tiers (D-04/D-05/D-07). The single
  // Anthropic ephemeral cache_control breakpoint rides the context tier (buildContextTier
  // sets it at message-level providerOptions); the stable tier sits above it and the
  // volatile tier (knowledge brief + date-granularity stamp) below it. Per-turn state never
  // enters these tiers — it rides composeTurnMessages after the system region. Non-Anthropic
  // providers never parse the `anthropic` namespace, so the breakpoint is a transparent no-op.
  private buildSystemTiers(context: StepContext): SystemModelMessage[] {
    return [
      { role: 'system', content: buildSystemPrompt(this.platform, this.agentRules) },
      buildContextTier(context),
      buildVolatileTier(context),
    ]
  }

  async plan(
    step: string,
    screenState: ScreenState,
    context: StepContext,
    abortSignal?: AbortSignal,
  ): Promise<PlanResult> {
    const planStart = performance.now()
    const turnContext: StepContext = { ...context, stepInstruction: step }
    const system = this.buildSystemTiers(turnContext)
    const actionTools = buildTools(defaultRegistry, { platform: this.platform })

    // One clamped/degraded planning call over the decomposed turn messages. Task 1 wires
    // the tier array + decomposed messages; Task 2 wraps this in executeClampedCall.
    const runTurn = (messages: ModelMessage[]): Promise<PlanningTurnResult> =>
      executePlanningTurn({
        model: this.model,
        registry: defaultRegistry,
        actionTools,
        system,
        messages,
        abortSignal,
        logger: this.logger,
      })

    // Zero non-action tools are bound (D-07): the turn is a one-shot, provably identical
    // to v1's single-call planner. The screenshot-failure fallback retries the whole turn
    // without the image (v1 parity), re-composing the turn messages with the text-only note.
    let turnResult: PlanningTurnResult
    try {
      if (context.screenshot) {
        try {
          turnResult = await runTurn(composeTurnMessages(turnContext, screenState))
        } catch (err) {
          this.logger?.warn('Screenshot send failed, retrying without image', {
            error: err instanceof Error ? err.message : String(err),
          })
          const fallbackNote = turnContext.promptNote
            ? `${turnContext.promptNote}\n${SCREENSHOT_UNAVAILABLE_NOTE}`
            : SCREENSHOT_UNAVAILABLE_NOTE
          const fallbackContext: StepContext = { ...turnContext, screenshot: undefined, promptNote: fallbackNote }
          turnResult = await runTurn(composeTurnMessages(fallbackContext, screenState))
        }
      } else {
        turnResult = await runTurn(composeTurnMessages(turnContext, screenState))
      }
    } catch (err) {
      if (abortSignal?.aborted) throw err
      const errorMsg = err instanceof Error ? err.message : String(err)
      // Handle tool-related errors with clear messages
      if (errorMsg.includes('no such tool') || errorMsg.includes('tool_not_found') || errorMsg.includes('unknown tool')) {
        const availableTools = Object.keys(actionTools).join(', ')
        this.logger?.warn('LLM called unknown tool', { error: errorMsg, availableTools })
        throw new Error(`LLM called unknown tool. Available tools: ${availableTools}. Error: ${errorMsg}`)
      }
      if (errorMsg.includes('invalid_tool_input') || errorMsg.includes('tool input') || errorMsg.includes('schema validation')) {
        this.logger?.warn('LLM provided invalid tool input', { error: errorMsg })
        throw new Error(`LLM provided invalid tool input: ${errorMsg}`)
      }
      throw err
    }

    if (!turnResult.ok) {
      // D-08 replaces v1's `throw new Error('LLM did not call any action tool')` inside
      // the turn with a structured failure. The loop consumes that failure to feed the
      // replan path in wave 4; here we surface it to preserve v1's Planner contract.
      throw new Error(`Planning turn failed (${turnResult.reason}): ${turnResult.message}`)
    }

    const plan = turnResult.plan

    this.logger?.info('LLM plan generated', {
      model: typeof this.model === 'object' && this.model && 'modelId' in this.model ? (this.model as { modelId: string }).modelId : 'unknown',
      promptTokens: turnResult.tokenUsage?.promptTokens ?? 0,
      completionTokens: turnResult.tokenUsage?.completionTokens ?? 0,
      latencyMs: performance.now() - planStart,
      confidence: plan.confidence,
      actionType: plan.action?.type,
    })

    return {
      plan,
      tokenUsage: turnResult.tokenUsage,
    }
  }
}
