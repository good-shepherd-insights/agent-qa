// A real MCP client spawns the SHIPPED binary (Phase 396 plan 01, D-09 / D-17's spirit).
//
// WHY A SECOND CELL WHEN THE TRACER ALREADY PASSES. The tracer drives the catalog in process. Every
// interesting thing about STDIO is invisible from there: whether the built artifact starts at all,
// whether the command still resolves, whether the era negotiation the serving entry owns actually
// completes over a pipe, and — the one that breaks every client in the field when it goes wrong —
// whether anything but JSON-RPC reaches stdout. None of those are provable against an in-process
// handler, and stdio is how every editor and desktop client will actually reach this server.
//
// THE STDOUT CLAIM IS PROVEN BY THE ROUND TRIP ITSELF, not by a string search. A stray byte on
// stdout ahead of a response is not a cosmetic blemish — it corrupts the framing and the transport
// fails outright — so a completed `tools/list` over this pipe IS the assertion that stdout carried
// protocol and nothing else. The startup line is asserted separately, on captured STDERR, which is
// the other half of the same law: the diagnostic exists AND it is not on the protocol channel.
//
// BUILD PREREQUISITE (the stale-dist law). These cells measure the BUILT artifact. Run
// `pnpm build` — or at minimum the schema, agent, mcp and cli filters in dependency order —
// before running them, or the binary spawned here is a previous revision wearing this one's name.
// The guard below refuses with that instruction rather than spawning something that does not exist.

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { FunctionScopeSchema } from '@vostride/agent-qa-schema'
import { afterEach, describe, expect, it } from 'vitest'

import { MCP_DEFAULT_GRANTED_SCOPES, MCP_STDIO_STARTUP_MESSAGE } from '../commands/mcp.js'

const CLI_ENTRY = resolve(dirname(fileURLToPath(import.meta.url)), '../../dist/cli.js')

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** A real project on disk — produced, not a literal path handed to the child. */
function fixtureProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'agent-qa-396-01-stdio-'))
  roots.push(root)
  writeFileSync(
    join(root, 'agent-qa.config.yaml'),
    `${JSON.stringify(
      {
        workspace: {
          testMatch: ['tests/**/*.yaml'],
          testPathIgnore: [],
          suiteMatch: ['suites/**/*.suite.yaml'],
          hooksFile: 'hooks.yaml',
          envFile: '.env',
          secretsFile: '.env.secrets.local',
        },
      },
      null,
      2,
    )}\n`,
    'utf8',
  )
  mkdirSync(join(root, '.agent-qa'), { recursive: true })
  return root
}

describe('agent-qa mcp over spawned stdio', () => {
  it('completes a tools/list round trip and keeps its startup line off stdout', async () => {
    expect(
      existsSync(CLI_ENTRY),
      `the built CLI entry is missing at ${CLI_ENTRY}; run \`pnpm build\` first (see this file's header)`,
    ).toBe(true)

    const cwd = fixtureProject()
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [CLI_ENTRY, 'mcp'],
      cwd,
      stderr: 'pipe',
    })

    let captured = ''
    const stderr = transport.stderr
    stderr?.on('data', (chunk: Buffer | string) => {
      captured += typeof chunk === 'string' ? chunk : chunk.toString('utf8')
    })

    const client = new Client({ name: 'agent-qa-396-stdio-smoke', version: '0.0.0' })
    try {
      await client.connect(transport)
      const listed = await client.listTools()
      const names = listed.tools.map((entry) => entry.name)

      // (a) The catalog reached a client that spawned the shipped binary.
      expect(names).toContain('agent_qa_list_proposals')

      // (b) D-07's default grant, read off the SHIPPED constant rather than restated: everything
      // except `config-write`, derived from the scope enum by exclusion. Stated honestly: the
      // matching TOOL-side clause — that no config-write tool appears in this listing — is
      // VACUOUS at plan 01, because no config-write op is projected yet. Its bar arrives with the
      // completed mapping in plan 04, and the two-token differential (a granted caller sees a
      // tool a withheld caller cannot) is plan 05's. What is measured here is the grant itself.
      expect(MCP_DEFAULT_GRANTED_SCOPES).not.toContain('config-write')
      expect([...MCP_DEFAULT_GRANTED_SCOPES].sort()).toEqual(
        FunctionScopeSchema.options.filter((scope) => scope !== 'config-write').sort(),
      )

      // (c) The diagnostic exists and it is on STDERR. Together with the round trip above — which
      // could not have completed had anything else been written to stdout — this pins the channel
      // discipline from both sides.
      await expect
        .poll(() => captured, { timeout: 5_000 })
        .toContain(MCP_STDIO_STARTUP_MESSAGE)
    } finally {
      await client.close().catch(() => {})
      await transport.close().catch(() => {})
    }
  }, 30_000)
})
