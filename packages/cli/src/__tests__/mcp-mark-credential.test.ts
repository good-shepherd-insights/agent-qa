// 419 D-20: actual HTTP bearer resolution, catalog and invokeFunction over durable mark fixtures.
// No provider calls. The positive case explicitly runs local-headless with trustMode FALSE.
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { join } from 'node:path'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { AgentQaConfigSchema } from '@vostride/agent-qa-core'
import { FunctionScopeError, invokeFunction } from '@vostride/agent-qa-agent'
import { KnowledgeGatesListResultSchema, RunsMarkOutcomeSchema } from '@vostride/agent-qa-schema'
import { afterEach, describe, expect, it } from 'vitest'

import { composeMcpMasking, createMcpHttpRequestListener, mcpFunctionCaller } from '../commands/mcp.js'
import { composeCliLocalAgent } from '../composition/local-agent-host.js'
import { credentialForBearer, matchBearer, resolveMcpTokens } from '../composition/mcp-token-resolution.js'
import { markFixture } from '../gates/__tests__/feedback-fixture.js'

const WRITER = 'zz-419-writer-credential-64bea7'
const READER = 'zz-419-reader-credential-53fbc8'
const INVALID = 'zz-419-undeclared-credential-71cad9'
const MARK_ONLY = 'zz-419-mark-only-credential-95eda2'
const MARK_TOOL = 'agent_qa_mark_run'
const GATES_TOOL = 'agent_qa_list_knowledge_gates'
const cleanups: (() => Promise<void>)[] = []

afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close()
})

async function harness(trustMode: boolean) {
  const fixture = markFixture()
  cleanups.push(async () => { rmSync(fixture.root, { recursive: true, force: true }) })
  const config = AgentQaConfigSchema.parse({
    workspace: {
      testMatch: ['tests/**/*.yaml'], suiteMatch: ['suites/**/*.suite.yaml'],
      hooksFile: 'hooks.yaml', envFile: '.env', secretsFile: '.env.secrets.local',
    },
    use: { mobile: { appState: 'preserve' } },
    safety: { trustMode },
    services: { mcp: { tokens: [
      { name: 'writer', tokenEnvVar: 'AGENT_QA_419_WRITER', scopes: ['read', 'run', 'knowledge-write'] },
      { name: 'reader', tokenEnvVar: 'AGENT_QA_419_READER', scopes: ['read'] },
      { name: 'mark-only', tokenEnvVar: 'AGENT_QA_419_MARK_ONLY', scopes: ['knowledge-write'] },
    ] } },
  })
  writeFileSync(fixture.configPath, JSON.stringify(config))
  const host = composeCliLocalAgent({
    agentQaRoot: fixture.agentQaRoot, configPath: fixture.configPath,
    confirm: undefined, resolveExecutionContext: () => 'local-headless',
  })
  cleanups.push(() => host.close())
  const tokens = resolveMcpTokens(config.services!.mcp!.tokens, {
    AGENT_QA_419_WRITER: WRITER, AGENT_QA_419_READER: READER, AGENT_QA_419_MARK_ONLY: MARK_ONLY,
  })
  const mask = composeMcpMasking({ tokens, env: {} })
  const server: Server = createServer(createMcpHttpRequestListener({
    registry: host.registry, tokens, maskText: text => mask.mask(text),
  }))
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  cleanups.push(() => new Promise<void>(resolve => server.close(() => resolve())))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('missing bound address')
  const url = new URL(`http://127.0.0.1:${address.port}/mcp`)
  const frames: string[] = []
  async function connect(token?: string) {
    const client = new Client({ name: 'agent-qa-419-mark', version: '0.0.0' })
    cleanups.push(() => client.close())
    await client.connect(new StreamableHTTPClientTransport(url, {
      fetch: (async (input: URL | string, init?: RequestInit) => {
        const headers = new Headers(init?.headers)
        if (token !== undefined) headers.set('authorization', `Bearer ${token}`)
        const response = await fetch(input, { ...init, headers })
        frames.push(await response.clone().text())
        return response
      }) as typeof fetch,
    }))
    return client
  }
  const ledger = join(fixture.runDir, 'marks.jsonl')
  const ledgerBytes = () => existsSync(ledger) ? readFileSync(ledger, 'utf8') : ''
  const markArgs = { runId: fixture.handoff.runId, kind: 'confirmed-bug' }
  const list = async (client: Client) => (await client.listTools()).tools.map(tool => tool.name)
  const mark = (client: Client) => client.callTool({ name: MARK_TOOL, arguments: markArgs })
  return { fixture, connect, frames, list, mark, ledgerBytes, registry: host.registry, tokens }
}

describe('419 MCP sovereign mark bearer differential', () => {
  it.each([false, true])('anonymous/reader remain excluded and refused when trustMode=%s', async trustMode => {
    const h = await harness(trustMode)
    const anonymous = await h.connect()
    const reader = await h.connect(READER)
    const before = h.ledgerBytes()
    const anonymousNames = await h.list(anonymous)
    expect(anonymousNames).toContain('agent_qa_apply_proposal')
    expect(anonymousNames).toContain(GATES_TOOL)
    for (const client of [anonymous, reader]) {
      expect(await h.list(client)).not.toContain(MARK_TOOL)
      const result = await h.mark(client)
      expect(result.isError).toBe(true)
      expect(result.structuredContent).toMatchObject({ status: 'credential-required', applied: false })
      expect(JSON.stringify(result.content)).toContain('present a bearer whose scopes include `knowledge-write`')
      expect(JSON.stringify(result)).not.toContain('--trust-session')
    }
    expect(h.ledgerBytes()).toBe(before)
    const gates = await anonymous.callTool({ name: GATES_TOOL, arguments: { recordId: h.fixture.published.id } })
    expect(KnowledgeGatesListResultSchema.parse(gates.structuredContent).kind).toBe('found')
    for (const secret of [WRITER, READER, INVALID, MARK_ONLY]) expect(h.frames.join('\n')).not.toContain(secret)
  })

  it('declared writer marks headlessly without trustMode; authority never carries to later or concurrent anonymous requests', async () => {
    const h = await harness(false)
    const writer = await h.connect(WRITER)
    expect(await h.list(writer)).toContain(MARK_TOOL)
    const result = await h.mark(writer)
    expect(result.isError).not.toBe(true)
    const outcome = RunsMarkOutcomeSchema.parse(result.structuredContent)
    expect(outcome.kind).toBe('marked')
    if (outcome.kind !== 'marked') throw new Error('writer did not persist the mark')
    expect(result.structuredContent).toMatchObject({
      kind: 'marked', receipt: { origin: 'user', kind: 'confirmed-bug', ordinal: 1 },
    })
    const written = h.ledgerBytes()
    expect(written.trim().split('\n').map(line => JSON.parse(line))).toEqual([outcome.receipt])
    const gates = await writer.callTool({ name: GATES_TOOL, arguments: { recordId: h.fixture.published.id } })
    expect(KnowledgeGatesListResultSchema.parse(gates.structuredContent).kind).toBe('found')

    const anonymous = await h.connect()
    expect(await h.list(anonymous)).not.toContain(MARK_TOOL)
    expect((await h.mark(anonymous)).isError).toBe(true)
    const lists = await Promise.all(Array.from({ length: 8 }, (_, index) => h.list(index % 2 ? writer : anonymous)))
    lists.forEach((names, index) => expect(names.includes(MARK_TOOL)).toBe(index % 2 === 1))
    expect((await h.mark(anonymous)).structuredContent).toMatchObject({ status: 'credential-required' })
    expect(h.ledgerBytes()).toBe(written)
    await expect(h.connect(INVALID)).rejects.toThrow()
    expect(h.frames.some(frame => frame.includes('invalid_token'))).toBe(true)
    expect(h.ledgerBytes()).toBe(written)
    for (const secret of [WRITER, READER, INVALID, MARK_ONLY]) expect(h.frames.join('\n')).not.toContain(secret)
  })

  it('a knowledge-write-only credential never grants missing config, authoring or run scopes', async () => {
    const h = await harness(false)
    const writer = await h.connect(MARK_ONLY)
    const names = await h.list(writer)
    expect(names).toContain(MARK_TOOL)
    expect(names).not.toContain('agent_qa_apply_config_proposal')
    expect(names).not.toContain('agent_qa_write_test')
    expect(names).not.toContain('agent_qa_start_run')
    expect((await h.mark(writer)).structuredContent).toMatchObject({ kind: 'marked' })
    const written = h.ledgerBytes()
    await writer.callTool({ name: 'agent_qa_apply_config_proposal', arguments: {
      proposal_id: 'prop_419-absent', confirmed: true,
    } }).catch(() => undefined)
    expect(h.frames.at(-1)).toContain('not found')
    // Bypass listing to prove the independent op-required-scope guard still refuses.
    const verdict = matchBearer(`Bearer ${MARK_ONLY}`, h.tokens)
    if (verdict.kind !== 'token') throw new Error('declared writer did not resolve')
    const caller = mcpFunctionCaller(verdict.scopes, credentialForBearer(verdict))
    expect(caller.credential).toBeDefined()
    await expect(invokeFunction(h.registry, 'config.proposal.apply', {
      proposalId: 'prop_419-absent',
    }, caller)).rejects.toBeInstanceOf(FunctionScopeError)
    expect(h.ledgerBytes()).toBe(written)
    for (const secret of [WRITER, READER, INVALID, MARK_ONLY]) expect(h.frames.join('\n')).not.toContain(secret)
  })
})
