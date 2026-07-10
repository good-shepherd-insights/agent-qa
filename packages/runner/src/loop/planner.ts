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
import type { LanguageModel, LanguageModelUsage, ModelMessage, SystemModelMessage } from 'ai'
import type {
  DeclaredModelProfile,
  ElementInfo,
  ModelCallRecord,
  Platform,
  ScreenState,
  ToolExchangeEvidence,
} from '@vostride/agent-qa-schema'
import type { Planner, PlanResult, StepContext } from './types.js'
import type { LoopScopedLogger, TokenAccounting } from './ports.js'
import { buildSystemPrompt, buildContextTier, buildVolatileTier, composeTurnMessages } from './prompts.js'
import { buildTools, defaultRegistry } from '../tools/index.js'
import {
  executePlanningTurn,
  type GroundabilityCallback,
  type PlanningTurnFailureReason,
  type PlanningTurnResult,
} from './planning-turn.js'
import { executeClampedCall, type ClampedCallResult } from './clamp.js'
import { groundActionPlan } from '../grounding/gate.js'
import { matchDescriptor } from '../grounding/matcher.js'
import { buildAnchorKey } from './progress/stagnation-tree.js'

// The text-only fallback note appended to the current-instruction message when the
// screenshot send fails (D-11). Byte-identical to v1's note so the fallback turn matches.
const SCREENSHOT_UNAVAILABLE_NOTE =
  '[Note: Visual screenshot is unavailable for this step. Rely on the accessibility tree and DOM context for element identification.]'

// Max characters of a provider `responseBody` to carry into log meta / rethrown messages —
// bounds an accidentally-large error body so a swallowed catch never dumps an unbounded blob.
const MAX_RESPONSE_BODY_CHARS = 500

/**
 * Structured planning-turn failure used to preserve failed-turn evidence across
 * the planner's throw-based public contract (D-03).
 */
export class PlanningTurnError extends Error {
  readonly reason: PlanningTurnFailureReason
  readonly exchanges: ToolExchangeEvidence[]
  readonly callRecord?: ModelCallRecord

  constructor(
    reason: PlanningTurnFailureReason,
    message: string,
    exchanges: ToolExchangeEvidence[],
    callRecord?: ModelCallRecord,
  ) {
    super(`Planning turn failed (${reason}): ${message}`)
    this.name = 'PlanningTurnError'
    this.reason = reason
    this.exchanges = exchanges
    this.callRecord = callRecord
  }
}

// RUNX-04 (planner half): duck-typed `@ai-sdk/provider` APICallError extraction — mirrors
// `packages/cli/src/commands/auth.ts` `extractProviderError`. The runner stays provider-neutral
// (no model/@ai-sdk import): it reads the structural `statusCode?: number` + `responseBody?:
// string` fields off the error object. Returns undefined when NEITHER field is present (an
// ordinary Error), so the existing rethrow paths are unaffected. `detail` is the provider's own
// words parsed out of a JSON responseBody (e.g. codex's "Unsupported parameter: max_output_tokens").
function extractProviderError(
  err: unknown,
): { statusCode?: number; responseBody?: string; detail?: string } | undefined {
  if (err === null || typeof err !== 'object') return undefined
  const e = err as { statusCode?: unknown; responseBody?: unknown }
  const statusCode = typeof e.statusCode === 'number' ? e.statusCode : undefined
  const rawBody = typeof e.responseBody === 'string' ? e.responseBody : undefined
  if (statusCode === undefined && rawBody === undefined) return undefined

  const responseBody = rawBody !== undefined ? rawBody.slice(0, MAX_RESPONSE_BODY_CHARS) : undefined
  let detail: string | undefined
  if (rawBody !== undefined) {
    try {
      const body = JSON.parse(rawBody) as { detail?: unknown; error?: { message?: unknown } }
      if (typeof body?.detail === 'string') detail = body.detail
      else if (typeof body?.error?.message === 'string') detail = body.error.message
    } catch {
      // Provider did not return JSON — the bounded responseBody still carries its words.
    }
  }
  return { statusCode, responseBody, detail }
}

// D-04 longpress-for-tap ban resolution. Resolve the emitted action's target to the STABLE
// element anchor (role + nameNormalized + same-screen ordinal) — never the volatile ref string —
// so the ban keys on the exact identity the stagnation tree does (buildAnchorKey, reused). Reads a
// `ref` against the fresh observation, or resolves a `target` descriptor via the shared matcher.
// Returns undefined when the target does not resolve on this observation (⇒ no ban fires).
function resolveActionAnchorKey(
  action: { [key: string]: unknown },
  screenState: ScreenState,
): string | undefined {
  let element: ElementInfo | undefined
  const ref = typeof action.ref === 'string' ? action.ref : undefined
  if (ref !== undefined) {
    element = screenState.elements.find((e) => e.ref === ref)
  } else if (action.target !== null && typeof action.target === 'object') {
    const match = matchDescriptor({ descriptor: action.target as never, elements: screenState.elements })
    if (match.kind === 'resolved') {
      element = screenState.elements.find((e) => e.ref === match.ref)
    }
  }
  if (element === undefined) return undefined
  const resolved = element
  const ordinal = screenState.elements
    .filter((e) => e.role === resolved.role && e.nameNormalized === resolved.nameNormalized)
    .findIndex((e) => e.ref === resolved.ref)
  if (ordinal < 0) return undefined
  return buildAnchorKey({ role: resolved.role, nameNormalized: resolved.nameNormalized, ordinal })
}

// D-04 deterministic longpress-for-tap ban (gate-agnostic pre-check, no model judgment). When the
// emitted action's verb + resolved anchor match a banned substitution on a stagnating control,
// returns the §7.1 self-correcting error text naming the required control + verb; the planning-turn
// one-shot injects it in-conversation for a single retry, and a second banned emission surfaces the
// structured 'ungroundable_action' turn failure (357 D-09 machinery, unmodified). Any other verb, or
// an action on a DIFFERENT element, returns undefined — D-04's explicit negative: no wandering
// heuristic here; genuine loops are caught by CYCLE-03 revisitation.
// Extract the trimmed textual content of a system tier. A tier's `content` is a string
// (the SystemModelMessage shape the planner builders emit); defensively, if a tier ever
// carries array content parts, join their text before trimming so an empty check stays
// honest across shapes.
function tierTextContent(tier: SystemModelMessage): string {
  const content = tier.content as unknown
  if (typeof content === 'string') return content.trim()
  if (Array.isArray(content)) {
    return content
      .map((part) => (part && typeof part === 'object' && 'text' in part ? String((part as { text: unknown }).text) : ''))
      .join('')
      .trim()
  }
  return ''
}

// RUNX-01 / D2 fix: assemble the cache-ordered [stable, context, volatile] planner
// system tiers and DROP any tier whose trimmed text content is empty. For a bare test
// (no suiteContext/testContext) buildContextTier returns a role:'system' message with
// content '' — published 0.1.21 sent a single non-empty `system` string and never emitted
// an empty message, so the OpenAI Responses API never rejected it with HTTP 400. Filtering
// at assembly time (not inside buildContextTier) means every caller benefits and the
// retained tiers keep their content + providerOptions (incl. the Anthropic cache_control
// breakpoint on a retained context tier) byte-for-byte. Pure + exported so the regression
// test drives it directly; LLMPlanner.buildSystemTiers delegates here unchanged in behavior
// except for the drop.
export function assemblePlannerSystemTiers(
  context: StepContext,
  options: { platform: Platform; agentRules?: string },
): SystemModelMessage[] {
  const tiers: SystemModelMessage[] = [
    { role: 'system', content: buildSystemPrompt(options.platform, options.agentRules) },
    buildContextTier(context),
    buildVolatileTier(context),
  ]
  return tiers.filter((tier) => tierTextContent(tier).length > 0)
}

function bannedSubstitutionMessage(
  action: { type: string; [key: string]: unknown },
  screenState: ScreenState,
  context: StepContext,
): string | undefined {
  const banned = context.stagnation?.bannedSubstitutions
  if (banned === undefined || banned.length === 0) return undefined
  const verb = typeof action.type === 'string' ? action.type : undefined
  if (verb === undefined) return undefined
  const anchorKey = resolveActionAnchorKey(action, screenState)
  if (anchorKey === undefined) return undefined
  for (const entry of banned) {
    if (entry.anchorKey === anchorKey && entry.banned === verb) {
      return `A ${entry.banned} is not a valid substitute for the required ${entry.required} on the stagnating control (${anchorKey}). Emit a ${entry.required} on that same control instead of a ${entry.banned}.`
    }
  }
  return undefined
}

export class LLMPlanner implements Planner {
  private model: LanguageModel
  private platform: Platform
  private logger?: LoopScopedLogger
  private agentRules?: string
  private accounting: TokenAccounting
  private profile?: DeclaredModelProfile

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
    profile?: DeclaredModelProfile,
  ) {
    this.model = model
    this.platform = platform ?? 'web'
    this.logger = logger
    this.agentRules = agentRules
    this.accounting = accounting
    this.profile = profile
  }

  // Cache-ordered [stable, context, volatile] system tiers (D-04/D-05/D-07). The single
  // Anthropic ephemeral cache_control breakpoint rides the context tier (buildContextTier
  // sets it at message-level providerOptions); the stable tier sits above it and the
  // volatile tier (knowledge brief + date-granularity stamp) below it. Per-turn state never
  // enters these tiers — it rides composeTurnMessages after the system region. Non-Anthropic
  // providers never parse the `anthropic` namespace, so the breakpoint is a transparent no-op.
  private buildSystemTiers(context: StepContext): SystemModelMessage[] {
    return assemblePlannerSystemTiers(context, { platform: this.platform, agentRules: this.agentRules })
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
    // Tool-schema tokens are counted into the input estimate `I` explicitly — the port's
    // estimate() sees the message stream only, never the always-send-all action slice
    // (clamp Pitfall 4). Serialized once here and handed to the clamp helper as bytes.
    const toolSchema = JSON.stringify(actionTools)

    // D-09 groundability callback: close over the in-scope fresh observation and ground
    // the parsed action through the Plan-04 gate. The gate resolves an emission-shape
    // action (ref OR target descriptor) to a fully-grounded execution-shape action (a
    // ref) before adapter execution (GROUND-01), returning the §A8 attempts trail. No
    // vision capability signal is in scope in M1, so the gate's default ladder
    // [refValidate, treeSearch] applies (no visual rung, D-01). A gate failure is adapted
    // to the turn's structured groundability verdict — the turn injects the §7.1 error
    // text for one in-conversation correction, never a throw (schema_invalid stays a
    // throw upstream in toolCallToActionPlan, Q2).
    const groundability: GroundabilityCallback = (parsed) => {
      // D-04 deterministic longpress-for-tap ban — checked BEFORE grounding. A banned
      // substitution on a stagnating anchor returns the §7.1 bounce through the existing
      // one-shot machinery (planning-turn.ts unchanged); grounding/gate.ts stays pure and
      // stagnation-agnostic.
      const banMessage = bannedSubstitutionMessage(parsed.action, screenState, context)
      if (banMessage !== undefined) return { ok: false, message: banMessage }

      const toolName = typeof parsed.action.type === 'string' ? parsed.action.type : 'action'
      const gate = groundActionPlan({ toolName, action: parsed.action, screenState })
      if (gate.ok) {
        return { ok: true, action: gate.action, attempts: gate.attempts }
      }

      // The gate rejected the planned action. Surface a diagnostic so an ungroundable action
      // is never opaque again (this is how the "both ref+target" live regression was found):
      // the tool, the failure code, and which grounding handles the planner actually supplied.
      // Element identifiers only (ref/target/elementDescription) — never the text/value fields
      // a fill/type could carry. The §7.1 error text + hint is fed back to the model unchanged
      // (the one-shot retry contract is untouched).
      this.logger?.warn('planner emitted an ungroundable action', {
        tool: toolName,
        code: gate.error.code,
        hasRef: parsed.action.ref !== undefined && parsed.action.ref !== null,
        hasTarget: parsed.action.target !== undefined && parsed.action.target !== null,
        ref: parsed.action.ref,
        elementDescription: parsed.action.elementDescription,
        target: parsed.action.target,
      })
      return { ok: false, message: `${gate.error.message} ${gate.error.hint}` }
    }

    // One clamped/degraded planning call over the decomposed turn messages. The clamp helper
    // (Plan 04) computes the dynamic output cap, proactively degrades when the input estimate
    // exceeds the budget (pinning the observation + instruction so the live screen/goal are
    // never evicted, D-08), retries exactly once on a live context overflow, and feeds
    // recordUsage once per successful response (CTXB-04, D-10/D-17). The pin set is a
    // reference-identity Set over the last two composeTurnMessages entries — the latest
    // OBSERVATION (second-to-last) and the CURRENT INSTRUCTION (last) per the D-08 contract.
    const runTurn = (messages: ModelMessage[]): Promise<ClampedCallResult<PlanningTurnResult>> => {
      const observation = messages[messages.length - 2]
      const instruction = messages[messages.length - 1]
      const pinned = new Set<ModelMessage>([observation, instruction])
      return executeClampedCall<PlanningTurnResult>({
        accounting: this.accounting,
        system,
        messages,
        toolSchema,
        pin: (message) => pinned.has(message),
        call: (maxOutputTokens, fitted) =>
          executePlanningTurn({
            model: this.model,
            registry: defaultRegistry,
            actionTools,
            system,
            messages: fitted,
            maxOutputTokens,
            sampling: this.profile?.sampling,
            abortSignal,
            logger: this.logger,
            groundability,
          }),
        // recordUsage anchors on the observed input tokens (prompt only, per the clamp
        // contract); the turn result's accumulated TokenUsage supplies the triad. The `ai`
        // LanguageModelUsage also carries nested token-detail objects the port never reads —
        // asserting the minimal anchor is honest here (fabricating detail zeros would not be).
        recordFrom: (tr) =>
          ({
            inputTokens: tr.tokenUsage?.promptTokens ?? 0,
            outputTokens: tr.tokenUsage?.completionTokens ?? 0,
            totalTokens: tr.tokenUsage?.totalTokens ?? 0,
          }) as LanguageModelUsage,
      })
    }

    // Zero non-action tools are bound (D-07): the turn is a one-shot, provably identical
    // to v1's single-call planner. The screenshot-failure fallback retries the whole turn
    // without the image (v1 parity), re-composing the turn messages with the text-only note;
    // the retry rides the same clamp helper so it too is clamped/degraded (D-08).
    let clamped: ClampedCallResult<PlanningTurnResult>
    try {
      if (context.screenshot) {
        try {
          clamped = await runTurn(composeTurnMessages(turnContext, screenState))
        } catch (err) {
          const provider = extractProviderError(err)
          this.logger?.warn('Screenshot send failed, retrying without image', {
            error: err instanceof Error ? err.message : String(err),
            ...(provider !== undefined
              ? { statusCode: provider.statusCode, responseBody: provider.responseBody }
              : {}),
          })
          const fallbackNote = turnContext.promptNote
            ? `${turnContext.promptNote}\n${SCREENSHOT_UNAVAILABLE_NOTE}`
            : SCREENSHOT_UNAVAILABLE_NOTE
          const fallbackContext: StepContext = { ...turnContext, screenshot: undefined, promptNote: fallbackNote }
          clamped = await runTurn(composeTurnMessages(fallbackContext, screenState))
        }
      } else {
        clamped = await runTurn(composeTurnMessages(turnContext, screenState))
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
      // RUNX-04: a provider APICallError must not collapse to a bare "Bad Request". When the
      // duck-typed statusCode/responseBody are present, surface them in the log meta and the
      // rethrown message so the provider's own words (e.g. codex's max_output_tokens 400) survive
      // the runner boundary — no temporary capture patch needed.
      const provider = extractProviderError(err)
      if (provider !== undefined) {
        this.logger?.warn('LLM planning failed (provider error)', {
          statusCode: provider.statusCode,
          responseBody: provider.responseBody,
          error: errorMsg,
        })
        const status = provider.statusCode !== undefined ? `HTTP ${provider.statusCode}` : 'provider error'
        const detail = provider.detail ?? provider.responseBody ?? errorMsg
        throw new Error(`LLM planning failed (${status}): ${detail}`)
      }
      throw err
    }

    const turnResult = clamped.result

    // A cannot-fit degrade (system + tool schema + pinned observation/instruction alone
    // exceed the budget) never throws — the clamp helper proceeds with the pinned floor and
    // surfaces the structured reason. Log it and continue (D-17); the turn still ran.
    if (clamped.degrade && clamped.degrade.ok === false) {
      this.logger?.warn('Planning turn degraded to the pinned floor (input exceeds budget)', {
        reason: clamped.degrade.reason,
      })
    }

    if (!turnResult.ok) {
      // D-08 replaces v1's `throw new Error('LLM did not call any action tool')` inside
      // the turn with a structured failure. Surface the failure through a typed error so
      // the loop can recover failed-turn exchanges for D-03 while preserving the planner's
      // throw-based contract and byte-identical display message.
      throw new PlanningTurnError(
        turnResult.reason,
        turnResult.message,
        turnResult.exchanges,
        turnResult.callRecord,
      )
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
      exchanges: turnResult.exchanges,
      ...(turnResult.callRecord !== undefined ? { callRecord: turnResult.callRecord } : {}),
    }
  }
}
