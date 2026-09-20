import { describe, it, expect } from 'vitest'
import { AgentQaConfigSchema } from '../schema/config-schema.js'
import {
  ModelConfigSchema,
  NamedLLMConfigSchema,
  TimeoutConfigSchema,
  PlannerConfigSchema,
  BrowserConfigSchema,
} from '../schema/primitives.js'
import {
  DashboardConfigSchema,
  McpConfigSchema,
  AccessibilityConfigSchema,
  CacheConfigSchema,
  AuthStateConfigSchema,
  ServicesSchema,
  VisionServiceSchema,
} from '../schema/services-schema.js'

const validWorkspace = {
  testMatch: ['tests/**/*.yaml'],
  suiteMatch: ['suites/**/*.suite.yaml'],
  testPathIgnore: ['tests/skip/**'],
  hooksFile: 'hooks.yaml',
  envFile: '.env',
  secretsFile: '.env.secrets.local',
}

function withWorkspace<T extends Record<string, unknown>>(config: T): T & { workspace: typeof validWorkspace } {
  const use = config.use && typeof config.use === 'object' && !Array.isArray(config.use)
    ? {
        mobile: { appState: 'preserve' },
        ...(config.use as Record<string, unknown>),
      }
    : { mobile: { appState: 'preserve' } }

  return {
    ...config,
    workspace: {
      ...validWorkspace,
      ...(config.workspace && typeof config.workspace === 'object' && !Array.isArray(config.workspace)
        ? config.workspace as Partial<typeof validWorkspace>
        : {}),
    },
    use,
  }
}

describe('AgentQaConfigSchema — 4-bucket structure', () => {
  it('rejects config that omits workspace', () => {
    const result = AgentQaConfigSchema.safeParse({})
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some(i => i.path.join('.') === 'workspace')).toBe(true)
    }
  })

  it('parses a full 4-bucket config successfully', () => {
    const config = {
      workspace: {
        testMatch: ['tests/**/*.yaml'],
        suiteMatch: ['suites/**/*.suite.yaml'],
        testPathIgnore: ['tests/skip/**'],
        hooksFile: 'hooks.yaml',
        envFile: '.env',
        secretsFile: '.env.secrets.local',
      },
      services: {
        dashboard: { port: 3470, artifactsDir: '.agent-qa/artifacts' },
        cache: { dir: '.agent-qa/cache', ttl: '7d' },
        authState: { dir: '.agent-qa/auth-states' },
        logging: { level: 'warn' as const },
        recording: { enabled: true },
        accessibility: {
          enabled: true,
          standard: 'wcag2aa' as const,
          runAfter: 'every-step' as const,
          failOnViolation: false,
        },
        mcp: {
          enabled: true,
          transport: 'http' as const,
          host: '127.0.0.1',
          port: 3471,
          path: '/mcp',
        },
      },
      registry: {
        llms: [{ name: 'claude-main', provider: 'anthropic-subscription' as const, model: 'claude-sonnet-4-20250514' }],
        targets: {
          web: { platform: 'web' as const, url: 'https://example.com' },
        },
      },
      use: {
        browser: { name: 'chromium' as const, headless: true },
        mobile: { appState: 'preserve' as const },
        timeout: { step: '30s', test: '10m', navigation: '10s' },
        planner: { maxSubActions: 10, previousStepCount: 5 },
        logCapture: { console: true, network: false },
        llm: 'claude-main',
        parallel: false,
      },
    }
    const result = AgentQaConfigSchema.safeParse(config)
    expect(result.success).toBe(true)
  })

  it('accepts explicit auth plugin package and path declarations', () => {
    const result = AgentQaConfigSchema.safeParse(withWorkspace({
      plugins: {
        auth: [
          { package: '@vostride/agent-qa-subscription-auth' },
          { path: '../agent-qa-subscription-auth/dist/index.js' },
        ],
      },
    }))

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.plugins?.auth).toEqual([
        { package: '@vostride/agent-qa-subscription-auth' },
        { path: '../agent-qa-subscription-auth/dist/index.js' },
      ])
    }
  })

  it('rejects ambiguous auth plugin declarations', () => {
    const result = AgentQaConfigSchema.safeParse(withWorkspace({
      plugins: {
        auth: [
          {
            package: '@vostride/agent-qa-subscription-auth',
            path: '../agent-qa-subscription-auth/dist/index.js',
          },
        ],
      },
    }))

    expect(result.success).toBe(false)
  })

  it('accepts explicit provider plugin package and path declarations', () => {
    const result = AgentQaConfigSchema.safeParse(withWorkspace({
      plugins: {
        providers: [
          { package: '@scope/pkg' },
          { path: '../x/dist/index.js' },
        ],
      },
    }))

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.plugins?.providers).toEqual([
        { package: '@scope/pkg' },
        { path: '../x/dist/index.js' },
      ])
    }
  })

  it('rejects ambiguous provider plugin declarations', () => {
    const result = AgentQaConfigSchema.safeParse(withWorkspace({
      plugins: {
        providers: [
          {
            package: '@scope/pkg',
            path: '../x/dist/index.js',
          },
        ],
      },
    }))

    expect(result.success).toBe(false)
  })

  it('rejects empty provider plugin declarations', () => {
    const result = AgentQaConfigSchema.safeParse(withWorkspace({
      plugins: {
        providers: [{}],
      },
    }))

    expect(result.success).toBe(false)
  })

  it('defaults omitted provider plugin declarations to an empty array', () => {
    const result = AgentQaConfigSchema.safeParse(withWorkspace({
      plugins: {},
    }))

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.plugins?.providers).toEqual([])
    }
  })

  it('rejects root use.headless and accepts browser-scoped headless', () => {
    const result = AgentQaConfigSchema.safeParse(withWorkspace({
      use: {
        browser: { name: 'chromium', headless: false },
        headless: true,
      },
    }))

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some(i => i.path.join('.') === 'use')).toBe(true)
    }
  })

  it('rejects old root keys with z.strict() — browsers', () => {
    const result = AgentQaConfigSchema.safeParse({ browsers: [{ name: 'chromium', headless: true }] })
    expect(result.success).toBe(false)
  })

  it('rejects old root keys with z.strict() — defaultLLM', () => {
    const result = AgentQaConfigSchema.safeParse({ defaultLLM: 'claude' })
    expect(result.success).toBe(false)
  })

  it('rejects old root keys with z.strict() — defaultRunMode', () => {
    const result = AgentQaConfigSchema.safeParse({ defaultRunMode: 'local' })
    expect(result.success).toBe(false)
  })

  it('rejects old root keys with z.strict() — variables', () => {
    const result = AgentQaConfigSchema.safeParse({ variables: { file: '.env' } })
    expect(result.success).toBe(false)
  })

  it('rejects old root keys with z.strict() — codebase', () => {
    const result = AgentQaConfigSchema.safeParse({ codebase: { path: '.' } })
    expect(result.success).toBe(false)
  })

  it('rejects old root keys with z.strict() — environments', () => {
    const result = AgentQaConfigSchema.safeParse({ environments: { staging: { url: 'http://localhost' } } })
    expect(result.success).toBe(false)
  })

  it('accepts current dashboard service fields', () => {
    const result = AgentQaConfigSchema.safeParse(withWorkspace({
      services: {
        dashboard: {
          artifactsDir: '.agent-qa/artifacts',
          dbPath: '.agent-qa/runs.db',
        },
      },
    }))
    expect(result.success).toBe(true)
  })

  it('REC-KNOB-PARSES: preserves optional failures-only recording settings', () => {
    for (const keepFailuresOnly of [true, false]) {
      const result = AgentQaConfigSchema.safeParse(withWorkspace({
        services: { recording: { keepFailuresOnly } },
      }))
      expect(result.success).toBe(true)
      if (result.success) expect(result.data.services?.recording).toEqual({ keepFailuresOnly })
    }
    const empty = AgentQaConfigSchema.parse(withWorkspace({ services: { recording: {} } }))
    expect(empty.services?.recording).toEqual({})
    const absent = AgentQaConfigSchema.parse(withWorkspace({ services: {} }))
    expect(absent.services).not.toHaveProperty('recording')
  })

  it('REC-KNOB-STRICT: accepts the knob but rejects unknown recording keys', () => {
    const recording = { keepFailuresOnly: true }
    expect(AgentQaConfigSchema.safeParse(withWorkspace({ services: { recording } })).success)
      .toBe(true)
    expect(AgentQaConfigSchema.safeParse(withWorkspace({
      services: { recording: { ...recording, videoDir: 'videos' } },
    })).success).toBe(false)
  })

  it('accepts a complete service runtime path config sample', () => {
    const result = AgentQaConfigSchema.safeParse(withWorkspace({
      services: {
        dashboard: {
          port: 3470,
          dbPath: '.agent-qa/runs.db',
          artifactsDir: '.agent-qa/custom-artifacts',
        },
        cache: {
          dir: '.agent-qa/custom-cache',
          ttl: '7d',
        },
        authState: {
          dir: '.agent-qa/custom-auth-states',
        },
        logging: {
          level: 'warn',
        },
        recording: {
          enabled: false,
        },
        accessibility: {
          enabled: false,
        },
      },
    }))

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.services?.dashboard?.artifactsDir).toBe('.agent-qa/custom-artifacts')
      expect(result.data.services?.cache?.dir).toBe('.agent-qa/custom-cache')
      expect(result.data.services?.cache?.ttl).toBe(604_800_000)
      expect(result.data.services?.authState?.dir).toBe('.agent-qa/custom-auth-states')
      expect(result.data.services?.logging?.level).toBe('warn')
      expect(result.data.services?.recording?.enabled).toBe(false)
      expect(result.data.services?.accessibility?.enabled).toBe(false)
    }
  })

  it('rejects services.dashboard.testsDir', () => {
    const result = AgentQaConfigSchema.safeParse(withWorkspace({
      services: {
        dashboard: {
          testsDir: './tests',
        },
      },
    }))
    expect(result.success).toBe(false)
  })

  it('rejects services.dashboard.screenshotDir (old key)', () => {
    const result = AgentQaConfigSchema.safeParse({
      services: { dashboard: { screenshotDir: '.agent-qa/screenshots' } },
    })
    expect(result.success).toBe(false)
  })

  it('accepts services.authState.dir as a string path', () => {
    const result = AgentQaConfigSchema.safeParse(withWorkspace({
      services: {
        authState: {
          dir: '.agent-qa/auth-states',
        },
      },
    }))

    expect(result.success).toBe(true)
    expect(AuthStateConfigSchema.safeParse({ dir: '.agent-qa/auth-states' }).success).toBe(true)
  })

  it('rejects invalid services.authState config', () => {
    expect(AuthStateConfigSchema.safeParse({}).success).toBe(false)
    expect(AuthStateConfigSchema.safeParse({ dir: '' }).success).toBe(false)
    expect(AuthStateConfigSchema.safeParse({ dir: '.agent-qa/auth-states', ttlSeconds: 3600 }).success).toBe(false)
  })

  it('workspace accepts all documented fields per D-04', () => {
    const result = AgentQaConfigSchema.safeParse(withWorkspace({
      workspace: {
        testMatch: ['**/*.yaml'],
        suiteMatch: ['**/*.suite.yaml'],
        testPathIgnore: ['node_modules'],
        hooksFile: 'hooks.yaml',
        envFile: '.env',
        secretsFile: '.env.secrets.local',
      },
    }))
    expect(result.success).toBe(true)
  })

  it('rejects workspace config that omits each required workspace key', () => {
    const requiredKeys = ['testMatch', 'suiteMatch', 'hooksFile', 'envFile', 'secretsFile'] as const
    for (const key of requiredKeys) {
      const workspace = { ...validWorkspace }
      delete workspace[key]
      const result = AgentQaConfigSchema.safeParse({ workspace })
      expect(result.success, key).toBe(false)
      if (!result.success) {
        expect(result.error.issues.some(i => i.path.join('.') === `workspace.${key}`), key).toBe(true)
      }
    }
  })

  it('rejects empty workspace match arrays', () => {
    const result = AgentQaConfigSchema.safeParse({
      workspace: {
        ...validWorkspace,
        testMatch: [],
      },
    })
    const suiteResult = AgentQaConfigSchema.safeParse({
      workspace: {
        ...validWorkspace,
        suiteMatch: [],
      },
    })
    expect(result.success).toBe(false)
    expect(suiteResult.success).toBe(false)
  })

  it('rejects empty workspace scalar file keys', () => {
    const requiredKeys = ['hooksFile', 'envFile', 'secretsFile'] as const
    for (const key of requiredKeys) {
      const result = AgentQaConfigSchema.safeParse({
        workspace: {
          ...validWorkspace,
          [key]: '',
        },
      })
      expect(result.success, key).toBe(false)
      if (!result.success) {
        expect(result.error.issues.some(i => i.path.join('.') === `workspace.${key}`), key).toBe(true)
      }
    }
  })

  it('registry.targets has no environments key per D-08', () => {
    const result = AgentQaConfigSchema.safeParse({
      registry: {
        targets: {
          myapp: {
            platform: 'web',
            environments: { staging: { url: 'http://localhost' } },
          },
        },
      },
    })
    expect(result.success).toBe(false)
  })

  it('accepts analytics.passRateScope exact attribute predicates', () => {
    const result = AgentQaConfigSchema.safeParse(withWorkspace({
      analytics: {
        passRateScope: {
          attributes: {
            'git.branch': 'master',
            'user.email': 'CI',
          },
        },
      },
    }))
    expect(result.success).toBe(true)
  })

  it('accepts analytics.passRateScope regex attribute predicates', () => {
    const result = AgentQaConfigSchema.safeParse(withWorkspace({
      analytics: {
        passRateScope: {
          attributes: {
            'git.branch': { regex: '^(master|main)$' },
          },
        },
      },
    }))
    expect(result.success).toBe(true)
  })

  it('accepts optional analytics privacy hard opt-out', () => {
    const result = AgentQaConfigSchema.safeParse(withWorkspace({
      analytics: {
        privacy: true,
      },
    }))

    expect(result.success).toBe(true)
  })

  it('rejects analytics privacy false because omission represents enabled tracking', () => {
    const result = AgentQaConfigSchema.safeParse(withWorkspace({
      analytics: {
        privacy: false,
      },
    }))

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some(i => i.path.join('.') === 'analytics.privacy')).toBe(true)
    }
  })

  it('rejects analytics.passRateScope non-string scalar predicates', () => {
    const result = AgentQaConfigSchema.safeParse({
      analytics: {
        passRateScope: {
          attributes: {
            'git.branch': ['main'],
          },
        },
      },
    })
    expect(result.success).toBe(false)
  })

  it('requires global use.mobile.appState', () => {
    const result = AgentQaConfigSchema.safeParse({
      workspace: validWorkspace,
      use: {
        browser: { name: 'chromium', headless: true },
      },
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      const issue = result.error.issues.find(i => i.path.join('.') === 'use.mobile.appState')
      expect(issue).toBeDefined()
      expect(issue?.message).toContain('use.mobile.appState is required')
      expect(issue?.message).toContain('preserve | reset')
    }
  })

  it('rejects invalid global use.mobile.appState', () => {
    const result = AgentQaConfigSchema.safeParse({
      workspace: validWorkspace,
      use: {
        mobile: { appState: 'fresh' },
      },
    })

    expect(result.success).toBe(false)
  })

  it('rejects stale global use.device', () => {
    const result = AgentQaConfigSchema.safeParse({
      workspace: validWorkspace,
      use: {
        mobile: { appState: 'preserve' },
        device: 'ios-sim',
      },
    })

    expect(result.success).toBe(false)
  })

  // KDIR-03 (Phase 373): the slim knowledge block replaced the retired v1 memory services block.
  it('materializes knowledge defaults when the block is omitted', () => {
    const result = AgentQaConfigSchema.safeParse(withWorkspace({}))
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.knowledge.dir).toBe('agent-qa-knowledge')
      expect(result.data.knowledge.commitArtifacts).toBe('none')
      expect(result.data.knowledge.contextBudgetTokens).toBeUndefined()
    }
  })

  it('accepts an explicit knowledge block', () => {
    const result = AgentQaConfigSchema.safeParse(withWorkspace({
      knowledge: { dir: 'docs/knowledge', commitArtifacts: 'thumbnails', contextBudgetTokens: 4096 },
    }))
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.knowledge.dir).toBe('docs/knowledge')
      expect(result.data.knowledge.commitArtifacts).toBe('thumbnails')
      expect(result.data.knowledge.contextBudgetTokens).toBe(4096)
    }
  })

  it('rejects stale global use.actionProofs', () => {
    const result = AgentQaConfigSchema.safeParse({
      workspace: validWorkspace,
      use: {
        mobile: { appState: 'preserve' },
        actionProofs: 'strict',
      },
    })

    expect(result.success).toBe(false)
  })

  it('rejects global use.authState because auth state is selected per test or suite', () => {
    const result = AgentQaConfigSchema.safeParse({
      workspace: validWorkspace,
      use: {
        mobile: { appState: 'preserve' },
        authState: 'admin',
      },
    })

    expect(result.success).toBe(false)
  })
})

describe('AgentQaConfigSchema — LLM cross-validation', () => {
  it('use.llm cross-validates against registry.llms names — pass', () => {
    const result = AgentQaConfigSchema.safeParse(withWorkspace({
      registry: {
        llms: [{ name: 'claude', provider: 'anthropic-subscription', model: 'claude-sonnet-4-20250514' }],
      },
      use: { llm: 'claude' },
    }))
    expect(result.success).toBe(true)
  })

  it('use.llm cross-validates against registry.llms names — fail', () => {
    const result = AgentQaConfigSchema.safeParse(withWorkspace({
      registry: {
        llms: [{ name: 'claude', provider: 'anthropic-subscription', model: 'claude-sonnet-4-20250514' }],
      },
      use: { llm: 'nonexistent' },
    }))
    expect(result.success).toBe(false)
    if (!result.success) {
      const issue = result.error.issues.find(i => i.path[0] === 'use' && i.path[1] === 'llm')
      expect(issue).toBeDefined()
      expect(issue!.message).toContain('does not match any name in registry.llms')
    }
  })

  it('rejects duplicate names in registry.llms', () => {
    const result = AgentQaConfigSchema.safeParse(withWorkspace({
      registry: {
        llms: [
          { name: 'dupe', provider: 'anthropic-subscription', model: 'claude-sonnet-4-20250514' },
          { name: 'dupe', provider: 'openai-compatible', model: 'gpt-4o', baseURL: 'https://remote.example/api/v1' },
        ],
      },
    }))
    expect(result.success).toBe(false)
    if (!result.success) {
      const issue = result.error.issues.find(i => i.message.includes('Duplicate'))
      expect(issue).toBeDefined()
    }
  })

  it('accepts use.llm when no registry defined (llm defaults to empty array)', () => {
    const result = AgentQaConfigSchema.safeParse(withWorkspace({
      use: { llm: 'anything' },
    }))
    expect(result.success).toBe(false)
    if (!result.success) {
      const issue = result.error.issues.find(i => i.path[0] === 'use' && i.path[1] === 'llm')
      expect(issue).toBeDefined()
    }
  })
})

describe('Sub-schemas — primitives', () => {
  it('accepts current LLM providers including openai-compatible', () => {
    const providers = [
      'openai-compatible',
      'anthropic-compatible',
      'openai-subscription',
      'anthropic-subscription',
      'gemini',
    ] as const

    for (const provider of providers) {
      const result = ModelConfigSchema.safeParse({
        provider,
        model: 'model-name',
        ...(provider === 'openai-compatible' || provider === 'anthropic-compatible'
          ? { baseURL: 'https://remote.example/api/v1' }
          : {}),
      })
      expect(result.success, provider).toBe(true)
    }
  })

  it('rejects removed LLM provider values through schema validation', () => {
    for (const provider of ['anthropic', 'openai', 'google', 'ollama', 'lmstudio', 'custom']) {
      const result = ModelConfigSchema.safeParse({
        provider,
        model: 'model-name',
        baseURL: 'http://localhost:1234/v1',
      })
      expect(result.success, provider).toBe(false)
    }
  })

  it('rejects product-facing authMethod on LLM configs', () => {
    const result = ModelConfigSchema.safeParse({
      provider: 'gemini',
      model: 'gemini-2.0-flash',
      authMethod: 'key',
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some(issue => (
        issue.code === 'unrecognized_keys'
        && 'keys' in issue
        && issue.keys.includes('authMethod')
      ))).toBe(true)
    }
  })

  it('requires baseURL for openai-compatible providers', () => {
    const missing = ModelConfigSchema.safeParse({
      provider: 'openai-compatible',
      model: 'deepseek-chat',
    })
    const blank = ModelConfigSchema.safeParse({
      provider: 'openai-compatible',
      model: 'deepseek-chat',
      baseURL: '   ',
    })

    expect(missing.success).toBe(false)
    expect(blank.success).toBe(false)
    if (!missing.success) {
      expect(missing.error.issues.some(issue => (
        issue.path.join('.') === 'baseURL'
        && issue.message === 'Base URL is required for openai-compatible providers.'
      ))).toBe(true)
    }
  })

  it('rejects inline apiKey for openai-compatible providers', () => {
    const result = ModelConfigSchema.safeParse({
      provider: 'openai-compatible',
      model: 'deepseek-chat',
      baseURL: 'https://remote.example/api/v1',
      apiKey: 'sk-inline',
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some(issue => (
        issue.code === 'unrecognized_keys'
        && 'keys' in issue
        && issue.keys.includes('apiKey')
      ))).toBe(true)
    }
  })

  it('requires exact baseURL for anthropic-compatible providers', () => {
    const missing = ModelConfigSchema.safeParse({
      provider: 'anthropic-compatible',
      model: 'claude-compatible',
    })
    const valid = ModelConfigSchema.safeParse({
      provider: 'anthropic-compatible',
      model: 'claude-compatible',
      baseURL: 'https://remote.example/api/v1/messages',
    })

    expect(missing.success).toBe(false)
    if (!missing.success) {
      expect(missing.error.issues.some(issue => issue.path.join('.') === 'baseURL')).toBe(true)
    }
    expect(valid.success).toBe(true)
    if (valid.success) {
      expect(valid.data.baseURL).toBe('https://remote.example/api/v1/messages')
    }
  })

  it('accepts providerHeaders only for anthropic-compatible providers', () => {
    const anthropicCompatible = ModelConfigSchema.safeParse({
      provider: 'anthropic-compatible',
      model: 'claude-compatible',
      baseURL: 'https://remote.example/api/v1/messages',
      providerHeaders: { 'x-workspace': 'agent-qa' },
    })
    const openAICompatible = ModelConfigSchema.safeParse({
      provider: 'openai-compatible',
      model: 'deepseek-chat',
      baseURL: 'https://remote.example/api/v1',
      providerHeaders: { 'x-workspace': 'agent-qa' },
    })

    expect(anthropicCompatible.success).toBe(true)
    expect(openAICompatible.success).toBe(false)
    if (!openAICompatible.success) {
      expect(openAICompatible.error.issues.some(issue => issue.path.join('.') === 'providerHeaders')).toBe(true)
    }
  })

  it('rejects inline apiKey for anthropic-compatible providers', () => {
    const result = ModelConfigSchema.safeParse({
      provider: 'anthropic-compatible',
      model: 'claude-compatible',
      baseURL: 'https://remote.example/api/v1/messages',
      apiKey: 'sk-inline',
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some(issue => (
        issue.code === 'unrecognized_keys'
        && 'keys' in issue
        && issue.keys.includes('apiKey')
      ))).toBe(true)
    }
  })

  it('rejects auth-like providerHeaders for anthropic-compatible providers', () => {
    for (const header of ['authorization', 'cookie', 'x-api-key', 'api-key', 'token', 'secret']) {
      const result = ModelConfigSchema.safeParse({
        provider: 'anthropic-compatible',
        model: 'claude-compatible',
        baseURL: 'https://remote.example/api/v1/messages',
        providerHeaders: { [header]: 'secret-ish' },
      })

      expect(result.success, header).toBe(false)
      if (!result.success) {
        expect(result.error.issues.some(issue => issue.path.join('.') === 'providerHeaders')).toBe(true)
        expect(result.error.issues.some(issue => issue.message.toLowerCase().includes(header))).toBe(true)
      }
    }
  })

  it('rejects empty duplicate and control-character providerHeaders for anthropic-compatible providers', () => {
    const invalidHeaders = [
      { '': 'value' },
      { 'X-Team': 'one', 'x-team': 'two' },
      { 'bad\nkey': 'value' },
      { 'x-team': 'line\nbreak' },
    ]

    for (const providerHeaders of invalidHeaders) {
      const result = ModelConfigSchema.safeParse({
        provider: 'anthropic-compatible',
        model: 'claude-compatible',
        baseURL: 'https://remote.example/api/v1/messages',
        providerHeaders,
      })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues.some(issue => issue.path.join('.') === 'providerHeaders')).toBe(true)
      }
    }
  })

  it('TimeoutConfigSchema requires all fields as duration strings', () => {
    expect(TimeoutConfigSchema.safeParse({}).success).toBe(false)
    expect(TimeoutConfigSchema.safeParse({ step: '1s' }).success).toBe(false)
    expect(
      TimeoutConfigSchema.safeParse({ step: '1s', test: '2s', navigation: '3s' }).success,
    ).toBe(true)
  })

  it('CacheConfigSchema requires all fields', () => {
    expect(CacheConfigSchema.safeParse({}).success).toBe(false)
    expect(CacheConfigSchema.safeParse({ dir: '.cache', ttl: '7d' }).success).toBe(true)
  })

  it('AuthStateConfigSchema requires a non-empty dir only', () => {
    expect(AuthStateConfigSchema.safeParse({}).success).toBe(false)
    expect(AuthStateConfigSchema.safeParse({ dir: '.agent-qa/auth-states' }).success).toBe(true)
    expect(AuthStateConfigSchema.safeParse({ dir: '.agent-qa/auth-states', ttlSeconds: 3600 }).success).toBe(false)
  })

  it('PlannerConfigSchema requires all fields', () => {
    expect(PlannerConfigSchema.safeParse({}).success).toBe(false)
    expect(
      PlannerConfigSchema.safeParse({
        maxSubActions: 10,
        previousStepCount: 5,
      }).success,
    ).toBe(true)
  })

  it('BrowserConfigSchema requires name and headless', () => {
    expect(BrowserConfigSchema.safeParse({}).success).toBe(false)
    expect(BrowserConfigSchema.safeParse({ name: 'chromium' }).success).toBe(false)
    expect(
      BrowserConfigSchema.safeParse({ name: 'chromium', headless: true }).success,
    ).toBe(true)
  })

  it('DashboardConfigSchema accepts optional port and artifactsDir', () => {
    expect(DashboardConfigSchema.safeParse({}).success).toBe(true)
    expect(
      DashboardConfigSchema.safeParse({ port: 3470, artifactsDir: '.agent-qa/artifacts' }).success,
    ).toBe(true)
  })

  it('McpConfigSchema accepts local HTTP and stdio settings', () => {
    expect(McpConfigSchema.safeParse({}).success).toBe(true)
    expect(McpConfigSchema.safeParse({
      enabled: true,
      transport: 'http',
      host: '127.0.0.1',
      port: 3471,
      path: '/mcp',
    }).success).toBe(true)
    expect(McpConfigSchema.safeParse({
      enabled: true,
      transport: 'stdio',
    }).success).toBe(true)
  })

  it('McpConfigSchema rejects unsupported keys and non-local endpoints', () => {
    expect(McpConfigSchema.safeParse({ exposed: true }).success).toBe(false)
    expect(McpConfigSchema.safeParse({ host: '0.0.0.0' }).success).toBe(false)
    expect(McpConfigSchema.safeParse({ port: 70000 }).success).toBe(false)
    expect(McpConfigSchema.safeParse({ path: 'mcp' }).success).toBe(false)
  })

  it('AccessibilityConfigSchema requires all fields when present', () => {
    expect(AccessibilityConfigSchema.safeParse({}).success).toBe(false)
    expect(
      AccessibilityConfigSchema.safeParse({
        enabled: false,
        standard: 'wcag2aa',
        runAfter: 'every-step',
        failOnViolation: false,
      }).success,
    ).toBe(true)
  })

  it('accepts contextWindow on LLM config entries', () => {
    const result = NamedLLMConfigSchema.safeParse({
      name: 'claude-main',
      provider: 'anthropic-subscription',
      model: 'claude-sonnet-4-20250514',
      contextWindow: '128k',
    })
    expect(result.success).toBe(true)
  })
})

describe('ModelConfigSchema — vision config relocation', () => {
  it('defaults model vision to true', () => {
    const result = ModelConfigSchema.safeParse({
      provider: 'anthropic-subscription',
      model: 'claude-sonnet-4-20250514',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.vision).toBe(true)
    }
  })

  it('rejects relocated per-model screenshotSize and effectiveResolution', () => {
    expect(ModelConfigSchema.safeParse({
      provider: 'anthropic-subscription',
      model: 'claude-sonnet-4-20250514',
      screenshotSize: '1m',
    }).success).toBe(false)

    expect(ModelConfigSchema.safeParse({
      provider: 'anthropic-subscription',
      model: 'claude-sonnet-4-20250514',
      effectiveResolution: 1024,
    }).success).toBe(false)
  })

  it('accepts services.vision sizing and transforms screenshotSize', () => {
    const result = ServicesSchema.safeParse({
      vision: {
        screenshotSize: '256k',
        effectiveResolution: 768,
      },
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.vision?.screenshotSize).toBe(262144)
      expect(result.data.vision?.effectiveResolution).toBe(768)
    }
  })

  it('rejects removed per-model vision sizing override', () => {
    const removedOverrideKey = ['vision', 'Override'].join('')

    expect(ModelConfigSchema.safeParse({
      provider: 'anthropic-subscription',
      model: 'claude-sonnet-4-20250514',
      [removedOverrideKey]: {
        screenshotSize: '128k',
        effectiveResolution: 1024,
      },
    }).success).toBe(false)

    expect(NamedLLMConfigSchema.safeParse({
      name: 'claude-main',
      provider: 'anthropic-subscription',
      model: 'claude-sonnet-4-20250514',
      [removedOverrideKey]: {
        screenshotSize: '128k',
      },
    }).success).toBe(false)

    const validResult = NamedLLMConfigSchema.safeParse({
      name: 'claude-main',
      provider: 'anthropic-subscription',
      model: 'claude-sonnet-4-20250514',
    })
    expect(validResult.success).toBe(true)
    if (validResult.success) {
      expect(validResult.data.vision).toBe(true)
    }
  })

  it('rejects unknown services.vision keys', () => {
    expect(VisionServiceSchema.safeParse({
      screenshotSize: '256k',
      extra: true,
    }).success).toBe(false)
  })
})

describe('NamedLLMConfigSchema — name validation', () => {
  it('validates a valid named config', () => {
    const result = NamedLLMConfigSchema.safeParse({
      name: 'claude-main',
      provider: 'anthropic-subscription',
      model: 'claude-sonnet-4-20250514',
    })
    expect(result.success).toBe(true)
  })

  it('rejects name with spaces', () => {
    const result = NamedLLMConfigSchema.safeParse({
      name: 'claude main',
      provider: 'anthropic-subscription',
      model: 'claude-sonnet-4-20250514',
    })
    expect(result.success).toBe(false)
  })

  it('rejects name starting with hyphen', () => {
    const result = NamedLLMConfigSchema.safeParse({
      name: '-bad',
      provider: 'anthropic-subscription',
      model: 'claude-sonnet-4-20250514',
    })
    expect(result.success).toBe(false)
  })
})

describe('Duration/size string validation', () => {
  it('rejects invalid duration string in timeout', () => {
    expect(
      TimeoutConfigSchema.safeParse({ step: 'invalid', test: '10m', navigation: '10s' }).success,
    ).toBe(false)
  })

  it('rejects raw numbers in timeout fields', () => {
    expect(
      TimeoutConfigSchema.safeParse({ step: 30000, test: 600000, navigation: 10000 }).success,
    ).toBe(false)
  })

  it('accepts 0s duration', () => {
    const result = TimeoutConfigSchema.safeParse({ step: '0s', test: '10m', navigation: '10s' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.step).toBe(0)
    }
  })
})

import { TargetSchema } from '../schema/registry-schema.js'
import { CaptureConfigSchema } from '../schema/test-schema.js'

describe('CaptureConfigSchema', () => {
  it('method field is required (no default)', () => {
    const result = CaptureConfigSchema.safeParse({ variable: 'token' })
    expect(result.success).toBe(false)
  })

  it('accepts explicit method', () => {
    const result = CaptureConfigSchema.safeParse({
      variable: 'token',
      method: 'ai',
      description: 'Extract the auth token',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.method).toBe('ai')
    }
  })
})

describe('TargetSchema — product key validation', () => {
  it('accepts target with valid product', () => {
    const result = TargetSchema.safeParse({ product: 'hacker-news', platform: 'web', url: 'https://hn.com' })
    expect(result.success).toBe(true)
  })

  it('accepts target without product (optional)', () => {
    const result = TargetSchema.safeParse({ platform: 'web', url: 'https://hn.com' })
    expect(result.success).toBe(true)
  })

  it('rejects product with path traversal (..)', () => {
    const result = TargetSchema.safeParse({ product: '../escape', platform: 'web' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some(i => i.message.includes('product'))).toBe(true)
    }
  })

  it('rejects product with forward slash', () => {
    const result = TargetSchema.safeParse({ product: 'bad/path', platform: 'web' })
    expect(result.success).toBe(false)
  })

  it('rejects product with backslash', () => {
    const result = TargetSchema.safeParse({ product: 'back\\slash', platform: 'web' })
    expect(result.success).toBe(false)
  })

  it('rejects product with null byte', () => {
    const result = TargetSchema.safeParse({ product: 'null\x00byte', platform: 'web' })
    expect(result.success).toBe(false)
  })

  it('accepts product with hyphens and numbers', () => {
    const result = TargetSchema.safeParse({ product: 'valid-name-123', platform: 'web', url: 'https://example.com' })
    expect(result.success).toBe(true)
  })

  it('full config with targets containing product parses successfully', () => {
    const result = AgentQaConfigSchema.safeParse(withWorkspace({
      registry: {
        targets: {
          hn: { product: 'hacker-news', platform: 'web', url: 'https://hn.com' },
        },
      },
    }))
    expect(result.success).toBe(true)
  })

  it('accepts slug-safe target registry keys', () => {
    const result = AgentQaConfigSchema.safeParse(withWorkspace({
      registry: {
        targets: {
          'staging-web': { platform: 'web', url: 'https://staging.example.com' },
        },
      },
    }))

    expect(result.success).toBe(true)
  })

  it('rejects unsafe target registry keys', () => {
    for (const targetName of ['Staging', 'staging_web', 'bad/path', '.', '..', '../staging', '', 'staging-']) {
      const result = AgentQaConfigSchema.safeParse(withWorkspace({
        registry: {
          targets: {
            [targetName]: { platform: 'web', url: 'https://staging.example.com' },
          },
        },
      }))

      expect(result.success, JSON.stringify(targetName)).toBe(false)
    }
  })
})

// D-15 config half: an explicit opt-in `safety.trustMode` boolean. Strict object rejects
// unknown subkeys and non-boolean values; the key is optional so pre-362 configs still parse.
describe('AgentQaConfigSchema — safety.trustMode (D-15)', () => {
  it('accepts safety.trustMode: true', () => {
    const result = AgentQaConfigSchema.safeParse(withWorkspace({ safety: { trustMode: true } }))
    expect(result.success).toBe(true)
  })

  it('rejects a non-boolean trustMode', () => {
    const result = AgentQaConfigSchema.safeParse(withWorkspace({ safety: { trustMode: 'yes' } }))
    expect(result.success).toBe(false)
  })

  it('rejects unknown safety subkeys (strict)', () => {
    const result = AgentQaConfigSchema.safeParse(withWorkspace({ safety: { trustMode: true, bypass: true } }))
    expect(result.success).toBe(false)
  })

  it('parses a config WITHOUT the safety key (optional, additive)', () => {
    const result = AgentQaConfigSchema.safeParse(withWorkspace({}))
    expect(result.success).toBe(true)
  })
})

// D-03 (Phase 372): eval substrate params — judge names a registry.llms entry;
// strict so unknown eval subkeys are rejected; optional so pre-372 configs still parse.
describe('AgentQaConfigSchema — eval block (D-03)', () => {
  it('accepts a full eval block', () => {
    const result = AgentQaConfigSchema.safeParse(withWorkspace({
      eval: {
        judge: 'gpt-judge',
        k: 3,
        seed: 42,
        seeding: { silverPerTestCap: 5 },
      },
    }))
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.eval?.judge).toBe('gpt-judge')
      expect(result.data.eval?.k).toBe(3)
      expect(result.data.eval?.seed).toBe(42)
      expect(result.data.eval?.seeding?.silverPerTestCap).toBe(5)
    }
  })

  it('rejects unknown eval subkeys (strict)', () => {
    const result = AgentQaConfigSchema.safeParse(withWorkspace({
      eval: { judg: 'x' },
    }))
    expect(result.success).toBe(false)
  })

  it('rejects unknown eval.seeding subkeys (strict)', () => {
    const result = AgentQaConfigSchema.safeParse(withWorkspace({
      eval: { seeding: { silverPerTest: 5 } },
    }))
    expect(result.success).toBe(false)
  })

  it('rejects non-positive k and non-integer seed', () => {
    expect(AgentQaConfigSchema.safeParse(withWorkspace({ eval: { k: 0 } })).success).toBe(false)
    expect(AgentQaConfigSchema.safeParse(withWorkspace({ eval: { seed: 1.5 } })).success).toBe(false)
    expect(AgentQaConfigSchema.safeParse(withWorkspace({ eval: { seeding: { silverPerTestCap: 0 } } })).success).toBe(false)
  })

  it('parses a config WITHOUT the eval key (optional, additive)', () => {
    const result = AgentQaConfigSchema.safeParse(withWorkspace({}))
    expect(result.success).toBe(true)
  })

  // Owner override of D-10 (2026-07-12): the explicit same-family judging opt-in.
  it('accepts eval.judgeAllowSameFamily as a boolean (D-10 owner override)', () => {
    const result = AgentQaConfigSchema.safeParse(withWorkspace({
      eval: { judge: 'judge', judgeAllowSameFamily: true },
    }))
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.eval?.judgeAllowSameFamily).toBe(true)
    }
  })

  it('rejects a non-boolean eval.judgeAllowSameFamily (strict)', () => {
    const result = AgentQaConfigSchema.safeParse(withWorkspace({
      eval: { judge: 'judge', judgeAllowSameFamily: 'yes' },
    }))
    expect(result.success).toBe(false)
  })
})
