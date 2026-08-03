// The PARENT side of the post-run daemon proofs (Phase 388 plan 06, SC4).
//
// Deliberately the 385 kill-matrix / 386 socket-takeover protocol rather than a third one: a real
// daemon generation, a real unix socket, a real writer lease, a real SIGKILL, and every fact the
// leg depends on observed rather than assumed. Nothing here knows anything about post-processing;
// it is about processes, markers and signals only, which is why it can be shared by both SC4
// suites without either of them learning how the other drives the chain.
//
// Four facts a leg needs from this module, each a function rather than an inline assertion:
//
//   1. THE CHILD REACHED ITS POINT. `waitForMarker` polls for an atomically published marker and
//      aborts THE MOMENT the child exits, with the child's captured output attached — otherwise
//      "the daemon never claimed the job" spends ninety seconds pretending to be flake.
//   2. THE CHILD WAS ALIVE WHEN THE SIGNAL WENT OUT. Killing a process that already finished is a
//      call that does nothing and reports success.
//   3. IT DIED BY THE SIGNAL. `{code: null, signal: 'SIGKILL'}` as an equality on the pair: a
//      graceful exit is `{code: 0, signal: null}` and must not pass for a crash proof.
//   4. THE PID IS GONE. `pidIsAlive` reads the kernel's answer, because the whole lease-vs-PID
//      claim is that a dead pid does NOT make a fresh lease reclaimable.

import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect } from 'vitest'

const PACKAGE_ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const JITI = join(PACKAGE_ROOT, 'node_modules', '.bin', 'jiti')
const DAEMON_FIXTURE = fileURLToPath(new URL('./daemon.fixture.ts', import.meta.url))

/** Generous on purpose: these legs spawn real processes and wait out a real 30s lease TTL. */
export const LEG_TIMEOUT_MS = 300_000
export const MARKER_TIMEOUT_MS = 120_000

export const POST_RUN_DAEMON_ENV = {
  role: 'AGENT_QA_POST_RUN_DAEMON_ROLE',
  root: 'AGENT_QA_POST_RUN_DAEMON_ROOT',
  generation: 'AGENT_QA_POST_RUN_DAEMON_GENERATION',
  readyMarker: 'AGENT_QA_POST_RUN_DAEMON_READY',
  report: 'AGENT_QA_POST_RUN_DAEMON_REPORT',
  /**
   * The file the daemon-side `curate-memory` fold publishes the instant it is ENTERED.
   *
   * This is what makes the kill land between the two chain stages rather than somewhere a sleep
   * happened to put it: by the time these bytes exist, `analyze-run`'s `completeAndChain`
   * transaction has committed and `curate-memory` is claimed and inside its handler.
   */
  enteredMarker: 'AGENT_QA_POST_RUN_DAEMON_ENTERED',
  /** The fold returns only once this file exists. Absent ⇒ the fold parks until it is killed. */
  gate: 'AGENT_QA_POST_RUN_DAEMON_GATE',
} as const

export type DaemonGeneration = 'first' | 'restarted'

export interface PostRunDaemonPaths {
  readonly root: string
  readonly agentQaRoot: string
  readonly knowledgeRoot: string
  readonly gate: string
  readonly enteredMarker: Record<DaemonGeneration, string>
  readonly readyMarker: Record<DaemonGeneration, string>
  readonly report: Record<DaemonGeneration, string>
}

const temporaryRoots: string[] = []

export function makePostRunDaemonRoot(label: string): PostRunDaemonPaths {
  const root = mkdtempSync(join(tmpdir(), `agent-qa-388-06-${label}-`))
  temporaryRoots.push(root)
  const paths: PostRunDaemonPaths = {
    root,
    agentQaRoot: join(root, '.agent-qa'),
    knowledgeRoot: join(root, 'agent-qa-knowledge'),
    gate: join(root, 'curation.gate'),
    enteredMarker: {
      first: join(root, 'first.curation-entered.json'),
      restarted: join(root, 'restarted.curation-entered.json'),
    },
    readyMarker: {
      first: join(root, 'first.ready.json'),
      restarted: join(root, 'restarted.ready.json'),
    },
    report: {
      first: join(root, 'first.report.json'),
      restarted: join(root, 'restarted.report.json'),
    },
  }
  mkdirSync(paths.agentQaRoot, { recursive: true })
  mkdirSync(paths.knowledgeRoot, { recursive: true })
  return paths
}

export function cleanupPostRunDaemonRoots(): void {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true })
}

export interface RunningDaemon {
  readonly child: ChildProcess
  readonly generation: DaemonGeneration
  output(): string
}

const running: ChildProcess[] = []

export function startPostRunDaemon(
  generation: DaemonGeneration,
  paths: PostRunDaemonPaths,
): RunningDaemon {
  const child = spawn(JITI, [DAEMON_FIXTURE], {
    cwd: PACKAGE_ROOT,
    env: {
      ...process.env,
      [POST_RUN_DAEMON_ENV.role]: 'daemon',
      [POST_RUN_DAEMON_ENV.root]: paths.root,
      [POST_RUN_DAEMON_ENV.generation]: generation,
      [POST_RUN_DAEMON_ENV.readyMarker]: paths.readyMarker[generation],
      [POST_RUN_DAEMON_ENV.report]: paths.report[generation],
      [POST_RUN_DAEMON_ENV.enteredMarker]: paths.enteredMarker[generation],
      [POST_RUN_DAEMON_ENV.gate]: paths.gate,
      AGENT_QA_MODEL_CACHE_DIR: join(paths.root, 'empty-model-cache'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  running.push(child)
  if (child.stdout === null || child.stderr === null) {
    throw new Error('post-run daemon child pipes were not created')
  }
  let captured = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => { captured += chunk })
  child.stderr.on('data', (chunk: string) => { captured += chunk })
  return { child, generation, output: () => captured }
}

export async function killIfRunning(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = once(child, 'exit')
  child.kill('SIGKILL')
  await exited
}

export async function stopAllPostRunDaemons(): Promise<void> {
  for (const child of running.splice(0)) await killIfRunning(child)
}

export async function waitForMarker(
  daemon: RunningDaemon,
  markerPath: string,
  selector: string,
  timeoutMs = MARKER_TIMEOUT_MS,
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs
  while (!existsSync(markerPath)) {
    if (daemon.child.exitCode !== null || daemon.child.signalCode !== null) {
      throw new Error(
        `the ${daemon.generation} daemon exited before ${selector}:\n${daemon.output()}`,
      )
    }
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${selector}:\n${daemon.output()}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  return JSON.parse(readFileSync(markerPath, 'utf8')) as Record<string, unknown>
}

/** Poll a predicate the parent can evaluate itself (durable rows, file bytes). */
export async function waitUntil(
  predicate: () => boolean | Promise<boolean>,
  message: string,
  timeoutMs = MARKER_TIMEOUT_MS,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (await predicate()) return
    if (Date.now() > deadline) throw new Error(message)
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

/**
 * The kill, proven rather than assumed (the 385 `sendRealSigkill` contract, verbatim in intent).
 *
 * Liveness is asserted BEFORE the signal, and the exit is required to be a signal death rather
 * than any non-zero status — a daemon that shut down gracefully would otherwise satisfy a crash
 * proof by having politely released its lease and finished its chain.
 */
export async function sendRealSigkill(child: ChildProcess): Promise<void> {
  expect(child.exitCode, 'the daemon must still be running when the signal is sent').toBeNull()
  expect(child.signalCode).toBeNull()
  const exited = once(child, 'exit')
  expect(child.kill('SIGKILL')).toBe(true)
  const [code, signal] = (await exited) as [number | null, string | null]
  expect({ code, signal }).toEqual({ code: null, signal: 'SIGKILL' })
}

/** The kernel's own answer, so "the holder's process is gone" is never inferred from bookkeeping. */
export function pidIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false
    if ((error as NodeJS.ErrnoException).code === 'EPERM') return true
    throw error
  }
}
