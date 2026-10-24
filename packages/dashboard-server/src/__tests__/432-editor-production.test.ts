// The live editor's production refusal (Phase 432 plan 04, D-18).
//
// The live editor drives a target without the run core: `POST /api/live-editor/sessions` builds a
// session, and `LiveSession.initialize` runs the setup hooks, acquires Appium, constructs the
// platform adapter and navigates. So the core's refusal (432-03) never sees it, and the editor
// carries its own copy of the same rule: a target the CURRENT config declares
// `environment: production` is refused, before any of those effects, unless the same config says
// `allowProduction: true`.
//
// Two places refuse, and both are measured. The create door refuses before `createSession`, and
// `initialize` refuses again before its first setup effect, because it is callable apart from the
// door. The request may name a target; it can never supply the target's environment or the opt-in.
//
// Every effect is instrumented at the package seam it crosses: the hook runner, the Docker hook
// executor, the three platform adapters, the mobile target resolution, the Appium lease, the
// model, and navigation. A refusal's whole claim is that none of them is reached, and each paired
// control shows the same session with a non-production target reaching them.

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer, request as httpRequest } from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { HookDefinition } from '@vostride/agent-qa-core'

const effects = vi.hoisted(() => ({
  runHooks: [] as string[],
  dockerExecutors: 0,
  webAdapters: 0,
  androidAdapters: 0,
  iosAdapters: 0,
  adapterSetups: [] as string[],
  adapterCleanups: [] as string[],
  navigations: [] as string[],
  mobileResolutions: [] as string[],
  models: 0,
}))

function resetEffects(): void {
  effects.runHooks.length = 0
  effects.dockerExecutors = 0
  effects.webAdapters = 0
  effects.androidAdapters = 0
  effects.iosAdapters = 0
  effects.adapterSetups.length = 0
  effects.adapterCleanups.length = 0
  effects.navigations.length = 0
  effects.mobileResolutions.length = 0
  effects.models = 0
}

vi.mock('@vostride/agent-qa-web', () => ({
  WebPlatformAdapter: vi.fn().mockImplementation(function () {
    effects.webAdapters += 1
    return {
      platform: 'web',
      setup: async () => { effects.adapterSetups.push('web') },
      cleanup: async () => { effects.adapterCleanups.push('web') },
      execute: async (action: { type: string; url?: string }) => {
        if (action.type === 'navigate') effects.navigations.push(action.url ?? '')
        return { success: true }
      },
    }
  }),
}))

vi.mock('@vostride/agent-qa-android', () => ({
  AndroidPlatformAdapter: vi.fn().mockImplementation(function () {
    effects.androidAdapters += 1
    return {
      platform: 'android',
      setup: async () => { effects.adapterSetups.push('android') },
      cleanup: async () => { effects.adapterCleanups.push('android') },
      execute: async () => ({ success: true }),
    }
  }),
}))

vi.mock('@vostride/agent-qa-ios', () => ({
  IOSPlatformAdapter: vi.fn().mockImplementation(function () {
    effects.iosAdapters += 1
    return {
      platform: 'ios',
      setup: async () => { effects.adapterSetups.push('ios') },
      cleanup: async () => { effects.adapterCleanups.push('ios') },
      execute: async () => ({ success: true }),
    }
  }),
}))

vi.mock('@vostride/agent-qa-runner', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@vostride/agent-qa-runner')>()
  return {
    ...actual,
    runHooks: async (hooks: Array<{ name: string }>) => {
      for (const hook of hooks) effects.runHooks.push(hook.name)
      return {
        results: new Map(hooks.map((hook) => [hook.name, {
          success: true,
          duration: 1,
          stdout: '',
          stderr: '',
          variables: {},
        }])),
        variables: {},
        allPassed: true,
        duration: 1,
      }
    },
    LLMPlanner: vi.fn().mockImplementation(function () { return { plan: vi.fn() } }),
    LLMVerifier: vi.fn().mockImplementation(function () { return { verify: vi.fn() } }),
  }
})

vi.mock('@vostride/agent-qa-runner-local', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@vostride/agent-qa-runner-local')>()),
  DockerHookExecutor: class {
    constructor() { effects.dockerExecutors += 1 }
    execute() { return Promise.resolve({ success: true, variables: {}, stdout: '', stderr: '', duration: 1 }) }
  },
}))

vi.mock('@vostride/agent-qa-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@vostride/agent-qa-core')>()
  return {
    ...actual,
    resolveMobileRunConfig: (input: { targetName: string; platform: 'android' | 'ios' }) => {
      effects.mobileResolutions.push(input.targetName)
      return {
        platform: input.platform,
        targetName: input.targetName,
        deviceName: 'fixture-device',
        device: { name: 'fixture-device', platform: input.platform, transport: 'local', match: {} },
        app: {
          appPackage: input.platform === 'android' ? 'com.example.app' : undefined,
          bundleId: input.platform === 'ios' ? 'com.example.app' : undefined,
          deepLinkAppId: 'com.example.app',
        },
        appState: 'preserve',
        sourceTrace: [],
      }
    },
  }
})

vi.mock('@vostride/agent-qa-model', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@vostride/agent-qa-model')>()
  return {
    ...actual,
    createModel: () => {
      effects.models += 1
      return { modelId: 'fixture-model' }
    },
  }
})

import { ConfigManager } from '../config/index.js'
import { DashboardDatabase } from '../db/database.js'
import { LiveSession } from '../live-editor/live-session.js'
import { SessionManager } from '../live-editor/session-manager.js'
import type { LiveSessionConfig } from '../live-editor/types.js'
import { createRouter } from '../server/routes.js'

/** The one line the refusal must name, spelled here rather than imported from the producer. */
const OPT_IN_LINE = 'allowProduction: true'

const HOOK_ID = 'h_amber-birch-coral-delta-ember-falcon-garden-harbor-island-jungle'
const HOOK: HookDefinition = { id: HOOK_ID, name: 'seed-the-account' } as unknown as HookDefinition

const LLM = {
  provider: 'anthropic-compatible',
  model: 'claude-sonnet-4-20250514',
  baseURL: 'https://anthropic-proxy.example/messages',
} as const

type Platform = 'web' | 'android' | 'ios'
const PLATFORMS: readonly Platform[] = ['web', 'android', 'ios']

const PROD_URL = 'http://127.0.0.1:9/prod-web'
const LOCAL_URL = 'http://127.0.0.1:9/local-web'

/** The production and local target of each platform, as this fixture's config declares them. */
const TARGETS: Readonly<Record<Platform, { readonly production: string; readonly local: string }>> = {
  web: { production: 'prod-web', local: 'local-web' },
  android: { production: 'prod-android', local: 'local-android' },
  ios: { production: 'prod-ios', local: 'local-ios' },
}

let project: string
let configPath: string
let configManager: ConfigManager

interface Appium {
  readonly leases: string[]
  readonly releases: string[]
  readonly manager: {
    acquireLease: (input: { runId: string }) => Promise<void>
    releaseLease: (runId: string) => boolean
    getUrl: () => string
  }
}

function appium(): Appium {
  const leases: string[] = []
  const releases: string[] = []
  return {
    leases,
    releases,
    manager: {
      acquireLease: async ({ runId }) => { leases.push(runId) },
      releaseLease: (runId) => { releases.push(runId); return true },
      getUrl: () => 'http://127.0.0.1:4723',
    },
  }
}

/**
 * The project config, written as a person would write it. `optIn` is the literal text of the
 * top-level `allowProduction` line, or absent.
 */
async function writeConfig(optIn?: string, extraTargets: readonly string[] = []): Promise<void> {
  const lines = [
    'workspace:',
    '  testMatch:',
    "    - 'tests/**/*.yaml'",
    '  suiteMatch:',
    "    - 'suites/**/*.suite.yaml'",
    '  hooksFile: hooks.yaml',
    '  envFile: .env',
    '  secretsFile: .env.secrets.local',
    ...(optIn === undefined ? [] : [`allowProduction: ${optIn}`]),
    'registry:',
    '  targets:',
    '    prod-web:',
    '      platform: web',
    `      url: ${PROD_URL}`,
    '      environment: production',
    '    local-web:',
    '      platform: web',
    `      url: ${LOCAL_URL}`,
    '      environment: local',
    '    prod-android:',
    '      platform: android',
    '      appPackage: com.example.app',
    '      environment: production',
    '    local-android:',
    '      platform: android',
    '      appPackage: com.example.app',
    '      environment: local',
    '    prod-ios:',
    '      platform: ios',
    '      bundleId: com.example.app',
    '      environment: production',
    '    local-ios:',
    '      platform: ios',
    '      bundleId: com.example.app',
    '      environment: shared',
    ...extraTargets,
    '',
  ]
  await writeFile(configPath, lines.join('\n'), 'utf-8')
}

beforeEach(async () => {
  resetEffects()
  project = await mkdtemp(join(tmpdir(), 'editor-production-'))
  configPath = join(project, 'agent-qa.config.yaml')
  configManager = new ConfigManager(configPath, (text) => text)
  await writeConfig()
  await Promise.all([
    writeFile(join(project, 'hooks.yaml'), 'hooks: []\n', 'utf-8'),
    writeFile(join(project, '.env'), '', 'utf-8'),
    writeFile(join(project, '.env.secrets.local'), '', 'utf-8'),
  ])
})

afterEach(async () => {
  await rm(project, { recursive: true, force: true })
})

/** A session config as the door builds it: a target by name, a setup hook, and a URL for web. */
function sessionConfig(platform: Platform, targetName: string | undefined): LiveSessionConfig {
  return {
    platform,
    ...(targetName === undefined ? {} : { targetName }),
    llmConfig: { ...LLM },
    setupHooks: [HOOK_ID],
    resolvedHooks: new Map([[HOOK_ID, HOOK]]),
    headless: true,
    ...(platform === 'web' ? { url: targetName === TARGETS.web.production ? PROD_URL : LOCAL_URL } : {}),
  }
}

async function refusalOf(work: Promise<unknown>): Promise<Error | undefined> {
  try {
    await work
    return undefined
  } catch (error) {
    return error as Error
  }
}

/** The refusal sentence: the target, the declaration, and the line to add, on one line. */
function expectProductionRefusal(message: string | undefined, targetName: string): void {
  expect(message).toBeDefined()
  expect(message).toContain(`"${targetName}"`)
  expect(message).toContain('environment: production')
  expect(message).toContain(OPT_IN_LINE)
  expect(message!.split('\n')).toHaveLength(1)
}

/** Every setup effect a refused session must not have. */
function expectNoSetupEffects(lease: Appium): void {
  expect(effects.runHooks, 'a setup hook ran for a refused session').toEqual([])
  expect(effects.dockerExecutors, 'a hook executor was built for a refused session').toBe(0)
  expect(effects.mobileResolutions, 'a mobile target was resolved for a refused session').toEqual([])
  expect(lease.leases, 'Appium was acquired for a refused session').toEqual([])
  expect(effects.webAdapters + effects.androidAdapters + effects.iosAdapters, 'an adapter was built').toBe(0)
  expect(effects.adapterSetups).toEqual([])
  expect(effects.navigations, 'a refused session navigated').toEqual([])
  expect(effects.models, 'a model was created for a refused session').toBe(0)
}

/**
 * The effects a started session has, per platform: the hook, the adapter, Appium or navigation.
 *
 * `hooks: false` for a session started through the door, which resolves hooks from the project's
 * `hooks.yaml`; this fixture's file declares none, so the door's controls send none.
 */
function expectSetupEffects(
  platform: Platform,
  lease: Appium,
  targetName: string,
  options: { readonly hooks: boolean } = { hooks: true },
): void {
  expect(effects.runHooks).toEqual(options.hooks ? [HOOK.name] : [])
  expect(effects.adapterSetups).toEqual([platform])
  if (platform === 'web') {
    expect(effects.navigations).toEqual([targetName === TARGETS.web.production ? PROD_URL : LOCAL_URL])
  } else {
    expect(effects.mobileResolutions).toEqual([targetName])
    expect(lease.leases).toHaveLength(1)
  }
}

// ---- the create door ------------------------------------------------------------------------

interface Served {
  readonly manager: SessionManager
  readonly created: unknown[]
  readonly lease: Appium
  readonly port: number
  close(): Promise<void>
}

const servers: Served[] = []

afterEach(async () => {
  while (servers.length > 0) await servers.pop()?.close()
})

async function serve(): Promise<Served> {
  const lease = appium()
  const manager = new SessionManager({
    appiumManager: lease.manager as never,
    configManager,
    configPath,
  })
  const created: unknown[] = []
  const createSession = manager.createSession.bind(manager)
  manager.createSession = async (...args) => {
    created.push(args[0])
    return await createSession(...args)
  }
  const db = new DashboardDatabase({ dbPath: ':memory:' })
  const router = createRouter({
    db,
    configManager,
    configPath,
    llmConfig: { ...LLM },
    sessionManager: manager,
    workspacePaths: workspacePaths() as never,
  })
  const server: Server = createServer(router)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const served: Served = {
    manager,
    created,
    lease,
    port: (server.address() as AddressInfo).port,
    close: async () => {
      await manager.cleanupAll()
      await new Promise<void>((resolve) => server.close(() => resolve()))
      db.close()
    },
  }
  servers.push(served)
  return served
}

function workspacePaths() {
  const file = (workspaceRelativePath: string) => ({
    configuredPath: workspaceRelativePath,
    absolutePath: join(project, workspaceRelativePath),
    workspaceRelativePath,
  })
  return {
    configPath,
    configDir: project,
    testMatch: ['tests/**/*.yaml'],
    suiteMatch: ['suites/**/*.suite.yaml'],
    testPathIgnore: [],
    hooksFile: file('hooks.yaml'),
    envFile: file('.env'),
    secretsFile: file('.env.secrets.local'),
  }
}

async function postSession(
  served: Served,
  body: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const payload = JSON.stringify(body)
  return await new Promise((resolve, reject) => {
    const req = httpRequest({
      host: '127.0.0.1',
      port: served.port,
      method: 'POST',
      path: '/api/live-editor/sessions',
      headers: { 'content-type': 'application/json' },
    }, (res) => {
      let text = ''
      res.setEncoding('utf8')
      res.on('data', (chunk: string) => { text += chunk })
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: JSON.parse(text) as Record<string, unknown> }))
    })
    req.on('error', reject)
    req.end(payload)
  })
}

async function deleteSession(served: Served, sessionId: string): Promise<number> {
  return await new Promise((resolve, reject) => {
    const req = httpRequest({
      host: '127.0.0.1',
      port: served.port,
      method: 'DELETE',
      path: `/api/live-editor/sessions/${encodeURIComponent(sessionId)}`,
    }, (res) => {
      res.resume()
      res.on('end', () => resolve(res.statusCode ?? 0))
    })
    req.on('error', reject)
    req.end()
  })
}

function doorBody(
  platform: Platform,
  targetName: string,
  options: { readonly hooks: boolean } = { hooks: true },
): Record<string, unknown> {
  return {
    platform,
    targetName,
    headless: true,
    ...(options.hooks ? { setupHooks: [HOOK_ID] } : {}),
    ...(platform === 'web' ? { url: targetName === TARGETS.web.production ? PROD_URL : LOCAL_URL } : {}),
  }
}

describe('C432-EDITOR-PRODUCTION — the live editor refuses a declared production target before any setup effect', () => {
  it.each(PLATFORMS)(
    'C432-EDITOR-PRODUCTION: direct initialize refuses a production %s target before the setup hooks, Appium, the adapter and navigation',
    async (platform) => {
      const lease = appium()
      const session = new LiveSession(`direct-${platform}`, {
        appiumManager: lease.manager as never,
        configManager,
        configPath,
      })

      const refusal = await refusalOf(session.initialize(sessionConfig(platform, TARGETS[platform].production)))

      expectProductionRefusal(refusal?.message, TARGETS[platform].production)
      expectNoSetupEffects(lease)
      expect(session.getState().interactive).toBe(false)
    },
  )

  it.each(PLATFORMS)(
    'C432-EDITOR-PRODUCTION: the create door refuses a production %s target before createSession',
    async (platform) => {
      const served = await serve()

      const answer = await postSession(served, doorBody(platform, TARGETS[platform].production))

      expect(answer.status).toBe(403)
      expectProductionRefusal(answer.body.error as string, TARGETS[platform].production)
      expect(served.created, 'createSession was reached for a refused target').toEqual([])
      expect(served.manager.size).toBe(0)
      expectNoSetupEffects(served.lease)
    },
  )

  it.each(PLATFORMS)(
    'the paired control: direct initialize of a non-production %s target runs its setup and reaches the adapter',
    async (platform) => {
      const lease = appium()
      const session = new LiveSession(`control-${platform}`, {
        appiumManager: lease.manager as never,
        configManager,
        configPath,
      })

      await session.initialize(sessionConfig(platform, TARGETS[platform].local))

      expectSetupEffects(platform, lease, TARGETS[platform].local)
      expect(session.getState().interactive).toBe(true)
      await session.cleanup()
    },
  )

  it.each(PLATFORMS)(
    'the opt-in control: with allowProduction: true a production %s target starts through the door',
    async (platform) => {
      await writeConfig('true')
      const served = await serve()

      const answer = await postSession(
        served,
        doorBody(platform, TARGETS[platform].production, { hooks: false }),
      )

      expect(answer.status).toBe(201)
      expect(served.created).toHaveLength(1)
      expect(served.manager.size).toBe(1)
      expectSetupEffects(platform, served.lease, TARGETS[platform].production, { hooks: false })
    },
  )
})

describe('the live editor production boundary: edges and retained controls (432-04, D-18)', () => {
  it('EDGE-05: a raw URL with no target name is not production, even when it is a production target\'s URL', async () => {
    const served = await serve()

    const answer = await postSession(served, { platform: 'web', url: PROD_URL, headless: true })

    expect(answer.status).toBe(201)
    expect(effects.navigations).toEqual([PROD_URL])
  })

  it('a target name the config does not declare is not production', async () => {
    const lease = appium()
    const session = new LiveSession('undeclared', { appiumManager: lease.manager as never, configManager, configPath })

    await session.initialize({ ...sessionConfig('web', 'nowhere'), url: LOCAL_URL })

    expect(effects.adapterSetups).toEqual(['web'])
    await session.cleanup()
  })

  it.each(['__proto__', 'constructor', 'toString'])(
    'a prototype-shaped name (%s) is not a declared target and does not throw',
    async (name) => {
      const lease = appium()
      const session = new LiveSession(`proto-${name}`, { appiumManager: lease.manager as never, configManager, configPath })

      await session.initialize({ ...sessionConfig('web', name), url: LOCAL_URL })

      expect(effects.adapterSetups).toEqual(['web'])
      await session.cleanup()
    },
  )

  it('the request cannot author the environment or the opt-in', async () => {
    const served = await serve()

    const answer = await postSession(served, {
      ...doorBody('web', TARGETS.web.production),
      environment: 'local',
      allowProduction: true,
      production: { productionTargetNames: [] },
    })

    expect(answer.status).toBe(403)
    expectProductionRefusal(answer.body.error as string, TARGETS.web.production)
    expect(served.created).toEqual([])
    expectNoSetupEffects(served.lease)
  })

  it.each([
    ['false', 'false'],
    ['the string "true"', '"true"'],
    ['1', '1'],
    ['yes', 'yes'],
  ])('only the literal true opts in: allowProduction %s refuses as its absence does', async (_label, optIn) => {
    await writeConfig(optIn)
    const lease = appium()
    const session = new LiveSession('not-opted-in', { appiumManager: lease.manager as never, configManager, configPath })

    const refusal = await refusalOf(session.initialize(sessionConfig('web', TARGETS.web.production)))

    expectProductionRefusal(refusal?.message, TARGETS.web.production)
    expectNoSetupEffects(lease)
  })

  it('a padded target name is the same target: refused', async () => {
    const served = await serve()

    const answer = await postSession(served, doorBody('android', `  ${TARGETS.android.production}  `))

    expect(answer.status).toBe(403)
    expectProductionRefusal(answer.body.error as string, TARGETS.android.production)
    expectNoSetupEffects(served.lease)
  })

  it('EDGE-06: control and bidi characters in a declared name are replaced, and the refusal stays one line', async () => {
    const hostile = 'prod\u202eweb\nnext'
    await writeConfig(undefined, [
      `    ${JSON.stringify(hostile)}:`,
      '      platform: web',
      `      url: ${PROD_URL}`,
      '      environment: production',
    ])
    const lease = appium()
    const session = new LiveSession('hostile', { appiumManager: lease.manager as never, configManager, configPath })

    const refusal = await refusalOf(session.initialize({ ...sessionConfig('web', hostile), url: PROD_URL }))

    expect(refusal?.message).toContain(OPT_IN_LINE)
    expect(refusal?.message).not.toContain('\u202e')
    expect(refusal?.message.split('\n')).toHaveLength(1)
    expectNoSetupEffects(lease)
  })

  it('initialize honours the door\'s finding: a caller cannot clear it, and only the config opts in', async () => {
    const lease = appium()
    const cleared = new LiveSession('cleared', { appiumManager: lease.manager as never, configManager, configPath })
    // A caller that claims the target is not production is still refused: the config is read again.
    const refusal = await refusalOf(cleared.initialize({
      ...sessionConfig('web', TARGETS.web.production),
      production: { productionTargetNames: [] },
    }))
    expectProductionRefusal(refusal?.message, TARGETS.web.production)

    // A finding the door made stays a refusal when the config read now has no opt-in, even for a
    // session whose own target the config reads as local.
    const kept = new LiveSession('kept', { appiumManager: lease.manager as never, configManager, configPath })
    const keptRefusal = await refusalOf(kept.initialize({
      ...sessionConfig('web', TARGETS.web.local),
      production: { productionTargetNames: [TARGETS.web.production] },
    }))
    expectProductionRefusal(keptRefusal?.message, TARGETS.web.production)
    expectNoSetupEffects(lease)
  })

  it('the opt-in withdrawn between the door and initialize: refused with 403, and the session is never held', async () => {
    await writeConfig('true')
    const served = await serve()
    const read = configManager.readWithRevision.bind(configManager)
    let reads = 0
    configManager.readWithRevision = async () => {
      const answer = await read()
      reads += 1
      // The door's own read saw the opt-in; the person removes it before anything else reads.
      if (reads === 1) await writeConfig()
      return answer
    }

    const answer = await postSession(served, doorBody('ios', TARGETS.ios.production, { hooks: false }))

    expect(answer.status).toBe(403)
    expectProductionRefusal(answer.body.error as string, TARGETS.ios.production)
    expect(served.created).toHaveLength(1)
    expect(served.manager.size).toBe(0)
    expect(served.manager.listSessions()).toEqual([])
    expectNoSetupEffects(served.lease)
  })

  it('SessionManager.createSession refuses and holds nothing: no subject, no idle timer, no number', async () => {
    const registered: string[] = []
    const lease = appium()
    const manager = new SessionManager({
      appiumManager: lease.manager as never,
      configManager,
      configPath,
      liveEditorSubjects: {
        register: (sessionId: string) => { registered.push(sessionId) },
        unregister: () => {},
      } as never,
    })
    const entity = { type: 'test' as const, id: 't_fixture' }

    const refusal = await refusalOf(manager.createSession(sessionConfig('android', TARGETS.android.production), entity))

    expectProductionRefusal(refusal?.message, TARGETS.android.production)
    expect(manager.size).toBe(0)
    expect(registered).toEqual([])
    expect(manager.getCounter(entity)).toBe(0)
    expectNoSetupEffects(lease)
  })

  it('cleanup is retained: after a refusal, a local mobile session starts and its end releases Appium and the adapter', async () => {
    const served = await serve()
    const refused = await postSession(served, doorBody('android', TARGETS.android.production))
    expect(refused.status).toBe(403)

    const started = await postSession(served, doorBody('android', TARGETS.android.local, { hooks: false }))
    expect(started.status).toBe(201)
    const sessionId = started.body.sessionId as string
    expect(served.manager.size).toBe(1)
    expect(served.lease.leases).toEqual([sessionId])

    expect(await deleteSession(served, sessionId)).toBe(200)
    expect(served.manager.size).toBe(0)
    expect(effects.adapterCleanups).toEqual(['android'])
    expect(served.lease.releases).toEqual([sessionId])
  })
})
