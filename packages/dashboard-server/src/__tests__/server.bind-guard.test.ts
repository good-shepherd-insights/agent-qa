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

/** A run-service port set that is never called — only its PRESENCE and the count are read here. */
function stubRunServicePorts(): NonNullable<Parameters<typeof startServer>[0]['runService']> {
  return {
    verifyBearer: () => ({ kind: 'refused', reason: 'missing_authorization' }),
    invokeRunStart: () => { throw new Error('the bind cells never start a run') },
    attach: () => undefined,
    readiness: () => ({
      service: 'up',
      hostComposed: false,
      authConfigured: true,
      contractVersion: 1,
    }),
  } as NonNullable<Parameters<typeof startServer>[0]['runService']>
}

async function start(opts: {
  host?: string
  port?: number
  tokenCount?: number
  mountService?: boolean
}): Promise<{ server: Server; close: () => void }> {
  const db = new DashboardDatabase({ dbPath: ':memory:' })
  dbs.push(db)
  const handle = await startServer({
    db,
    port: opts.port ?? 0,
    configPath: configPathFor(),
    ...(opts.host === undefined ? {} : { host: opts.host }),
    ...(opts.tokenCount === undefined ? {} : { runServiceTokenCount: opts.tokenCount }),
    ...(opts.mountService === true ? { runService: stubRunServicePorts() } : {}),
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
