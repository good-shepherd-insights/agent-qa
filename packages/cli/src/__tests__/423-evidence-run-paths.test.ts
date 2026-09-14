import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { generateRunId, generateSuiteId, generateTestId } from '@vostride/agent-qa-ids'
import { SecretRedactor, SecretStore } from '@vostride/agent-qa-runner'
import type { EvidenceArtifactStorePort } from '@vostride/agent-qa-runner'
import { buildRunMaskingContext, createRunInvocationCore } from '@vostride/agent-qa-agent-local'
import { FsEvidenceArtifactStore, slugBranch } from '@vostride/agent-qa-runner-local'
import { DashboardDatabase, createDashboardRunDetailReader, createDashboardRunIngest } from '@vostride/agent-qa-dashboard'
import { asRunId, ConsoleEvidenceDocumentSchema } from '@vostride/agent-qa-schema'
import { RunDetailProjectionSchema } from '@vostride/agent-qa-schema'
import { createFunctionRegistry, invokeFunction, RUNS_DETAIL_FUNCTION_ID, type FunctionDeps } from '@vostride/agent-qa-agent'
import type { FunctionCaller } from '@vostride/agent-qa-schema'
import type { RunEventEnvelope, StepFinalizedPayload } from '@vostride/agent-qa-schema'
import { produceDirectRunMembers, produceSuiteRunMembers } from '../commands/run.js'
import type { RunInvocationInputs, SuiteRunMemberProductionInput } from '../commands/run.js'
import { assembleCliRun } from '../composition/run-assembly.js'

const boundary = vi.hoisted(() => ({
  provider: vi.fn(() => { throw new Error('provider must not be called') }),
  observe: vi.fn(() => { throw new Error('evidence must not add a capture') }),
  execute: vi.fn(async () => ({ success: true })),
  drain: vi.fn(() => [] as Array<{ level: string; text: string; timestamp: number; location?: { url: string; lineNumber: number; columnNumber: number } }>),
  onExecute: () => {},
}))

// Only external model/platform boundaries are doubles. The producers, member runner,
// terminal finalizer, run bus, filesystem store and dashboard subscriber remain real.
vi.mock('@vostride/agent-qa-model', async importOriginal => ({
  ...await importOriginal<typeof import('@vostride/agent-qa-model')>(),
  createModel: () => ({ doGenerate: boundary.provider, doStream: boundary.provider }),
}))
vi.mock('../llm-utils.js', async importOriginal => ({
  ...await importOriginal<typeof import('../llm-utils.js')>(),
  resolveModelAuth: async () => ({ kind: 'unauthenticated', credentialKey: 'fixture', provider: 'openai-compatible', optional: true, message: 'fixture' }),
}))
vi.mock('@vostride/agent-qa-web', () => ({
  WebPlatformAdapter: class {
    platform = 'web' as const
    async setup() {}
    async cleanup() {}
    async navigate() {}
    observe = boundary.observe
    async execute() { boundary.onExecute(); return boundary.execute() }
    drainConsoleLogs = boundary.drain
  },
}))

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'agent-qa-423-paths-'))
  vi.clearAllMocks()
  vi.stubEnv('AGENT_QA_LLM_MODEL', '')
  vi.stubEnv('AGENT_QA_LLM_PROVIDER', '')
  vi.stubEnv('AGENT_QA_RUN_ATTRIBUTES_JSON', '')
  vi.stubEnv('AGENT_QA_RUN_ID', '')
  // The production command treats an empty run ID as supplied at some boundaries.
  delete process.env.AGENT_QA_RUN_ID
})
afterEach(() => {
  boundary.onExecute = () => {}
  vi.unstubAllEnvs()
  rmSync(root, { recursive: true, force: true })
})

for (const path of ['COMPOSED', 'DIRECT'] as const) {
  it(`CONSOLE-${path}-PATH / CONSOLE-REOPEN-READ: real CLI member stores masked bytes and publishes the immutable ref`, async () => {
    const runId = generateRunId()
    const testId = generateTestId()
    const filePath = join(root, 'one.yaml')
    const suiteFile = join(root, 'one.suite.yaml')
    const configFilePath = join(root, 'agent-qa.config.yaml')
    const test = { 'test-id': testId, name: 'Console evidence', target: 'fixture', steps: ['{{appium: mobile: scroll, direction: down}}'] }
    const fileContent = JSON.stringify(test)
    writeFileSync(filePath, fileContent)
    writeFileSync(suiteFile, 'name: Console suite\n')
    const config = {
      workspace: { testMatch: ['*.yaml'], suiteMatch: ['*.suite.yaml'], testPathIgnore: [] },
      registry: {
        llms: [{ name: 'fixture', provider: 'openai-compatible', model: 'gpt-4o', baseURL: 'http://127.0.0.1:1/v1' }],
        targets: { fixture: { platform: 'web', product: 'console-fixture' } },
      },
      use: { llm: 'fixture', cache: false, logCapture: { console: true, network: false }, timeout: { step: 1000, test: 5000 } },
      services: { logging: { level: 'silent' } },
      knowledge: { dir: 'knowledge' },
    } as unknown as RunInvocationInputs['config']
    const configContent = JSON.stringify(config)
    writeFileSync(configFilePath, configContent)
    const secretStore = SecretStore.fromEnvContent('')
    const secretRedactor = new SecretRedactor(secretStore)
    const masking = buildRunMaskingContext({ env: {} })
    const lateSecret = 'synthetic-late-console-token'
    boundary.onExecute = () => masking.register(lateSecret)
    const records = [
      { level: 'warn', text: `first ${lateSecret}`, timestamp: 23, location: { url: `https://example.invalid/${lateSecret}`, lineNumber: 2, columnNumber: 4 } },
      { level: 'error', text: `second ${lateSecret}`, timestamp: 11 },
    ]
    boundary.drain.mockImplementation(() => records)
    const opts = { disableCache: true, reporter: ['console'] }
    const inputs = {
      config, configDir: root, configFilePath, configContent,
      runtimeSecrets: { secretStore, secretRedactor, secretsFileMetadata: { path: null, status: 'missing' } },
      envFileVars: {}, inlineVars: {}, cliVars: {}, userRunAttributes: {},
      effectiveLogLevel: 'silent', resolvedHooks: new Map(),
      rawEnvFileContent: null, resolvedEnvFilePath: null,
    } as RunInvocationInputs
    const produced = path === 'DIRECT'
      ? await produceDirectRunMembers({ inputs, bindings: [{ test, filePath, fileContent }] as never, opts })
      : await produceSuiteRunMembers({
          config, configDir: root, configFilePath, configContent, runId, opts,
          effectiveLogLevel: 'silent', suiteFiles: [suiteFile],
          preflight: {
            definitions: new Map([[suiteFile, { 'suite-id': generateSuiteId(), name: 'Console suite', target: 'fixture', tests: [{ test: 'one.yaml', id: testId }] }]]),
            preloadedTests: new Map([[filePath, { fileContent, parseResult: { tests: [test], errors: [] } }]]),
            product: 'console-fixture',
          },
          variableContext: { envFileVars: {}, inlineVars: {}, cliVars: {}, userRunAttributes: {}, secretStore, secretRedactor },
        } as SuiteRunMemberProductionInput)
    produced.bindRunContext({ maskingContext: masking, safetyHooks: undefined as never })
    const dbPath = join(root, 'dashboard.db')
    const db = new DashboardDatabase({ dbPath })
    const ingest = createDashboardRunIngest({ db, correlationEnv: { runId } })
    const events: RunEventEnvelope[] = []
    let store: EvidenceArtifactStorePort | undefined
    let bytesAtPublication: Uint8Array | undefined
    const core = createRunInvocationCore({
      configPath: configFilePath, agentQaRoot: join(root, '.agent-qa'), executionContext: 'ci',
      resolveTargetDeclaration: () => ({ targetClass: 'local', targetNames: ['fixture'] }),
      mintRunId: () => runId, isMintedRunId: () => true,
      assembleRun: async context => {
        store = context.ports.evidenceArtifacts
        const assembly = await assembleCliRun({
          ...context, knowledgeRoot: produced.knowledgeRoot, maskingContext: masking,
          members: produced.members, executor: produced.executor, configDigests: produced.configDigests,
          product: produced.product, confirmPausedMs: () => 0, warn: () => {},
        })
        produced.applyAssembly(assembly)
        produced.bindKnowledge?.(assembly.buildOrdinal)
        return assembly.config
      },
      onSession: session => {
        produced.bindSession(session)
        session.subscribe(1, event => {
          events.push(event)
          if (event.type === 'stepFinalized') {
            const entry = (event.payload as StepFinalizedPayload).evidence?.console
            if (entry?.state === 'present') bytesAtPublication = store!.getBlob(entry.ref.sha)
          }
          ingest.handler(event)
        })
      },
    })
    try {
      await core.execute({})
      await produced.finalize?.()
      expect(produced.takeFrameworkError()).toBeUndefined()
      const terminals = events.filter(event => event.type === 'stepFinalized')
      expect(terminals).toHaveLength(1)
      const terminal = terminals[0]!.payload as StepFinalizedPayload
      expect(terminal.status).toBe('passed')
      expect(terminal.evidence?.console).toMatchObject({ state: 'present', counts: { total: 2, errors: 1, warnings: 1 } })
      const entry = terminal.evidence!.console
      if (entry.state !== 'present') throw new Error('Expected persisted console evidence')
      const bytes = store!.getBlob(entry.ref.sha)!
      expect(bytesAtPublication).toEqual(bytes)
      const text = Buffer.from(bytes).toString('utf8')
      expect(text).not.toContain(lateSecret)
      expect(ConsoleEvidenceDocumentSchema.parse(JSON.parse(text)).records).toEqual(records.map(record => ({
        ...record, text: masking.mask(record.text),
        ...(record.location ? { location: { ...record.location, url: masking.mask(record.location.url) } } : {}),
      })))
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(entry.ref.sha)
      expect(entry.ref.id).toBe(`console-evidence:${entry.ref.sha}`)
      const persistedEvents = readFileSync(join(root, '.agent-qa', 'runs', slugBranch(runId), 'events.jsonl'), 'utf8')
        .trim().split('\n').map(line => JSON.parse(line) as RunEventEnvelope)
      expect(persistedEvents.filter(event => event.type === 'stepFinalized')).toEqual(terminals)
      const blobDir = join(root, '.agent-qa', 'runs', slugBranch(runId), 'blobs')
      expect(readdirSync(blobDir)).toEqual([entry.ref.sha])
      expect(readFileSync(join(blobDir, entry.ref.sha))).toEqual(Buffer.from(bytes))
      const reopened = new FsEvidenceArtifactStore({ root: join(root, '.agent-qa'), runId })
      expect(reopened.getBlob(entry.ref.sha)).toEqual(bytes)
      expect(boundary.provider).not.toHaveBeenCalled()
      expect(boundary.observe).not.toHaveBeenCalled()
      expect(boundary.execute).toHaveBeenCalledTimes(1)
      expect(boundary.drain).toHaveBeenCalledTimes(1)
      await ingest.finalize({})
      db.close()
      const coldDb = new DashboardDatabase({ dbPath })
      try {
        const rows = await createDashboardRunDetailReader(coldDb).read(asRunId(runId))
        expect(rows?.steps).toHaveLength(1)
        expect(rows?.steps[0]?.status).toBe('passed')
        expect(rows?.steps[0]?.evidence).toEqual(terminal.evidence)
        const registry = createFunctionRegistry({
          deps: { runDetail: createDashboardRunDetailReader(coldDb) } as FunctionDeps,
          auditSink: { appendExecutionAudit() {}, appendGuardrailAudit() {} },
          resolveExecutionContext: () => 'local-interactive',
        })
        const detail = RunDetailProjectionSchema.parse(await invokeFunction(
          registry, RUNS_DETAIL_FUNCTION_ID, { runId: asRunId(runId) },
          { surface: 'cli', grantedScopes: ['read'], safeMode: false, origin: 'human' } as FunctionCaller,
        ))
        const coldEntry = detail.steps[0]?.evidence?.console
        expect(coldEntry).toEqual(entry)
        if (coldEntry?.state !== 'present') throw new Error('Expected reopened console ref')
        const coldBytes = reopened.getBlob(coldEntry.ref.sha)!
        expect(coldBytes).toEqual(bytes)
        expect(createHash('sha256').update(coldBytes).digest('hex')).toBe(coldEntry.ref.sha)
        expect(ConsoleEvidenceDocumentSchema.parse(JSON.parse(Buffer.from(coldBytes).toString('utf8'))).records)
          .toEqual(ConsoleEvidenceDocumentSchema.parse(JSON.parse(text)).records)
        expect(Buffer.from(coldBytes).toString('utf8')).not.toContain(lateSecret)
        expect(detail.steps[0]).not.toHaveProperty('variableSnapshot')
      } finally { coldDb.close() }
      expect(reopened.getBlob(entry.ref.sha)).toEqual(bytes)
    } finally {
      db.close()
      masking.dispose()
    }
  })
}
