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
import { generateText } from 'ai'
import type { LanguageModel } from 'ai'
import type { Platform, ScreenState } from '@vostride/agent-qa-schema'
import type { Planner, PlanResult, StepContext } from './types.js'
import type { LoopScopedLogger } from './ports.js'
import { buildSystemPrompt, buildStepPrompt } from './prompts.js'
import { buildTools, toolCallToActionPlan, defaultRegistry } from '../tools/index.js'

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
    const prompt = buildStepPrompt(step, screenState, context, this.logger, {
      platform: this.platform,
      agentRules: this.agentRules,
    })
    const systemPrompt = buildSystemPrompt(this.platform, this.agentRules)
    const screenshot = context.screenshot

    const tools = buildTools(defaultRegistry, { platform: this.platform })

    let result
    try {
      if (screenshot) {
        try {
          result = await generateText({
            model: this.model,
            maxRetries: 0,
            tools,
            toolChoice: 'required',
            system: systemPrompt,
            abortSignal,
            messages: [{
              role: 'user',
              content: [
                { type: 'text', text: prompt },
                { type: 'image', image: screenshot },
              ],
            }],
          })
        } catch (err) {
          this.logger?.warn('Screenshot send failed, retrying without image', { error: err instanceof Error ? err.message : String(err) })
          const fallbackPrompt = prompt + '\n\n[Note: Visual screenshot is unavailable for this step. Rely on the accessibility tree and DOM context for element identification.]'
          result = await generateText({
            model: this.model,
            maxRetries: 0,
            tools,
            toolChoice: 'required',
            system: systemPrompt,
            abortSignal,
            prompt: fallbackPrompt,
          })
        }
      } else {
        result = await generateText({
          model: this.model,
          maxRetries: 0,
          tools,
          toolChoice: 'required',
          system: systemPrompt,
          abortSignal,
          prompt,
        })
      }
    } catch (err) {
      if (abortSignal?.aborted) throw err
      const errorMsg = err instanceof Error ? err.message : String(err)
      // Handle tool-related errors with clear messages
      if (errorMsg.includes('no such tool') || errorMsg.includes('tool_not_found') || errorMsg.includes('unknown tool')) {
        const availableTools = Object.keys(tools).join(', ')
        this.logger?.warn('LLM called unknown tool', { error: errorMsg, availableTools })
        throw new Error(`LLM called unknown tool. Available tools: ${availableTools}. Error: ${errorMsg}`)
      }
      if (errorMsg.includes('invalid_tool_input') || errorMsg.includes('tool input') || errorMsg.includes('schema validation')) {
        this.logger?.warn('LLM provided invalid tool input', { error: errorMsg })
        throw new Error(`LLM provided invalid tool input: ${errorMsg}`)
      }
      throw err
    }

    // Extract the tool call — the tool name is the action type
    const toolCall = result.toolCalls?.[0]
    if (!toolCall) {
      throw new Error('LLM did not call any action tool')
    }

    const tc = toolCall as { toolName: string; args?: Record<string, unknown>; input?: Record<string, unknown>; [k: string]: unknown }
    const rawArgs = tc.args ?? tc.input ?? (tc as Record<string, unknown>).arguments ?? (tc as Record<string, unknown>).toolInput
    if (!rawArgs || typeof rawArgs !== 'object') {
      const keys = Object.keys(tc).filter(k => k !== 'type')
      this.logger?.warn('Tool call args missing', { toolName: tc.toolName, keys, raw: JSON.stringify(tc).slice(0, 500) })
      throw new Error(`LLM tool call '${tc.toolName}' returned no args. Tool call keys: [${keys.join(', ')}]. Raw: ${JSON.stringify(tc).slice(0, 300)}`)
    }
    const toolArgs = rawArgs as Record<string, unknown>
    this.logger?.debug('Tool call', {
      action: tc.toolName,
      ...(toolArgs.ref ? { ref: toolArgs.ref } : {}),
      ...(toolArgs.url ? { url: toolArgs.url } : {}),
      ...(toolArgs.value ? { value: String(toolArgs.value).slice(0, 50) } : {}),
      ...(toolArgs.direction ? { direction: toolArgs.direction } : {}),
      ...(toolArgs.condition ? { condition: String(toolArgs.condition).slice(0, 80) } : {}),
      ...(toolArgs.key ? { key: toolArgs.key } : {}),
      confidence: toolArgs.confidence,
      stepComplete: toolArgs.stepComplete,
      stepFailed: toolArgs.stepFailed,
    })

    const plan = toolCallToActionPlan(tc.toolName, toolArgs, defaultRegistry)

    const inputTokens = result.usage?.inputTokens ?? 0
    const outputTokens = result.usage?.outputTokens ?? 0

    this.logger?.info('LLM plan generated', {
      model: typeof this.model === 'object' && this.model && 'modelId' in this.model ? (this.model as { modelId: string }).modelId : 'unknown',
      promptTokens: inputTokens,
      completionTokens: outputTokens,
      latencyMs: performance.now() - planStart,
      confidence: plan.confidence,
      actionType: plan.action?.type,
    })

    return {
      plan,
      tokenUsage: result.usage ? {
        promptTokens: inputTokens,
        completionTokens: outputTokens,
        totalTokens: inputTokens + outputTokens,
      } : undefined,
    }
  }
}
