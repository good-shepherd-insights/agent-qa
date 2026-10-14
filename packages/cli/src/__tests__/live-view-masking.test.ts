// THE TWO-BINDER MASKING CELL (403 Task 3, T-403-16 · Q4(b) · #224's second half).
//
// 2026-10-01 (432-21, D-12/D-13): the second shipped binder — `composeRunServicePorts` with the
// declared run-service credentials — is deleted with those credentials, so the order axis now runs
// `composeLiveView` against a second store bound through the same door entry point (any composer
// may bind one). The union claim is unchanged. The run service is tokenless, and the signed
// live-view link it mints keeps its own subject and expiry checks, independent of who asked
// (C432-RETAINED-LIVE-LINK), including for concurrent tokenless mints (EDGE-17).
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

/** The second store's value. `…_CRED` matches no suffix `sensitiveEnvSlice` recognises, on purpose. */
const CREDENTIAL = 'zz-403-01-planted-run-credential-9f21ab'
const CREDENTIAL_VAR = 'AGENT_QA_403_01_RUN_CRED'

/** The two orders the two binders can be composed in. Both must mask both values. */
const BINDER_ORDERS = ['liveView-then-store', 'store-then-liveView'] as const
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
  /** The live-view validator the frame socket uses, by reference (403 D-06). */
  readonly validate: ReturnType<typeof composeLiveView>['validate']
  readonly maskingSecrets: () => { forEachSecret(cb: (n: string, v: string) => void): void } | undefined
  readonly close: () => Promise<void>
}

const openFixtures: Fixture[] = []

/**
 * The shipped command's composition, with the two binders run in a chosen ORDER: every composer
 * here is the production one.
 */
async function openFixture(order: BinderOrder): Promise<Fixture> {
  const configPath = fixtureWorkspace()
  const configDir = dirname(resolve(configPath))
  const { DashboardDatabase, startServer } = await import('@vostride/agent-qa-dashboard')
  const db = new DashboardDatabase({ dbPath: join(configDir, 'dashboard.db') })
  const runDoor = await createDashboardRunDoor({ db })
  let boundOrigin: string | undefined

  const sessions = createRunServiceSessionRegistry({ observeSessions: runDoor.observeSessions })

  const bindLiveView = (): ReturnType<typeof composeLiveView> =>
    composeLiveView({ sessions, origin: () => boundOrigin, door: runDoor })
  // 432-21: the second binder — a store bound through the door's one entry point, as any composer
  // may. Its value travels in an explicit closure, never `process.env`.
  const bindStore = (): void => {
    runDoor.bindMaskingSecrets({ forEachSecret(cb) { cb(CREDENTIAL_VAR, CREDENTIAL) } })
  }

  // THE AXIS. Both binders bind through the door's ONE entry point; which one goes first is the
  // whole experiment.
  const liveView = order === 'liveView-then-store' ? bindLiveView() : undefined
  bindStore()
  const composedLiveView = liveView ?? bindLiveView()
  // 432-21 (D-12): the tokenless run service, composed as the command composes it.
  const runService = composeRunServicePorts({ door: runDoor, sessions })

  const { agentHost, host } = composeDashboardDoor({
    agentQaRoot: join(configDir, '.agent-qa'),
    configPath,
    boundOrigin: () => boundOrigin,
    liveView: composedLiveView.liveView,
    runBridge: runDoor.runBridge,
  })
  runDoor.bindHost(host)

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
    validate: composedLiveView.validate,
    maskingSecrets: () => runDoor.runBridge.maskingSecrets?.(),
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
    headers: { 'Content-Type': 'application/json' },
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
    // 432-21: "the declared credential" is the second store's value now (see the file header).
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
    // `store-then-liveView` loses the store's value, `liveView-then-store` loses the token.
    expect(walked, `the second store's value must survive binder order ${order}`)
      .toContain(CREDENTIAL)
    expect(walked, `the minted liveUrl token must survive binder order ${order}`)
      .toContain(token)
  }, 180_000)
})

// 432-21 (D-12/D-13, EDGE-17): the live-view link is the one credential the run service still
// mints, and its subject and expiry are checked by the validator independently of who asked — no
// bearer, no caller field. Two tokenless mints for two concurrently started runs each bind their own
// subject: neither token opens the other run, and neither outlives its expiry.
describe('C432-RETAINED-LIVE-LINK: a tokenless mint stays bound to its own subject and expiry', () => {
  it('C432-RETAINED-LIVE-LINK: concurrent tokenless mints bind independent subjects, and expiry is enforced', async () => {
    const fixture = await openFixture('liveView-then-store')
    const [runA, runB] = await Promise.all([startRunOverTheWire(fixture), startRunOverTheWire(fixture)])
    expect(runA).not.toBe(runB)

    const mint = async (runId: string, handle: number) => {
      const response = await fetch(`${fixture.origin}/run/${encodeURIComponent(runId)}/live-url?handle=${String(handle)}`)
      expect(response.status, `the tokenless run service mints for ${runId}`).toBe(200)
      return RunsLiveUrlResultSchema.parse(await response.json())
    }
    const [mintedA, mintedB] = await Promise.all([mint(runA, 0), mint(runB, 0)])
    const tokenA = mintedA.liveUrl.split('#')[1] as string
    const tokenB = mintedB.liveUrl.split('#')[1] as string
    expect(tokenA).not.toBe(tokenB)
    const now = Date.now()

    // Each token validates for its OWN subject, and its claims name exactly that run and handle.
    const okA = fixture.validate(tokenA, { subject: { kind: 'run', id: runA }, now })
    const okB = fixture.validate(tokenB, { subject: { kind: 'run', id: runB }, now })
    if (okA.kind !== 'ok' || okB.kind !== 'ok') throw new Error(`a fresh mint did not validate: ${okA.kind}/${okB.kind}`)
    expect(okA.claims.subject).toEqual({ kind: 'run', runId: runA, handle: 0 })
    expect(okB.claims.subject).toEqual({ kind: 'run', runId: runB, handle: 0 })

    // Neither opens the other run, and neither opens an editor session of the same id.
    expect(fixture.validate(tokenA, { subject: { kind: 'run', id: runB }, now }).kind).toBe('refused')
    expect(fixture.validate(tokenB, { subject: { kind: 'run', id: runA }, now }).kind).toBe('refused')
    expect(fixture.validate(tokenA, { subject: { kind: 'editor', id: runA }, now }).kind).toBe('refused')

    // And neither outlives its expiry.
    expect(fixture.validate(tokenA, { subject: { kind: 'run', id: runA }, now: mintedA.expiresAt + 1 }))
      .toEqual({ kind: 'refused', reason: 'expired' })
    // A tampered token is refused by its signature, not by a caller check.
    const tampered = `${tokenA.slice(0, -2)}${tokenA.endsWith('AA') ? 'BB' : 'AA'}`
    expect(fixture.validate(tampered, { subject: { kind: 'run', id: runA }, now }).kind).toBe('refused')

    // SUBJECT SELECTION is the door's own check, and it stands with no credential behind it: a
    // malformed or ambiguous handle is refused by name and nothing is minted for it.
    for (const query of ['?handle=not-a-handle', '?handle=0&handle=1']) {
      const refused = await fetch(`${fixture.origin}/run/${encodeURIComponent(runA)}/live-url${query}`)
      expect(refused.status, `the door minted for ${query}`).toBe(400)
      expect(await refused.json()).toEqual({ error: 'invalid_handle' })
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
