// Four shipped doors over byte-identical scratch runs, with independent durable ledgers.
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough, Writable } from 'node:stream'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { invokeFunction, RUNS_MARK_FUNCTION_ID } from '@vostride/agent-qa-agent'
import { AgentQaConfigSchema, resolveWorkspacePaths } from '@vostride/agent-qa-core'
import { DashboardDatabase, createConfirmRegistry, startServer } from '@vostride/agent-qa-dashboard'
import { slugBranch } from '@vostride/agent-qa-runner-local'
import { MarkReceiptSchema, RunsMarkOutcomeSchema, type MarkReceipt } from '@vostride/agent-qa-schema'
import { Command } from 'commander'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parse } from 'yaml'
import { composeDashboardDoor } from '../commands/dashboard.js'
import { composeMcpMasking, createMcpHttpRequestListener } from '../commands/mcp.js'
import { createRunsCommand } from '../commands/runs.js'
import * as host from '../composition/local-agent-host.js'
import { resolveMcpTokens } from '../composition/mcp-token-resolution.js'
import { markFixture } from '../gates/__tests__/feedback-fixture.js'

export const MARK_RECEIPT_EQUIVALENCE_KEYS = [
  'runId', 'testIndex', 'stepIndex', 'kind', 'origin',
] as const

/** Receipts agree modulo markId, ordinal, markedAt and the surface's response wrapper. */
function equivalenceOf(receipt: MarkReceipt) {
  return {
    ...Object.fromEntries(MARK_RECEIPT_EQUIVALENCE_KEYS.map(key => [key, receipt[key]])),
    disposition: receipt.disposition.kind,
    gold: receipt.gold.map(item => item.channel),
    evidence: receipt.evidence,
  }
}

const closers: Array<() => void | Promise<void>> = []
afterEach(async () => {
  vi.restoreAllMocks()
  process.exitCode = 0
  for (const close of closers.splice(0).reverse()) await close()
})

function scratch(template: ReturnType<typeof markFixture>) {
  const root = mkdtempSync(join(tmpdir(), 'agent-qa-mark-parity-'))
  closers.push(() => rmSync(root, { recursive: true, force: true }))
  cpSync(template.root, root, { recursive: true })
  const configPath = join(root, 'agent-qa.config.yaml')
  const config = AgentQaConfigSchema.parse(parse(readFileSync(configPath, 'utf8')))
  config.safety = { ...config.safety, trustMode: false }
  writeFileSync(configPath, JSON.stringify(config))
  const agentQaRoot = join(root, '.agent-qa')
  const ledger = join(agentQaRoot, 'runs', slugBranch(template.handoff.runId), 'marks.jsonl')
  expect(existsSync(ledger)).toBe(false)
  return { root, configPath, config, agentQaRoot, ledger }
}
type Scratch = ReturnType<typeof scratch>

function terminalConfirmation() {
  const input = new PassThrough()
  let prompt = ''
  const output = new Writable({ write(chunk, _encoding, done) {
    prompt += String(chunk)
    if (String(chunk).includes('[y/N]')) queueMicrotask(() => input.write('y\n'))
    done()
  } })
  closers.push(() => { input.destroy(); output.destroy() })
  return {
    confirm: host.createTtyConfirmPort({ isTty: true, input, output }),
    prompt: () => prompt,
  }
}

function receiptOf(value: unknown): MarkReceipt {
  const outcome = RunsMarkOutcomeSchema.parse(value)
  expect(outcome.kind).toBe('marked')
  if (outcome.kind !== 'marked') throw new Error('the door did not persist a new mark')
  return outcome.receipt
}

async function mcpDoor(scene: Scratch) {
  // Test-owned declared credential; never copied from the environment or printed on the wire.
  const token = 'agent-qa-parity-fixture-writer-419'
  const declarations: Parameters<typeof resolveMcpTokens>[0] = [{ name: 'writer', tokenEnvVar: 'AGENT_QA_PARITY_WRITER', scopes: ['knowledge-write'] }]
  scene.config.services = { ...scene.config.services, mcp: { tokens: [...declarations], stdio: { grantConfigWrite: false } } }
  writeFileSync(scene.configPath, JSON.stringify(scene.config))
  const composed = host.composeCliLocalAgent({ configPath: scene.configPath, agentQaRoot: scene.agentQaRoot, confirm: undefined,
    resolveExecutionContext: () => 'local-headless' })
  closers.push(() => composed.close())
  const tokens = resolveMcpTokens(declarations, { AGENT_QA_PARITY_WRITER: token })
  const masking = composeMcpMasking({ tokens, env: {} })
  const server = createServer(createMcpHttpRequestListener({ registry: composed.registry,
    tokens, maskText: text => masking.mask(text) }))
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  closers.push(() => new Promise<void>(resolve => server.close(() => resolve())))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('MCP did not bind')
  const url = new URL(`http://127.0.0.1:${address.port}/mcp`)
  async function connect(authenticated: boolean) {
    const client = new Client({ name: 'agent-qa-mark-parity', version: '0.0.0' })
    closers.push(() => client.close())
    await client.connect(new StreamableHTTPClientTransport(url, {
      fetch: (async (input: URL | string, init?: RequestInit) => {
        const headers = new Headers(init?.headers)
        if (authenticated) headers.set('authorization', `Bearer ${token}`)
        return fetch(input, { ...init, headers })
      }) as typeof fetch,
    }))
    return client
  }
  return { writer: await connect(true), anonymous: await connect(false) }
}

/** Real SSE frames, held before the POST and answered through the production answer route. */
async function dashboardDoor(scene: Scratch, input: { runId: string; kind: 'false-fail' | 'confirmed-bug' }) {
  const db = new DashboardDatabase({ dbPath: ':memory:' })
  const confirms = createConfirmRegistry({ timeoutMs: 20_000 })
  const door = composeDashboardDoor({ ...scene, boundOrigin: () => undefined, confirms })
  const server = await startServer({ db, port: 0, configPath: scene.configPath,
    workspacePaths: resolveWorkspacePaths({ config: scene.config, configPath: scene.configPath }),
    agentHost: door.agentHost })
  closers.push(async () => { server.close(); await door.host.close() })
  const address = server.server.address()
  if (!address || typeof address === 'string') throw new Error('dashboard did not bind')
  const origin = `http://127.0.0.1:${address.port}`
  const controller = new AbortController()
  const response = await fetch(`${origin}/api/run-confirm/channel`, { signal: controller.signal })
  expect(response.status).toBe(200)
  if (!response.body) throw new Error('confirmation stream had no body')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const frames: Array<{ event?: string; data: string }> = []
  let raw = ''
  const pump = (async () => {
    try {
      for (;;) {
        const chunk = await reader.read()
        if (chunk.done) return
        raw += decoder.decode(chunk.value, { stream: true })
        const parts = raw.split('\n\n')
        raw = parts.pop() ?? ''
        for (const part of parts) {
          const lines = part.split('\n')
          frames.push({ event: lines.find(line => line.startsWith('event: '))?.slice(7),
            data: lines.find(line => line.startsWith('data: '))?.slice(6) ?? '' })
        }
      }
    } catch (error) { if (!controller.signal.aborted) throw error }
  })()
  closers.push(async () => { controller.abort(); await pump })
  async function frame(event: string) {
    await vi.waitFor(() => expect(frames.some(item => item.event === event)).toBe(true), { timeout: 10_000 })
    return JSON.parse(frames.find(item => item.event === event)!.data)
  }
  const { scopeId } = await frame('confirm_scope')
  const pending = fetch(`${origin}/api/runs/${encodeURIComponent(input.runId)}/mark`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kind: input.kind, confirmScope: scopeId }),
  })
  const request = await frame('confirm_request')
  expect(JSON.stringify(request)).toContain('fn:runs.mark')
  expect(existsSync(scene.ledger)).toBe(false)
  const answer = await fetch(`${origin}/api/run-confirm/answer`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ scopeId, confirmId: request.confirmId, answer: 'accept' }),
  })
  expect(answer.status).toBe(200)
  const marked = await pending
  expect(marked.status).toBe(200)
  return receiptOf(await marked.json())
}

describe('419 mark receipt parity across the four sovereign doors', () => {
  it.each(['false-fail', 'confirmed-bug'] as const)('%s receipts agree across fn, CLI, declared MCP and confirmed HTTP', async kind => {
    const template = markFixture()
    closers.push(() => rmSync(template.root, { recursive: true, force: true }))
    const scenes = [scratch(template), scratch(template), scratch(template), scratch(template)] as const
    const input = { runId: template.handoff.runId, kind }
    const tty = terminalConfirmation()
    const fnHost = host.composeCliLocalAgent({ configPath: scenes[0].configPath, agentQaRoot: scenes[0].agentQaRoot, confirm: tty.confirm,
      resolveExecutionContext: () => 'local-interactive' })
    closers.push(() => fnHost.close())
    const fn = receiptOf(await invokeFunction(fnHost.registry, RUNS_MARK_FUNCTION_ID, input, host.CLI_FUNCTION_CALLER))
    expect(tty.prompt()).toContain('fn:runs.mark')

    const cliTty = terminalConfirmation()
    const compose = host.composeCliLocalAgent
    const spy = vi.spyOn(host, 'composeCliLocalAgent').mockImplementation(options => compose({ ...options,
      confirm: cliTty.confirm, resolveExecutionContext: () => 'local-interactive' }))
    const output = vi.spyOn(console, 'log').mockImplementation(() => {})
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    let cli: MarkReceipt
    try {
      const program = new Command().exitOverride().option('--config <path>').addCommand(createRunsCommand())
      await program.parseAsync(['--config', scenes[1].configPath, 'runs', 'mark', input.runId, '--kind', kind, '--json'], { from: 'user' })
      expect(errors.mock.calls).toEqual([])
      expect(cliTty.prompt()).toContain('fn:runs.mark')
      cli = receiptOf(JSON.parse(String(output.mock.calls.at(-1)?.[0])))
    } finally { spy.mockRestore(); output.mockRestore(); errors.mockRestore() }

    const mcp = await mcpDoor(scenes[2])
    expect((await mcp.anonymous.listTools()).tools.map(tool => tool.name)).not.toContain('agent_qa_mark_run')
    const refused = await mcp.anonymous.callTool({ name: 'agent_qa_mark_run', arguments: input })
    expect(refused.isError).toBe(true)
    expect(JSON.stringify(refused.content)).toContain('present a bearer whose scopes include `knowledge-write`')
    expect(existsSync(scenes[2].ledger)).toBe(false)
    const called = await mcp.writer.callTool({ name: 'agent_qa_mark_run', arguments: input })
    expect(called.isError).not.toBe(true)
    const bearer = receiptOf(called.structuredContent)
    const api = await dashboardDoor(scenes[3], input)
    const receipts = [fn, cli!, bearer, api]
    for (const [index, receipt] of receipts.entries()) {
      expect(equivalenceOf(receipt)).toEqual(equivalenceOf(fn))
      const lines = readFileSync(scenes[index]!.ledger, 'utf8').trim().split('\n')
      expect(lines).toHaveLength(1)
      const durable = MarkReceiptSchema.parse(JSON.parse(lines[0]!))
      expect(durable).toEqual(receipt)
      expect(durable.origin).toBe('user')
      expect(durable.ordinal).toBe(1)
      expect(durable.gold.map(item => item.channel)).toEqual(['user-mark'])
      expect(durable.evidence.confirmed).toBe(1)
      expect(durable.disposition.kind).toBe(kind === 'false-fail' ? 'drafted' : 'confirmed-bug')
    }
  }, 60_000)
})
