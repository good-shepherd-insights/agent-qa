import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { createServer, type Server, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  LEASE_FILE,
  LEASE_HEARTBEAT_TTL_MS,
  LEASE_RENEWAL_FILE,
} from '@vostride/agent-qa-knowledge-local'
import { afterAll, afterEach, describe, expect, test } from 'vitest'

import { readDrainSessionReceipts } from '../daemon/drain-receipts.js'
import {
  DAEMON_REGISTRATION_SCHEMA_VERSION,
  daemonRegistrationPath,
  writeDaemonRegistration,
} from '../daemon/registration.js'
import {
  enqueueRealCandidate,
  invokeDrain,
  writeWorkspaceConfig,
} from './drain-recovery/fixtures.js'
import { readJson } from './fencing/spawn-helpers.js'
import {
  cleanupTakeoverRoots,
  killIfRunning,
  makeRoot,
  processStateFromOs,
  startDaemonChild,
  waitForMarker,
} from './socket-takeover/spawn-helpers.js'

const describePosix = process.platform === 'win32' ? describe.skip : describe

/** The stopped leg pays a real TTL plus a two-minute pre-fix daemon wait; budget for both. */
const RECOVERY_LEG_TIMEOUT_MS = 300_000

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false
    if ((error as NodeJS.ErrnoException).code === 'EPERM') return true
    throw error
  }
}

/**
 * Bind a listener that accepts and never answers, at an address short enough to bind.
 *
 * A per-project socket under a `mkdtemp` root plus this suite's own label overruns darwin's
 * 104-byte `sun_path` budget, so the wedged-daemon address gets its own shallow directory.
 */
function bindUnansweringSocket(
  accepted: Socket[],
): { socketPath: string; server: Server; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'aq-wedge-'))
  // Accept and never answer. The accepted connections are held so cleanup can destroy them;
  // net.Server has no closeAllConnections, so close() alone would wait on them forever.
  const server = createServer((socket) => { accepted.push(socket) })
  return { dir, socketPath: join(dir, 'd.sock'), server }
}

function readEpoch(knowledgeRoot: string): number {
  return Number(readFileSync(join(knowledgeRoot, '.epoch'), 'utf8').trim())
}

function plantLease(
  knowledgeRoot: string,
  lease: { leaseId: string; pid: number; epoch: number; heartbeatAtMs: number },
): void {
  mkdirSync(knowledgeRoot, { recursive: true })
  writeFileSync(join(knowledgeRoot, '.epoch'), `${lease.epoch}\n`, 'utf8')
  writeFileSync(join(knowledgeRoot, LEASE_FILE), `${JSON.stringify(lease)}\n`, 'utf8')
}

describePosix('knowledge drain recovery across unreachable daemon hosts (CR-08)', () => {
  const surrogates: ChildProcess[] = []
  const servers: Server[] = []
  const socketDirs: string[] = []
  const acceptedSockets: Socket[] = []

  afterEach(async () => {
    for (const surrogate of surrogates.splice(0)) {
      if (surrogate.exitCode === null && surrogate.signalCode === null) {
        const exited = once(surrogate, 'exit')
        surrogate.kill('SIGKILL')
        await exited
      }
    }
    for (const socket of acceptedSockets.splice(0)) socket.destroy()
    for (const server of servers.splice(0)) {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
    for (const dir of socketDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  afterAll(cleanupTakeoverRoots)

  test(
    'drains through the inline successor when the registered daemon is SIGSTOPped past the lease TTL',
    async () => {
      const paths = makeRoot('sigstop')
      const configPath = writeWorkspaceConfig(paths.root)
      const daemon = startDaemonChild('predecessor', paths)

      try {
        await waitForMarker(daemon, paths.readyMarker.predecessor, 'daemon readiness')
        const ready = readJson(paths.readyMarker.predecessor)
        expect(ready).toMatchObject({ ready: true, pid: daemon.child.pid })
        const daemonPid = daemon.child.pid!
        const daemonInstanceId = ready.instanceId as string
        const epochUnderDaemon = readEpoch(paths.knowledgeRoot)

        // Stop the whole host before any work arrives, so the queued candidate is only ever
        // drainable by whoever recovers the registration.
        expect(daemon.child.kill('SIGSTOP')).toBe(true)
        await new Promise((resolve) => setTimeout(resolve, 250))
        expect(processStateFromOs(daemonPid)).toContain('T')

        const candidateId = enqueueRealCandidate(paths.knowledgeRoot, 'sigstop-remainder')
        await new Promise((resolve) => setTimeout(resolve, LEASE_HEARTBEAT_TTL_MS + 1_500))
        expect(processStateFromOs(daemonPid)).toContain('T')

        const result = await invokeDrain(configPath)

        // The command completed the work itself rather than reporting an unreachable daemon.
        expect(result.stderr).toBe('')
        expect(result.exitCode).toBeUndefined()
        expect(result.stdout).toContain('Knowledge curation queue drained inline')
        expect(result.stdout).toContain('remaining 0')

        // Exactly the classified generation was removed, and the lease was arbitrated inline.
        expect(existsSync(daemonRegistrationPath(paths.agentQaRoot))).toBe(false)
        expect(daemonInstanceId).toMatch(/^[0-9a-f-]{36}$/)
        expect(readEpoch(paths.knowledgeRoot)).toBeGreaterThan(epochUnderDaemon)

        // The receipt chain names the inline session that actually did the work.
        expect(readDrainSessionReceipts(paths.agentQaRoot)).toEqual([
          expect.objectContaining({
            holderPid: process.pid,
            candidateIds: [candidateId],
            remainingAfter: 0,
            outcome: 'completed',
            failures: 0,
            quarantined: 0,
          }),
        ])

        // Recovery cost the stopped host nothing: it is still exactly where it was left.
        expect(processStateFromOs(daemonPid)).toContain('T')
        expect(isAlive(daemonPid)).toBe(true)
        expect(daemon.child.exitCode).toBeNull()
        expect(daemon.child.signalCode).toBeNull()
      } finally {
        await killIfRunning(daemon.child)
      }
    },
    RECOVERY_LEG_TIMEOUT_MS,
  )

  test(
    'drains inline through a reused-pid registration and never signals the unrelated occupant',
    async () => {
      const paths = makeRoot('reused')
      const configPath = writeWorkspaceConfig(paths.root)
      mkdirSync(paths.agentQaRoot, { recursive: true })

      // An unrelated process that inherited the dead daemon's pid. It never touches the queue,
      // the lease, or the socket — it merely occupies the number the registration records.
      const surrogate = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1_000)'], {
        stdio: ['ignore', 'ignore', 'ignore'],
      })
      surrogates.push(surrogate)
      await new Promise((resolve) => setTimeout(resolve, 150))
      const surrogatePid = surrogate.pid!
      expect(isAlive(surrogatePid)).toBe(true)

      const instanceId = randomUUID()
      writeDaemonRegistration(paths.agentQaRoot, {
        schemaVersion: DAEMON_REGISTRATION_SCHEMA_VERSION,
        instanceId,
        pid: surrogatePid,
        // The dead generation's address; nothing listens there any more.
        socketPath: join(paths.agentQaRoot, `daemon-${instanceId.slice(0, 12)}.sock`),
        startedAtMs: Date.now() - 600_000,
      })
      plantLease(paths.knowledgeRoot, {
        leaseId: randomUUID(),
        pid: surrogatePid,
        epoch: 4,
        heartbeatAtMs: Date.now() - (LEASE_HEARTBEAT_TTL_MS * 4),
      })
      const candidateId = enqueueRealCandidate(paths.knowledgeRoot, 'reused-pid-remainder')

      const result = await invokeDrain(configPath)

      expect(result.stderr).toBe('')
      expect(result.exitCode).toBeUndefined()
      expect(result.stdout).toContain('Knowledge curation queue drained inline')
      expect(result.stdout).toContain('remaining 0')
      expect(existsSync(daemonRegistrationPath(paths.agentQaRoot))).toBe(false)
      expect(readEpoch(paths.knowledgeRoot)).toBe(5)
      expect(readDrainSessionReceipts(paths.agentQaRoot)).toEqual([
        expect.objectContaining({
          holderPid: process.pid,
          epoch: 5,
          candidateIds: [candidateId],
          remainingAfter: 0,
          outcome: 'completed',
        }),
      ])

      // The occupant of the recorded pid was never a target.
      expect(isAlive(surrogatePid)).toBe(true)
      expect(surrogate.exitCode).toBeNull()
      expect(surrogate.signalCode).toBeNull()
    },
    RECOVERY_LEG_TIMEOUT_MS,
  )

  test(
    'refuses to recover a daemon whose renewal sidecar is fresh and names the holder instead',
    async () => {
      const paths = makeRoot('fresh')
      const configPath = writeWorkspaceConfig(paths.root)
      mkdirSync(paths.agentQaRoot, { recursive: true })

      // A daemon inside a long governed mutation: its socket accepts the connection but its
      // blocked loop never answers the identity handshake, and its lease FILE has aged out.
      const { dir, socketPath, server } = bindUnansweringSocket(acceptedSockets)
      socketDirs.push(dir)
      servers.push(server)
      await new Promise<void>((resolve) => server.listen(socketPath, resolve))

      const leaseId = randomUUID()
      const holderPid = process.pid
      plantLease(paths.knowledgeRoot, {
        leaseId,
        pid: holderPid,
        epoch: 9,
        heartbeatAtMs: Date.now() - (LEASE_HEARTBEAT_TTL_MS * 2),
      })
      // 386-29's sidecar: renewal is alive even though the lease file could not be rewritten.
      writeFileSync(
        join(paths.knowledgeRoot, LEASE_RENEWAL_FILE),
        `${JSON.stringify({ leaseId, heartbeatAtMs: Date.now() })}\n`,
        'utf8',
      )
      writeDaemonRegistration(paths.agentQaRoot, {
        schemaVersion: DAEMON_REGISTRATION_SCHEMA_VERSION,
        instanceId: randomUUID(),
        pid: holderPid,
        socketPath,
        startedAtMs: Date.now() - 60_000,
      })
      enqueueRealCandidate(paths.knowledgeRoot, 'fresh-holder-remainder')
      const registrationBefore = readFileSync(daemonRegistrationPath(paths.agentQaRoot))
      const leaseBefore = readFileSync(join(paths.knowledgeRoot, LEASE_FILE))

      const result = await invokeDrain(configPath)

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('writer-lease-held')
      expect(result.stderr).toContain(`pid ${holderPid}`)
      expect(result.stderr).toContain(leaseId)

      // Nothing was stolen, removed, or drained.
      expect(readFileSync(daemonRegistrationPath(paths.agentQaRoot))).toEqual(registrationBefore)
      expect(readFileSync(join(paths.knowledgeRoot, LEASE_FILE))).toEqual(leaseBefore)
      expect(readEpoch(paths.knowledgeRoot)).toBe(9)
      expect(readDrainSessionReceipts(paths.agentQaRoot)).toEqual([])
    },
    RECOVERY_LEG_TIMEOUT_MS,
  )

  test(
    'still recovers when the renewal sidecar names a superseded lease',
    async () => {
      const paths = makeRoot('sidecar')
      const configPath = writeWorkspaceConfig(paths.root)
      mkdirSync(paths.agentQaRoot, { recursive: true })

      const { dir, socketPath, server } = bindUnansweringSocket(acceptedSockets)
      socketDirs.push(dir)
      servers.push(server)
      await new Promise<void>((resolve) => server.listen(socketPath, resolve))

      plantLease(paths.knowledgeRoot, {
        leaseId: randomUUID(),
        pid: process.pid,
        epoch: 2,
        heartbeatAtMs: Date.now() - (LEASE_HEARTBEAT_TTL_MS * 2),
      })
      // Drawn from OUTSIDE the freshness precondition: a leftover sidecar from an older lease
      // extends nothing, so this registration stays recoverable.
      writeFileSync(
        join(paths.knowledgeRoot, LEASE_RENEWAL_FILE),
        `${JSON.stringify({ leaseId: randomUUID(), heartbeatAtMs: Date.now() })}\n`,
        'utf8',
      )
      writeDaemonRegistration(paths.agentQaRoot, {
        schemaVersion: DAEMON_REGISTRATION_SCHEMA_VERSION,
        instanceId: randomUUID(),
        pid: process.pid,
        socketPath,
        startedAtMs: Date.now() - 60_000,
      })
      enqueueRealCandidate(paths.knowledgeRoot, 'superseded-sidecar-remainder')

      const result = await invokeDrain(configPath)

      expect(result.stderr).toBe('')
      expect(result.exitCode).toBeUndefined()
      expect(result.stdout).toContain('Knowledge curation queue drained inline')
      expect(result.stdout).toContain('remaining 0')
      expect(existsSync(daemonRegistrationPath(paths.agentQaRoot))).toBe(false)
      expect(readEpoch(paths.knowledgeRoot)).toBe(3)
    },
    RECOVERY_LEG_TIMEOUT_MS,
  )
})
