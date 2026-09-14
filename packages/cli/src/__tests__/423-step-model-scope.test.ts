import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { generateRunId, generateSuiteId, generateTestId } from '@vostride/agent-qa-ids'
import { SecretRedactor, SecretStore, makeScreenState } from '@vostride/agent-qa-runner'
import type { MemberRunConfig, StepModelScope } from '@vostride/agent-qa-runner'
import { buildRunMaskingContext, createRunInvocationCore } from '@vostride/agent-qa-agent-local'
import type { RunEventEnvelope } from '@vostride/agent-qa-schema'
import { asRunId } from '@vostride/agent-qa-schema'
import { produceDirectRunMembers, produceSuiteRunMembers } from '../commands/run.js'
import type { RunInvocationInputs, SuiteRunMemberProductionInput } from '../commands/run.js'
import { assembleCliRun } from '../composition/run-assembly.js'
import { runInProcessCliRun } from '../composition/in-process-run-execution.js'

const boundary = vi.hoisted(() => ({
  configs: [] as MemberRunConfig[],
  scopes: [] as StepModelScope[],
  safety: vi.fn(),
  transport: vi.fn(),
}))

// Keep the real member loop, model registry, middleware, SDK and raw-report parser.
// The runner spy only retains the scopes that production composition supplies.
vi.mock('@vostride/agent-qa-runner', async importOriginal => {
  const real = await importOriginal<typeof import('@vostride/agent-qa-runner')>()
  return { ...real, runMemberTest: (...args: Parameters<typeof real.runMemberTest>) => {
    const [member, config] = args
    boundary.configs.push(config)
    const binding = config.stepModelScope
    return real.runMemberTest(member, binding ? { ...config, stepModelScope: {
      ...binding, create: key => {
        const scope = binding.create(key)
        boundary.scopes.push(scope)
        return scope
      },
    } } : config)
  } }
})
vi.mock('@vostride/agent-qa-safety', async importOriginal => {
  const real = await importOriginal<typeof import('@vostride/agent-qa-safety')>()
  return { ...real, registerFirstPartySafetyHooks: (...args: Parameters<typeof real.registerFirstPartySafetyHooks>) => {
    const hooks = real.registerFirstPartySafetyHooks(...args)
    const transform = hooks.middleware.transformParams!
    return { ...hooks, middleware: { ...hooks.middleware, transformParams: (...params: Parameters<typeof transform>) => {
      boundary.safety()
      return transform(...params)
    } } }
  } }
})
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
    async observe() { return makeScreenState() }
    async execute() { return { success: true } }
  },
}))

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'agent-qa-423-scope-'))
  boundary.configs.length = 0
  boundary.scopes.length = 0
  vi.clearAllMocks()
  vi.stubEnv('AGENT_QA_LLM_MODEL', '')
  vi.stubEnv('AGENT_QA_LLM_PROVIDER', '')
  vi.stubEnv('AGENT_QA_RUN_ATTRIBUTES_JSON', '')
  vi.stubEnv('AGENT_QA_RUN_ID', '')
  delete process.env.AGENT_QA_RUN_ID
  vi.stubGlobal('fetch', boundary.transport.mockImplementation(async (_url: unknown, init: RequestInit) => {
    const request = JSON.parse(String(init.body))
    const planning = Array.isArray(request.tools) && request.tools.some((tool: { function: { name: string } }) => tool.function.name === 'web_click')
    return new Response(JSON.stringify({
      id: 'chat-synthetic-423', created: 1, model: planning ? 'reported-planner' : 'reported-verifier',
      choices: [{ index: 0, finish_reason: planning ? 'tool_calls' : 'stop', message: planning
        ? { role: 'assistant', content: null, tool_calls: [{ id: 'call-synthetic-423', type: 'function', function: {
            name: 'web_click', arguments: JSON.stringify({ ref: 'e2', reasoning: 'Click the button', confidence: 1,
              stepComplete: true, doesActionAdvanceUsTowardsGoal: true }),
          } }] }
        : { role: 'assistant', content: JSON.stringify({ success: true, reasoning: 'Button clicked', isAppError: false }) } }],
      usage: { prompt_tokens: 100, completion_tokens: 7, prompt_tokens_details: { cached_tokens: 30 } },
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }))
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  rmSync(root, { recursive: true, force: true })
})

async function executePath(path: 'DIRECT' | 'SUITE' | 'COMPOSED') {
  const runId = asRunId(generateRunId())
  const testId = generateTestId()
  const filePath = join(root, 'one.yaml')
  const suiteFile = join(root, 'one.suite.yaml')
  const configFilePath = join(root, 'agent-qa.config.yaml')
  const test = { 'test-id': testId, name: 'Observed click', target: 'fixture', steps: ['Click Log in'] }
  const fileContent = JSON.stringify(test)
  writeFileSync(filePath, fileContent)
  writeFileSync(suiteFile, 'name: Observed suite\n')
  const config = {
    workspace: { testMatch: ['one.yaml'], suiteMatch: ['*.suite.yaml'], testPathIgnore: [] },
    registry: {
      llms: [{ name: 'fixture', provider: 'openai-compatible', model: 'gpt-4o', baseURL: 'https://usage-fixture.invalid/v1' }],
      targets: { fixture: { platform: 'web', product: 'usage-fixture', environment: 'local' } },
    },
    use: { llm: 'fixture', cache: false, logCapture: { console: false, network: false }, timeout: { step: 5000, test: 10000 } },
    services: { logging: { level: 'silent' } }, knowledge: { dir: 'knowledge' },
  } as unknown as RunInvocationInputs['config']
  const configContent = JSON.stringify(config)
  writeFileSync(configFilePath, configContent)
  const secretStore = SecretStore.fromEnvContent('')
  const secretRedactor = new SecretRedactor(secretStore)
  const inputs = {
    config, configDir: root, configFilePath, configContent,
    runtimeSecrets: { secretStore, secretRedactor, secretsFileMetadata: { path: null, status: 'missing' } },
    envFileVars: {}, inlineVars: {}, cliVars: {}, userRunAttributes: {}, effectiveLogLevel: 'silent',
    resolvedHooks: new Map(), rawEnvFileContent: null, resolvedEnvFilePath: null,
    discovered: { tests: [filePath], suites: [] },
  } as unknown as RunInvocationInputs
  const events: RunEventEnvelope[] = []
  if (path === 'COMPOSED') {
    const outcome = await runInProcessCliRun({
      configPath: configFilePath, agentQaRoot: join(root, '.agent-qa'), executionContext: 'ci', inputs,
      onSession: session => { session.subscribe(1, event => { events.push(event) }) },
    }, { runId, patterns: [filePath] })
    expect(outcome.exitCode).toBe(0)
  } else {
    const opts = { disableCache: true, reporter: ['console'] }
    const produced = path === 'DIRECT'
      ? await produceDirectRunMembers({ inputs, bindings: [{ test, filePath, fileContent }] as never, opts })
      : await produceSuiteRunMembers({
          config, configDir: root, configFilePath, configContent, runId, opts,
          effectiveLogLevel: 'silent', suiteFiles: [suiteFile],
          preflight: {
            definitions: new Map([[suiteFile, { 'suite-id': generateSuiteId(), name: 'Observed suite', target: 'fixture', tests: [{ test: 'one.yaml', id: testId }] }]]),
            preloadedTests: new Map([[filePath, { fileContent, parseResult: { tests: [test], errors: [] } }]]), product: 'usage-fixture',
          },
          variableContext: { envFileVars: {}, inlineVars: {}, cliVars: {}, userRunAttributes: {}, secretStore, secretRedactor },
        } as SuiteRunMemberProductionInput)
    const masking = buildRunMaskingContext({ env: {} })
    produced.bindRunContext({ maskingContext: masking, safetyHooks: undefined as never })
    const core = createRunInvocationCore({
      configPath: configFilePath, agentQaRoot: join(root, '.agent-qa'), executionContext: 'ci',
      resolveTargetDeclaration: () => ({ targetClass: 'local', targetNames: ['fixture'] }),
      mintRunId: () => runId, isMintedRunId: () => true,
      assembleRun: async context => {
        const assembly = await assembleCliRun({ ...context, knowledgeRoot: produced.knowledgeRoot, maskingContext: masking,
          members: produced.members, executor: produced.executor, configDigests: produced.configDigests,
          product: produced.product, confirmPausedMs: () => 0, warn: () => {} })
        produced.applyAssembly(assembly)
        produced.bindKnowledge?.(assembly.buildOrdinal)
        return assembly.config
      },
      onSession: session => { produced.bindSession(session); session.subscribe(1, event => { events.push(event) }) },
    })
    await core.execute({})
    await produced.finalize?.()
    expect(produced.takeFrameworkError()).toBeUndefined()
  }
  expect(events.filter(event => event.type === 'stepFinalized').map(event => event.payload)).toMatchObject([{ status: 'passed' }])
  expect(boundary.transport).toHaveBeenCalled()
  return runId
}

for (const path of ['DIRECT', 'SUITE', 'COMPOSED'] as const) {
  it(`USAGE-${path}-PATH: actual CLI transport binds every dispatched model call to the canonical step`, async () => {
    const runId = await executePath(path)
    expect(boundary.configs).toHaveLength(1)
    expect(boundary.configs[0]?.stepModelScope, 'production member must carry an observed scope').toBeDefined()
    expect(boundary.scopes).toHaveLength(1)
    const snapshot = boundary.scopes[0]!.snapshot()
    expect(snapshot).toMatchObject({ runId, testIndex: 0, stepIndex: 0,
      started: 2, succeeded: 2, failed: 0, inputTokens: 200, outputTokens: 14, cachedInputTokens: 60 })
    expect(snapshot.roles.planner.respondingModelIds).toEqual(['reported-planner'])
    expect(snapshot.roles.verifier.respondingModelIds).toEqual(['reported-verifier'])
    expect(boundary.safety).toHaveBeenCalledTimes(boundary.transport.mock.calls.length)
  })
}
