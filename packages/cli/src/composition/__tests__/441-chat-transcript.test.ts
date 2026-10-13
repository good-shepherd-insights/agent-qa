// C441-CHAT (441 D-06, D-19, folded 399.1): a declared value typed in chat is stored as
// `[secret:<name>]`; an undeclared credential is stored as typed.

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { AGENT_ASK_FUNCTION_ID, invokeFunction } from '@vostride/agent-qa-agent'
import type { JobModelCapability } from '@vostride/agent-qa-agent'
import type { ComposeLocalAgentInput } from '@vostride/agent-qa-agent-local'
import type { AgentAskResult, MaskFn } from '@vostride/agent-qa-schema'
import { runSafetyScope } from '@vostride/agent-qa-safety-local'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { runDaemonHost, type DaemonHostOperations } from '../../daemon/host.js'
import { CLI_FUNCTION_CALLER, composeCliLocalAgent } from '../local-agent-host.js'

const DECLARED = 'Hunter-42-zz'
const MARKER = '[secret:PW_441]'
const UNDECLARED = 'sk-PROBE-123456'
const TYPED = `use ${DECLARED} with ${UNDECLARED}`
const MESSAGE = `/fn knowledge.record.show ${JSON.stringify({ recordId: TYPED })}`

const CONFIG = `workspace:
  testMatch:
    - tests/**/*.yaml
  suiteMatch:
    - suites/**/*.suite.yaml
  hooksFile: hooks.yaml
  envFile: .env
  secretsFile: .env.secrets.local

registry:
  llms:
    - name: judge
      provider: openai-subscription
      model: gpt-5.6-terra

use:
  llm: judge
  mobile:
    appState: preserve
  parallel: false
`

interface SessionEvent {
  readonly kind: string
  readonly text?: string
  readonly clause?: string
  readonly payload?: unknown
}

let root: string
let configPath: string
let agentQaRoot: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'c441-chat-'))
  configPath = join(root, 'agent-qa.config.yaml')
  agentQaRoot = join(root, '.agent-qa')
  mkdirSync(agentQaRoot, { recursive: true })
  writeFileSync(configPath, CONFIG)
  writeFileSync(join(root, '.env.secrets.local'), `PW_441=${DECLARED}\n`)
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

async function typeInChat(): Promise<AgentAskResult> {
  const host = composeCliLocalAgent({ agentQaRoot, configPath })
  try {
    return await runSafetyScope(
      { executionContext: 'local-interactive' },
      async () => await invokeFunction(
        host.registry, AGENT_ASK_FUNCTION_ID, { message: MESSAGE }, CLI_FUNCTION_CALLER,
      ) as AgentAskResult,
    )
  } finally {
    await host.close()
  }
}

function sessionBytes(): string {
  const dir = join(agentQaRoot, 'sessions')
  if (!existsSync(dir)) return ''
  return readdirSync(dir).filter((name) => name.endsWith('.jsonl'))
    .map((name) => readFileSync(join(dir, name), 'utf8')).join('')
}

function sessionEvents(kind: string): SessionEvent[] {
  return sessionBytes().split('\n').filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as SessionEvent)
    .filter((event) => event.kind === kind)
}

const DAEMON_MODEL: JobModelCapability = {
  modelId: 'test:c441-chat-daemon',
  generate: () => Promise.reject(new Error('the daemon cells never author')),
}

async function daemonMask(withConfigPath: boolean): Promise<MaskFn | undefined> {
  const signals = new Map<NodeJS.Signals, () => void>()
  const errors: string[] = []
  let composed: ComposeLocalAgentInput | undefined
  const operations = {
    setInterval: () => 1 as unknown as ReturnType<typeof setInterval>,
    clearInterval: () => undefined,
    setTimeout: () => 2 as unknown as ReturnType<typeof setTimeout>,
    clearTimeout: () => undefined,
    onSignal: (signal: NodeJS.Signals, listener: () => void) => { signals.set(signal, listener) },
    offSignal: (signal: NodeJS.Signals, listener: () => void) => {
      if (signals.get(signal) === listener) signals.delete(signal)
    },
    hardExit: (code: number) => { throw new Error(`unexpected hard exit ${code}`) },
    startHeartbeatSupervisor: () => Promise.resolve({
      exited: Promise.resolve(), stop: () => Promise.resolve(),
    }),
    composeJobRecovery: () => ({
      store: { adoptEpoch: () => Promise.resolve({ epoch: 1 }) },
      recoverAbandonedClaims: () => Promise.resolve({ recovered: 0 }),
      resumePending: () => Promise.resolve([]),
      close: vi.fn(),
    }),
    composeLocalAgent: (input: ComposeLocalAgentInput) => {
      composed = input
      return {
        registry: {},
        jobs: () => Promise.resolve({
          queue: { runNextJob: () => Promise.resolve({ ran: false, reason: 'no-job' }) },
        }),
        close: vi.fn(),
      }
    },
    inspectDrainableCurationWork: () => ({ queuedCandidateIds: [], recoverableClaimedCandidateIds: [] }),
    countRemainingCurationWork: () => ({ queued: 0, claimedNonterminal: 0, quarantined: 0 }),
    listQueuedCandidates: () => [],
    drainQueue: () => Promise.resolve({ drained: 0 }),
    appendDrainSessionReceipt: () => undefined,
    startInvokeServer: (started: { socketPath: string }) => Promise.resolve({
      socketPath: started.socketPath, close: () => Promise.resolve(),
    }),
  } as unknown as Partial<DaemonHostOperations>

  const running = runDaemonHost({
    agentQaRoot,
    knowledgeRoot: join(root, 'agent-qa-knowledge'),
    ...(withConfigPath ? { configPath } : {}),
    config: {
      getMasked: () => Promise.resolve({ schemaVersion: 1, configPath, entries: [] }),
    },
    model: () => DAEMON_MODEL,
    operations,
    logger: { info: vi.fn(), error: (message) => errors.push(message) },
  })
  const deadline = Date.now() + 30_000
  while (composed === undefined || !signals.has('SIGTERM')) {
    if (errors.length > 0) throw new Error(`the daemon refused to start: ${errors.join(' | ')}`)
    if (Date.now() >= deadline) throw new Error('the daemon never composed its local agent')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  signals.get('SIGTERM')?.()
  await running
  return composed.mask
}

describe('C441-CHAT', () => {
  it('a declared secret typed in chat is masked in user_message and clause_receipt', async () => {
    await typeInChat()

    const messages = sessionEvents('user_message')
    const receipts = sessionEvents('clause_receipt')
    expect(messages).toHaveLength(1)
    expect(receipts).toHaveLength(1)
    expect(messages[0]?.text).toContain(MARKER)
    expect(receipts[0]?.clause).toContain(MARKER)
    expect(sessionBytes()).not.toContain(DECLARED)
  })

  it('an undeclared credential typed in chat is stored as typed', async () => {
    await typeInChat()

    const messages = sessionEvents('user_message')
    const receipts = sessionEvents('clause_receipt')
    expect(messages[0]?.text).toContain(`use ${MARKER} with ${UNDECLARED}`)
    expect(receipts[0]?.clause).toContain(`use ${MARKER} with ${UNDECLARED}`)
  })

  it('the op result and the turn result are masked with the same mask', async () => {
    const result = await typeInChat()

    const persisted = sessionEvents('clause_result')
    expect(persisted).toHaveLength(1)
    const opResult = JSON.stringify(persisted[0]?.payload)
    expect(opResult).toContain(MARKER)
    expect(opResult).not.toContain(DECLARED)

    const turn = JSON.stringify(result)
    expect(result.results).toHaveLength(1)
    expect(JSON.stringify(result.results[0]?.payload)).toContain(MARKER)
    expect(JSON.stringify(result.receipts)).toContain(MARKER)
    expect(turn).toContain(UNDECLARED)
    expect(turn).not.toContain(DECLARED)
  })

  it('the daemon composes its host with the declared mask for its config path', async () => {
    const mask = await daemonMask(true)

    expect(mask?.(TYPED)).toBe(`use ${MARKER} with ${UNDECLARED}`)
  })

  it('a daemon host composed with no config path passes the identity', async () => {
    const mask = await daemonMask(false)

    expect(mask?.(TYPED)).toBe(TYPED)
  })
})
