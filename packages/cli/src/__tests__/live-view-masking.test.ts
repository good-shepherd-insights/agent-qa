// THE TWO-BINDER MASKING CELL (403 Task 3, T-403-16 · Q4(b) · #224's second half).
//
// WHAT THIS EXISTS FOR. `createDashboardRunDoor` publishes ONE `bindMaskingSecrets` entry point,
// and after 403 there are TWO composers that legitimately bind through it: `composeRunServicePorts`
// binds the declared run-service credentials (402-06, #224) and `composeLiveView` binds the
// `liveUrl` tokens it mints. A single-slot setter (`maskingSecrets = store`) is not a bug you can
// see by reading either composer — each one is correct on its own, and whichever binds LAST wins
// silently. The command's own order drops the minted tokens; the reverse order drops the
// credential. So the cell is parameterised over the ORDER, because a cell that ran one order would
// certify half of the property and pass under the defect in the other half.
//
// EVERY CELL DRIVES THE PRODUCTION COMPOSITION on the TOKEN-DECLARING arm — deliberately, because
// that is the only arm where both binders exist. `run-service-auth-hardening.test.ts` cannot see
// this defect at all: its BIND-HALF cells use a `stubDoor`, which has one slot by construction.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import type { Server } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import { RUNS_LIVE_URL_FUNCTION_ID } from '@vostride/agent-qa-agent'
import type { FunctionRegistry } from '@vostride/agent-qa-agent'
import { invokeFunction } from '@vostride/agent-qa-agent'
import { EditorLiveUrlResultSchema, RunsLiveUrlResultSchema } from '@vostride/agent-qa-schema'
import type { TrustScope } from '@vostride/agent-qa-schema'
import { generateTestId } from '@vostride/agent-qa-ids'
import { createMaskingContext, seedMaskingContext } from '@vostride/agent-qa-safety'
import { afterEach, describe, expect, it } from 'vitest'

import {
  DASHBOARD_FUNCTION_CALLER,
  composeDashboardDoor,
  composeRunServicePorts,
  createDashboardRunDoor,
} from '../commands/dashboard.js'
import { composeLiveView } from '../composition/live-view-composition.js'
import { createRunServiceSessionRegistry } from '../composition/run-service-session-registry.js'
import { plantEditorSubject, startLiveViewHarness } from './conformance/live-view-fixture.js'
import { cleanupTempRoots } from './conformance/spawned-chat.js'

/** The declared credential. `…_CRED` matches no suffix `sensitiveEnvSlice` recognises, on purpose. */
const CREDENTIAL = 'zz-403-01-planted-run-credential-9f21ab'
const CREDENTIAL_VAR = 'AGENT_QA_403_01_RUN_CRED'
const PROJECT_SCOPE: TrustScope = { project: 'acme' }

/** The two orders the two binders can be composed in. Both must mask both values. */
const BINDER_ORDERS = ['liveView-then-runService', 'runService-then-liveView'] as const
type BinderOrder = (typeof BINDER_ORDERS)[number]

const openRoots: string[] = []

function fixtureWorkspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'agent-qa-403-01-masking-'))
  openRoots.push(root)
  const configPath = join(root, 'agent-qa.config.yaml')
  writeFileSync(
    configPath,
    `${JSON.stringify({
      workspace: {
        testMatch: ['tests/**/*.test.yaml'],
        suiteMatch: ['suites/**/*.suite.yaml'],
        hooksFile: 'hooks.yaml',
        envFile: '.env',
        secretsFile: '.env.secrets.local',
      },
      use: { mobile: { appState: 'reset' } },
      registry: {
        targets: {
          conformance: {
            platform: 'web',
            url: 'https://conformance.invalid',
            // `local` folds to `mutating-local`, which allows in every execution context — the
            // remote door composes no confirm channel, so a shared target would deny before a run
            // ever started and this cell would measure the gate rather than the masker.
            environment: 'local',
          },
        },
      },
      services: {
        dashboard: {
          runServiceTokens: [{ name: 'ci', tokenEnvVar: CREDENTIAL_VAR, trustScope: PROJECT_SCOPE }],
        },
      },
    })}\n`,
    'utf8',
  )
  writeFileSync(join(root, '.env'), '', 'utf8')
  writeFileSync(join(root, '.env.secrets.local'), '', 'utf8')
  writeFileSync(join(root, 'hooks.yaml'), 'hooks: []\n', 'utf8')
  mkdirSync(join(root, 'tests'), { recursive: true })
  writeFileSync(
    join(root, 'tests', 'probe.test.yaml'),
    'name: The live-view masking probe\n'
    + `test-id: ${generateTestId()}\n`
    + 'target: conformance\n'
    + 'steps:\n'
    + '  - Do nothing this run will ever reach\n',
    'utf8',
  )
  return configPath
}

interface Fixture {
  readonly origin: string
  readonly registry: FunctionRegistry
  readonly maskingSecrets: () => { forEachSecret(cb: (n: string, v: string) => void): void } | undefined
  readonly close: () => Promise<void>
  /** Every line the chained observer masked through a started run's OWN context. */
  readonly seen: string[]
  /** The text that observer masks. Set before starting the run whose masking is measured. */
  observed: string
}

const openFixtures: Fixture[] = []

/**
 * The shipped command's composition, with the two binders run in a chosen ORDER.
 *
 * Everything here is the production composer: `createDashboardRunDoor`, `composeLiveView`,
 * `composeDashboardDoor`, `composeRunServicePorts`, `startServer`. The ONLY addition is a chained
 * `subscribers` observer that masks a line through each started run's own context — the
 * `observeMasking` idiom from `run-service-auth-hardening.test.ts`, which keeps the door's own
 * `maskingSecrets` resolver intact because that resolver is the thing under measurement.
 */
async function openFixture(order: BinderOrder): Promise<Fixture> {
  const configPath = fixtureWorkspace()
  const configDir = dirname(resolve(configPath))
  const { DashboardDatabase, startServer } = await import('@vostride/agent-qa-dashboard')
  const db = new DashboardDatabase({ dbPath: join(configDir, 'dashboard.db') })
  const runDoor = await createDashboardRunDoor({ db })
  let boundOrigin: string | undefined
  const seen: string[] = []
  const state = { observed: '' }

  const sessions = createRunServiceSessionRegistry({ observeSessions: runDoor.observeSessions })

  const bindLiveView = (): ReturnType<typeof composeLiveView> =>
    composeLiveView({ sessions, origin: () => boundOrigin, door: runDoor })
  const bindRunService = (): ReturnType<typeof composeRunServicePorts> =>
    composeRunServicePorts({
      entries: [{ name: 'ci', tokenEnvVar: CREDENTIAL_VAR, trustScope: PROJECT_SCOPE }],
      // The value travels in an EXPLICIT env map, never `process.env` (the `withRunServiceDoor` rule).
      env: { [CREDENTIAL_VAR]: CREDENTIAL },
      door: runDoor,
      sessions,
    })

  // THE AXIS. Both composers bind through the door's ONE entry point; which one goes first is the
  // whole experiment.
  const liveView = order === 'liveView-then-runService' ? bindLiveView() : undefined
  const runServiceFirst = order === 'runService-then-liveView' ? bindRunService() : undefined
  const composedLiveView = liveView ?? bindLiveView()
  const runService = runServiceFirst ?? bindRunService()

  const { agentHost, host, enterRunTriggerScope } = composeDashboardDoor({
    agentQaRoot: join(configDir, '.agent-qa'),
    configPath,
    boundOrigin: () => boundOrigin,
    liveView: composedLiveView.liveView,
    runBridge: {
      ...runDoor.runBridge,
      subscribers: (attach) => {
        if (state.observed !== '') seen.push(attach.maskingContext.mask(state.observed))
        return runDoor.runBridge.subscribers?.(attach)
      },
    },
  })
  runDoor.bindHost(host)
  runDoor.bindTriggerScope(enterRunTriggerScope)

  const started = await startServer({
    db,
    port: 0,
    configPath,
    agentHost,
    executionBackend: runDoor.backend,
    runService: runService.ports,
    runServiceReadiness: runService.readiness,
  })
  const address = (started.server as Server).address()
  if (address === null || typeof address === 'string') throw new TypeError('the server bound no port')
  boundOrigin = `http://127.0.0.1:${String(address.port)}`

  const fixture: Fixture = {
    origin: boundOrigin,
    registry: host.registry as FunctionRegistry,
    maskingSecrets: () => runDoor.runBridge.maskingSecrets?.(),
    seen,
    get observed() { return state.observed },
    set observed(value: string) { state.observed = value },
    close: async () => {
      started.close()
      runService.dispose()
      sessions.dispose()
      await host.close()
      db.close()
      rmSync(configDir, { recursive: true, force: true })
    },
  }
  openFixtures.push(fixture)
  return fixture
}

async function startRunOverTheWire(fixture: Fixture): Promise<string> {
  const response = await fetch(`${fixture.origin}/run`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${CREDENTIAL}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ patterns: ['tests/probe.test.yaml'] }),
  })
  expect(response.status).toBe(202)
  const ack = await response.json() as { runId?: string }
  expect(typeof ack.runId, 'the ack names the run this door started').toBe('string')
  return ack.runId as string
}

afterEach(async () => {
  while (openFixtures.length > 0) await openFixtures.pop()?.close().catch(() => undefined)
  while (openRoots.length > 0) rmSync(openRoots.pop() as string, { recursive: true, force: true })
})

describe.each(BINDER_ORDERS)('the door UNIONS every bound secret store — order: %s', (order) => {
  it('(1) BIND HALF — both the declared credential and a minted liveUrl token are walked', async () => {
    const fixture = await openFixture(order)
    const runId = await startRunOverTheWire(fixture)

    const result = RunsLiveUrlResultSchema.parse(
      await invokeFunction(fixture.registry, RUNS_LIVE_URL_FUNCTION_ID, { runId, handle: 0 }, DASHBOARD_FUNCTION_CALLER),
    )
    const token = result.liveUrl.split('#')[1] as string
    expect(token.startsWith('v1.')).toBe(true)

    const walked: string[] = []
    fixture.maskingSecrets()?.forEachSecret((_name, value) => { walked.push(value) })

    // UNDER A SINGLE-SLOT SETTER exactly one of these two fails, and WHICH one names the order:
    // `liveView-then-runService` loses the token, `runService-then-liveView` loses the credential.
    expect(walked, `the declared run-service credential must survive binder order ${order}`)
      .toContain(CREDENTIAL)
    expect(walked, `the minted liveUrl token must survive binder order ${order}`)
      .toContain(token)
  }, 180_000)

  it('(2) CONSUME HALF — a run started AFTER both masks both values in its own context', async () => {
    const fixture = await openFixture(order)
    const first = await startRunOverTheWire(fixture)
    const result = RunsLiveUrlResultSchema.parse(
      await invokeFunction(fixture.registry, RUNS_LIVE_URL_FUNCTION_ID, { runId: first, handle: 0 }, DASHBOARD_FUNCTION_CALLER),
    )
    const token = result.liveUrl.split('#')[1] as string

    // The SECOND run is the one under measurement: `seed.ts:17` walks the store once at run start,
    // so only a run started after the mint can mask the minted token (the Pitfall 2 limit, stated
    // as a dated note in `composeLiveView`).
    fixture.observed = `the run printed ${CREDENTIAL} and ${token} on its way past`
    await startRunOverTheWire(fixture)

    expect(fixture.seen.length, 'the positive control — the masker was actually driven')
      .toBeGreaterThan(0)
    for (const masked of fixture.seen) {
      expect(masked).not.toContain(CREDENTIAL)
      expect(masked).not.toContain(token)
      expect(masked).toContain('SECRET')
      expect(masked, 'a mask is a substitution, not a redaction of the whole line')
        .toContain('the run printed')
    }
  }, 180_000)
})

describe('the union never manufactures an empty store (#224 posture preserved)', () => {
  it('(3) a door with nothing bound still resolves maskingSecrets to undefined', async () => {
    const configPath = fixtureWorkspace()
    const configDir = dirname(resolve(configPath))
    const { DashboardDatabase } = await import('@vostride/agent-qa-dashboard')
    const db = new DashboardDatabase({ dbPath: join(configDir, 'empty.db') })
    const runDoor = await createDashboardRunDoor({ db })
    try {
      // Zero stores must stay `undefined` and not become an empty walker: the seed would otherwise
      // walk a store for nothing on every run of a dashboard that holds no secrets at all.
      expect(runDoor.runBridge.maskingSecrets?.()).toBeUndefined()
    } finally {
      db.close()
    }
  }, 60_000)
})

describe('an editor token is a minted credential like any other (428 D-07)', () => {
  it('EDITOR-TOKEN-MASKED: an editor token minted through the door reaches the masking store, and a later print of it is masked', async () => {
    // THE SHIPPED COMPOSITION: the harness wires `composeLiveView` with the editor lookup and the
    // editor mint door exactly as `agent-qa dashboard` does, so the token below crossed the op's
    // `onMinted` on its way out of the door.
    const harness = await startLiveViewHarness({ label: '428-12-masking' })
    const editor = plantEditorSubject(harness, { sessionId: 'ed-mask', kind: 'cdp-screencast' })
    try {
      const response = await fetch(`${harness.origin}/api/live-editor/sessions/ed-mask/live-url`)
      const raw = await response.text()
      expect(response.status, `the editor mint door answered ${response.status === 200 ? '200' : raw.slice(0, 200)}`)
        .toBe(200)
      const token = EditorLiveUrlResultSchema.parse(JSON.parse(raw)).liveUrl.split('#')[1] as string
      expect(token.startsWith('v1.'), 'the needle this cell masks is a real v1 token').toBe(true)

      const store = harness.maskingSecrets()
      expect(store, 'the composition bound its minted-token store through the door').toBeDefined()
      const walked: string[] = []
      store?.forEachSecret((_name, value) => { walked.push(value) })
      expect(walked, 'the editor token was offered to the masking store').toContain(token)

      // A LATER PRINT: a masking context seeded from the store after the mint, as a run started
      // afterwards is seeded (`seed.ts`).
      const context = createMaskingContext()
      seedMaskingContext(context, { secretStore: store })
      const masked = context.mask(`the editor printed ${token} on its way past`)
      expect(masked, 'the editor token is masked').not.toContain(token)
      expect(masked, 'nothing of the token survives the mask').not.toContain('v1.')
      expect(masked).toContain('SECRET')
      expect(masked, 'a mask is a substitution, not a redaction of the whole line')
        .toContain('the editor printed')
    } finally {
      await editor.close()
      await harness.close()
      cleanupTempRoots()
    }
  }, 60_000)
})
