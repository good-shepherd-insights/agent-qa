// READ-CALLER-MATRIX (431-05 task 2 · D-07 · T-431-11 / T-431-12): who may fetch a screenshot.
//
// Measured at the real composition boundary: `composeCliLocalAgent` over a project on disk, the
// shipped `createMcpHttpRequestListener` bound to a loopback socket, and the built `agent-qa mcp`
// binary spawned over stdio.
//
// 2026-10-01 (432-21, D-12/D-13): TOKENLESS. The bearer tokens, the default-grant scope set and the
// credential marker are deleted, so every loopback or stdio caller is the same caller and reads
// screenshots, as it reads every other run read. What still refuses a caller is the network
// boundary: a page on another origin is refused before any server exists. Masking hides strings,
// never pixels: a screenshot shows what the page showed.
//
// MUTATION SUBJECT (observed 2026-09-28, restored byte for byte): M2 added a `credential: 'required'`
// marker to the evidence tool. 2026-10-01 (432-21): the marker no longer exists in `ToolProjection`.
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
import { asRunId } from '@vostride/agent-qa-schema'
import { afterEach, describe, expect, it } from 'vitest'

import { composeMcpMasking, createMcpHttpRequestListener, MCP_FUNCTION_CALLER } from '../commands/mcp.js'
import { composeCliLocalAgent } from '../composition/local-agent-host.js'

const CLI_ENTRY = resolve(dirname(fileURLToPath(import.meta.url)), '../../dist/cli.js')
const TOOL = 'agent_qa_get_run_evidence'

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
const PNG = Uint8Array.from(atob(PNG_BASE64), (char) => char.charCodeAt(0))

/** Bearer values a pre-432 client might still send. The listener neither needs nor reads them. */
const LEGACY_READER = 'zz-431-05-reader-credential-4a7c1e'
const LEGACY_NO_READ = 'zz-431-05-no-read-credential-8b2d9f'

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
  const mask = composeMcpMasking({ env: {} })
  const server: Server = createServer(createMcpHttpRequestListener({
    registry: host.registry, maskText: (text) => mask.mask(text),
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
  async function connect(extraHeaders: Record<string, string> = {}): Promise<Client> {
    const client = new Client({ name: 'agent-qa-431-05-caller', version: '0.0.0' })
    cleanups.push(() => client.close())
    await client.connect(new StreamableHTTPClientTransport(url, {
      fetch: (async (input: URL | string, init?: RequestInit) => {
        const headers = new Headers(init?.headers)
        for (const [name, value] of Object.entries(extraHeaders)) headers.set(name, value)
        const response = await fetch(input, { ...init, headers })
        frames.push(await response.clone().text())
        return response
      }) as typeof fetch,
    }))
    return client
  }
  return { ...p, registry: host.registry, connect, frames }
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
  // RE-SPELLED 2026-10-01 (432-21, D-12) from 'anonymous loopback, a read-only bearer and a writer
  // read the screenshot; none borrows a write credential for it'. There is no bearer to borrow: a
  // tokenless caller and a client still sending a legacy bearer read it identically.
  it('a tokenless loopback caller reads the screenshot, and a legacy bearer header changes nothing', async () => {
    const h = await httpHost()
    for (const [label, headers] of [
      ['tokenless', {}],
      ['legacy reader bearer', { authorization: `Bearer ${LEGACY_READER}` }],
    ] as const) {
      const client = await h.connect(headers)
      expect(await listNames(client), label).toContain(TOOL)
      expectScreenshot(await fetchScreenshot(client, h.runId, h.sha))
    }
    expect(Object.keys(MCP_FUNCTION_CALLER).sort()).toEqual(['origin', 'surface'])
    expect(h.frames.join('\n')).not.toContain(LEGACY_READER)
  })

  // RE-SPELLED 2026-10-01 (432-20, D-12) from 'a no-read bearer neither lists nor reaches the tool,
  // even by its hidden name'. No scope gates the listing or the op, so the no-read bearer reads the
  // screenshot like every other caller; the evidence masking and decoding claims are unchanged.
  // RE-SPELLED 2026-10-01 (432-21, D-12) from 'a no-read bearer lists and reaches the tool like
  // every caller': the tokenless caller the function layer sees reaches the op directly.
  it('a no-read bearer lists and reaches the tool like every caller', async () => {
    const h = await httpHost()
    const client = await h.connect({ authorization: `Bearer ${LEGACY_NO_READ}` })
    expect(await listNames(client)).toContain(TOOL)
    expectScreenshot(await fetchScreenshot(client, h.runId, h.sha))

    const served = await invokeFunction(h.registry, 'runs.artifact', { runId: h.runId, sha: h.sha },
      MCP_FUNCTION_CALLER)
      .then(() => 'served', (error: unknown) => (error as Error).name)
    expect(served).toBe('served')
    expect(h.frames.join('\n')).not.toContain(LEGACY_NO_READ)
  })

  // RE-SPELLED 2026-10-01 (432-21, D-12/D-13) from 'an undeclared bearer is refused before any
  // server exists and never degrades to anonymous'. No bearer is checked; what is refused before any
  // server exists is a page on another origin, and the refusal serves none of the screenshot.
  it('a cross-origin page is refused before any server exists and reads nothing', async () => {
    const h = await httpHost()
    await expect(h.connect({ origin: 'https://evil.example' })).rejects.toThrow()
    expect(h.frames.some((frame) => frame.includes('forbidden_origin'))).toBe(true)
    expect(h.frames.join('\n')).not.toContain(PNG_BASE64.slice(0, 16))
  })

  // RE-SPELLED 2026-10-01 (432-21, D-12) from '… with the default grant': no stdio grant exists.
  it('an anonymous stdio client of the built binary reads the screenshot with no grant', async () => {
    expect(existsSync(CLI_ENTRY), `the built CLI entry is missing at ${CLI_ENTRY}; run \`pnpm build\` first`).toBe(true)
    const p = project()
    const env = Object.fromEntries(Object.entries({ ...process.env })
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
