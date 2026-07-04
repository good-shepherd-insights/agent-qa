// Runner-owned LLM verifier (re-derived from core/src/agent/verifier.ts, D-02/D-04).
// Byte-equivalent behavior: Output.object structured verification with maxRetries: 0,
// empty-output throw, and a never-crash catch-all fallback — abort is the only rethrow
// (the loop's abort path depends on it, T-353-07 mitigation). §12.2 structured-assert
// semantics are Phase 360; no semantic changes here.
import { generateText, Output } from 'ai'
import type { LanguageModel, ModelMessage, SystemModelMessage } from 'ai'
import { z } from 'zod'
import type { ScreenState } from '@vostride/agent-qa-schema'
import type { Action } from '../platform.js'
import type { Verifier, VerifyResult } from './types.js'
import type { TokenAccounting } from './ports.js'
import { buildVerificationPrompt, buildVerifierStableTier } from './prompts.js'

// Three-outcome verification strategy (multi-action replanning):
// The planner self-reports goal completion via stepComplete. The verifier
// is only called on stepComplete: true or execution failure.
//   - success: true  + stepComplete: true  → goal met, step done
//   - success: true  + stepComplete: false → action worked but goal not met, continue
//   - success: false                       → action failed, inject error and replan
export const VerificationResultSchema = z.object({
  success: z.boolean().describe('Whether the step goal was accomplished'),
  reasoning: z.string().describe('Explanation of why the step succeeded or failed'),
  isAppError: z.boolean().describe(
    'Whether the page shows an application error (HTTP error, error toast, crash) vs the agent simply not accomplishing the goal',
  ),
})

export class LLMVerifier implements Verifier {
  private model: LanguageModel
  private accounting: TokenAccounting

  // TokenAccounting is a required constructor dependency (D-15 constructor-injection):
  // the verifier holds its OWN instance (not the planner's — distinct cache entry, D-11)
  // and rides the same clamp/degrade/recordUsage seam every verifier call goes through
  // (CTXB-04). Plan 07 constructs a distinct verifierAccounting at the composition root.
  constructor(model: LanguageModel, accounting: TokenAccounting) {
    this.model = model
    this.accounting = accounting
  }

  async verify(
    step: string,
    before: ScreenState,
    after: ScreenState,
    action: Action,
    screenshot?: Buffer,
    abortSignal?: AbortSignal,
    promptNote?: string,
  ): Promise<VerifyResult> {
    try {
      const promptText = buildVerificationPrompt(step, before, after, action, !!screenshot, promptNote)

      const outputConfig = Output.object({
        schema: VerificationResultSchema,
        name: 'verification_result',
        description: 'Verification of whether the test step succeeded',
      })

      // Verdict-identity cached stable prefix (D-11): a one-tier SystemModelMessage array
      // carrying the single Anthropic ephemeral cache_control breakpoint. Byte-stable per
      // run (buildVerifierStableTier is arg-less), so it forms the verifier's own cache
      // entry — distinct system content from the planner ⇒ a distinct cache key. The
      // `anthropic` providerOptions namespace is a transparent no-op on other providers.
      // No planner-ingredient parity (previous-steps / working-memory framing) is added.
      const system: SystemModelMessage[] = [{
        role: 'system',
        content: buildVerifierStableTier(),
        providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } },
      }]

      // The single per-call turn message: before/after states + action as text, plus the
      // screenshot image part when present. It is the only turn message (and the final
      // message) — pinned by construction so the clamp never evicts the states/action.
      const turnMessage: ModelMessage = {
        role: 'user',
        content: screenshot
          ? [
              { type: 'text', text: promptText },
              { type: 'image', image: screenshot },
            ]
          : [{ type: 'text', text: promptText }],
      }

      const result = await this.runVerification(system, turnMessage, outputConfig, abortSignal)

      if (!result.output) {
        throw new Error('LLM returned empty response — no verification result')
      }

      const inputTokens = result.usage?.inputTokens ?? 0
      const outputTokens = result.usage?.outputTokens ?? 0
      return {
        verification: result.output,
        tokenUsage: result.usage ? {
          promptTokens: inputTokens,
          completionTokens: outputTokens,
          totalTokens: inputTokens + outputTokens,
        } : undefined,
      }
    } catch (error: unknown) {
      if (abortSignal?.aborted) throw error
      return {
        verification: {
          success: false,
          reasoning: `Verification failed: ${error instanceof Error ? error.message : String(error)}`,
          isAppError: false,
        },
      }
    }
  }

  // Single structured verification call over the cached stable tier + the pinned turn
  // message. Task 2 wraps this in the shared clamp/degrade/retry-once + recordUsage seam.
  private async runVerification(
    system: SystemModelMessage[],
    turnMessage: ModelMessage,
    outputConfig: ReturnType<typeof Output.object>,
    abortSignal?: AbortSignal,
  ) {
    return generateText({
      model: this.model,
      maxRetries: 0,
      output: outputConfig,
      abortSignal,
      system,
      messages: [turnMessage],
    })
  }
}
