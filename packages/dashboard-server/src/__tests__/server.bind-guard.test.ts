import { afterEach, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { DashboardDatabase } from '../db/database.js'
import { DashboardRemoteBindRefusedError, startServer } from '../server/server.js'

/**
 * THE BIND CONTRACT (402-05, D-07 — INVK-03).
 *
 * The measured fact this file exists for: before 402-05 `startServer` called `server.listen(port)`
 * with no host, which binds every interface — so the dashboard's UNAUTHENTICATED run trigger was
 * reachable from any machine on the LAN. A constant-time compare on the authed `/run` door is
 * theatre while that is true, which is why the bind guard and the credential door ship in one
 * phase (the one-sided-hardening scar).
 *
 * WHAT EVERY CELL HERE ASSERTS IS THE SOCKET, NOT THE CONFIG. `server.address()` is read off the
 * LISTENING server; a cell that asserted "a default was passed" would pass under an implementation
 * that passed the default and then ignored it.
 *
 * THE REFUSAL IS PROVEN ON A GENUINELY NON-LOOPBACK HOST, BOTH WAYS. `0.0.0.0` is refused with no
 * credential declared and BOUND with one — a suite that only exercised the loopback default would
 * prove nothing about the arm D-07 exists to permit.
 */

const NON_LOOPBACK_HOST = '0.0.0.0'

let tempDir: string | undefined
const started: Array<{ close: () => void }> = []
const dbs: DashboardDatabase[] = []

afterEach(() => {
  while (started.length > 0) started.pop()?.close()
  while (dbs.length > 0) dbs.pop()?.close()
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true })
    tempDir = undefined
  }
})

function configPathFor(): string {
  tempDir = mkdtempSync(join(tmpdir(), 'agent-qa-bind-guard-'))
  const configPath = join(tempDir, 'agent-qa.config.yaml')
  writeFileSync(configPath, 'testDir: tests\n')
  return configPath
}

type ServicePorts = NonNullable<Parameters<typeof startServer>[0]['runService']>
type Readiness = NonNullable<Parameters<typeof startServer>[0]['runServiceReadiness']>

const ACCEPTED_TOKEN = 'bind-guard-fixture-token'

/**
 * A run-service port set whose readiness is INJECTED by the caller.
 *
 * The bind cells never call any of these; the readiness cells below hand in one function object
 * and then drive both doors, which is what lets an equality cell measure "the same predicate" and
 * not merely "two functions that agree today".
 */
function stubRunServicePorts(readiness: Readiness): ServicePorts {
  return {
    verifyBearer: (header: string | null | undefined) =>
      header === `Bearer ${ACCEPTED_TOKEN}`
        ? { kind: 'token', clientId: 'fixture', trustScope: {} }
        : { kind: 'refused', reason: 'invalid_token' },
    invokeRunStart: () => { throw new Error('the bind cells never start a run') },
    attach: () => undefined,
    readiness,
  } as unknown as ServicePorts
}

const INERT_READINESS: Readiness = () => ({
  service: 'up',
  hostComposed: false,
  authConfigured: true,
  contractVersion: 1,
})

async function start(opts: {
  host?: string
  port?: number
  tokenCount?: number
  mountService?: boolean
  readiness?: Readiness
}): Promise<{ server: Server; close: () => void }> {
  const db = new DashboardDatabase({ dbPath: ':memory:' })
  dbs.push(db)
  const readiness = opts.readiness ?? INERT_READINESS
  const handle = await startServer({
    db,
    port: opts.port ?? 0,
    configPath: configPathFor(),
    ...(opts.host === undefined ? {} : { host: opts.host }),
    ...(opts.tokenCount === undefined ? {} : { runServiceTokenCount: opts.tokenCount }),
    ...(opts.mountService === true ? { runService: stubRunServicePorts(readiness) } : {}),
    ...(opts.readiness === undefined ? {} : { runServiceReadiness: readiness }),
  })
  started.push(handle)
  return handle
}

/** The address the socket is actually bound to — the only evidence a bind cell may rest on. */
function boundAddress(server: Server): string {
  const address = server.address() as AddressInfo | null
  if (address === null) throw new Error('the server exposed no address — it is not listening')
  return address.address
}

/** A port nothing holds, released before it is handed on. Used to prove a refusal listened. */
async function reserveFreePort(): Promise<number> {
  const probe = createServer()
  await new Promise<void>((ok) => { probe.listen(0, '127.0.0.1', ok) })
  const { port } = probe.address() as AddressInfo
  await new Promise<void>((ok) => { probe.close(() => { ok() }) })
  return port
}

/** True when this process can bind `port` — i.e. nothing else is listening on it. */
async function portIsFree(port: number): Promise<boolean> {
  const probe = createServer()
  const free = await new Promise<boolean>((ok) => {
    probe.once('error', () => { ok(false) })
    probe.listen(port, '0.0.0.0', () => { ok(true) })
  })
  await new Promise<void>((done) => { probe.close(() => { done() }) })
  return free
}

describe('the dashboard bind contract (D-07)', () => {
  it('binds LOOPBACK by default — read off the listening socket, not off the options', async () => {
    const { server } = await start({})
    expect(boundAddress(server)).toBe('127.0.0.1')
  })

  it.each(['localhost', '127.0.0.1', '::1'])(
    'binds the loopback spelling %s with no credential declared',
    async (host) => {
      const { server } = await start({ host })
      // `localhost` resolves to whichever loopback address this host prefers; both are loopback and
      // the cell accepts either rather than pinning one machine's resolver order.
      expect(['127.0.0.1', '::1']).toContain(boundAddress(server))
    },
  )

  it('REFUSES an explicit non-loopback host when zero run-service credentials are declared', async () => {
    const port = await reserveFreePort()
    await expect(start({ host: NON_LOOPBACK_HOST, port, tokenCount: 0 }))
      .rejects.toBeInstanceOf(DashboardRemoteBindRefusedError)
    // NOTHING LISTENED. The refusal is pre-listen, so the port it was handed is still free — the
    // assertion that distinguishes "threw after binding and then tore down" from "never bound".
    await expect(portIsFree(port)).resolves.toBe(true)
  })

  it('names the host and the config key that unlocks it, and never a token value', async () => {
    const error = await start({ host: NON_LOOPBACK_HOST, tokenCount: 0 }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(DashboardRemoteBindRefusedError)
    const message = (error as Error).message
    expect(message).toContain(NON_LOOPBACK_HOST)
    expect(message).toContain('services.dashboard.runServiceTokens')
    expect(message).toContain('services.dashboard.host')
  })

  it('BINDS the same non-loopback host once a credential is declared', async () => {
    const { server } = await start({
      host: NON_LOOPBACK_HOST,
      tokenCount: 1,
      mountService: true,
    })
    expect(boundAddress(server)).toBe(NON_LOOPBACK_HOST)
  })

  it('refuses a non-loopback host that MOUNTED a service with a zero count — the count is the authority', async () => {
    await expect(start({ host: NON_LOOPBACK_HOST, tokenCount: 0, mountService: true }))
      .rejects.toBeInstanceOf(DashboardRemoteBindRefusedError)
  })
})

/**
 * THE LOCAL READINESS DOOR — ONE PREDICATE, TWO DOORS (402-05, D-15).
 *
 * The cells hand ONE function object to both `runService.readiness` (which the authed `/ok`
 * serves) and `runServiceReadiness` (which the local `/api/run-readiness` serves), then drive both
 * over a real socket. That is what makes the equality claim a claim about the PREDICATE: a fixture
 * that built two equal-looking objects would pass against two implementations that agree today and
 * drift tomorrow, which is the failure D-15 exists to prevent.
 */
describe('the local readiness door (D-15)', () => {
  /** A readiness whose facts MOVE, so a door that snapshotted rather than called is visible. */
  function movingReadiness(): { fn: Readiness; flip: () => void } {
    let hostComposed = false
    return {
      fn: () => ({
        service: 'up' as const,
        hostComposed,
        authConfigured: true,
        contractVersion: 7,
      }),
      flip: () => { hostComposed = true },
    }
  }

  async function get(port: number, path: string, token?: string): Promise<{
    status: number
    body: unknown
  }> {
    const response = await fetch(`http://127.0.0.1:${String(port)}${path}`, {
      headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
    })
    return { status: response.status, body: await response.json().catch(() => undefined) }
  }

  it('serves the SAME body the authed /ok serves, for one composed state, under both doors', async () => {
    const { fn, flip } = movingReadiness()
    const { server } = await start({ mountService: true, tokenCount: 1, readiness: fn })
    const port = (server.address() as AddressInfo).port

    const before = await Promise.all([
      get(port, '/api/run-readiness'),
      get(port, '/ok', ACCEPTED_TOKEN),
    ])
    expect(before[0].status).toBe(200)
    expect(before[1].status).toBe(200)
    expect(before[0].body).toEqual(before[1].body)
    expect(before[0].body).toEqual({
      service: 'up',
      hostComposed: false,
      authConfigured: true,
      contractVersion: 7,
    })

    // THE STATE MOVES. Both doors must move with it — a door that answered from a value captured
    // at mount time would now disagree, and the equality above alone could not see that.
    flip()
    const after = await Promise.all([
      get(port, '/api/run-readiness'),
      get(port, '/ok', ACCEPTED_TOKEN),
    ])
    expect(after[0].body).toEqual(after[1].body)
    expect(after[0].body).toMatchObject({ hostComposed: true })
  })

  it('answers the LOCAL door with no token at all — the bind guard is what keeps it local', async () => {
    const { fn } = movingReadiness()
    const { server } = await start({ mountService: true, tokenCount: 1, readiness: fn })
    const port = (server.address() as AddressInfo).port

    // No Authorization header anywhere. The authed door refuses the identical question.
    await expect(get(port, '/api/run-readiness')).resolves.toMatchObject({ status: 200 })
    await expect(get(port, '/ok')).resolves.toMatchObject({ status: 401 })
  })

  it('answers honestly with NO run service mounted — never a 404', async () => {
    // The shipped no-credential arm: the service is not mounted, and the composition still hands
    // over the SAME producer with a zero count. The browser preflight gets a readable answer.
    const { server } = await start({
      readiness: () => ({
        service: 'up',
        hostComposed: true,
        authConfigured: false,
        contractVersion: 7,
      }),
    })
    const port = (server.address() as AddressInfo).port
    const local = await get(port, '/api/run-readiness')
    expect(local.status).toBe(200)
    expect(local.body).toMatchObject({ authConfigured: false })
    // …and the authed door genuinely is not mounted on this arm.
    await expect(get(port, '/ok', ACCEPTED_TOKEN)).resolves.toMatchObject({ status: 404 })
  })

  it('answers 503 BY NAME on a mount that was given no predicate — not a fabricated answer', async () => {
    const { server } = await start({})
    const port = (server.address() as AddressInfo).port
    await expect(get(port, '/api/run-readiness')).resolves.toMatchObject({ status: 503 })
  })
})
