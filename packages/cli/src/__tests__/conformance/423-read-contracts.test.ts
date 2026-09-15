// 2026-09-15, 423-38 D-04/D-18: every 423 read contract, composed on every door, and the reviewed
// artifact rows that record them.
//
// ONE CANONICAL FIXTURE PER SCENE, READ THROUGH EVERY DOOR. A scenario is one op and one input over
// real durable state: dashboard rows and content-addressed evidence blobs for the run-detail family,
// a real mark ledger and knowledge store for the feedback reads. The same answer is then read through
// the `fn` dispatch (the registry under the CLI's own caller, which is what `agent-qa fn` invokes),
// the MCP protocol door built by the shipped factory over the same registry, the authed remote HTTP
// door and the local human HTTP door. Machine doors must agree byte for byte; the human door may
// differ only by restoring an allowed placeholder and sanitizing restored auth state.
//
// THE MCP HALF IS THE MAPPING'S OWN WORD. A projected read answers `tools/call` with the registry
// result; an unprojected read has no door at all and its recorded `UNPROJECTED_OPS` reason classifies
// to the scenario row's class. Nothing here restates a tool name or a reason.
//
// GOLDEN-CATALOG-COMPLETE compares COMMITTED artifacts with the live tree for exactly these ops, so
// it is an artifact-agreement cell on the regen scripts' written eligibility rule. It never writes.

import { createHash } from 'node:crypto'
import { cpSync, existsSync, lstatSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { createMcpHandler } from '@modelcontextprotocol/server'
import {
  createFunctionRegistry,
  invokeFunction,
  type FunctionDeclaration,
  type FunctionDeps,
  type FunctionRegistry,
} from '@vostride/agent-qa-agent'
import {
  buildRunMaskingContext,
  createEvidenceBlobReader,
  resolveMaskingHostKey,
  writeMaskingDigests,
  type LocalAgentHost,
} from '@vostride/agent-qa-agent-local'
import { AUTH_STATE_REDACTION_MARKER } from '@vostride/agent-qa-core'
import {
  createConfirmRegistry,
  createDashboardRunDetailReader,
  createRunServiceRoutes,
  DashboardDatabase,
  startServer,
  type RunServicePorts,
} from '@vostride/agent-qa-dashboard'
import { AGENT_QA_TOOL_PROJECTIONS, buildAgentQaMcpServer, UNPROJECTED_OPS } from '@vostride/agent-qa-mcp'
import { FsEvidenceArtifactStore } from '@vostride/agent-qa-runner-local'
import { setActiveMaskingContextResolver } from '@vostride/agent-qa-safety'
import {
  asRunId,
  canonicalJson,
  CurationSnapshotSchema,
  KnowledgeRecordShowResultSchema,
  PostProcessingStatusSchema,
  RunDetailProjectionSchema,
  RunKnowledgeProjectionSchema,
  RunsEvidenceResultSchema,
  RunsMarkPreviewResultSchema,
  RunsMarksHistoryResultSchema,
  type CatalogOpRow,
  type CompletedRunHandoff,
  type FunctionCaller,
  type FunctionScope,
  type RecordChange,
  type RunId,
} from '@vostride/agent-qa-schema'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { composeDashboardAgentHost, composeDashboardDoor } from '../../commands/dashboard.js'
import { mcpFunctionCaller } from '../../commands/mcp.js'
import { createDisplayUnmasker } from '../../composition/display-unmask.js'
import { loadCapabilityCatalog } from '../../capability-catalog/loader.js'
import { CLI_FUNCTION_CALLER } from '../../composition/local-agent-host.js'
import { credentialForBearer, matchBearer, resolveMcpTokens } from '../../composition/mcp-token-resolution.js'
import { matchServiceBearer } from '../../composition/run-service-token-resolution.js'
import { createFeedbackPortForHost } from '../../gates/feedback-host.js'
import { markFixture } from '../../gates/__tests__/feedback-fixture.js'
import { CATALOG_PATH, catalogOpRowOf } from './catalog.js'
import { GOLDEN_PATH, goldenRowOf, withGoldenRootDeclarations, type GoldenFile } from './golden.js'
import { scenarioRowFor, unprojectedReasonKeyOf } from './scenario-table.js'

// ---- Synthetic secrets and the one live mask ------------------------------------------------------

const AUTH_TOKEN = 'synthetic-423-38-cookie-token'
const AUTH_STATE = JSON.stringify({
  cookies: [{ name: 'session', value: AUTH_TOKEN, domain: 'app.test', path: '/' }],
  origins: [],
})
const ALLOWED = 'Restored 423-38 display label'
const BEARER = 'synthetic-423-38-remote-client'
const READ_SCOPES: readonly FunctionScope[] = ['read']

/** Every path and byte under a root, directories included, so a created directory is visible. */
function tree(root: string): [string, string][] {
  if (!existsSync(root)) return [[root, 'absent']]
  const walk = (path: string): [string, string][] => lstatSync(path).isDirectory()
    ? [[path, 'dir'], ...readdirSync(path).sort().flatMap(name => walk(join(path, name)))]
    : [[path, createHash('sha256').update(readFileSync(path)).digest('hex')]]
  return walk(root)
}

/** The declared-bearer MCP caller the socket path mints, for a read-only grant. */
function declaredMcpCaller(scopes: readonly FunctionScope[]): FunctionCaller {
  const token = 'agent-qa-423-38-mcp-bearer'
  const tokens = resolveMcpTokens([
    { name: 'read-contracts', tokenEnvVar: 'AGENT_QA_423_38_BEARER', scopes: [...scopes] },
  ], { AGENT_QA_423_38_BEARER: token })
  return mcpFunctionCaller(scopes, credentialForBearer(matchBearer(`Bearer ${token}`, tokens)))
}

// ---- Doors over one registry ----------------------------------------------------------------------

interface HttpAnswer { readonly status: number; readonly raw: string; readonly body: unknown }
type McpAnswer =
  | { readonly door: 'answered'; readonly isError: boolean; readonly structured: unknown; readonly text: string }
  | { readonly door: 'absent'; readonly code: number | undefined; readonly message: string }

interface Doors {
  readonly registry: FunctionRegistry
  fn(opId: string, input: unknown): Promise<unknown>
  mcpTools(): Promise<readonly string[]>
  mcp(tool: string, input: Record<string, unknown>): Promise<McpAnswer>
  human(method: 'GET' | 'POST', path: string, body?: unknown): Promise<HttpAnswer>
  machine(method: 'GET' | 'POST', path: string, body?: unknown): Promise<HttpAnswer>
  close(): Promise<void>
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('fixture server bound no port')
  return `http://127.0.0.1:${String(address.port)}`
}

async function openDoors(input: {
  registry: FunctionRegistry
  agentHost: ReturnType<typeof composeDashboardAgentHost>
  db: DashboardDatabase
  maskText: (text: string) => string
}): Promise<Doors> {
  const started = await startServer({ db: input.db, port: 0, agentHost: input.agentHost })
  const address = started.server.address()
  if (address === null || typeof address === 'string') throw new Error('human door bound no port')
  const humanOrigin = `http://127.0.0.1:${String(address.port)}`
  const remote = createServer(createRunServiceRoutes({ agentHost: input.agentHost,
    verifyBearer: header => matchServiceBearer(header, [{ name: 'read-contracts', tokenEnvVar: 'AGENT_QA_423_38_TOKEN',
      value: BEARER, trustScope: { project: 'read-contracts' } }]),
  } as RunServicePorts))
  const machineOrigin = await listen(remote)
  const call = async (url: string, method: 'GET' | 'POST', headers: Record<string, string>, body?: unknown) => {
    const response = await fetch(url, { method, headers: { ...headers, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    const raw = await response.text()
    let parsed: unknown
    try { parsed = JSON.parse(raw) } catch { parsed = undefined }
    return { status: response.status, raw, body: parsed }
  }
  const withClient = async <T>(body: (client: Client) => Promise<T>): Promise<T> => {
    const handler = createMcpHandler(() => buildAgentQaMcpServer({
      registry: input.registry, caller: declaredMcpCaller(READ_SCOPES), maskText: input.maskText }))
    const client = new Client({ name: 'agent-qa-423-38-read-contracts', version: '0.0.0' })
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL('http://read-contracts.local/mcp'), {
        fetch: ((url: URL | string, init?: RequestInit) => handler.fetch(new Request(url, init))) as typeof fetch }))
      return await body(client)
    } finally { await client.close().catch(() => undefined) }
  }
  return {
    registry: input.registry,
    fn: (opId, value) => invokeFunction(input.registry, opId, value, CLI_FUNCTION_CALLER),
    mcpTools: () => withClient(async client => (await client.listTools()).tools.map(tool => tool.name)),
    mcp: (tool, args) => withClient(async (client): Promise<McpAnswer> => {
      try {
        const result = await client.callTool({ name: tool, arguments: args }) as {
          isError?: boolean; structuredContent?: unknown; content?: { type: string; text?: string }[] }
        return { door: 'answered', isError: result.isError === true, structured: result.structuredContent,
          text: (result.content ?? []).map(entry => entry.type === 'text' ? entry.text ?? '' : '').join('\n') }
      } catch (thrown) {
        const error = thrown as { code?: number; message?: string }
        return { door: 'absent', code: typeof error.code === 'number' ? error.code : undefined, message: String(error.message) }
      }
    }),
    human: (method, path, body) => call(`${humanOrigin}/api/runs${path}`, method, {}, body),
    machine: (method, path, body) => call(`${machineOrigin}/run${path}`, method, { Authorization: `Bearer ${BEARER}` }, body),
    async close() {
      await started.close()
      await new Promise<void>(resolve => remote.close(() => resolve()))
    },
  }
}

// ---- Scene A: the durable run-detail family -------------------------------------------------------

const RECORD_USED = 'record-423-38-used'
const RECORD_LEARNED = 'record-423-38-learned'

function currentRecord(recordId: string) {
  return KnowledgeRecordShowResultSchema.parse({
    kind: 'found', schemaVersion: 1, summary: `Current summary ${recordId}`, body: `Current body ${recordId}`,
    provenance: { schemaVersion: 1, mode: 'standalone', originClass: 'agent-observed', sourceDescription: 'synthetic 423-38' },
    record: { schemaVersion: 1, recordId, product: 'shop', scope: 'checkout', kind: 'fact', status: 'superseded',
      confirmations: 3, contradictions: 1, evidenceTokens: ['evidence-423-38'], openedAtOrdinal: 4, closedAtOrdinal: 40,
      lastEventOrdinal: 40, anchors: ['page:/checkout'], trustNarrative: 'Current synthetic evidence' },
  })
}

function curationSnapshot(runId: string) {
  const classified = (recordId: string, change: RecordChange['change'], atOrdinal: number): RecordChange => ({
    schemaVersion: 1, recordId, change, atOrdinal, sourceRunId: runId,
    evidenceToken: `receipt-${recordId}`, observationId: `observation-${recordId}` })
  return CurationSnapshotSchema.parse({ schemaVersion: 1, rows: [
    { recordId: RECORD_LEARNED, bucket: 'added', changes: [{ bucket: 'added', change: classified(RECORD_LEARNED, 'added', 20) }] },
    { recordId: 'confirmed-423-38', bucket: 'confirmed', changes: [{ bucket: 'confirmed', change: classified('confirmed-423-38', 'confirmed', 21) }] },
    { recordId: 'victim-423-38', bucket: 'superseded', byRecordId: 'replacement-423-38', changes: [
      { bucket: 'superseded', change: { ...classified('victim-423-38', 'superseded', 22), byRecordId: 'replacement-423-38' } },
      { bucket: 'added', change: classified('replacement-423-38', 'added', 22) }] },
    { recordId: 'deprecated-423-38', bucket: 'deprecated', changes: [{ bucket: 'deprecated', change: classified('deprecated-423-38', 'deprecated', 23) }] },
    { recordId: 'proposed-423-38', bucket: 'proposed', changes: [{ bucket: 'proposed', change: classified('proposed-423-38', 'added', 24) }] },
  ], breakdown: { added: 1, confirmed: 1, superseded: 1, deprecated: 1, proposed: 1 } })
}

const LEGACY_RUNG = { schemaVersion: 1, rung: 'bundle-scan', reason: 'index-unavailable' } as const
const CURRENT_RUNG = { schemaVersion: 2, rung: 'bundle-scan', reason: 'index-locked' } as const

function knowledgeHandoff(runId: RunId, allowedPlaceholder: string): CompletedRunHandoff {
  const brief = (channel1: unknown[] = []) => ({ scope: { tier: 'product', key: 'shop' }, asOfBuild: 12, budget: 400,
    truncation: '', channel1, channel2: [], channel3: [], briefDigest: 'digest-423-38' })
  const step = (stepIndex: number, extra: Record<string, unknown>) => ({ stepIndex, stepText: allowedPlaceholder,
    cacheStatus: 'miss', servedBrief: brief(), subActions: [], verifierVerdict: { pass: true, reasoning: 'ok' }, ...extra })
  return {
    schemaVersion: 6, runId, scope: { tier: 'product', key: 'shop' }, buildOrdinal: 12, executionContext: 'local',
    aggregateVerdict: 'passed', configDigests: { suiteConfigDigest: 'suite-423-38', testConfigDigest: 'test-423-38' },
    startedAt: 1, endedAt: 2,
    tests: [{ testId: 't_423_38', testName: 'read contracts', filePath: 'tests/read-contracts.yaml', testIndex: 0, outcome: 'passed',
      steps: [
        step(0, { retrievalRung: LEGACY_RUNG, servedBrief: brief([{ id: RECORD_USED, kind: 'fact', summary: allowedPlaceholder,
          trust: 0.7, status: 'active', servedAsCanary: false, tier: 'context' }]) }),
        step(1, { retrievalRung: CURRENT_RUNG }),
      ] }],
  } as unknown as CompletedRunHandoff
}

async function openDurableScene() {
  const root = mkdtempSync(join(tmpdir(), 'agent-qa-423-38-durable-'))
  const db = new DashboardDatabase({ dbPath: join(root, 'dashboard.db') })
  const values = { AUTH_STATE, ALLOWED }
  const store = { forEachSecret(cb: (name: string, value: string) => void) {
    for (const [name, value] of Object.entries(values)) cb(name, value) } }
  const mask = buildRunMaskingContext({ secretStore: store, env: {} })
  const placeholders = new Map(mask.snapshotRegistered().map(({ value, placeholder }) => [value, placeholder]))
  const authPlaceholder = placeholders.get(AUTH_STATE)!
  const allowedPlaceholder = placeholders.get(ALLOWED)!
  setActiveMaskingContextResolver(() => mask)

  const runId = db.insertRun({ name: 'Read contract fixture', status: 'failed', duration: 1,
    startedAt: new Date(0).toISOString(), endedAt: new Date(1).toISOString() })
  writeMaskingDigests({ root, runId, key: resolveMaskingHostKey(root), entries: mask.snapshotRegistered() })
  const blobs = new FsEvidenceArtifactStore({ root, runId })
  const consoleRef = blobs.persistEvidenceDocument({ schemaVersion: 1, kind: 'console', records: [
    { level: 'error', text: allowedPlaceholder, timestamp: 1 }, { level: 'log', text: authPlaceholder, timestamp: 2 }] })
  const networkRef = blobs.persistEvidenceDocument({ schemaVersion: 1, kind: 'network', records: [
    { url: 'https://app.test/api/cart', method: 'GET', status: 500, requestHeaders: { accept: 'application/json' },
      responseHeaders: { 'content-type': 'application/json' }, body: allowedPlaceholder, startTime: 1, endTime: 2 }] })
  const a11yRef = blobs.persistEvidenceDocument({ schemaVersion: 1, kind: 'a11y', records: [
    { ruleId: 'button-name', impact: 'serious', description: allowedPlaceholder, help: 'Buttons need names',
      helpUrl: 'https://rules.test/button-name', nodes: [{ html: '<button></button>', target: ['#buy'] }] }] })
  const ariaRef = blobs.persistEvidenceDocument({ schemaVersion: 1, kind: 'aria', tree: `- button "${allowedPlaceholder}"` })

  db.upsertRunMember({ runId, testIndex: 0, name: 'Read contract member', totalSteps: 2, outcome: 'failed' })
  const planner = (modelId: string, respondingModelIds: string[]) => ({ declared: { provider: 'provider-423-38', modelId }, respondingModelIds })
  db.insertRunStep({ runId, testIndex: 0, stepIndex: 0, stepText: allowedPlaceholder, cacheStatus: 'miss',
    verifierVerdict: null, selfHealOccurred: false, briefDigest: '', status: 'failed', error: authPlaceholder,
    tokenUsage: { promptTokens: 100, completionTokens: 7, totalTokens: 107, cachedInputTokens: 60 },
    modelUsage: { calls: { started: 1, succeeded: 1, failed: 0 }, roles: { planner: planner('planner-a', ['planner-a-response']) } },
    evidence: {
      console: { kind: 'console', state: 'present', ref: consoleRef as never, counts: { total: 2, errors: 1, warnings: 0 } },
      network: { kind: 'network', state: 'present', ref: networkRef as never, counts: { total: 1, failed: 1, errored: 0 } },
      a11y: { kind: 'a11y', state: 'present', ref: a11yRef as never, counts: { minor: 0, moderate: 0, serious: 1, critical: 0 } },
      variables: { kind: 'variables', state: 'present', counts: { count: 1 } },
    },
    variableSnapshot: { CART_LABEL: { value: allowedPlaceholder, source: 'inline' } },
  })
  // Recorded before 423: no evidence column, no model identity, no provider cache measurement.
  db.insertRunStep({ runId, testIndex: 0, stepIndex: 1, stepText: 'Historical step', cacheStatus: 'hit',
    verifierVerdict: null, selfHealOccurred: false, briefDigest: '',
    tokenUsage: { promptTokens: 900, completionTokens: 13, totalTokens: 913 } })
  db.insertRunSubAction({ runId, testIndex: 0, stepIndex: 0, subActionIndex: 0, plan: 'click buy',
    plannedAction: { kind: 'click' }, result: { ok: true }, screenStateHash: 'hash-423-38',
    artifactRefs: [ariaRef], ariaEvidence: { kind: 'aria', state: 'present', ref: ariaRef as never } })

  const handoff = knowledgeHandoff(asRunId(runId), allowedPlaceholder)
  const snapshot = curationSnapshot(runId)
  const deps = {
    runs: {
      list: async () => [handoff], get: async (id: string) => (id === runId ? handoff : undefined),
      readEvents: async () => [], readStepEvidence: async () => ({ kind: 'run-not-recorded' as const }),
    },
    knowledge: {
      listBundles: async () => [], inspectRecords: async () => [],
      diffSince: async () => snapshot.rows.flatMap(row => row.changes.map(entry => entry.change)),
      showRecord: async ({ recordId }: { recordId: string }) => ({ kind: 'not-found' as const, schemaVersion: 1 as const, recordId }),
      showRecords: async ({ recordIds }: { recordIds: readonly string[] }) => recordIds.map(currentRecord),
    },
    entities: { resolve: async () => ({ kind: 'none' as const, reason: 'no-match' as const }), get: async () => undefined },
    config: { getMasked: async () => ({ schemaVersion: 1, configPath: 'agent-qa.config.yaml', entries: [] }) },
    postProcessing: {
      idSource: { jobIdFor: (kind: string, key: string) => `${kind}:${key}` },
      readChain: async () => ({
        analyzeRun: { status: 'done', claimed: false, attempts: 1 },
        curateMemory: { status: 'done', claimed: false, attempts: 2 },
        proposeImprovements: { status: 'queued', claimed: true, attempts: 1 },
        curationSnapshot: snapshot,
      }),
    },
    runDetail: createDashboardRunDetailReader(db),
    evidenceBlobs: createEvidenceBlobReader({ agentQaRoot: root }),
  } as unknown as FunctionDeps
  const registry = createFunctionRegistry({ deps, resolveExecutionContext: () => 'local-interactive',
    auditSink: { appendExecutionAudit() {}, appendGuardrailAudit() {} } })
  const unmask = createDisplayUnmasker({ agentQaRoot: root, secretStores: () => [store], env: () => ({}), authStatePayloads: () => [] })
  const agentHost = composeDashboardAgentHost({ registry } as LocalAgentHost,
    { subscribe: () => () => undefined, emit() {} }, undefined, undefined, unmask)
  const doors = await openDoors({ registry, agentHost, db, maskText: text => mask.mask(text) })
  return { root, db, runId, authPlaceholder, allowedPlaceholder, doors, snapshot,
    async close() {
      await doors.close()
      db.close()
      setActiveMaskingContextResolver(() => undefined)
      mask.dispose()
      rmSync(root, { recursive: true, force: true })
    } }
}

// ---- Scene B: the feedback reads over the shipped dashboard composition ---------------------------

async function openFeedbackScene() {
  const f = markFixture()
  const runId = f.handoff.runId
  const marked = await createFeedbackPortForHost(f.deps).mark({ runId, kind: 'false-fail', note: 'first run-level note' })
  if (marked.kind !== 'marked') throw new Error(`fixture mark refused: ${marked.kind}`)
  const root = mkdtempSync(join(tmpdir(), 'agent-qa-423-38-feedback-'))
  cpSync(f.root, root, { recursive: true })
  rmSync(f.root, { recursive: true, force: true })
  const agentQaRoot = join(root, '.agent-qa')
  const configPath = join(root, 'agent-qa.config.yaml')
  writeFileSync(join(root, '.env.secrets.local'), `READ_CONTRACT_TOKEN=${AUTH_TOKEN}\n`)
  const door = composeDashboardDoor({ configPath, agentQaRoot, boundOrigin: () => undefined,
    confirms: createConfirmRegistry({ timeoutMs: 1_000 }) })
  const db = new DashboardDatabase({ dbPath: ':memory:' })
  const doors = await openDoors({ registry: door.host.registry, agentHost: door.agentHost, db, maskText: text => text })
  return { root, runId, receipt: marked.receipt, doors,
    stores: [join(agentQaRoot, 'runs'), join(agentQaRoot, 'proposals'), join(agentQaRoot, 'eval'),
      join(root, 'agent-qa-knowledge'), join(root, 'agent-qa-eval')],
    async close() {
      await doors.close()
      await door.host.close()
      db.close()
      rmSync(root, { recursive: true, force: true })
    } }
}

// ---- The scenarios --------------------------------------------------------------------------------

type DurableScene = Awaited<ReturnType<typeof openDurableScene>>
type FeedbackScene = Awaited<ReturnType<typeof openFeedbackScene>>

interface ReadScenario {
  readonly name: string
  readonly opId: string
  readonly scene: 'durable' | 'feedback'
  /** The op input, from the canonical fixture. */
  input(scene: DurableScene | FeedbackScene): Record<string, unknown>
  /** The HTTP path under each door's run prefix, or `undefined` where that door publishes none. */
  readonly http: {
    readonly method: 'GET' | 'POST'
    path(input: Record<string, unknown>): string
    readonly machine: boolean
    /** The route's own published envelope around the op result, where it has one. */
    readonly envelope?: (result: unknown) => unknown
  }
  /** What the positive case must show, over the machine answer. */
  expectPositive(result: unknown, scene: DurableScene | FeedbackScene): void
}

const run = (input: Record<string, unknown>) => `/${encodeURIComponent(String(input['runId']))}`
const evidencePath = (input: Record<string, unknown>) => {
  const query = new URLSearchParams({ kind: String(input['kind']), testIndex: String(input['testIndex']), stepIndex: String(input['stepIndex']),
    ...(input['subActionIndex'] === undefined ? {} : { subActionIndex: String(input['subActionIndex']) }) })
  return `${run(input)}/evidence?${query.toString()}`
}
const durable = (scene: DurableScene | FeedbackScene) => scene as DurableScene
const feedback = (scene: DurableScene | FeedbackScene) => scene as FeedbackScene

const EVIDENCE_KINDS_READ = [
  { kind: 'console', subActionIndex: undefined, document: { records: [{ text: '<allowed>' }, { text: '<auth>' }] } },
  { kind: 'network', subActionIndex: undefined, document: { records: [{ status: 500, body: '<allowed>' }] } },
  { kind: 'a11y', subActionIndex: undefined, document: { records: [{ impact: 'serious', description: '<allowed>' }] } },
  { kind: 'aria', subActionIndex: 0, document: { tree: '- button "<allowed>"' } },
  { kind: 'variables', subActionIndex: undefined, document: { records: { CART_LABEL: { value: '<allowed>', source: 'inline' } } } },
] as const

function placeholdersIn(value: unknown, scene: DurableScene): unknown {
  return JSON.parse(JSON.stringify(value).replaceAll('<allowed>', scene.allowedPlaceholder).replaceAll('<auth>', scene.authPlaceholder))
}

const READ_SCENARIOS: readonly ReadScenario[] = [
  ...EVIDENCE_KINDS_READ.map((entry): ReadScenario => ({
    name: `runs.evidence five kinds: ${entry.kind}`,
    opId: 'runs.evidence', scene: 'durable',
    input: scene => ({ runId: durable(scene).runId, testIndex: 0, stepIndex: 0, kind: entry.kind,
      ...(entry.subActionIndex === undefined ? {} : { subActionIndex: entry.subActionIndex }) }),
    http: { method: 'GET', path: evidencePath, machine: true },
    expectPositive(result, scene) {
      const parsed = RunsEvidenceResultSchema.parse(result)
      expect(parsed).toMatchObject({ outcome: 'ready', evidence: { kind: entry.kind, state: 'present' },
        document: placeholdersIn({ kind: entry.kind, ...entry.document }, durable(scene)) })
    },
  })),
  {
    name: 'runs.evidence pre-423 step answers unavailable',
    opId: 'runs.evidence', scene: 'durable',
    input: scene => ({ runId: durable(scene).runId, testIndex: 0, stepIndex: 1, kind: 'console' }),
    http: { method: 'GET', path: evidencePath, machine: true },
    expectPositive(result) {
      expect(RunsEvidenceResultSchema.parse(result)).toMatchObject({ outcome: 'absent',
        evidence: { kind: 'console', state: 'absent', reason: 'unavailable' } })
    },
  },
  {
    name: 'runs.detail mixed authoritative usage and historical evidence',
    opId: 'runs.detail', scene: 'durable',
    input: scene => ({ runId: durable(scene).runId }),
    http: { method: 'GET', path: input => `${run(input)}/detail`, machine: true },
    expectPositive(result) {
      const parsed = RunDetailProjectionSchema.parse(result)
      expect(parsed.tokens).toMatchObject({ measuredSteps: 2, promptTokens: 1000, completionTokens: 20, totalTokens: 1020,
        cachedInputTokens: 60, cachedMeasuredSteps: 1, cachedInputMeasuredTokens: 100 })
      expect(parsed.models).toEqual({ declared: [{ provider: 'provider-423-38', modelId: 'planner-a', stepCount: 1 }],
        responding: [{ provider: 'provider-423-38', modelId: 'planner-a-response', stepCount: 1 }] })
      expect(parsed.steps[0]?.evidence).toMatchObject({ console: { state: 'present' }, network: { state: 'present' },
        a11y: { state: 'present' }, variables: { state: 'present' } })
      expect(parsed.steps[1]?.evidence).toMatchObject({ console: { state: 'absent', reason: 'unavailable' } })
    },
  },
  {
    name: 'runs.postprocessing early curation snapshot with all five buckets',
    opId: 'runs.postprocessing', scene: 'durable',
    input: scene => ({ runId: durable(scene).runId }),
    // 404-05: the local read answers `{ status, failures }`; with no chip events relayed, failures is empty.
    http: { method: 'GET', path: input => `${run(input)}/post-processing`, machine: false,
      envelope: result => ({ status: result, failures: {} }) },
    expectPositive(result, scene) {
      const parsed = PostProcessingStatusSchema.parse(result)
      expect(parsed.chips).toEqual({ analysis: 'done', curation: 'done' })
      expect(parsed).toMatchObject({ stageDetails: { analysis: { attempts: 1 }, curation: { attempts: 2 }, proposals: { attempts: 1 } } })
      expect(parsed).toHaveProperty('curationSnapshot', durable(scene).snapshot)
      expect(parsed).not.toHaveProperty('notification')
    },
  },
  {
    name: 'runs.knowledge batch current-content joins and snapshot sections',
    opId: 'runs.knowledge', scene: 'durable',
    input: scene => ({ runId: durable(scene).runId }),
    http: { method: 'GET', path: input => `${run(input)}/knowledge`, machine: false },
    expectPositive(result, scene) {
      const parsed = RunKnowledgeProjectionSchema.parse(result)
      if (parsed.kind !== 'ready') throw new Error(`expected a ready knowledge projection, got ${parsed.kind}`)
      const used = parsed.steps[0]?.served.channel1[0]
      expect(used).toMatchObject({ id: RECORD_USED, recordContent: { kind: 'fact', currentStatus: 'superseded' } })
      expect(parsed.learned).toHaveProperty('curationSnapshot', durable(scene).snapshot)
      expect(parsed.learned).toHaveProperty('sinceThen', { changes: [], count: 0 })
      expect(parsed.learned.changes.find(row => row.recordId === RECORD_LEARNED))
        .toMatchObject({ recordContent: { kind: 'fact', currentStatus: 'superseded' } })
    },
  },
  {
    name: 'runs.knowledge legacy and current rung causes',
    opId: 'runs.knowledge', scene: 'durable',
    input: scene => ({ runId: durable(scene).runId }),
    http: { method: 'GET', path: input => `${run(input)}/knowledge`, machine: false },
    expectPositive(result) {
      const parsed = RunKnowledgeProjectionSchema.parse(result)
      if (parsed.kind !== 'ready') throw new Error(`expected a ready knowledge projection, got ${parsed.kind}`)
      expect(parsed.steps.map(step => step.retrievalRung)).toEqual([LEGACY_RUNG, CURRENT_RUNG])
      expect(parsed.retrievalRung).toEqual(LEGACY_RUNG)
    },
  },
  {
    name: 'runs.marks.history over the real ledger writes nothing',
    opId: 'runs.marks.history', scene: 'feedback',
    input: scene => ({ runId: feedback(scene).runId }),
    http: { method: 'GET', path: input => `${run(input)}/marks`, machine: true },
    expectPositive(result, scene) {
      const parsed = RunsMarksHistoryResultSchema.parse(result)
      if (parsed.kind !== 'history') throw new Error(`expected history, got ${parsed.kind}`)
      expect(parsed.entries.map(entry => [entry.markId, entry.ordinal, entry.active]))
        .toEqual([[feedback(scene).receipt.markId, 1, true]])
    },
  },
  {
    name: 'runs.mark.preview over the real stores writes nothing',
    opId: 'runs.mark.preview', scene: 'feedback',
    input: scene => ({ runId: feedback(scene).runId, kind: 'confirmed-bug' }),
    http: { method: 'POST', path: input => `${run(input)}/mark-preview`, machine: true },
    expectPositive(result, scene) {
      const parsed = RunsMarkPreviewResultSchema.parse(result)
      expect(parsed).toMatchObject({ kind: 'consequences', prospective: true, markKind: 'confirmed-bug',
        latest: { kind: 'supersedes', markId: feedback(scene).receipt.markId, ordinal: 1 } })
    },
  },
]

/** The addressed read ops: the three new ones and the three whose results 423 widened. */
const ADDRESSED_OPS = ['runs.detail', 'runs.evidence', 'runs.knowledge', 'runs.mark.preview', 'runs.marks.history', 'runs.postprocessing']

function toolFor(opId: string): string | undefined {
  return AGENT_QA_TOOL_PROJECTIONS.find(projection => projection.ops.includes(opId))?.name
}

/** What the human door shows for a machine answer: allowed text restored, restored auth state sanitized. */
function humanViewOf(machine: unknown, scene: DurableScene | FeedbackScene, restores: boolean): unknown {
  if (!restores || !('allowedPlaceholder' in scene)) return machine
  const escaped = (text: string) => JSON.stringify(text).slice(1, -1)
  return JSON.parse(JSON.stringify(machine)
    .replaceAll(escaped(scene.allowedPlaceholder), escaped(ALLOWED))
    .replaceAll(escaped(scene.authPlaceholder), escaped(AUTH_STATE_REDACTION_MARKER)))
}

describe('423-38 all-door read contracts (D-04/D-18)', () => {
  let durableScene: DurableScene
  let feedbackScene: FeedbackScene

  beforeAll(async () => {
    durableScene = await openDurableScene()
    feedbackScene = await openFeedbackScene()
  }, 180_000)
  afterAll(async () => {
    await feedbackScene?.close()
    await durableScene?.close()
  })

  const sceneOf = (scenario: ReadScenario) => scenario.scene === 'durable' ? durableScene : feedbackScene

  it('ALL-READ-CONTRACT-PARITY: addresses at least six read ops, every new op and every widened result', () => {
    expect(new Set(READ_SCENARIOS.map(scenario => scenario.opId))).toEqual(new Set(ADDRESSED_OPS))
    expect(new Set(READ_SCENARIOS.map(scenario => scenario.opId)).size).toBeGreaterThanOrEqual(6)
    expect(READ_SCENARIOS.filter(scenario => scenario.opId === 'runs.evidence').map(scenario => scenario.input(durableScene)['kind']).sort())
      .toEqual(['a11y', 'aria', 'console', 'console', 'network', 'variables'])
  })

  for (const scenario of READ_SCENARIOS) {
    it(`ALL-READ-CONTRACT-PARITY: ${scenario.name} agrees on fn, MCP, HTTP and the registry descriptors`, async () => {
      const scene = sceneOf(scenario)
      const doors = scene.doors
      const input = scenario.input(scene)
      const before = 'stores' in scene ? scene.stores.map(tree) : undefined

      // fn: the registry dispatch `agent-qa fn` performs, under the CLI's own caller.
      const viaFn = await doors.fn(scenario.opId, input)
      scenario.expectPositive(viaFn, scene)

      // Registry descriptors: read tier, bound here, and the scenario row's MCP claim is the mapping's.
      const declaration = doors.registry.list(CLI_FUNCTION_CALLER).find(entry => entry.id === scenario.opId)
      expect(declaration).toMatchObject({ bindingStatus: 'bound', requiredScopes: ['read'], resultKind: 'unary', risk: { readOnly: true } })
      const row = scenarioRowFor(scenario.opId)
      expect(row?.policyPoints).toEqual({ grant: 'allow', refuse: 'deny' })
      const tool = toolFor(scenario.opId)
      const tools = await doors.mcpTools()
      if (row?.perSurface.mcp !== undefined && 'reachable' in row.perSurface.mcp) {
        expect(tool).toBe(row.perSurface.mcp.reachable.tool)
        expect(tools).toContain(tool)
        const answer = await doors.mcp(tool!, input)
        expect(answer).toMatchObject({ door: 'answered', isError: false })
        if (answer.door === 'answered') expect(answer.structured).toEqual(viaFn)
      } else {
        expect(tool).toBeUndefined()
        const recorded = UNPROJECTED_OPS.find(entry => entry.opId === scenario.opId)
        expect(recorded, `${scenario.opId} carries no recorded unprojection reason`).toBeDefined()
        expect(unprojectedReasonKeyOf(recorded!.reason)).toBe(row?.perSurface.mcp.unprojected)
        const plausible = `agent_qa_${scenario.opId.replaceAll('.', '_')}`
        expect(tools).not.toContain(plausible)
        expect(await doors.mcp(plausible, input)).toMatchObject({ door: 'absent' })
      }

      // HTTP: the authed remote door answers the same bytes; the local human door restores then sanitizes.
      const path = scenario.http.path(input)
      const body = scenario.http.method === 'POST' ? input : undefined
      if (scenario.http.machine) {
        const machine = await doors.machine(scenario.http.method, path, body)
        expect(machine.status, machine.raw).toBe(200)
        expect(machine.body).toEqual(viaFn)
      } else {
        expect((await doors.machine(scenario.http.method, path, body)).status).toBe(404)
      }
      const human = await doors.human(scenario.http.method, path, body)
      expect(human.status, human.raw).toBe(200)
      const shown = humanViewOf(viaFn, scene, scenario.opId !== 'runs.postprocessing')
      expect(human.body).toEqual(scenario.http.envelope === undefined ? shown : scenario.http.envelope(shown))

      if (before !== undefined && 'stores' in scene) expect(scene.stores.map(tree)).toEqual(before)
    }, 120_000)
  }

  it('MASKED-MACHINE: machine doors keep placeholders, only the local human door restores, and no read tool gains a writer grant', async () => {
    const doors = durableScene.doors
    const input = { runId: durableScene.runId, testIndex: 0, stepIndex: 0, kind: 'console' }
    const viaFn = JSON.stringify(await doors.fn('runs.evidence', input))
    const machineDetail = await doors.machine('GET', `/${durableScene.runId}/detail`)
    const machineEvidence = await doors.machine('GET', evidencePath(input))
    for (const raw of [viaFn, machineDetail.raw, machineEvidence.raw]) {
      expect(raw).toContain(durableScene.authPlaceholder)
      expect(raw).toContain(durableScene.allowedPlaceholder)
      expect(raw).not.toContain(AUTH_TOKEN)
      expect(raw).not.toContain(ALLOWED)
    }
    const humanDetail = await doors.human('GET', `/${durableScene.runId}/detail`)
    const humanEvidence = await doors.human('GET', evidencePath(input))
    const humanKnowledge = await doors.human('GET', `/${durableScene.runId}/knowledge`)
    for (const raw of [humanDetail.raw, humanEvidence.raw, humanKnowledge.raw]) {
      expect(raw).toContain(ALLOWED)
      expect(raw).not.toContain(AUTH_TOKEN)
      expect(raw).not.toContain(durableScene.authPlaceholder)
      expect(raw).not.toContain(durableScene.allowedPlaceholder)
    }
    expect(humanEvidence.body).toMatchObject({ document: { records: [{ text: ALLOWED }, { text: AUTH_STATE_REDACTION_MARKER }] } })
    // The durable bytes stay masked whatever a door displayed.
    expect(JSON.stringify(durableScene.db.readRunDetailRows(durableScene.runId))).not.toContain(AUTH_TOKEN)

    // The two projected feedback reads are read tools: read-only annotations, no credential, no apply.
    for (const opId of ['runs.marks.history', 'runs.mark.preview']) {
      const projection = AGENT_QA_TOOL_PROJECTIONS.find(entry => entry.ops.includes(opId))
      expect(projection, opId).toMatchObject({ kind: 'read' })
      expect(projection, opId).not.toHaveProperty('credential')
    }
    // A machine caller's feedback answers never carry the secret the workspace declared.
    const history = await feedbackScene.doors.machine('GET', `/${feedbackScene.runId}/marks`)
    const preview = await feedbackScene.doors.machine('POST', `/${feedbackScene.runId}/mark-preview`, { runId: feedbackScene.runId, kind: 'confirmed-bug' })
    const tool = await feedbackScene.doors.mcp(toolFor('runs.marks.history')!, { runId: feedbackScene.runId })
    for (const raw of [history.raw, preview.raw, JSON.stringify(tool)]) expect(raw).not.toContain(AUTH_TOKEN)
  }, 120_000)
})

describe('423-38 committed artifacts carry the reviewed read contracts', () => {
  let declarations: readonly FunctionDeclaration[]
  beforeAll(async () => { declarations = await withGoldenRootDeclarations(rows => rows) }, 120_000)

  it('GOLDEN-CATALOG-COMPLETE: the committed golden ledger and capability catalog carry every addressed read op as the live tree declares it', () => {
    const golden = JSON.parse(readFileSync(GOLDEN_PATH, 'utf8')) as GoldenFile
    const catalog = loadCapabilityCatalog(CATALOG_PATH)
    const ops = catalog.rows.filter((row): row is CatalogOpRow => row.kind === 'op')
    const disagreements: string[] = []
    for (const opId of ADDRESSED_OPS) {
      const declaration = declarations.find(entry => entry.id === opId)
      expect(declaration, `${opId} is not declared at the composition root`).toBeDefined()
      const same = (left: unknown, right: unknown) => canonicalJson(left) === canonicalJson(right)
      const committedRow = golden.rows.find(entry => entry.id === opId)
      if (committedRow === undefined) disagreements.push(`golden:${opId}:missing`)
      else if (!same(committedRow, goldenRowOf(declaration!))) disagreements.push(`golden:${opId}:differs`)
      const catalogRow = ops.find(entry => entry.id === opId)
      if (catalogRow === undefined) disagreements.push(`catalog:${opId}:missing`)
      else if (!same(catalogRow, catalogOpRowOf(declaration!))) disagreements.push(`catalog:${opId}:differs`)
    }
    expect(disagreements, 'the committed artifacts lag the live read contracts; regenerate through '
      + 'scripts/397-regen-golden.sh --write, then scripts/398-regen-catalog.sh --write').toEqual([])
    for (const opId of ADDRESSED_OPS) {
      const declaration = declarations.find(entry => entry.id === opId)!
      expect(golden.rows.find(entry => entry.id === opId), opId).toEqual(goldenRowOf(declaration))
      expect(ops.find(entry => entry.id === opId), opId).toEqual(catalogOpRowOf(declaration))
    }
  })
})
