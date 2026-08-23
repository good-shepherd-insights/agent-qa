import type { AgentAskResult, ClauseReceiptStatus, ChatSessionEvent } from '@vostride/agent-qa-schema'

export interface RunRow {
  id: string
  name: string
  filePath: string | null
  status: string
  duration: number
  attributes: Record<string, string>
  environment: string | null
  metadata: Record<string, unknown> | null
  startedAt: string | null
  endedAt: string | null
  videoPath: string | null
  failureSummary: string | null
  errorLog: string | null
  memoryLog: string | null
  testId: string | null
  suiteId: string | null
  platform: string
  testFileContent: string | null
  modelName: string | null
  llmProvider: string | null
  parentRunId: string | null
  attemptNumber: number
  retryCount: number
  maxRetries: number
  createdAt: string
  targetName?: string | null
  tests?: RunRow[]
}

export interface AttributePredicate {
  key: string
  value: string
  mode: 'exact' | 'regex'
}

export interface StepAnnotation {
  clickPoint?: { x: number; y: number }
  boundingBox?: { x: number; y: number; width: number; height: number }
  failureHighlight?: { x: number; y: number; width: number; height: number }
  type: string
  viewport?: { width: number; height: number }
  startPoint?: { x: number; y: number }
  endPoint?: { x: number; y: number }
  direction?: 'up' | 'down' | 'left' | 'right'
  pinchScale?: 'in' | 'out'
}

export interface AccessibilityViolation {
  ruleId: string
  impact: 'minor' | 'moderate' | 'serious' | 'critical'
  description: string
  help: string
  helpUrl: string
  nodes: Array<{ html: string; target: string[] }>
}

export interface SubActionData {
  index: number
  observation: string
  reasoning: string
  plannedAction: unknown
  result: 'success' | 'failure' | 'in-progress'
  error?: string
  screenStateBefore: string
  screenStateAfter?: string
  confidence?: number
  verifierReasoning?: string
  cached: boolean
  tokenUsage?: { promptTokens: number; completionTokens: number; totalTokens: number }
  phaseDurations?: { observe?: number; plan?: number; execute?: number; verify?: number }
  screenshotBeforePath?: string
  screenshotAfterPath?: string
  annotation?: StepAnnotation
  screenContextBefore?: string
  screenContextAfter?: string
  data?: unknown
}

export interface StepRow {
  id: string
  runId: string
  name: string
  status: string
  duration: number
  action: unknown | null
  observation: string | null
  reasoning: string | null
  plannedAction: unknown | null
  result: string | null
  error: string | null
  screenshotPath: string | null
  screenshotBeforePath: string | null
  retryCount: number
  capturedVariables: Record<string, string> | null
  stepOrder: number
  annotationData: StepAnnotation | null
  healingScreenshotPaths: string[] | null
  accessibilityViolations: AccessibilityViolation[] | null
  consoleLogs: Array<{
    level: string
    text: string
    location?: { url: string; lineNumber: number; columnNumber: number }
    timestamp: number
  }> | null
  networkLogs: Array<{
    url: string
    method: string
    status: number
    requestHeaders: Record<string, string>
    responseHeaders: Record<string, string>
    body?: string
    requestBody?: string
    startTime: number
    endTime: number
    timing?: Record<string, number>
  }> | null
  confidence: number | null
  promptTokens: number
  completionTokens: number
  totalTokens: number
  subActionsData: SubActionData[] | null
  variableSnapshot: Record<string, { value: string; source: string }> | null
  originalStepName: string | null
  screenContextBefore: string | null
  screenContextAfter: string | null
  createdAt: string
}

export interface Stats {
  totalRuns: number
  passed: number
  failed: number
  flakeRate: number
  avgDuration: number
  runs: { date: string; passed: number; failed: number; healed: number; duration: number }[]
  scope?: AnalyticsScope
  memory?: {
    runs: number
    added: number
    confirmed: number
    deprecated: number
    deleted: number
    curatorTokens: number
  }
}

export interface RunsFilter {
  status?: string
  name?: string
  platform?: string
  target?: string
  attributes?: AttributePredicate[]
  from?: string
  to?: string
  limit?: number
  offset?: number
}

export type RunArtifactKind = 'test' | 'suite-parent' | 'suite-child' | 'unknown'

export interface RunArtifactPayload {
  schemaVersion: number
  [key: string]: unknown
}

export interface RunArtifactRow {
  runId: string
  kind: RunArtifactKind
  schemaVersion: number
  payload: RunArtifactPayload
  finalizedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface RunArtifactResponse {
  run: RunRow
  artifact: RunArtifactRow | null
  children: Array<{ run: RunRow; artifact: RunArtifactRow | null }>
  missingSections: string[]
}

export interface LLMProviderMetadata {
  id: string
  label: string
  auth:
    | {
      kind: 'api-key'
      credentialTypes: Array<'api-key' | 'bearer-token'>
      optional?: boolean
    }
    | {
      kind: 'oauth-plugin'
      mode: 'browser-poll' | 'manual-code'
      buttonLabel?: string
    }
  modelAdapter?: 'openai-responses' | 'anthropic-messages'
  needsBaseURL?: boolean
  authModes?: Array<'api-key' | 'bearer-token' | 'subscription' | 'none'>
  subscription?: boolean
  baseURLPlaceholder?: string
  defaultModel?: string
}

export interface ModelCatalogEntry {
  id: string
  label: string
  vision: boolean
  notes?: string
}

export interface AuthStateMetadata {
  version: 1
  kind: 'web'
  target: string
  name: string
  capturedAt: string
}

function toAuthStateMetadata(value: unknown): AuthStateMetadata | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const candidate = value as Record<string, unknown>
  if (
    candidate.version !== 1 ||
    candidate.kind !== 'web' ||
    typeof candidate.target !== 'string' ||
    typeof candidate.name !== 'string' ||
    typeof candidate.capturedAt !== 'string'
  ) {
    return null
  }

  return {
    version: 1,
    kind: 'web',
    target: candidate.target,
    name: candidate.name,
    capturedAt: candidate.capturedAt,
  }
}

const API_BASE = ''

/**
 * Error thrown by api.ts helpers when the server returns a non-OK status with a JSON body.
 * Preserves server-sent structured fields (error, details, missingTests, message) so callers
 * can render rich UX. The `message` property inherits the server's top-level `error` field
 * when available, or falls back to `API error {status}: {statusText}`.
 *
 * Defensive parsing: non-JSON responses produce an ApiError with a null payload; malformed
 * JSON is swallowed. Structured fields are only copied when the payload is a non-null object
 * (primitives and arrays are rejected). See threat model T-181.04-02 / T-181.04-03.
 */
export class ApiError extends Error {
  readonly status: number
  readonly statusText: string
  readonly payload: Record<string, unknown> | null
  readonly details?: unknown
  readonly missingTests?: Array<{ index: number; test: string; id: string }>

  constructor(status: number, statusText: string, payload: Record<string, unknown> | null) {
    const message =
      (payload && typeof payload.error === 'string' && payload.error) ||
      (payload && typeof payload.message === 'string' && payload.message) ||
      `API error ${status}: ${statusText}`
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.statusText = statusText
    this.payload = payload
    if (payload && 'details' in payload) this.details = payload.details
    if (payload && Array.isArray(payload.missingTests)) {
      this.missingTests = payload.missingTests as Array<{ index: number; test: string; id: string }>
    }
  }
}

async function parseErrorPayload(res: Response): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = await res.json()
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
    return null
  } catch {
    // non-JSON or malformed body — payload stays null; ApiError falls back to statusText
    return null
  }
}

function buildQuery(params: Record<string, string | number | undefined>): string {
  const parts: string[] = []
  for (const [key, val] of Object.entries(params)) {
    if (val !== undefined && val !== '') {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(val))}`)
    }
  }
  return parts.length > 0 ? `?${parts.join('&')}` : ''
}

function appendAttributePredicateQueryParts(parts: string[], predicates: AttributePredicate[] | undefined) {
  for (const predicate of predicates ?? []) {
    if (!predicate.key || !predicate.value) continue
    const paramName = predicate.mode === 'regex'
      ? `attributes[${predicate.key}][regex]`
      : `attributes[${predicate.key}]`
    parts.push(`${encodeURIComponent(paramName)}=${encodeURIComponent(predicate.value)}`)
  }
}

function buildRunsQuery(opts: RunsFilter): string {
  const parts: string[] = []
  for (const [key, val] of Object.entries({
    status: opts.status,
    name: opts.name,
    platform: opts.platform,
    target: opts.target,
    from: opts.from,
    to: opts.to,
    limit: opts.limit,
    offset: opts.offset,
  })) {
    if (val !== undefined && val !== '') {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(val))}`)
    }
  }
  appendAttributePredicateQueryParts(parts, opts.attributes)
  return parts.length > 0 ? `?${parts.join('&')}` : ''
}

async function request<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`)
  if (!res.ok) {
    const payload = await parseErrorPayload(res)
    throw new ApiError(res.status, res.statusText, payload)
  }
  return res.json() as Promise<T>
}

async function postJson<T>(path: string, body: unknown, method = 'POST'): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const payload = await parseErrorPayload(res)
    throw new ApiError(res.status, res.statusText, payload)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export async function fetchRuns(opts: RunsFilter = {}): Promise<{ runs: RunRow[]; total: number; targets?: string[] }> {
  const query = buildRunsQuery(opts)
  return request(`/api/runs${query}`)
}

export interface AttributeKeySuggestion {
  key: string
  count: number
}

export interface AttributeValueSuggestion {
  value: string
  count: number
}

export async function fetchRunAttributeKeys(opts: { q?: string; limit?: number } = {}): Promise<{ keys: AttributeKeySuggestion[] }> {
  const query = buildQuery({ q: opts.q, limit: opts.limit })
  return request(`/api/runs/attributes/keys${query}`)
}

export async function fetchRunAttributeValues(key: string, opts: { q?: string; limit?: number } = {}): Promise<{ values: AttributeValueSuggestion[] }> {
  const query = buildQuery({ key, q: opts.q, limit: opts.limit })
  return request(`/api/runs/attributes/values${query}`)
}

export async function fetchRun(id: string): Promise<{ run: RunRow; steps: StepRow[]; attempts: RunRow[]; tests?: RunRow[] }> {
  return request(`/api/runs/${encodeURIComponent(id)}`)
}

export async function fetchRunArtifact(id: string): Promise<RunArtifactResponse> {
  return request(`/api/runs/${encodeURIComponent(id)}/artifact`)
}

export async function fetchStats(opts: { from?: string; to?: string; scope?: 'passRate' } = {}): Promise<Stats> {
  const query = buildQuery({ from: opts.from, to: opts.to, scope: opts.scope })
  return request(`/api/stats${query}`)
}

export async function fetchAuthStates(opts: { target?: string } = {}): Promise<{ authStates: AuthStateMetadata[] }> {
  const query = buildQuery({ target: opts.target })
  const result = await request<{ authStates?: unknown }>(`/api/auth-states${query}`)
  const authStates = Array.isArray(result.authStates)
    ? result.authStates.map(toAuthStateMetadata).filter((item): item is AuthStateMetadata => item !== null)
    : []
  return { authStates }
}

export async function saveLiveAuthState(
  sessionId: string,
  input: { name: string; replace?: boolean },
): Promise<{ authState: AuthStateMetadata }> {
  const result = await postJson<{ authState?: unknown }>(
    `/api/live-editor/sessions/${encodeURIComponent(sessionId)}/auth-state`,
    input,
  )
  const authState = toAuthStateMetadata(result.authState)
  if (!authState) {
    throw new Error('Invalid auth state response')
  }
  return { authState }
}

export type InsightsBreakdownDimension = 'test' | 'suite' | 'platform'

export interface InsightsBreakdownRow {
  key: string
  label: string
  runs: number
  passRate: number
  flakeRate: number
  avgDuration: number
  passed: number
  failed: number
  filePath?: string
  suiteId?: string
}

export async function fetchInsightsBreakdown(
  dimension: InsightsBreakdownDimension,
  opts: { from?: string; to?: string; limit?: number; scope?: 'passRate' } = {},
): Promise<{ dimension: InsightsBreakdownDimension; rows: InsightsBreakdownRow[]; scope?: AnalyticsScope }> {
  const query = buildQuery({
    dimension,
    from: opts.from,
    to: opts.to,
    limit: opts.limit,
    scope: opts.scope,
  })
  return request(`/api/analytics/breakdowns${query}`)
}

// Queue API

export interface QueueStatus {
  pending: { count: number; jobs: RunRow[] }
  running: { count: number; jobs: RunRow[] }
  concurrency: number
  activeSlots: number
  recent?: RunRow[]
}

export async function fetchQueueStatus(opts?: { completed?: boolean }): Promise<QueueStatus> {
  const query = buildQuery({ completed: opts?.completed ? 'true' : undefined })
  return request(`/api/queue/status${query}`)
}

// Test file API

export interface TestFileInfo {
  path: string
  name: string
  testId: string | null
  targetName: string | null
  platform: string | null
  modified: string
}

export interface TestValidationResult {
  valid: boolean
  errors: { message: string; line?: number; column?: number; suggestion?: string }[]
}

export async function fetchTestFiles(): Promise<{ files: TestFileInfo[]; targets?: string[] }> {
  return request('/api/tests')
}

export async function fetchTestFile(testId: string): Promise<{ path: string; content: string }> {
  return request(`/api/tests/${encodeURIComponent(testId)}`)
}

export async function createTestFile(filePath: string, content: string): Promise<{ path: string; created: boolean }> {
  const result = await postJson<{ path: string; created: boolean }>('/api/tests', { path: filePath, content })
  return result
}

export async function updateTestFile(testId: string, content: string): Promise<{ path: string; updated: boolean }> {
  return postJson(`/api/tests/${encodeURIComponent(testId)}`, { content }, 'PUT')
}

export async function deleteTestFile(testId: string): Promise<{ deleted: boolean; path: string }> {
  return postJson(`/api/tests/${encodeURIComponent(testId)}`, undefined, 'DELETE')
}

export async function validateTestContent(content: string, filePath?: string): Promise<TestValidationResult> {
  return postJson('/api/tests/validate', { content, filePath })
}

// Suite file API

export interface SuiteFileInfo {
  path: string
  suiteId: string | null
  name: string
  testCount: number
  modified: string
  platform: string | null
}

export async function fetchSuiteFiles(): Promise<{ files: SuiteFileInfo[] }> {
  return request('/api/suites')
}

export async function fetchSuiteFile(suiteId: string): Promise<{ path: string; content: string; suiteId: string }> {
  return request(`/api/suites/${encodeURIComponent(suiteId)}`)
}

export async function createSuiteFile(filePath: string, content: string): Promise<{ path: string; created: boolean }> {
  const result = await postJson<{ path: string; created: boolean }>('/api/suites', { path: filePath, content })
  return result
}

export async function updateSuiteFile(suiteId: string, content: string): Promise<{ path: string; updated: boolean }> {
  return postJson(`/api/suites/${encodeURIComponent(suiteId)}`, { content }, 'PUT')
}

export async function deleteSuiteFile(filePath: string): Promise<{ deleted: boolean }> {
  return postJson(`/api/suites/${encodeURIComponent(filePath)}`, undefined, 'DELETE')
}

export async function validateSuiteContent(content: string): Promise<TestValidationResult> {
  return postJson('/api/suites/validate', { content })
}

// Live execution API

export interface ActiveExecution {
  runId: string
  status: string
  startedAt: string
  duration: number
  testName?: string
}

export async function fetchActiveExecutions(): Promise<{ executions: ActiveExecution[] }> {
  return request('/api/execution/active')
}

/**
 * The confirm scope this page is currently askable on, or nothing (401-09, D-11).
 *
 * A MODULE-LEVEL BOX AND NOT A PARAMETER, and the reason is what the value MEANS. It is not a
 * property of any one trigger — it is "which browser is asking", which is a property of this page,
 * and this page has one person in front of it. There are nine call sites that start a run (the runs
 * table, the tests table, the suites table, three editors, two viewers, the rerun button); threading
 * a scope through all of them would be nine places to forget, and forgetting means an ask-tier run
 * silently falls back to `local-headless` and denies with nobody asked. Registered once by
 * {@link RunConfirmHost}, read here, and cleared when the channel closes.
 *
 * ABSENT IS THE HONEST DEFAULT: no channel, no claim, and the run fails closed by name.
 */
let currentRunConfirmScope: string | undefined

/** Set by the confirm host when its channel opens; cleared when it closes. */
export function setRunConfirmScope(scopeId: string | undefined): void {
  currentRunConfirmScope = scopeId
}

export function triggerRun(opts: { file?: string; patterns?: string[]; noCache?: boolean; local?: boolean }): Promise<{ runId: string; status: string }> {
  return postJson('/api/runs/trigger', {
    ...opts,
    ...(currentRunConfirmScope === undefined ? {} : { confirmScope: currentRunConfirmScope }),
  })
}

export async function cancelRun(runId: string): Promise<{ cancelled: boolean }> {
  return postJson(`/api/runs/${encodeURIComponent(runId)}/cancel`, {})
}

export async function deleteRun(runId: string): Promise<{ deleted: boolean; deletedRunIds: string[] }> {
  return postJson(`/api/runs/${encodeURIComponent(runId)}`, undefined, 'DELETE')
}

export async function purgeCache(opts: { file?: string; all?: boolean }): Promise<{ purged: number }> {
  return postJson('/api/cache/purge', opts)
}

export interface ExecutionLiveIdentity {
  eventId?: string
  runId: string
  parentRunId?: string | null
  suiteIndex?: number
  suiteTotal?: number
  testIndex?: number
  stepIndex?: number
  stepId?: string
}

export interface ExecutionTestStartEvent extends ExecutionLiveIdentity {
  type: 'test-start'
  testName: string
  filePath: string
  totalSteps: number
  timestamp?: string
}

export interface ExecutionTestCompleteEvent extends ExecutionLiveIdentity {
  type: 'test-complete'
  testName: string
  status: string
  duration: number
}

export interface ExecutionStepStartEvent extends ExecutionLiveIdentity {
  type: 'step-start'
  stepName: string
  testName: string
  timestamp: string
}

export interface ExecutionStepCompleteEvent extends ExecutionLiveIdentity {
  type: 'step-complete'
  stepName: string
  testName?: string
  status: string
  duration: number
  screenshot?: string
  screenshotBefore?: string
  observation?: string
  reasoning?: string
  plannedAction?: unknown
  result?: string
  error?: string
  annotation?: unknown
}

export interface ExecutionStepPhaseEvent extends ExecutionLiveIdentity {
  type: 'step-phase'
  stepName: string
  testName: string
  phase: 'observe' | 'plan' | 'execute' | 'verify' | 'heal'
  subActionIndex?: number
  phaseOrdinal?: number
  text?: string
  confidence?: number
  action?: unknown
  success?: boolean
  duration?: number
  timestamp: string
}

export interface ExecutionHookStartEvent extends Partial<ExecutionLiveIdentity> {
  type: 'hook-start'
  hookId?: string
  hookName: string
  phase: 'setup' | 'teardown' | 'inline'
  hookExecutionId: string
  timestamp: string
}

export interface ExecutionHookEndEvent extends Partial<ExecutionLiveIdentity> {
  type: 'hook-end'
  hookId?: string
  hookName: string
  phase: 'setup' | 'teardown' | 'inline'
  hookExecutionId: string
  status: 'passed' | 'failed'
  duration: number
  stdout?: string
  stderr?: string
  variables?: Record<string, string>
  error?: string
  logType?: 'hook' | 'appium-script' | 'runjs'
  timestamp: string
}

export interface ExecutionRunCompleteEvent {
  type: 'run-complete'
  eventId?: string
  runId: string
  status: string
  duration: number
}

// Test analytics API

export interface TestAnalyticsEntry {
  name: string
  filePath: string | null
  totalRuns: number
  passRate: number
  flakyScore: number
  isFlaky: boolean
}

export interface TestTrends {
  daily: { date: string; passed: number; failed: number; total: number; avgDuration: number }[]
  passRate: number
  totalRuns: number
  avgDuration: number
}

export interface AnalyticsScope {
  configured: boolean
  predicates: AttributePredicate[]
  scopedCount: number
  totalCount: number
}

export interface TestAnalyticsDetail {
  name: string
  runs: RunRow[]
  total: number
  trends: TestTrends
  isFlaky: boolean
  flakyScore: number
  scope?: AnalyticsScope
  scopedTrends?: TestTrends
  scopedFlakyScore?: number
  scopedRuns?: RunRow[]
}

export interface SuiteAnalyticsDetail {
  suiteId: string
  runs: RunRow[]
  total: number
  trends: TestTrends
  isFlaky: boolean
  flakyScore: number
  scope?: AnalyticsScope
  scopedTrends?: TestTrends
  scopedFlakyScore?: number
  scopedRuns?: RunRow[]
}

export async function fetchFlakyTests(opts?: { minRuns?: number; limit?: number }): Promise<{ tests: TestAnalyticsEntry[] }> {
  const query = buildQuery({ minRuns: opts?.minRuns, limit: opts?.limit })
  return request(`/api/analytics/tests${query}`)
}

export async function fetchTestAnalytics(
  name: string,
  opts?: { limit?: number; offset?: number; from?: string },
): Promise<TestAnalyticsDetail> {
  const query = buildQuery({ limit: opts?.limit, offset: opts?.offset, from: opts?.from })
  return request(`/api/analytics/tests/${encodeURIComponent(name)}${query}`)
}

export async function fetchSuiteAnalytics(
  suiteId: string,
  opts?: { limit?: number; offset?: number; from?: string },
): Promise<SuiteAnalyticsDetail> {
  const query = buildQuery({ limit: opts?.limit, offset: opts?.offset, from: opts?.from })
  return request(`/api/analytics/suites/${encodeURIComponent(suiteId)}${query}`)
}

// Cost / token analytics API

export interface CostStatsRun {
  runId: string
  name: string
  startedAt: string
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

export interface CostStats {
  runs: CostStatsRun[]
  totals: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
}

export async function fetchCostStats(opts?: { from?: string; to?: string }): Promise<CostStats> {
  const query = buildQuery({ from: opts?.from, to: opts?.to })
  return request(`/api/stats/costs${query}`)
}

export interface TokenEventStats {
  byModel: { date: string; model: string; promptTokens: number; completionTokens: number }[]
  bySource: Record<string, { promptTokens: number; completionTokens: number }>
  totals: { promptTokens: number; completionTokens: number }
}

export async function fetchTokenEventStats(opts?: { from?: string; to?: string }): Promise<TokenEventStats> {
  const query = buildQuery({ from: opts?.from, to: opts?.to })
  return request(`/api/token-events/stats${query}`)
}

export interface AccessibilitySummary {
  enabled: boolean | null
  total: number
  bySeverity: { critical: number; serious: number; moderate: number; minor: number }
  byRule: Array<{ ruleId: string; count: number; impact: string }>
  stepsWithViolations: number
  scannedSteps: number
  unscannedSteps: number
  totalSteps: number
}

export interface ReasoningTrace {
  id: string | null
  stepId: string
  observeText: string | null
  observeDuration: number | null
  planReasoning: string | null
  planConfidence: number | null
  planAction: unknown | null
  planDuration: number | null
  executeAction: unknown | null
  executeDuration: number | null
  verifyReasoning: string | null
  verifySuccess: boolean | null
  verifyDuration: number | null
  healAttempts: Array<{
    action: unknown
    observationBefore: string
    observationAfter?: string
    success: boolean
    attemptNumber?: number
    strategy?: string
    reasoning?: string
    confidence?: number
  }> | null
  totalDuration: number | null
  screenStateBefore: string | null
  screenStateAfter: string | null
  createdAt: string
}

export async function fetchStepReasoning(
  runId: string,
  stepOrder: number,
): Promise<{ trace: ReasoningTrace }> {
  return request(`/api/runs/${encodeURIComponent(runId)}/steps/${stepOrder}/reasoning`)
}

// Log API

export interface LogEntry {
  id: string
  stepId: string | null
  runId: string
  level: 'debug' | 'info' | 'warn' | 'error'
  source: 'agent' | 'adapter' | 'cache' | 'planner' | 'healer' | 'hook' | 'runner'
  message: string
  data: Record<string, unknown>
  timestamp: string
}

export async function fetchRunLogs(
  runId: string,
  opts?: { stepId?: string; level?: string; source?: string; limit?: number; offset?: number },
): Promise<{ logs: LogEntry[]; total: number }> {
  const query = buildQuery({
    stepId: opts?.stepId,
    level: opts?.level,
    source: opts?.source,
    limit: opts?.limit,
    offset: opts?.offset,
  })
  return request(`/api/runs/${encodeURIComponent(runId)}/logs${query}`)
}

export async function fetchAccessibilitySummary(runId: string): Promise<AccessibilitySummary> {
  return request(`/api/runs/${encodeURIComponent(runId)}/accessibility`)
}

export function subscribeToAllExecutionEvents(
  callbacks: {
    onRunStart?: (data: { runId: string; status: string; eventId?: string }) => void
    onRunComplete?: (data: ExecutionRunCompleteEvent) => void
  },
): EventSource {
  const source = new EventSource(`${API_BASE}/api/execution/events`)

  source.addEventListener('run-start', (e) => {
    callbacks.onRunStart?.(JSON.parse((e as MessageEvent).data))
  })
  source.addEventListener('run-complete', (e) => {
    callbacks.onRunComplete?.(JSON.parse((e as MessageEvent).data))
  })

  return source
}

// Config & LLM settings API

export interface ConfigResponse {
  config: Record<string, unknown>
}

export interface AppMetadataResponse {
  version: string
  update?: {
    latestVersion: string
  }
}

export interface AuthCredentialInfo {
  type: string
  provider: string
  expires: number | null
  source: string
  configName: string
}

export interface AuthStatusResponse {
  credentials: AuthCredentialInfo[]
}

export interface LLMTestResult {
  success: boolean
  error?: string
  message?: string
  authMessage?: string
  unauthenticated?: boolean
  responseTime?: number
  model?: string
  provider?: string
}

export async function fetchConfig(): Promise<ConfigResponse> {
  return request('/api/config')
}

export async function fetchAppMetadata(): Promise<AppMetadataResponse> {
  return request('/api/app-metadata')
}

export async function fetchTargets(): Promise<{ targets: string[] }> {
  return request('/api/config/targets')
}

export async function updateLLMs(
  llms: Array<{
    name: string
    provider: string
    model: string
    baseURL?: string
    providerHeaders?: Record<string, string>
    vision?: boolean
    contextWindow?: string
  }>,
  defaultLLM: string,
): Promise<{ updated: boolean }> {
  return postJson('/api/config/llms', { llms, defaultLLM }, 'PUT')
}

export async function updateDefaultLLM(name: string): Promise<{ updated: boolean }> {
  return postJson('/api/config/default-llm', { defaultLLM: name }, 'PUT')
}

export async function updateSettings(settings: Record<string, unknown>): Promise<{ updated: boolean }> {
  return postJson('/api/config/settings', settings, 'PUT')
}

export async function fetchAuthStatus(): Promise<AuthStatusResponse> {
  return request('/api/auth/status')
}

export async function fetchLLMProviders(): Promise<{ providers: LLMProviderMetadata[] }> {
  return request('/api/llm/providers')
}

export async function fetchModelCatalog(): Promise<{ catalog: Record<string, ModelCatalogEntry[]> }> {
  return request('/api/llm/catalog')
}

export async function fetchLiveModelCatalog(opts: {
  baseURL: string
  configName?: string
  providerHeaders?: Record<string, string>
}): Promise<{ models: ModelCatalogEntry[] }> {
  return postJson('/api/llm/catalog/live', opts)
}

export async function testLLMConnection(opts: {
  provider: string
  model: string
  baseURL?: string
  configName?: string
  providerHeaders?: Record<string, string>
}): Promise<LLMTestResult> {
  return postJson('/api/llm/test', opts)
}

export async function saveCredential(
  configName: string,
  provider: string,
  type: 'api-key' | 'bearer-token',
  secret: string,
): Promise<{ saved: boolean }> {
  return postJson('/api/auth/credential', { configName, provider, type, secret })
}

export async function startPluginAuth(
  provider: string,
  configName: string,
): Promise<{ authorizeUrl: string; sessionId: string; mode: 'browser-poll' | 'manual-code' }> {
  return postJson(`/api/auth/plugin/${encodeURIComponent(provider)}/start`, { configName })
}

export async function pollPluginAuthResult(
  provider: string,
  sessionId: string,
): Promise<{ status: 'pending' | 'completed' | 'error'; saved?: boolean; error?: string }> {
  return request(`/api/auth/plugin/${encodeURIComponent(provider)}/result?session=${encodeURIComponent(sessionId)}`)
}

export async function exchangePluginAuthCode(
  provider: string,
  sessionId: string,
  code: string,
): Promise<{ status: 'completed'; saved: boolean }> {
  return postJson(`/api/auth/plugin/${encodeURIComponent(provider)}/exchange`, { sessionId, code })
}

export async function deleteAuthCredential(configName: string): Promise<{ deleted: boolean }> {
  return postJson(`/api/auth/${encodeURIComponent(configName)}`, undefined, 'DELETE')
}

export function subscribeToExecutionEvents(
  runId: string,
  callbacks: {
    onRunStart?: (data: { runId: string; status: string; eventId?: string }) => void
    onTestStart?: (data: ExecutionTestStartEvent) => void
    onHookStart?: (data: ExecutionHookStartEvent) => void
    onHookEnd?: (data: ExecutionHookEndEvent) => void
    onStepStart?: (data: ExecutionStepStartEvent) => void
    onStepComplete?: (data: ExecutionStepCompleteEvent) => void
    onStepPhase?: (data: ExecutionStepPhaseEvent) => void
    onTestComplete?: (data: ExecutionTestCompleteEvent) => void
    onRunComplete?: (data: ExecutionRunCompleteEvent) => void
    onRunError?: (data: { runId: string; error: string; eventId?: string }) => void
  },
): EventSource {
  const source = new EventSource(`${API_BASE}/api/execution/events?runId=${encodeURIComponent(runId)}`)
  const parseExecutionEvent = <T extends { eventId?: string }>(e: Event): T => {
    const message = e as MessageEvent
    const parsed = JSON.parse(message.data) as T
    return message.lastEventId ? { ...parsed, eventId: message.lastEventId } : parsed
  }

  source.addEventListener('run-start', (e) => {
    callbacks.onRunStart?.(parseExecutionEvent<{ runId: string; status: string; eventId?: string }>(e))
  })
  source.addEventListener('test-start', (e) => {
    callbacks.onTestStart?.(parseExecutionEvent(e))
  })
  source.addEventListener('hook-start', (e) => {
    callbacks.onHookStart?.(parseExecutionEvent(e))
  })
  source.addEventListener('hook-end', (e) => {
    callbacks.onHookEnd?.(parseExecutionEvent(e))
  })
  source.addEventListener('step-start', (e) => {
    callbacks.onStepStart?.(parseExecutionEvent(e))
  })
  source.addEventListener('step-complete', (e) => {
    callbacks.onStepComplete?.(parseExecutionEvent(e))
  })
  source.addEventListener('step-phase', (e) => {
    callbacks.onStepPhase?.(parseExecutionEvent(e))
  })
  source.addEventListener('test-complete', (e) => {
    callbacks.onTestComplete?.(parseExecutionEvent(e))
  })
  source.addEventListener('run-complete', (e) => {
    callbacks.onRunComplete?.(parseExecutionEvent(e))
    source.close()
  })
  source.addEventListener('run-error', (e) => {
    callbacks.onRunError?.(parseExecutionEvent<{ runId: string; error: string; eventId?: string }>(e))
    source.close()
  })

  return source
}

// Variables API

export async function fetchVariables(): Promise<{ variables: { key: string; value: string }[]; filePath: string | null; error?: string }> {
  return request('/api/variables')
}

export async function updateVariable(opts: { oldKey?: string; key: string; value: string }): Promise<{ updated: boolean }> {
  return postJson('/api/variables', opts, 'PUT')
}

export async function deleteVariable(key: string): Promise<{ deleted: boolean }> {
  return postJson(`/api/variables/${encodeURIComponent(key)}`, undefined, 'DELETE')
}

export type HookRuntime = 'node' | 'bun' | 'python' | 'bash'
export type HookFieldName = 'id' | 'name' | 'runtime' | 'file' | 'timeout' | 'network' | 'registry'

export interface HookCatalogEntry {
  id: string
  name: string
  runtime: HookRuntime
  file: string
  timeout: number
  network: boolean
  fileMissing: boolean
}

export interface HookCatalogResponse {
  hooks: HookCatalogEntry[]
  filePath: string | null
  errors: string[]
  missing: boolean
}

export interface HookFieldError {
  field: HookFieldName
  code: string
  message: string
}

export interface HookDetailResponse {
  hook: HookCatalogEntry
  source: string | null
  fieldErrors: HookFieldError[]
}

export interface HookMutationInput {
  id?: string
  name: string
  runtime: HookRuntime
  file: string
  timeout: string
  network?: boolean
}

export interface HookMutationRequest {
  hook: HookMutationInput
  source: string
}

export interface HookDeleteReference {
  kind: 'test' | 'suite' | 'inline-runHook'
  label: string
  path: string
  context: string
}

export interface HookDeleteResult {
  deleted: boolean
  references: HookDeleteReference[]
}

export interface HookRunOverride {
  key: string
  value: string
}

export interface HookRunRequest {
  overrides?: HookRunOverride[]
}

export interface HookRunNetworkLogEntry {
  id: string
  method: string
  url: string
  statusCode: number | null
  durationMs: number | null
  error: string | null
}

export interface HookRunSandboxSummary {
  runtime: HookRuntime
  image: string
  networkMode: 'enabled' | 'disabled'
  dockerVersion?: string | null
  networkLogsAvailable: boolean
  networkLogs: HookRunNetworkLogEntry[]
}

export interface HookRunResponse {
  success: boolean
  status: 'passed' | 'failed'
  executedAt: string
  duration: number
  output: string
  stdout: string
  stderr: string
  error: string | null
  variables: Record<string, string>
  sandbox: HookRunSandboxSummary
}

export async function fetchHookCatalog(): Promise<HookCatalogResponse> {
  return request('/api/hooks')
}

export async function fetchHookDetail(hookId: string): Promise<HookDetailResponse> {
  return request(`/api/hooks/${encodeURIComponent(hookId)}`)
}

export async function createHook(payload: HookMutationRequest): Promise<HookDetailResponse> {
  const result = await postJson<HookDetailResponse>('/api/hooks', payload)
  return result
}

export async function updateHook(hookId: string, payload: HookMutationRequest): Promise<HookDetailResponse> {
  return postJson(`/api/hooks/${encodeURIComponent(hookId)}`, payload, 'PUT')
}

export async function deleteHook(
  hookId: string,
  opts: { force?: boolean } = {},
): Promise<HookDeleteResult> {
  const query = buildQuery({ force: opts.force ? 'true' : undefined })
  const res = await fetch(`${API_BASE}/api/hooks/${encodeURIComponent(hookId)}${query}`, {
    method: 'DELETE',
  })
  if (!res.ok) {
    const payload = await parseErrorPayload(res)
    throw new ApiError(res.status, res.statusText, payload)
  }
  return res.json() as Promise<HookDeleteResult>
}

export async function runHook(hookId: string, payload: HookRunRequest): Promise<HookRunResponse> {
  return postJson(`/api/hooks/${encodeURIComponent(hookId)}/run`, payload)
}

// Execution Logs API

export interface ExecutionLogEntry {
  id: string
  runId: string
  stepId: string | null
  type: 'hook' | 'appium-script' | 'runjs'
  name: string
  hookId?: string | null
  phase: 'setup' | 'teardown' | 'inline'
  status: 'running' | 'passed' | 'failed'
  duration: number
  stdout: string | null
  stderr: string | null
  returnData: unknown | null
  variables: Record<string, string> | null
  createdAt: string
}

export interface LiveExecutionLogEntry {
  id: string
  type: 'hook' | 'appium-script' | 'runjs'
  name: string
  hookId?: string | null
  phase: 'setup' | 'teardown' | 'inline'
  status: 'running' | 'passed' | 'failed'
  duration: number
  stdout: string | null
  stderr: string | null
  returnData: unknown | null
  variables: Record<string, string> | null
  createdAt: string
}

export async function fetchExecutionLogs(
  runId: string,
  opts?: { stepId?: string; type?: string }
): Promise<{ logs: ExecutionLogEntry[] }> {
  const query = buildQuery({ stepId: opts?.stepId, type: opts?.type })
  return request(`/api/runs/${encodeURIComponent(runId)}/execution-logs${query}`)
}

// Live editor API

export async function createLiveEditorSession(
  opts: {
    platform?: string
    targetName?: string
    url?: string
    headless?: boolean
    device?: Record<string, unknown>
    useDeviceName?: string
    appState?: 'preserve' | 'reset'
    bundleId?: string
    appPackage?: string
    appActivity?: string
    setupHooks?: string[]
    teardownHooks?: string[]
    entity?: { type: 'suite' | 'test'; id: string }
  },
  signal?: AbortSignal,
): Promise<{ sessionId: string; sessionNumber: number | null }> {
  const res = await fetch('/api/live-editor/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts),
    signal,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || `API error ${res.status}`)
  }
  const body = await res.json()
  const result = {
    sessionId: body.sessionId,
    sessionNumber: typeof body.sessionNumber === 'number' ? body.sessionNumber : null,
  }
  return result
}

export async function deleteLiveEditorSession(sessionId: string): Promise<{ ok: boolean }> {
  return postJson(`/api/live-editor/sessions/${encodeURIComponent(sessionId)}`, undefined, 'DELETE')
}

export async function fetchLiveEditorSessions(): Promise<{ sessions: Array<{ sessionId: string; platform: string; status: string; currentStep: string | null; currentUrl: string | null; stepsExecuted: number; createdAt: number }> }> {
  const res = await fetch('/api/live-editor/sessions')
  if (!res.ok) throw new Error(`${res.status}`)
  return res.json()
}

// Variable suggestion API (env keys, hook names, captured vars)

export async function fetchEnvVarKeys(): Promise<{ keys: string[] }> {
  return request('/api/variables/env')
}

export async function fetchHookNames(): Promise<{ names: string[] }> {
  return request('/api/variables/hooks')
}

export async function fetchCapturedVarNames(testId: string): Promise<{ names: string[] }> {
  return request(`/api/variables/captured/${encodeURIComponent(testId)}`)
}

// ---- The fourth door: dashboard chat (Phase 400 plan 06, DASH-01) ---------------------------
//
// FOUR WRAPPERS AND NO FIFTH. The door is `POST /api/chat/turn`, its stream, the confirm answer and
// the served capability catalog; there is no per-capability endpoint to wrap because there is no
// per-capability endpoint at all (397 D-03 — everything crosses one gated `agent.ask`). A helper
// here named after a capability would be the first inch of the bespoke-handler surface the roster
// exists to refuse.


/** One executed clause's registry fold, as the door computes it beside the payload (399.1 D-04). */
export interface ChatTurnFold {
  functionId: string
  verdict: { status: Exclude<ClauseReceiptStatus, 'not-run'>; outcome: string }
  foldLines: string[]
}

/** What `POST /api/chat/turn` answers with — the typed result, whole, plus the folds beside it. */
export interface ChatTurnResponse {
  result: AgentAskResult
  folds: ChatTurnFold[]
}

/**
 * The three answers a browser confirm offers — the TTY's `[y/a/N]`, in a medium with buttons.
 *
 * A VALUE AND A TYPE DERIVED FROM IT, rather than a bare union (401-09). Both confirm surfaces —
 * chat's inline bubble and the run trigger's dialog — render one button per member, and a
 * hand-written list at either render site would be a second spelling of the vocabulary that agreed
 * with the server right up until somebody changed one of them. It mirrors the server's own
 * `CHAT_CONFIRM_ANSWERS`, which the answer routes validate against with a closed `z.enum`, so a
 * fourth answer is a 400 rather than an `undefined` somewhere downstream.
 */
export const CONFIRM_ANSWER_VOCABULARY = ['accept', 'accept-always', 'deny'] as const

export type ChatConfirmAnswer = (typeof CONFIRM_ANSWER_VOCABULARY)[number]

export interface ChatConfirmRequestFrame {
  confirmId: string
  actionClass: string
  preview?: string
}

export interface ChatConfirmResolvedFrame {
  kind: 'confirm_resolved'
  confirmId: string
  answer: ChatConfirmAnswer
  /** WHY it resolved — a person, or one of the two silences. Rendered, never inferred. */
  by: 'answer' | 'timeout' | 'channel-closed'
}

export async function postChatTurn(input: {
  message: string
  sessionId?: string
}): Promise<ChatTurnResponse> {
  return postJson<ChatTurnResponse>('/api/chat/turn', input)
}

/**
 * Answer one outstanding confirm.
 *
 * `sessionId` IS NOT REDUNDANT WITH THE CONFIRM ID and must not be "tidied away": the registry
 * compares it against the session the question was parked for, so an id that leaked somewhere it
 * should not have cannot be spent on somebody else's conversation (T-400-09).
 */
export async function answerChatConfirm(input: {
  sessionId: string
  confirmId: string
  answer: ChatConfirmAnswer
}): Promise<{ resolved: boolean; answer: ChatConfirmAnswer }> {
  return postJson<{ resolved: boolean; answer: ChatConfirmAnswer }>('/api/chat/confirm', input)
}

/**
 * One row of the COMMITTED capability catalog, as the artifact spells it.
 *
 * The fields are the artifact's own, not a browser-shaped subset: the catalog is produced from a
 * real composition's declarations and the CLI's `/help`, its completer and `init --agent` all read
 * these same rows. A remapping here would be this surface's private idea of the document.
 */
export interface ChatCapabilityRow {
  kind: string
  alias?: string
  targetOpId?: string
  opId?: string
  description?: string
  docPath?: string | null
}

export interface ChatCapabilityCatalog {
  rowCount: number
  rowsDigest: string
  rows: ChatCapabilityRow[]
}

export async function fetchChatCapabilityCatalog(): Promise<ChatCapabilityCatalog> {
  return request<ChatCapabilityCatalog>('/api/chat/catalog')
}

/**
 * Watch one conversation.
 *
 * TWO KINDS OF FRAME ON ONE CONNECTION, and the callbacks keep them apart because the SERVER does:
 * session events are a projection of a durable log and carry the `id:` a reconnect spends; confirm
 * frames are transient facts about a question in flight and deliberately carry none (400-03). A
 * consumer that folded them into one handler would be inviting the reconnect to ask for an id no
 * window could hold.
 */
// ---- The RUN TRIGGER's confirm door (401-09, D-11) -------------------------------------------
//
// THE SAME THREE ANSWERS AS CHAT, ON A SURFACE WITH NO CONVERSATION. The registry, the single-use
// ids, the two DENY reapers and the mint are all the ones the chat confirm already rides; what is
// different here is only the address a question is delivered to, and that this browser has to ASK
// to be askable before it triggers anything.
//
// THE ORDER IS FORCED, NOT PREFERRED. The dashboard's queue dispatches a run in the same tick the
// trigger route enqueues it, so a channel opened after `triggerRun` resolved would be racing the
// run's own policy gate. The channel is opened first, the server mints the scope on it and
// announces it as the first frame, and the trigger names that scope.

/** The frame a freshly opened trigger channel announces itself with. */
export interface RunConfirmScopeFrame {
  scopeId: string
}

/**
 * Become askable, and stay askable until this connection closes.
 *
 * `onScope` FIRES BEFORE ANY QUESTION CAN ARRIVE, because the server writes the scope frame before
 * it registers the channel. A caller that triggered a run before this fired would be triggering as
 * an unaskable browser, which is why {@link setRunConfirmScope} is what the host calls from here.
 */
export function openRunConfirmChannel(
  callbacks: {
    onScope?: (frame: RunConfirmScopeFrame) => void
    onConfirmRequest?: (frame: ChatConfirmRequestFrame) => void
    onConfirmResolved?: (frame: ChatConfirmResolvedFrame) => void
    onPresent?: (text: string) => void
  },
): EventSource {
  const source = new EventSource(`${API_BASE}/api/run-confirm/channel`)
  source.addEventListener('confirm_scope', (e) => {
    callbacks.onScope?.(JSON.parse((e as MessageEvent).data) as RunConfirmScopeFrame)
  })
  source.addEventListener('confirm_request', (e) => {
    callbacks.onConfirmRequest?.(JSON.parse((e as MessageEvent).data) as ChatConfirmRequestFrame)
  })
  source.addEventListener('confirm_resolved', (e) => {
    callbacks.onConfirmResolved?.(JSON.parse((e as MessageEvent).data) as ChatConfirmResolvedFrame)
  })
  source.addEventListener('chat_present', (e) => {
    callbacks.onPresent?.((JSON.parse((e as MessageEvent).data) as { text: string }).text)
  })
  return source
}

/**
 * Answer one outstanding run-trigger confirm.
 *
 * `scopeId` IS NOT REDUNDANT WITH THE CONFIRM ID, on the chat answer route's own reasoning: the
 * registry compares it against the scope the question was parked for, so an id that leaked
 * somewhere it should not have cannot be spent on another browser's question.
 */
export async function answerRunConfirm(input: {
  scopeId: string
  confirmId: string
  answer: ChatConfirmAnswer
}): Promise<{ resolved: boolean; answer: ChatConfirmAnswer }> {
  return postJson<{ resolved: boolean; answer: ChatConfirmAnswer }>('/api/run-confirm/answer', input)
}

export function subscribeToChatSessionEvents(
  sessionId: string,
  callbacks: {
    onSessionEvent?: (event: ChatSessionEvent) => void
    onConfirmRequest?: (frame: ChatConfirmRequestFrame) => void
    onConfirmResolved?: (frame: ChatConfirmResolvedFrame) => void
    onPresent?: (text: string) => void
    onOpen?: () => void
  },
): EventSource {
  const source = new EventSource(
    `${API_BASE}/api/chat/sessions/${encodeURIComponent(sessionId)}/events`,
  )
  source.addEventListener('open', () => { callbacks.onOpen?.() })

  // The session-event kinds the door projects. Named rather than caught with a catch-all listener:
  // `EventSource` has no wildcard, and a `message` handler would only ever see frames the server
  // sent WITHOUT an `event:` line, which is none of these.
  const SESSION_EVENT_KINDS = [
    'user_message', 'stage_outcome', 'clause_receipt', 'clause_result', 'approval_decision',
    'mark_unhandled', 'model_change', 'active_tools_change', 'compaction', 'aborted',
    'turn_complete',
  ] as const
  for (const kind of SESSION_EVENT_KINDS) {
    source.addEventListener(kind, (e) => {
      callbacks.onSessionEvent?.(JSON.parse((e as MessageEvent).data) as ChatSessionEvent)
    })
  }

  source.addEventListener('confirm_request', (e) => {
    callbacks.onConfirmRequest?.(JSON.parse((e as MessageEvent).data) as ChatConfirmRequestFrame)
  })
  source.addEventListener('confirm_resolved', (e) => {
    callbacks.onConfirmResolved?.(JSON.parse((e as MessageEvent).data) as ChatConfirmResolvedFrame)
  })
  source.addEventListener('chat_present', (e) => {
    callbacks.onPresent?.((JSON.parse((e as MessageEvent).data) as { text: string }).text)
  })

  return source
}
