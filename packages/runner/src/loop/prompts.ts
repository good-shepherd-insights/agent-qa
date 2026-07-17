// Runner-owned prompt construction for the step-execution spine (re-derived from
// core/src/agent/prompts.ts, D-02/D-04 — mechanical move, minimal reshaping).
// Phase 355 rebuilds this into three tiers in place; keep the diff honest and
// shim-free. v1 semantics preserved: estimateTokens (chars/4) + its context-window
// warning behavior, the token-composition logging (Pitfall 10), and the
// sub-action-history "no visible change" warning (Pitfall 5). D-13 adds a re-run
// context block surfaced to the planner (LOOP-03).
import { asRef } from '@vostride/agent-qa-schema'
import type { ScreenState } from '@vostride/agent-qa-schema'
import type { ModelMessage, SystemModelMessage } from 'ai'
import type { Action } from '../platform.js'
import type { StepContext, AssertionInput, ExtractorInput } from './types.js'
import { defaultRegistry } from '../tools/index.js'

type PromptPlatform = 'web' | 'android' | 'ios'

const CHARS_PER_TOKEN = 4

/**
 * v1 token estimate (chars/4). No semantic change (D-04); the TokenAccounting port
 * lands in Phase 355. Exported here because the prompts module is the token estimate's
 * sole runner-side consumer.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

// Node-free re-derivation of core observation.ts:truncateScreenState (the full
// observation module stays in core — its hashing helpers use node:crypto, forbidden
// in the runner loop). Pure string composition only.
function truncateScreenState(state: ScreenState): string {
  const parts: string[] = []

  if (state.url) {
    parts.push(`Current page: ${state.url}`)
  }

  const viewportHeight = state.metadata.viewportHeight

  if (viewportHeight) {
    const allRefs = Object.keys(state.refMap).map(key => state.refMap[asRef(key)])
    const visible = allRefs.filter(r => r.bounds.y + r.bounds.height > 0 && r.bounds.y < viewportHeight)
    const above = allRefs.filter(r => r.bounds.y + r.bounds.height <= 0)
    const below = allRefs.filter(r => r.bounds.y >= viewportHeight)
    parts.push(`[viewport: ${visible.length} elements visible, ${above.length} scrolled above, ${below.length} below viewport]`)
  }

  return parts.length > 0
    ? parts.join('\n') + '\n\n' + state.tree
    : state.tree
}

// ---------------------------------------------------------------------------
// Rule group functions — each returns numbered rules for its concern.
// Numbering is continuous across groups (the LLM sees Rules: 1-20).
// To add a rule: append to the relevant group, increment subsequent numbers.
// ---------------------------------------------------------------------------

function primaryInteractionGuidance(platform?: PromptPlatform): string {
  if (platform === 'web') return 'Use "click" for buttons/links'
  if (platform === 'android' || platform === 'ios') return 'Use "tap" for tappable controls'
  return 'Use the surface-correct interaction verb for buttons/links ("click" on web, "tap" on mobile)'
}

function actionSelectionRules(platform?: PromptPlatform): string {
  return `1. Pick the most specific action type for the task. ${primaryInteractionGuidance(platform)}, "fill" for inputs. Use "select" for HTML/WebView dropdowns; use "nativeSelect" for native iOS picker wheels and Android native picker/dropdown/list controls.
2. Always use element refs from the CURRENT screen state below. Never guess or fabricate element refs. After a tab (new/switch) action, all previous refs are invalid — the screen state now shows the new tab's content with fresh refs. Ignore refs from earlier sub-actions and only use refs you can see in the current screen state.`
}

function scrollRules(): string {
  return `3. If the target element is not visible in the screen state, use a "scroll" action. To reveal a known label, use mode "untilVisible" with its "text" and a "direction" — the executor re-observes between swipes and stops as soon as it appears. To move the view generally, use mode "direction" with a "direction" ("up"/"down"/"left"/"right") and an "amount" ("page", "halfPage", or "toEnd"). When scrolling within a specific container (a list, card, panel, or any element that has its own scrollbar), always include the "ref" field pointing to that container element — without ref, the scroll targets the page viewport and will miss the container. When no container ref is available, use any child element's ref — the adapter automatically walks up to the nearest scrollable container. Prefer a ref near the target content over scrolling the page viewport. If you have already scrolled and the screen did not change (you reached the boundary), the element is not on this page — set stepFailed with an explanation of what you searched. EXCEPTION: When the step goal IS to reach the scroll boundary (e.g., 'scroll to the end', 'scroll to the bottom', 'scroll all the way down', 'scroll to the top'), use mode "direction" with amount "toEnd" — reaching the boundary IS the goal, so set stepComplete: true.`
}

function generalRules(): string {
  return `4. Provide clear reasoning explaining why you chose this action and element.
5. Set confidence based on how certain you are: 1.0 = exact match found, 0.5 = best guess, 0.0 = very uncertain.
6. Use only evidence from the current screen state, previous step outcomes, runtime memory, and explicit user-provided rules. Do not assume hidden source-code context or invent selectors that are not visible in the observation.
7. Prefer user-visible roles, labels, text, and coordinates from the current observation. Use stable attributes only when they appear in the screen state.`
}

function stepLifecycleRules(): string {
  return `8. You may be called multiple times within the same test step. You have three signals to control the step lifecycle:
   - stepComplete: false — more actions needed, continue working
   - stepComplete: true  — step goal is fully accomplished
   - stepFailed: true    — step goal cannot be achieved
   stepComplete and stepFailed are mutually exclusive. Never set both to true.
   You will receive your previous actions and their outcomes in the sub-action history. Use this to avoid repeating failed approaches — if an action produced no screen change or was rejected, try a fundamentally different strategy (different element, different action type, different navigation path).
   Set stepFailed when you have evidence the goal is impossible, not merely difficult:
   - Verification contradicted: step says "verify the button is blue" but it is visibly red — fail immediately
   - Target confirmed absent: step says "click checkout" but you have scrolled the full page and it does not exist
   - Precondition unmet: step says "fill the email field" but the form is disabled or not present
   - Wrong application state: step says "click Place Order on checkout" but screen shows the homepage with no path to checkout visible
   Do NOT set stepFailed when the goal might still be achievable:
   - Target element might be below the fold — scroll first
   - Page is still loading — wait first
   - Element exists but with a different label — try clicking it
   - An overlay, modal, or popup is blocking the target — dismiss it first
   When stepFailed is true, do not provide an action. The step ends immediately with your reasoning as the failure message.`
}

function elementTargetingRules(): string {
  return `9. When an element is visible on screen but has no [ref=eN] tag, use tapCoordinate instead of inventing a ref. tapCoordinate requires x, y, and coordSpace. Read coordinates from the @(x,y WxH) bounding box annotations in the screen state, and read coordSpace from the coordinate header, typically [Viewport: WxH] => coordSpace "viewport". These coordinates are in the same space as the [Viewport: WxH] header — output your tapCoordinate/swipe/pinch coords in THIS space. Do NOT estimate coordinates visually from screenshots. To tap the center of an element at @(100,200 80x40), use tapCoordinate with x=140, y=220 and coordSpace "viewport".
10. NEVER hallucinate a ref. A ref is a typed current-screen element handle from the observation, never a CSS selector, XPath, label, or guessed description. If an element appears in the observation without [ref=eN] (e.g. \`- menuitemradio "Chinese"\` with no ref), do NOT guess a ref number. Either use tapCoordinate with coordinates and coordSpace from the observation, or interact with a nearby ref'd element. If a tool offers elementDescription, use it only as optional disambiguation; it never replaces the ref or coordinates. Common no-ref cases: dropdown options, shadow DOM content, canvas elements, dynamically inserted items.
   TARGET DESCRIPTORS: Element-naming tools accept an optional \`target\` descriptor as an alternative to \`ref\`. PREFER a ref from the latest observation — it is the fast, exact path. Only when you have no confident ref for the element you must act on, emit a \`target\` instead of guessing a ref: give it the element's accessible \`name\` (always required — a nameless target cannot be grounded), plus \`role\` and \`ordinal\` when needed to disambiguate same-named elements. Every element-targeting action (click, tap, fill, select, hover, …) MUST carry EXACTLY ONE of \`ref\` or \`target\` — NEVER both, and NEVER neither. An action that carries neither a \`ref\` nor a \`target\` cannot be grounded and is rejected; do not emit a bare click/tap hoping the system will infer the element. If you have no confident \`ref\`, you MUST construct a \`target\` descriptor (accessible \`name\`, plus \`role\`/\`ordinal\` to disambiguate) rather than omitting both. Unlike elementDescription (pure logging), a \`target\` is grounded by the system against a fresh observation. If a tool call returns a grounding error (the descriptor did not resolve or was ambiguous), re-observe and refine the descriptor or switch to a visible ref/coordinates — do NOT retry the identical call.
11. RECOVERY RECIPE — when you need to interact with an element that has NO [ref=eN]:
   Step 1: Check if the element has @(x,y WxH) bounds annotation → use tapCoordinate at the center (x + width/2, y + height/2) with coordSpace from the [Viewport: WxH] header
   Step 2: If the target has a ref but is off-screen, use scroll to bring it into view. Off-screen elements still have refs; do not switch to coordinates just because the target is outside the current viewport
   Step 3: If no target ref exists, find a parent or sibling element that DOES have a [ref=eN] → interact with that ref instead. Use tapCoordinate only for targets genuinely absent from the accessibility tree/DOM handles (canvas, closed shadow roots, custom-drawn widgets)
   Step 4: NEVER fabricate a ref like e481 — fabricated refs always fail with "element not found"`
}

function assertionRules(): string {
  return `12. ASSERTIONS — route the check to the right verb (§12.2). There are two assertion verbs plus a report channel; pick by the KIND of claim:
   - DETERMINISTIC VALUE CHECKS → assertValue. Use it when the claim is a machine-readable value: the current URL, a cookie/localStorage/network value, or an element/JS-expression result. Supply a source (url/storage/network/expr-result) or an expr, one op from the closed set (isNull, isDefined, equals, notEquals, gt, lt, contains), and the expected value. assertValue is evaluated deterministically and feeds the verdict directly — no screenshot round-trip. Use it for tautologies, env/hook variable checks, and computed comparisons ("42 equals 42", "token is defined", "count gt 5").
   - CLAIM-SHAPED OR VISUAL JUDGMENTS → assertAI. Use it when the truth requires looking: "the error banner is red", "the layout is not broken", "the page shows a success message". Provide the claim; a fresh model judgment decides. A false claim comes back as a self-correcting error with the rationale — re-observe, act to fix, or terminate; do NOT repeat the identical assertAI.
   - AN ASSERTION THAT CONCLUDES THE STEP rides the SAME tool call as stepComplete: true. If the assertion holds but more sub-goals remain, proceed to the next sub-goal per Rule 13 and only set stepComplete when ALL are done.
   - INFORMATION-RETRIEVAL ANSWERS → reportValue. When the step asks you to find/read/report a value (not verify it), emit reportValue with the answer. reportValue is DISTINCT from stepComplete — it records the answer and you MAY report-then-continue; set stepComplete separately when the step goal is met.
   - AN IMPOSSIBLE OBJECTIVE → stepFailed with failureKind "infeasible" and a reason. Declaring infeasibility is a first-class terminal outcome, machine-distinct from an ordinary failure to complete the step; never silently abandon it.
   STRICT LITERAL ASSERTION: check the EXACT condition from the step text. If the step says "verify 42 equals 30", you assert whether 42 equals 30 — it does not, so the assertion fails (assertValue with op equals returns false → the step fails). Do NOT rewrite it as "42 does not equal 30" to pass, and do NOT store a value via setVariable to sidestep it. The step text is the test spec: if reality contradicts the spec, the test FAILS. This is QA — your job is to report truth, not make tests pass.`
}

function qaMindsetExample(platform?: PromptPlatform): string {
  if (platform === 'web') {
    return 'Example: step says "select Satellite and dismiss the panel" -> sub-goal 1: click Satellite, sub-goal 2: click X to close. After clicking Satellite, immediately click X — do not assert that Satellite is selected.'
  }
  if (platform === 'android' || platform === 'ios') {
    return 'Example: step says "select Satellite and dismiss the panel" -> sub-goal 1: tap Satellite, sub-goal 2: tap X to close. After tapping Satellite, immediately tap X — do not assert that Satellite is selected.'
  }
  return 'Example: step says "select Satellite and dismiss the panel" -> sub-goal 1: use the surface-correct interaction verb (click on web, tap on mobile) for Satellite, sub-goal 2: use the same surface-correct verb for X. After the first interaction, immediately perform the second — do not assert that Satellite is selected.'
}

function qaMindsetRules(platform?: PromptPlatform): string {
  return `13. QA MINDSET — ALWAYS MOVE FORWARD: Break the step instruction into sub-goals. Execute each sub-goal in order. After executing an action, MOVE to the next sub-goal — do not retry the same action, do not assert about what you just did, do not wait for visual confirmation of intermediate actions. An assert is NOT forward progress — if your reasoning identifies a next action, your output MUST be that action, not an assert about the current state. Review your previous actions in the sub-action history below — if you have already completed all parts of the step instruction, set stepComplete: true immediately instead of re-verifying or re-asserting. ${qaMindsetExample(platform)} After all sub-goals are done, set stepComplete: true.
14. TRUST THE ARIA TREE, VERIFY WITH SCREENSHOTS: The ARIA tree is your trusted source for finding elements and understanding page structure. Use its refs as the primary element handles, including full-page off-screen refs that you reach by scrolling, not by coordinates. Coordinates are the fallback for visible targets that are genuinely absent from the ARIA tree/DOM handles. But for ASSERTIONS — any step that says "verify", "check", "confirm", or uses the assert action — you must confirm the claim is true by what is visible in the screenshot:
   - Before asserting, ensure the target content is visible in the current viewport. If the target is above or below the visible area, SCROLL to bring it into view first, then assert. This applies in both directions — scroll up for content at the top, scroll down for content at the bottom.
   - For quantity assertions ("verify there are 30 items"), you MUST scroll through the entire content to visually confirm. The ARIA tree shows the full page including off-screen elements — you cannot verify quantity from the ARIA tree alone.
   - The ARIA tree tells you WHERE things are. The screenshot tells you what the user ACTUALLY SEES. Assertions are about what the user sees.
   - Visual issues invisible to the ARIA tree: overlapping elements, occlusion by modals, z-index problems, rendering failures, items hidden behind other content.`
}

function recoveryRules(): string {
  return `15. VERIFICATION FAILURE RECOVERY: When the verifier rejects your stepComplete (you see "step NOT complete" in your sub-action history), do NOT retry the same assert. Escalate progressively:
   1st rejection — DIFFERENT APPROACH: Re-read the screen. Try a different action, element, or strategy to achieve the goal
   2nd rejection — MAKE IT VISIBLE: The content may be off-screen or hidden. Scroll to bring it into view, dismiss overlays, or wait for loading
   3rd+ rejection — set stepFailed with clear reasoning about what approaches you tried and why the goal appears unachievable from the current state
16. CROSS-STEP CONTEXT: Use previous step outcomes to narrow your current step's scope. When a previous step found a specific element, row, or area, your current step's references to "this", "that", "the same", or "its" refer to what was found. Don't start fresh — build on prior work. The "Previous steps in this test" section above tells you what was already accomplished and where.
17. AMBIGUITY DETECTION: If you cannot uniquely identify the target element from the step instruction + previous step context + current screen state, set stepFailed with a message listing the ambiguous candidates. Do NOT guess when multiple elements match a generic description ("the button", "the link", "the icon"). A QA engineer asks for clarification rather than guessing — you fail the step. Single match = proceed. Multiple matches with disambiguating context from previous steps = use that context to select. Multiple matches with no context = fail.
   ASSERTION PRECISION: Read quantity qualifiers carefully before asserting:
   - "exists" / "is present" / "is mentioned" = at least one match. Multiple matches = pass.
   - "only once" / "exactly one" / "single" = count must be exactly 1. Multiple = fail.
   - "should not exist" / "is not shown" = zero matches. Any match = fail.
18. For web doubleClick/rightClick, do not use relativePosition { x: 0, y: 0 } unless the step explicitly asks for top-left or zero-offset, and omit no-op optional fields such as clickDelay: 0. If a doubleClick/rightClick fails because top-left is intercepted, retry the same semantic action at the center/interior of the same ref; do not switch to tapCoordinate or single click.`
}

function completionRules(platform?: PromptPlatform): string {
  const actionExamples = platform === 'web'
    ? '"click", "select", "scroll to", or "fill"'
    : platform === 'android' || platform === 'ios'
      ? '"tap", "press", "select", "scroll to", or "fill"'
      : 'the surface-correct interaction verb ("click" on web, "tap" on mobile), "select", "scroll to", or "fill"'
  const multiGoalExample = platform === 'web'
    ? '"click X and then verify Y"'
    : platform === 'android' || platform === 'ios'
      ? '"tap X and then verify Y"'
      : '"click X and then verify Y" on web, or "tap X and then verify Y" on mobile'
  return `19. ACTION STEP COMPLETION: When the step instruction is a pure action — a single verb like ${actionExamples} targeting a specific element — and you found the target element and executed the action successfully, set stepComplete: true immediately. Do NOT retry expecting a visible screen change. Many successful actions produce no visible change on the current page: file downloads save to disk silently, external links open in new tabs, buttons trigger background processes, PDF links open in the browser's PDF viewer. This rule applies to SINGLE-ACTION steps only. If the step has multiple sub-goals (${multiGoalExample}), complete the action sub-goal and move to the next per Rule 13 — do not set stepComplete until ALL sub-goals are done.
20. TRUST LOG READ RESULTS: When web_inspect (console/network) returns data, that data is the complete set of logs captured since the last step. Do NOT re-trigger user interactions or navigation to "regenerate" logs — the logs from prior steps are already captured. If web_inspect (console) returns an empty array, it means no matching console output was captured during this step's execution. If the step requires verifying log content and web_inspect (console) returns empty, either the expected log was not emitted or it was captured in a prior step — check the step instruction and set stepFailed if the expected log output is absent after one read attempt.
21. The setVariable action stores a runtime variable accessible via {{env:varName}} in later steps. ONLY use setVariable when the step instruction explicitly asks to set, store, save, or remember a variable (e.g., "Set env X to Y", "Store the value as env.token"). NEVER use setVariable as a substitute for page interactions, assertions, or any other action. If the step does not explicitly mention setting a variable, do not call setVariable.
22. STAGNATION FOCUS — DO NOT WANDER: When a specific named control fails to make progress, you will be shown a stagnation block naming that exact control and how it stalled. Remediate THAT control as the classification directs — wait for a transient load, dismiss an obstruction, scroll it into view, or re-enter the input. Do NOT wander off to an alternate path or a different control to sidestep the named target, and never substitute a longpress for a required tap on it. Genuine loops across revisited screen states are caught separately and surfaced as a cycle-break block.`
}

// ---------------------------------------------------------------------------
// Rule composer — joins groups into the Rules: block
// ---------------------------------------------------------------------------

function buildRules(platform?: PromptPlatform): string {
  const groups = [
    actionSelectionRules(platform),
    scrollRules(),
    generalRules(),
    stepLifecycleRules(),
    elementTargetingRules(),
    assertionRules(),
    qaMindsetRules(platform),
    recoveryRules(),
    completionRules(platform),
  ]
  return 'Rules:\n' + groups.join('\n')
}

// ---------------------------------------------------------------------------
// Step prompt section helpers
// ---------------------------------------------------------------------------

function appendContextSection(parts: string[], context: StepContext): void {
  if (context.suiteContext && context.testContext) {
    parts.push(`Suite context: ${context.suiteContext}\nTest context: ${context.testContext}`)
  } else if (context.suiteContext) {
    parts.push(`Suite context: ${context.suiteContext}`)
  } else if (context.testContext) {
    parts.push(`Test context: ${context.testContext}`)
  }
}

// BRIF-01/D-05: L0 is authored/sovereign policy material, not learned memory. It alone may
// enter the cached-prefix context tier. Empty/whitespace input emits no header or blank section.
function appendKnowledgePolicyL0(parts: string[], context: StepContext): void {
  const policy = context.knowledgePolicyL0
  if (!policy || policy.trim().length === 0) return
  if (parts.length > 0) parts.push('')
  parts.push('Knowledge policy (L0 — human-authored and sovereign):')
  parts.push(policy)
}

// D-13 re-run context (LOOP-03). Only emitted when the run-level re-run flag is set;
// when isRerun is false/absent nothing is pushed, so non-rerun prompt output stays
// byte-identical to v1. This is the explicit re-run signal the planner sees: the
// re-run carries full memory/context (no ablation) plus the prior failure summary.
function appendRerunContext(parts: string[], context: StepContext): void {
  if (!context.isRerun) return
  const attempt = context.rerunAttempt ?? 1
  parts.push('')
  parts.push(`RE-RUN CONTEXT — this is re-run attempt ${attempt}. A previous attempt of this test failed.`)
  if (context.previousFailureSummary) {
    parts.push(`The previous attempt failed at: ${context.previousFailureSummary}`)
  }
  parts.push('You carry all prior memory and context forward. Adapt based on why the previous attempt failed rather than repeating the same approach.')
}

function appendPreviousSteps(parts: string[], context: StepContext): void {
  if (context.previousSteps.length > 0) {
    parts.push('Previous steps in this test:')
    for (const prev of context.previousSteps) {
      parts.push(`- "${prev.instruction}" -> ${prev.outcome}`)
      if (prev.reasoning) parts.push(`  Reasoning: ${prev.reasoning}`)
      if (prev.plannedAction) parts.push(`  Action: ${prev.plannedAction}`)
      if (prev.verifierResponse) parts.push(`  Verification: ${prev.verifierResponse}`)
    }
  }
}

// D-12/D-13 working-memory channel: structured run-scoped turn content (the v2 successor to
// the retired opaque memoryContext string). Each entry is rendered VERBATIM (Pitfall 7 boundary
// 2 — the planner needs the real OTP/filename untransformed) as opaque display text: the entry's
// key, value, kind, provenance, and capture location when present. Values are never interpolated
// into instructions/control flow (renderDescriptor precedent, T-358-05b). An empty array or unset
// slot ⇒ no working-memory message at all (empty-slot omission), so no blank message leaks.
function appendWorkingMemory(parts: string[], context: StepContext): void {
  const entries = context.workingMemory
  if (!entries || entries.length === 0) return
  parts.push('Working memory (facts captured earlier this run — verbatim):')
  for (const entry of entries) {
    const locBits: string[] = []
    if (entry.testIndex !== undefined) locBits.push(`test ${entry.testIndex}`)
    if (entry.stepIndex !== undefined) locBits.push(`step ${entry.stepIndex}`)
    const loc = locBits.length > 0 ? ` · ${locBits.join(' ')}` : ''
    parts.push(`- ${entry.key} = ${entry.value} [${entry.kind} · ${entry.provenance}${loc}]`)
  }
}

// D-01/D-07 stagnation block (per-turn VOLATILE turn content — composeTurnMessages ONLY,
// never a tier builder, Pitfall 3). Renders the classification, the stagnating control's
// anchor (naming the control the planner MUST remediate — the wandering ban's positive half),
// and the raw diff facts as opaque display text (injection-inert, renderDescriptor precedent —
// app-observed text never steers control flow). For the `unresponsive` class no remediation is
// suggested — facts only (D-02). Omitted entirely when the slot is unset (empty-slot omission).
function appendStagnationBlock(parts: string[], context: StepContext): void {
  const s = context.stagnation
  // The classification/anchor/diff render triplet is independently optional from the D-04
  // bannedSubstitutions list (a ban-only slot carries no render block). Render only when the
  // full triplet is present; otherwise omit entirely (empty-slot omission).
  if (!s || s.classification === undefined || s.anchor === undefined || s.diff === undefined) return
  parts.push(`Stagnation detected (classification: ${s.classification}) on control ${s.anchor.role} "${s.anchor.nameNormalized}" (ordinal ${s.anchor.ordinal}).`)
  parts.push(`Observed diff: ${s.diff}`)
  if (s.classification !== 'unresponsive') {
    parts.push('Remediate THAT control as this classification directs — do not wander to an alternate path or substitute a different gesture for the required interaction.')
  }
}

// D-08 cycle-break block (per-turn VOLATILE turn content). Renders the revisited key, the
// W-window summary, and the §7.1 self-correcting instruction. Omitted when the slot is unset.
function appendCycleBreakBlock(parts: string[], context: StepContext): void {
  const c = context.cycleBreak
  if (!c) return
  parts.push(`Cycle detected — you have revisited state ${c.revisitedKey}: ${c.windowSummary}.`)
  parts.push('Change your approach or declare stepFailed — repeating the same path will not make progress.')
}

// D-09 active bulk-completion predicate (per-turn VOLATILE turn content). Re-states the
// planner's declared positive predicate with the re-evaluate/cite-evidence instruction.
// Omitted when the slot is unset.
function appendBulkCompletionPredicate(parts: string[], context: StepContext): void {
  const p = context.bulkCompletionPredicate
  if (!p) return
  parts.push(`Active bulk-completion predicate: "${p}".`)
  parts.push('Re-evaluate this predicate against the current observation each turn, and cite the positive evidence that it holds before setting stepComplete.')
}

function appendSubActionHistory(parts: string[], context: StepContext): void {
  if (!context.subActionHistory || context.subActionHistory.length === 0) return

  const history = context.subActionHistory
  const subHistoryParts: string[] = []
  subHistoryParts.push('Actions already taken for this step:')

  for (const sub of history) {
    let suffix = ''
    if (sub.result === 'failure') suffix = ` — FAILED: ${sub.error?.slice(0, 120)}`
    else if (sub.verifierRejection) suffix = ` — step NOT complete: ${sub.verifierRejection?.slice(0, 120)}`
    const reason = sub.reasoning ? ` (${sub.reasoning})` : ''
    subHistoryParts.push(`  ${sub.result === 'success' ? '✓' : '✗'} ${sub.action}${reason}${suffix}`)
    if (sub.data) subHistoryParts.push(`    Returned data: ${sub.data}`)
  }

  // §12.16 replacement: the v1 byte-identity anti-repetition warning is DELETED here.
  // It is actively wrong when repetition IS the task (a bulk "do X to all" loop
  // legitimately re-issues an identical action per unit). Progress vs. stagnation is now decided
  // by the differential-observation oracle + identity-keyed stagnation tree (CYCLE-01/02); when a
  // named control genuinely stagnates the planner is told via the structured stagnation block
  // (appendStagnationBlock), not a blanket byte-identity warning here.

  parts.push('')
  parts.push(subHistoryParts.join('\n'))
}

function appendFailureContext(parts: string[], context: StepContext): void {
  if (!context.failureContext) return
  parts.push('')
  parts.push('PREVIOUS ATTEMPT FAILED — avoid repeating the same approach:')
  parts.push(context.failureContext)
  parts.push('')
  parts.push('Adapt your strategy based on the failure above. Try a different element, selector, or approach.')
}

function appendDomContext(parts: string[], screenState: ScreenState): void {
  // D-04: domContext is a typed, web-only optional on the v2 metadata (absent on
  // Android/iOS). Read the discriminated-union optional directly — no cast.
  const domContext = screenState.metadata.domContext
  if (domContext) {
    parts.push('')
    parts.push('DOM structure (supplementary context — use ARIA element refs above for all action targeting):')
    parts.push(domContext)
  }
}

function appendPromptNote(parts: string[], promptNote?: string): void {
  // D-11: text-only runs carry a non-empty note (visual screenshot unavailable);
  // full-capture runs pass an empty/absent note and nothing is injected.
  if (promptNote && promptNote.length > 0) {
    parts.push('')
    parts.push(promptNote)
  }
}

// ---------------------------------------------------------------------------
// Exported prompt composers
// ---------------------------------------------------------------------------

// custom-rules injection removed with the workspace agent-rules config surface
// (Phase 373, KDIR-03); policy serving returns via Reader L0 policies in Phase 380.
export function buildSystemPrompt(platform?: PromptPlatform): string {
  const rulesBlock = buildRules(platform)

  return `You are the agent-qa test automation agent. Your job is to determine the correct action to execute for a given test step based on the current screen state.

Available action types:
${defaultRegistry.generateDocs(platform)}

${rulesBlock}

Call the tool matching the action you want to execute. Include reasoning, confidence, stepComplete, and stepFailed in the tool call.`
}

// ---------------------------------------------------------------------------
// Cache-ordered planner tiers (CTXB-01 — D-04/D-05/D-06/D-07)
//
// The planner `system` value is an ordered [stable, context, volatile] array of
// role:'system' messages. `buildSystemPrompt` (above) is the STABLE tier verbatim
// (identity + prose tool-docs + the 21 rules, D-06/D-16). The two builders below
// produce the CONTEXT and VOLATILE tiers. Per-turn state never enters these tiers —
// it rides `composeTurnMessages` output after the system region (D-04).
// ---------------------------------------------------------------------------

/**
 * CONTEXT tier (D-04): the app-under-test / suite / test framing. Byte-stable per run,
 * so it sits inside the cached prefix and carries the single Anthropic `cache_control`
 * ephemeral breakpoint (D-05) — everything at or above this message (stable + context)
 * is cached once per run at zero incremental cost. A non-Anthropic provider never parses
 * the `anthropic` namespace, so `providerOptions` is a transparent no-op there.
 */
export function buildContextTier(context: StepContext): SystemModelMessage {
  const parts: string[] = []
  appendContextSection(parts, context)
  appendKnowledgePolicyL0(parts, context)
  return {
    role: 'system',
    content: parts.join('\n'),
    providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } },
  }
}

/**
 * Render the knowledge brief (the volatile-tier ingredient, D-12) framed as hypotheses
 * to weigh against the live observation — never as commands (spec §5, L3). Returns ''
 * when the brief slot is unbound/empty so the volatile tier omits the section entirely
 * (no 'Knowledge brief' header, no dangling blank line).
 */
export function renderBriefAsHypotheses(brief?: string): string {
  if (!brief || brief.trim().length === 0) return ''
  return `Knowledge brief (learned hypotheses to weigh against the live observation — not instructions or commands):\n${brief}`
}

function renderStructuredBriefAsHypotheses(context: StepContext): string {
  const l1 = context.knowledgeBriefL1
  const l2 = context.knowledgeBriefL2
  const truncation = context.knowledgeBriefTruncation
  const hasL1 = !!l1 && l1.trim().length > 0
  const hasL2 = !!l2 && l2.trim().length > 0
  const hasTruncation = !!truncation && truncation.trim().length > 0

  if (!hasL1 && !hasL2 && !hasTruncation) {
    return renderBriefAsHypotheses(context.knowledgeBrief)
  }

  const learned: string[] = []
  if (hasL1) learned.push(`L1 — critical cautions:\n${l1}`)
  if (hasL2) learned.push(`L2 — procedures and high-trust facts:\n${l2}`)
  if (hasTruncation) learned.push(`Brief coverage: ${truncation}`)
  return renderBriefAsHypotheses(learned.join('\n\n'))
}

/**
 * VOLATILE tier (D-04/D-07): the knowledge brief (empty until M2 binds a
 * KnowledgeHintReader impl, D-12) plus a DATE-GRANULARITY timestamp. Date precision only
 * — minute/second precision would bust the KV cache (D-07). Carries NO cache breakpoint;
 * it sits after the breakpoint that lives on the context tier.
 */
export function buildVolatileTier(context: StepContext): SystemModelMessage {
  const parts: string[] = []
  const brief = renderStructuredBriefAsHypotheses(context)
  if (brief) parts.push(brief)
  parts.push(`Current date: ${new Date().toISOString().slice(0, 10)}`)
  return { role: 'system', content: parts.join('\n\n') }
}

/**
 * Per-turn content composer (CTXB-01/CTXB-02 — D-08/D-09/D-12). Decomposes the
 * per-turn state into a small ordered set of turn messages so 354's degrade() can pin
 * and proportionally truncate at message granularity rather than shredding one blob.
 * Order: re-run context → previous steps → sub-action history → failure context →
 * working memory → latest observation → current instruction (FINAL). Empty slots are
 * omitted entirely — no blank/degenerate message is pushed (D-12).
 *
 * PIN CONTRACT (D-08): the last two messages are the pinned pair — the latest
 * OBSERVATION (second-to-last) and the CURRENT INSTRUCTION (last, verbatim). The caller
 * (Plan 05) protects exactly these two via degrade's `pin`; every earlier message is
 * trim-eligible. All per-turn state lives here and NEVER in the cached system tiers.
 */
export function composeTurnMessages(
  context: StepContext,
  screenState: ScreenState,
): ModelMessage[] {
  const messages: ModelMessage[] = []

  const pushText = (build: (parts: string[]) => void): void => {
    const parts: string[] = []
    build(parts)
    const content = parts.join('\n')
    if (content.trim().length > 0) {
      messages.push({ role: 'user', content })
    }
  }

  // Trim-eligible history/memory — evictable before the observation is ever touched.
  pushText((parts) => appendRerunContext(parts, context))
  pushText((parts) => appendPreviousSteps(parts, context))
  pushText((parts) => appendSubActionHistory(parts, context))
  pushText((parts) => appendFailureContext(parts, context))
  pushText((parts) => appendWorkingMemory(parts, context))

  // D-01/D-08/D-09 progress-remediation blocks — per-turn VOLATILE turn content (never the
  // cached system tiers, Pitfall 3). Trim-eligible; sit before the pinned observation/instruction
  // pair so the live screen/goal are never evicted for them.
  pushText((parts) => appendStagnationBlock(parts, context))
  pushText((parts) => appendCycleBreakBlock(parts, context))
  pushText((parts) => appendBulkCompletionPredicate(parts, context))

  // Pinned pair — latest observation (with the screenshot when vision-capable), then
  // the current instruction as the FINAL message (D-08).
  const obsParts: string[] = []
  obsParts.push('Current screen state:')
  obsParts.push(truncateScreenState(screenState))
  appendDomContext(obsParts, screenState)
  const obsText = obsParts.join('\n')
  if (context.screenshot) {
    messages.push({
      role: 'user',
      content: [
        { type: 'text', text: obsText },
        { type: 'image', image: context.screenshot },
      ],
    })
  } else {
    messages.push({ role: 'user', content: obsText })
  }

  const instrParts: string[] = []
  instrParts.push(`Current step: "${context.stepInstruction}"`)
  appendPromptNote(instrParts, context.promptNote)
  messages.push({ role: 'user', content: instrParts.join('\n') })

  return messages
}

export function formatAction(action: Action): string {
  switch (action.type) {
    case 'click':
    case 'hover':
    case 'tap':
    case 'longpress':
    case 'doubleTap':
    case 'clearText':
    case 'doubleClick':
    case 'rightClick':
    case 'focus':
      return `${action.type} on ref="${action.ref}"`
    case 'fill':
      return `fill ref="${action.ref}" with text="${action.text}"${action.clearMode === 'append' ? ' (append)' : ''}${action.submit ? ' + submit' : ''}`
    case 'select':
      return `select ref="${action.ref}" value="${action.value}"`
    case 'nativeSelect':
      return `nativeSelect ref="${action.ref}" value="${action.value}"`
    case 'navigate':
      // Schema navigate discriminant (D-19: absorbed the retired refresh/navigateHistory verbs).
      return action.to === 'url' ? `navigate to "${action.url}"` : `navigate ${action.to}`
    case 'scroll':
      return action.mode === 'untilVisible'
        ? `scroll ${action.direction} until "${action.text}" visible (maxSwipes=${action.maxSwipes})${action.ref ? ` in ref="${action.ref}"` : ''}`
        : `scroll ${action.direction} ${action.amount}${action.ref ? ` on ref="${action.ref}"` : ''}`
    case 'swipe':
      // Schema swipe: SwipeByPath carries from/to points; SwipeByDirection carries direction.
      return action.mode === 'path'
        ? `swipe from (${action.from.x},${action.from.y}) to (${action.to.x},${action.to.y})`
        : `swipe ${action.direction}${action.ref ? ` on ref="${action.ref}"` : ''}`
    case 'pinch':
      return `pinch scale=${action.scale}${'ref' in action ? ` on ref="${action.ref}"` : ` at (${action.x},${action.y})`}`
    case 'multiTap':
      return `${action.fingers}-finger tap${'ref' in action ? ` on ref="${action.ref}"` : ` at (${action.x},${action.y})`}`
    case 'waitFor':
      // Schema WaitFor: {on:'text'|'gone', text, timeoutMs} | {on:'selector', selector, timeoutMs}.
      return action.on === 'selector'
        ? `waitFor selector "${action.selector}" (${action.timeoutMs}ms)`
        : `waitFor ${action.on} "${action.text}" (${action.timeoutMs}ms)`
    case 'delay':
      return `delay ${action.ms}ms`
    case 'waitForUrl':
      return `waitForUrl pattern="${action.pattern}"`
    case 'fileUpload':
      return `fileUpload ref="${action.ref}" files=[${action.files.join(', ')}]`
    case 'copy':
      return `copy ref="${action.ref}"`
    case 'keypress':
      return `keypress [${action.keys.join(', ')}]${action.mode !== 'press' ? ` (${action.mode})` : ''}`
    case 'paste':
      return `paste ref="${action.ref}" value="${action.value}"`
    case 'hideKeyboard':
      return 'hide keyboard'
    case 'drag':
      return `drag from ref="${action.fromRef}" to ref="${action.toRef}"`
    case 'openApp':
      return 'appName' in action ? `openApp "${action.appName}"` : `openApp bundleId="${action.bundleId}"`
    case 'stopApp':
      return `stopApp "${action.bundleId}"`
    case 'setOrientation':
      return `set orientation to ${action.orientation}`
    case 'tapCoordinate':
      return `tap at coordinates (${action.x}, ${action.y})`
    case 'setCookies':
      return `set ${action.cookies.length} cookie(s)`
    case 'setLocalStorage':
      return `set ${action.entries.length} local storage entry(ies)`
    case 'executeScript':
      return `executeScript "${action.command}"${action.args ? ` with ${JSON.stringify(action.args)}` : ''}`
    case 'setVariable':
      return `setVariable "${action.name}" = "${action.value}"`
    // Inspect fold (D-19: absorbed the retired read{Console,Network}Logs/Cookies/LocalStorage).
    case 'inspect':
      return `inspect ${action.what}`
    // Tab fold (D-19: absorbed the retired newTab/switchTab).
    case 'tab':
      return action.action === 'new'
        ? `open new tab "${action.url}"`
        : `switch tab${action.index !== undefined ? ` index ${action.index}` : action.title ? ` title "${action.title}"` : action.url ? ` URL "${action.url}"` : ''}`
    // §12.2 assertion split + termination verbs.
    case 'assertValue':
      return `assertValue ${'expr' in action ? `expr "${action.expr}"` : action.source} ${action.op}${action.expected !== undefined ? ` "${action.expected}"` : ''}`
    case 'assertAI':
      return `assertAI "${action.claim}" (${action.mode})`
    case 'extractAI':
      return `extractAI "${action.query}" (scope: ${action.scope})`
    case 'reportValue':
      return `reportValue "${action.value}"`
    case 'uniqueValue':
      return `uniqueValue prefix="${action.prefix}"`
    // Web network / storage / dialog verbs.
    case 'route':
      return `route "${action.urlPattern}"`
    case 'unroute':
      return `unroute${action.urlPattern ? ` "${action.urlPattern}"` : ' (all)'}`
    case 'networkState':
      return action.mode === 'offline'
        ? 'network offline'
        : `network throttle (${action.latencyMs}ms, down ${action.downloadKbps}kbps, up ${action.uploadKbps}kbps)`
    case 'storageState':
      return `storageState ${action.op} "${action.name}"`
    case 'handleDialog':
      return `handleDialog ${action.accept ? 'accept' : 'dismiss'}${action.promptText ? ` "${action.promptText}"` : ''}`
    // Android hardware / intent verbs.
    case 'intent':
      return `intent ${action.action}${action.data ? ` data="${action.data}"` : ''}`
    case 'keyevent':
      return `keyevent ${action.keycode}`
    // iOS verbs.
    case 'pressButton':
      return `pressButton ${action.button}`
    case 'pickerSelect':
      return `pickerSelect ref="${action.ref}" ${'value' in action ? `value="${action.value}"` : `order=${action.order}`}`
    case 'swipeFromEdge':
      return `swipeFromEdge ${action.edge}`
    case 'openUniversalLink':
      return `openUniversalLink "${action.url}"`
    default:
      // Compact generic fallback for the no-arg hardware verbs
      // (pressBack / pressHome / pressRecent / openNotifications / openQuickSettings).
      return (action as { type: string }).type
  }
}

/**
 * VERIFIER stable tier (CTXB-01 / D-11): the byte-stable verdict-identity block — the
 * verifier's own cached prefix. This is the fixed prose that is identical on every
 * verification call (identity, the negative-evidence verification approach, the
 * action-vs-assertion guidance, the screenshot-analysis framing, and the response
 * schema). It does NOT share the planner's cache entry (different system content ⇒
 * different cache key, D-11). Arg-less: no per-call inputs. Plan 06 wires this as the
 * verifier call's `system` while `buildVerificationPrompt` supplies the per-call turn.
 */
export function buildVerifierStableTier(): string {
  return `You are verifying whether a test step was successfully completed.

Verification approach:
Evaluate whether the step goal was accomplished. Look for NEGATIVE evidence — signs the action FAILED or the goal was NOT met:
- Application errors (HTTP errors, error toasts, crashes, "not found" messages)
- Contradicting state (wrong page, target element missing, unexpected content)
- Clear evidence the action did not execute (element still in pre-action state when it should have changed)

IMPORTANT: Absence of visible screen change is NOT evidence of failure. Many interactions produce results outside the current page (navigating to new tabs, triggering background processes, initiating file operations, updating server state). If the action targeted a valid element and no error or contradicting state is visible, the goal is likely accomplished.

For verification/assertion steps (step says "verify", "check", "confirm"): require POSITIVE evidence — the claimed condition must be visible on screen or in the ARIA tree.
For action steps (step uses the surface-correct interaction verb, such as "click" on web or "tap"/"press" on mobile, or says "fill" or "select"): if the target element existed and no error appeared, return success unless there is clear evidence of failure.

Analyze the attached screenshot for visual cues the ARIA tree cannot capture: colors, layout, images, visual indicators, error states. When the screenshot and ARIA tree conflict, visual evidence takes precedence. For quantity claims, only confirm what you can count in the screenshot.

Return a JSON object with:
- success (boolean): whether the step goal was accomplished
- reasoning (string): explanation of your judgment
- isAppError (boolean): whether the page shows an application error`
}

/**
 * VERIFIER per-call turn content (D-11). Only the per-verification-call bytes: the step
 * goal, the enriched action description, and the before/after screen states (+ the
 * optional screenshot note and prompt note). The byte-stable verdict-identity/approach
 * prose now lives in `buildVerifierStableTier()` (the verifier's own cached prefix), so
 * it is no longer re-emitted per call.
 */
export function buildVerificationPrompt(
  step: string,
  beforeState: ScreenState,
  afterState: ScreenState,
  action: Action,
  hasScreenshot = false,
  promptNote?: string,
  bulkCompletionPredicate?: string,
): string {
  const parts: string[] = []

  let actionDesc = formatAction(action)
  if ('ref' in action && action.ref && beforeState.elements.length > 0) {
    const el = beforeState.elements.find(e => e.ref === action.ref)
    if (el) actionDesc += ` (${el.role} "${el.name}")`
  }

  parts.push(`Step goal: "${step}"`)
  parts.push(`Action taken: ${actionDesc}`)
  // D-09 backstop: when a bulk "do X to all" predicate was declared, the verifier weighs it
  // as positive-evidence context (opaque display text, per-call volatile — never the stable tier).
  if (bulkCompletionPredicate) {
    parts.push(`Declared bulk-completion predicate: "${bulkCompletionPredicate}". Confirm this predicate holds against the AFTER state before agreeing the step is complete.`)
  }
  parts.push('')
  parts.push('Screen BEFORE action:')
  parts.push(truncateScreenState(beforeState))
  parts.push('')
  parts.push('Screen AFTER action:')
  parts.push(truncateScreenState(afterState))
  if (hasScreenshot) {
    parts.push('')
    parts.push('A screenshot of the AFTER state is attached for visual verification.')
  }

  appendPromptNote(parts, promptNote)

  return parts.join('\n')
}

export function buildAssertionPrompt(
  assertion: AssertionInput,
  screenState: ScreenState,
): string {
  const parts: string[] = []

  parts.push('You are verifying a test assertion against the current screen state.')
  parts.push('')
  parts.push(`Assertion: "${assertion.value}"`)
  if (assertion.expected) {
    parts.push(`Expected: "${assertion.expected}"`)
  }
  parts.push('')
  parts.push('Current screen state:')
  parts.push(truncateScreenState(screenState))
  parts.push('')
  parts.push('Evaluate whether the assertion is satisfied based on what you see on screen.')
  parts.push('Return a JSON object with:')
  parts.push('- passed (boolean): whether the assertion holds true')
  parts.push('- reasoning (string): explanation of your judgment')
  parts.push('- evidence (string): specific text or elements from the screen that support your judgment')

  return parts.join('\n')
}

export function buildExtractionPrompt(
  input: ExtractorInput,
  screenState: ScreenState,
): string {
  const parts: string[] = []

  parts.push('You are extracting a dynamic value from the current screen state.')
  parts.push('')
  parts.push(`Variable to capture: "${input.variableName}"`)

  if (input.description) {
    parts.push(`Description: ${input.description}`)
  }
  if (input.pattern) {
    parts.push(`Pattern hint: ${input.pattern}`)
  }
  if (input.selector) {
    parts.push(`Selector hint: ${input.selector}`)
  }

  parts.push('')
  parts.push('Current screen state:')
  parts.push(truncateScreenState(screenState))
  parts.push('')
  parts.push('Return a JSON object with:')
  parts.push('- value (string): the extracted value')
  parts.push('- reasoning (string): why this is the correct value')

  return parts.join('\n')
}
