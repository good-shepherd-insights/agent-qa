// Runner-owned LLM planner (re-derived from core/src/agent/planner.ts, D-02/D-04).
// Constructed with an injected `LanguageModel` handle — the runner orchestrates via
// the neutral `ai` SDK and never resolves a provider (D-04). v1 semantics preserved
// exactly: the generateText call shape (toolChoice: 'required' over the full v45 tool
// slice), the screenshot-failure fallback (retry once without the image), defensive
// tool-call arg extraction across SDK key variants, and token-usage accumulation.
//
// In 353-02 Task 2 the LLM exchange is delegated to executePlanningTurn (the bounded
// planning tool-loop); this file keeps the one-shot behavior byte-identical when zero
// non-action tools are bound (D-07).
import type { LanguageModel } from 'ai'
import type { Platform, ScreenState } from '@vostride/agent-qa-schema'
import type { Planner, PlanResult, StepContext } from './types.js'
import type { LoopScopedLogger } from './ports.js'
import { buildSystemPrompt, composeTurnMessages } from './prompts.js'
import { buildTools, defaultRegistry } from '../tools/index.js'
import { executePlanningTurn, type PlanningTurnResult } from './planning-turn.js'

// Flatten the text parts of the decomposed turn messages into v1's single user-prompt
// string (355-03 interim). Image parts are dropped here — the planner attaches the
// screenshot on its own below. Plan 05 drives the decomposed messages directly.
function flattenTurnText(messages: ReturnType<typeof composeTurnMessages>): string {
  return messages
    .map((m) =>
      typeof m.content === 'string'
        ? m.content
        : m.content
            .map((part) => ('text' in part && typeof part.text === 'string' ? part.text : ''))
            .join(''),
    )
    .join('\n')
}

export class LLMPlanner implements Planner {
  private model: LanguageModel
  private platform: Platform
  private logger?: LoopScopedLogger
  private agentRules?: string

  constructor(model: LanguageModel, platform: Platform = 'web', logger?: LoopScopedLogger, agentRules?: string) {
    this.model = model
    this.platform = platform
    this.logger = logger
    this.agentRules = agentRules
  }

  async plan(
    step: string,
    screenState: ScreenState,
    context: StepContext,
    abortSignal?: AbortSignal,
  ): Promise<PlanResult> {
    const planStart = performance.now()
    // Turn content is now decomposed into pinnable messages (355-03, D-09). This call
    // site keeps v1's single-user-string shape by flattening the text parts of those
    // messages; Plan 05 replaces this with the full [stable, context, volatile] system
    // tiers + the decomposed messages + the degrade/clamp + recordUsage wiring.
    const turnMessages = composeTurnMessages({ ...context, stepInstruction: step }, screenState)
    const prompt = flattenTurnText(turnMessages)
    const systemPrompt = buildSystemPrompt(this.platform, this.agentRules)
    const screenshot = context.screenshot

    const actionTools = buildTools(defaultRegistry, { platform: this.platform })

    // Delegate the LLM exchange to the bounded planning tool-loop (D-06). Zero
    // non-action tools are bound (D-07), so the turn behaves as a one-shot: exactly
    // one generateText call, terminating on the first (action) tool call — provably
    // identical to v1's one-shot planner. The screenshot-failure fallback stays here:
    // it retries the whole turn without the image, matching v1's single-call fallback
    // (with no non-action tools there is only one call per turn).
    let turnResult: PlanningTurnResult
    try {
      if (screenshot) {
        try {
          turnResult = await executePlanningTurn({
            model: this.model,
            registry: defaultRegistry,
            actionTools,
            system: systemPrompt,
            messages: [{
              role: 'user',
              content: [
                { type: 'text', text: prompt },
                { type: 'image', image: screenshot },
              ],
            }],
            abortSignal,
            logger: this.logger,
          })
        } catch (err) {
          this.logger?.warn('Screenshot send failed, retrying without image', { error: err instanceof Error ? err.message : String(err) })
          const fallbackPrompt = prompt + '\n\n[Note: Visual screenshot is unavailable for this step. Rely on the accessibility tree and DOM context for element identification.]'
          turnResult = await executePlanningTurn({
            model: this.model,
            registry: defaultRegistry,
            actionTools,
            system: systemPrompt,
            messages: [{ role: 'user', content: fallbackPrompt }],
            abortSignal,
            logger: this.logger,
          })
        }
      } else {
        turnResult = await executePlanningTurn({
          model: this.model,
          registry: defaultRegistry,
          actionTools,
          system: systemPrompt,
          messages: [{ role: 'user', content: prompt }],
          abortSignal,
          logger: this.logger,
        })
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
