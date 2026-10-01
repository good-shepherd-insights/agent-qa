// READ-CALLER-MATRIX (431-05 task 2 · D-07 · T-431-11 / T-431-12): who may fetch a screenshot.
//
// Measured at the real composition boundary: `composeCliLocalAgent` over a project on disk, the
// shipped `createMcpHttpRequestListener` bound to a loopback socket with real `Authorization`
// headers, and the built `agent-qa mcp` binary spawned over stdio.
//
// THE POSTURE IS INHERITED, NOT NEW. `agent_qa_get_run_evidence` declares `requiredScopes: ['read']`
// and no credential marker. The marker would demand a knowledge-write bearer for a read, because
// `credentialForBearer` only mints a credential for one, so it is deliberately absent. An anonymous
// loopback or stdio caller holds `DEFAULT_MCP_SCOPES` and therefore reads screenshots, as it
// already read every other run read. That anonymous exposure is recorded for the security gate,
// not redesigned here. Masking hides strings, never pixels: a screenshot shows what the page showed.
//
// MUTATION SUBJECT (observed 2026-09-28, restored byte for byte):
//   M2 `credential: 'required'` added to the evidence tool in mcp's mapping.ts -> READ-CALLER-MATRIX
//
// BUILD PREREQUISITE: the stdio cell spawns `dist/cli.js`. Run `pnpm build` first.

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { invokeFunction } from '@vostride/agent-qa-agent'
import { AgentQaConfigSchema } from '@vostride/agent-qa-core'
import { generateRunId } from '@vostride/agent-qa-ids'
import { FsEvidenceArtifactStore } from '@vostride/agent-qa-runner-local'
import { asRunId, FunctionScopeSchema } from '@vostride/agent-qa-schema'
import { afterEach, describe, expect, it } from 'vitest'

import { composeMcpMasking, createMcpHttpRequestListener, mcpFunctionCaller, MCP_DEFAULT_GRANTED_SCOPES } from '../commands/mcp.js'
import { composeCliLocalAgent } from '../composition/local-agent-host.js'
import { credentialForBearer, matchBearer, resolveMcpTokens, resolveStdioScopes } from '../composition/mcp-token-resolution.js'

const CLI_ENTRY = resolve(dirname(fileURLToPath(import.meta.url)), '../../dist/cli.js')
const TOOL = 'agent_qa_get_run_evidence'

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
const PNG = Uint8Array.from(atob(PNG_BASE64), (char) => char.charCodeAt(0))

const READER = 'zz-431-05-reader-credential-4a7c1e'
const NO_READ = 'zz-431-05-no-read-credential-8b2d9f'
const WRITER = 'zz-431-05-writer-credential-c3e6a0'
const INVALID = 'zz-431-05-undeclared-credential-5f9b21'
const TOKEN_ENV = {
  AGENT_QA_431_05_READER: READER,
  AGENT_QA_431_05_NO_READ: NO_READ,
  AGENT_QA_431_05_WRITER: WRITER,
}
const NO_READ_SCOPES = FunctionScopeSchema.options.filter((scope) => scope !== 'read')

type Block = { readonly type: string; readonly text?: string; readonly data?: string; readonly mimeType?: string }
type WireResult = { readonly content: readonly Block[]; readonly structuredContent?: unknown; readonly isError?: boolean }

const cleanups: (() => Promise<void> | void)[] = []
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close()
})

function project() {
  const root = mkdtempSync(join(tmpdir(), 'agent-qa-431-05-caller-'))
  cleanups.push(() => rmSync(root, { recursive: true, force: true }))
  const agentQaRoot = join(root, '.agent-qa')
  mkdirSync(agentQaRoot, { recursive: true })
  const configPath = join(root, 'agent-qa.config.yaml')
  const config = AgentQaConfigSchema.parse({
    workspace: {
      testMatch: ['tests/**/*.yaml'], suiteMatch: ['suites/**/*.suite.yaml'],
      hooksFile: 'hooks.yaml', envFile: '.env', secretsFile: '.env.secrets.local',
    },
    use: { mobile: { appState: 'preserve' } },
    services: { mcp: { tokens: [
      { name: 'reader', tokenEnvVar: 'AGENT_QA_431_05_READER', scopes: ['read'] },
      { name: 'no-read', tokenEnvVar: 'AGENT_QA_431_05_NO_READ', scopes: NO_READ_SCOPES },
      { name: 'writer', tokenEnvVar: 'AGENT_QA_431_05_WRITER', scopes: ['read', 'knowledge-write'] },
    ] } },
  })
  writeFileSync(configPath, JSON.stringify(config))
  const runId = asRunId(generateRunId())
  const { sha } = new FsEvidenceArtifactStore({ root: agentQaRoot, runId }).persistDecisionScreenshot(PNG)
  return { root, agentQaRoot, configPath, config, runId, sha }
}

async function httpHost() {
  const p = project()
  const host = composeCliLocalAgent({
    agentQaRoot: p.agentQaRoot, configPath: p.configPath,
    resolveExecutionContext: () => 'local-headless',
  })
  cleanups.push(() => host.close())
  const tokens = resolveMcpTokens(p.config.services!.mcp!.tokens, TOKEN_ENV)
  const mask = composeMcpMasking({ tokens, env: {} })
  const server: Server = createServer(createMcpHttpRequestListener({
    registry: host.registry, tokens, maskText: (text) => mask.mask(text),
  }))
  await new Promise<void>((listening, failed) => {
    server.once('error', failed)
    server.listen(0, '127.0.0.1', listening)
  })
  cleanups.push(() => new Promise<void>((closed) => server.close(() => closed())))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('missing bound address')
  const url = new URL(`http://127.0.0.1:${address.port}/mcp`)
  const frames: string[] = []
  async function connect(token?: string): Promise<Client> {
    const client = new Client({ name: 'agent-qa-431-05-caller', version: '0.0.0' })
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
  return { ...p, registry: host.registry, tokens, connect, frames }
}

const listNames = async (client: Client): Promise<string[]> => (await client.listTools()).tools.map((tool) => tool.name)

async function fetchScreenshot(client: Client, runId: string, sha: string): Promise<WireResult> {
  return await client.callTool({ name: TOOL, arguments: { action: 'runs.artifact', runId, sha } }) as unknown as WireResult
}

function expectScreenshot(result: WireResult): void {
  expect(result.isError ?? false, JSON.stringify(result.content).slice(0, 400)).toBe(false)
  expect(result.content.filter((block) => block.type === 'image'))
    .toEqual([{ type: 'image', data: PNG_BASE64, mimeType: 'image/png' }])
  expect(result.structuredContent).toMatchObject({ contentType: 'image/png', bytesBase64: PNG_BASE64 })
}

describe('READ-CALLER-MATRIX (D-07 · T-431-11)', () => {
  it('anonymous loopback, a read-only bearer and a writer read the screenshot; none borrows a write credential for it', async () => {
    const h = await httpHost()
    for (const [label, token] of [['anonymous', undefined], ['reader', READER], ['writer', WRITER]] as const) {
      const client = await h.connect(token)
      expect(await listNames(client), label).toContain(TOOL)
      expectScreenshot(await fetchScreenshot(client, h.runId, h.sha))
    }

    const anonymous = matchBearer(undefined, h.tokens)
    expect(anonymous).toEqual({ kind: 'anonymous', scopes: MCP_DEFAULT_GRANTED_SCOPES })
    expect(credentialForBearer(anonymous)).toBeUndefined()
    const reader = matchBearer(`Bearer ${READER}`, h.tokens)
    expect(reader).toMatchObject({ kind: 'token', clientId: 'reader', scopes: ['read'] })
    expect(credentialForBearer(reader)).toBeUndefined()
    for (const secret of [READER, NO_READ, WRITER]) expect(h.frames.join('\n')).not.toContain(secret)
  })

  // RE-SPELLED 2026-10-01 (432-20, D-12) from 'a no-read bearer neither lists nor reaches the tool,
  // even by its hidden name'. No scope gates the listing or the op, so the no-read bearer reads the
  // screenshot like every other caller; the evidence masking and decoding claims are unchanged.
  it('a no-read bearer lists and reaches the tool like every caller', async () => {
    const h = await httpHost()
    const client = await h.connect(NO_READ)
    expect(await listNames(client)).toContain(TOOL)
    expectScreenshot(await fetchScreenshot(client, h.runId, h.sha))

    const verdict = matchBearer(`Bearer ${NO_READ}`, h.tokens)
    if (verdict.kind !== 'token') throw new Error('the no-read bearer did not resolve')
    const served = await invokeFunction(h.registry, 'runs.artifact', { runId: h.runId, sha: h.sha },
      mcpFunctionCaller(verdict.scopes, credentialForBearer(verdict)))
      .then(() => 'served', (error: unknown) => (error as Error).name)
    expect(served).toBe('served')
    for (const secret of [READER, NO_READ, WRITER]) expect(h.frames.join('\n')).not.toContain(secret)
  })

  it('an undeclared bearer is refused before any server exists and never degrades to anonymous', async () => {
    const h = await httpHost()
    await expect(h.connect(INVALID)).rejects.toThrow()
    expect(h.frames.some((frame) => frame.includes('invalid_token'))).toBe(true)
    expect(h.frames.join('\n')).not.toContain(PNG_BASE64.slice(0, 16))
  })

  it('an anonymous stdio client of the built binary reads the screenshot with the default grant', async () => {
    expect(existsSync(CLI_ENTRY), `the built CLI entry is missing at ${CLI_ENTRY}; run \`pnpm build\` first`).toBe(true)
    expect(resolveStdioScopes(false)).toEqual(MCP_DEFAULT_GRANTED_SCOPES)
    const p = project()
    const env = Object.fromEntries(Object.entries({ ...process.env, ...TOKEN_ENV })
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
    const transport = new StdioClientTransport({ command: process.execPath, args: [CLI_ENTRY, 'mcp'], cwd: p.root, env, stderr: 'pipe' })
    const client = new Client({ name: 'agent-qa-431-05-stdio', version: '0.0.0' })
    cleanups.push(async () => {
      await client.close().catch(() => {})
      await transport.close().catch(() => {})
    })
    await client.connect(transport)

    expect(await listNames(client)).toContain(TOOL)
    expectScreenshot(await fetchScreenshot(client, p.runId, p.sha))
  }, 60_000)
})
