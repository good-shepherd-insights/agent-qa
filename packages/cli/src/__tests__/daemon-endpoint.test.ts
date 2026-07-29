import { spawn } from 'node:child_process'
import { once } from 'node:events'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { invokeFunction } from '@vostride/agent-qa-agent'
import type { ConfigReaderPort, JobModelCapability } from '@vostride/agent-qa-agent'
import { composeLocalAgent } from '@vostride/agent-qa-agent-local'
import type { LocalAgentHost } from '@vostride/agent-qa-agent-local'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { invokeViaDaemon } from '../daemon/client.js'
import {
  DAEMON_SOCKET_PATH_BUDGET_BYTES,
  DAEMON_FUNCTION_CALLER,
  DaemonSocketInUseError,
  startInvokeServer,
  type InvokeServerHandle,
} from '../daemon/server.js'
import {
  runDaemonHost,
  type DaemonHostOperations,
} from '../daemon/host.js'
import {
  DAEMON_REGISTRATION_SCHEMA_VERSION,
  readDaemonRegistration,
  writeDaemonRegistration,
} from '../daemon/registration.js'

const roots: string[] = []
const hosts: LocalAgentHost[] = []
const servers: InvokeServerHandle[] = []

const MASKED_CONFIG = {
  schemaVersion: 1 as const,
  configPath: '/fixture/agent-qa.config.yaml',
  entries: [{ key: 'use.llm', value: 'default', source: 'config-file' as const, masked: false }],
}

const TEST_CONFIG: ConfigReaderPort = {
  getMasked: () => Promise.resolve(MASKED_CONFIG),
}

const TEST_MODEL: JobModelCapability = {
  modelId: 'test:daemon-endpoint',
  generate: () => Promise.resolve({ text: 'unused' }),
}

function temporaryRoot(label: string): string {
  // Keep direct-socket fixtures below Darwin's shorter sun_path limit. The deep-path case below
  // deliberately grows from this short base to prove the production fallback.
  const base = process.platform === 'win32' ? tmpdir() : '/tmp'
  const root = mkdtempSync(join(base, `agent-qa-daemon-endpoint-${label}-`))
  roots.push(root)
  return root
}

function localHost(agentQaRoot: string, knowledgeRoot: string): LocalAgentHost {
  const host = composeLocalAgent({
    agentQaRoot,
    config: TEST_CONFIG,
    knowledgeRoot: () => knowledgeRoot,
    model: () => TEST_MODEL,
  })
  hosts.push(host)
  return host
}

function register(agentQaRoot: string, socketPath: string): void {
  writeDaemonRegistration(agentQaRoot, {
    schemaVersion: DAEMON_REGISTRATION_SCHEMA_VERSION,
    pid: process.pid,
    socketPath,
    startedAtMs: Date.now(),
  })
}

async function waitFor<T>(
  operation: () => Promise<T>,
  message: string,
  timeoutMs = 10_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      return await operation()
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  }
  throw new Error(`${message}: ${lastError instanceof Error ? lastError.message : String(lastError)}`)
}

function signalHarness(): {
  operations: Partial<DaemonHostOperations>
  signal(signal: NodeJS.Signals): void
} {
  const signals = new Map<NodeJS.Signals, () => void>()
  return {
    operations: {
      onSignal: (signal, listener) => signals.set(signal, listener),
      offSignal: (signal, listener) => {
        if (signals.get(signal) === listener) signals.delete(signal)
      },
    },
    signal(signal) {
      const listener = signals.get(signal)
      if (listener === undefined) throw new Error(`${signal} listener was not installed`)
      listener()
    },
  }
}

afterEach(async () => {
  vi.restoreAllMocks()
  for (const server of servers.splice(0)) await server.close()
  for (const host of hosts.splice(0)) host.close()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('daemon /invoke endpoint tracer', () => {
  it('keeps invokeFunction as the route module\'s only dispatch call', () => {
    const source = readFileSync(new URL('../daemon/server.ts', import.meta.url), 'utf8')
    expect(source.match(/\binvokeFunction\s*\(/g)).toHaveLength(1)
  })

  it('matches in-process invocation through the registered over-budget fallback socket', async () => {
    const root = temporaryRoot('deep')
    const projectRoot = join(root, 'x'.repeat(64), 'y'.repeat(64))
    const agentQaRoot = join(projectRoot, '.agent-qa')
    const knowledgeRoot = join(projectRoot, 'agent-qa-knowledge')
    mkdirSync(projectRoot, { recursive: true })

    const comparison = localHost(join(root, 'comparison-runtime'), join(root, 'comparison-knowledge'))
    const expected = await invokeFunction(
      comparison.registry,
      'config.get',
      {},
      DAEMON_FUNCTION_CALLER,
    )

    const harness = signalHarness()
    const running = runDaemonHost({
      agentQaRoot,
      knowledgeRoot,
      config: TEST_CONFIG,
      model: () => TEST_MODEL,
      operations: harness.operations,
      logger: { info: vi.fn(), error: vi.fn() },
    })

    const actual = await waitFor(
      () => invokeViaDaemon({ agentQaRoot, functionId: 'config.get', input: {} }),
      'daemon invocation never became reachable',
    )
    expect(actual).toEqual(expected)

    const registration = readDaemonRegistration(agentQaRoot)
    expect(registration.kind).toBe('parsed')
    if (registration.kind !== 'parsed') throw new Error('expected parsed daemon registration')
    expect(Buffer.byteLength(registration.registration.socketPath, 'utf8')).toBeLessThanOrEqual(
      DAEMON_SOCKET_PATH_BUDGET_BYTES,
    )
    expect(registration.registration.socketPath.startsWith(agentQaRoot)).toBe(false)
    expect(registration.registration.socketPath.startsWith(tmpdir())).toBe(true)

    harness.signal('SIGTERM')
    await expect(running).resolves.toBe(0)
    expect(existsSync(registration.registration.socketPath)).toBe(false)
  })

  it('recovers a stale plain-file endpoint and serves the one versioned route', async () => {
    const root = temporaryRoot('plain-file')
    const agentQaRoot = join(root, '.agent-qa')
    const socketPath = join(agentQaRoot, 'daemon.sock')
    mkdirSync(agentQaRoot, { recursive: true })
    writeFileSync(socketPath, 'stale endpoint', 'utf8')

    const host = localHost(agentQaRoot, join(root, 'agent-qa-knowledge'))
    register(agentQaRoot, socketPath)
    const server = await startInvokeServer({ socketPath, registry: host.registry })
    servers.push(server)

    await expect(invokeViaDaemon({
      agentQaRoot,
      functionId: 'config.get',
      input: {},
    })).resolves.toEqual(MASKED_CONFIG)
    expect(readFileSync(join(agentQaRoot, 'execution_audit.jsonl'), 'utf8')).toContain('config.get')
  })

  it.runIf(process.platform !== 'win32')('recovers a dead Unix socket left by a crashed process', async () => {
    const root = temporaryRoot('dead-socket')
    const agentQaRoot = join(root, '.agent-qa')
    const socketPath = join(agentQaRoot, 'daemon.sock')
    mkdirSync(agentQaRoot, { recursive: true })

    const child = spawn(process.execPath, [
      '--input-type=module',
      '--eval',
      `import net from 'node:net'; net.createServer().listen(${JSON.stringify(socketPath)}, () => process.stdout.write('ready\\n'))`,
    ], { stdio: ['ignore', 'pipe', 'pipe'] })
    if (child.stdout === null) throw new Error('child stdout was not piped')
    await once(child.stdout, 'data')
    child.kill('SIGKILL')
    await once(child, 'exit')
    expect(existsSync(socketPath)).toBe(true)

    const host = localHost(agentQaRoot, join(root, 'agent-qa-knowledge'))
    register(agentQaRoot, socketPath)
    const server = await startInvokeServer({ socketPath, registry: host.registry })
    servers.push(server)

    await expect(invokeViaDaemon({
      agentQaRoot,
      functionId: 'config.get',
      input: {},
    })).resolves.toEqual(MASKED_CONFIG)
  })

  it('refuses to unlink or replace a live listener', async () => {
    const root = temporaryRoot('live-listener')
    const agentQaRoot = join(root, '.agent-qa')
    const socketPath = join(agentQaRoot, 'daemon.sock')
    const host = localHost(agentQaRoot, join(root, 'agent-qa-knowledge'))
    const first = await startInvokeServer({ socketPath, registry: host.registry })
    servers.push(first)

    await expect(startInvokeServer({ socketPath, registry: host.registry }))
      .rejects.toBeInstanceOf(DaemonSocketInUseError)
    expect(existsSync(socketPath)).toBe(true)
  })
})
