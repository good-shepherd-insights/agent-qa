// The MCP credential mechanics (Phase 396 plan 05, D-06 / D-07 · MCPS-04), RETIRED 2026-10-01.
//
// 2026-10-01 (432-21, D-12): RE-SPELLED from the resolver's own cells. `mcp-token-resolution.ts` —
// `DEFAULT_MCP_SCOPES`, `resolveMcpTokens`, `matchBearer`, `credentialForBearer`,
// `resolveStdioScopes`, `mcpTokenSecretStore` and `McpTokenEnvVarUnsetError` — is deleted with the
// MCP bearer tokens. Each retired cell is replaced by the claim that now holds in its place:
//
//   * the knowledge-write credential a declared bearer minted, and the default grant derived from
//     the scope union -> the one tokenless caller carries no scope set, flag or credential;
//   * `matchBearer`'s three answers, and never degrading a wrong credential -> the listener reads no
//     `Authorization` header at all: absent, malformed and unmatched bearers are served identically;
//   * the startup dereference and its refusal by variable name -> the token block is not read, so a
//     declared-but-unset variable refuses nothing (`mcp-stdio-smoke.test.ts` drives the binary);
//   * the stdio grant opt-in -> no stdio grant exists;
//   * the declared values seeded into the masker -> the masker is seeded from the environment, and
//     a suffix-recognised secret is still masked (D-13).
//
// The refs-only config cells stay unchanged below: `services.mcp.tokens` and
// `services.mcp.stdio.grantConfigWrite` are still declared, unread, until 432-22 deletes the keys.

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { createFunctionRegistry } from '@vostride/agent-qa-agent'
import type { CreateFunctionRegistryOptions, FunctionDeps } from '@vostride/agent-qa-agent'
import { McpTokenEntrySchema } from '@vostride/agent-qa-schema'
import { AgentQaConfigSchema } from '@vostride/agent-qa-core'
import { afterEach, describe, expect, it } from 'vitest'

import * as mcpCommand from '../commands/mcp.js'
import { composeMcpMasking, createMcpHttpRequestListener, MCP_FUNCTION_CALLER } from '../commands/mcp.js'

/** The value that must never appear in any message, header or body this suite can reach. */
const PLANTED = 'zz-396-05-planted-credential-4f1c9a'
const PLANTED_VAR = 'AGENT_QA_396_MCP_CRED'

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..')

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close()
})

describe('C432-TOKENLESS-MCP: the MCP bearer resolver is deleted, not bypassed', () => {
  it('C432-TOKENLESS-MCP: the resolver module is gone and no CLI source imports it', () => {
    expect(existsSync(join(SRC, 'composition', 'mcp-token-resolution.ts'))).toBe(false)
    const offenders: string[] = []
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name)
        if (entry.isDirectory()) { if (entry.name !== '__tests__') walk(path) }
        else if (entry.name.endsWith('.ts') && readFileSync(path, 'utf8').includes("mcp-token-resolution.js'")) {
          offenders.push(path)
        }
      }
    }
    walk(SRC)
    expect(offenders).toEqual([])
  })

  it('C432-TOKENLESS-MCP: the command exports one tokenless caller and no grant, credential or sentinel', () => {
    for (const retired of ['MCP_DEFAULT_GRANTED_SCOPES', 'mcpFunctionCaller', 'MCP_AUTH_TOKEN_SENTINEL']) {
      expect(retired in mcpCommand, retired).toBe(false)
    }
    expect(MCP_FUNCTION_CALLER).toEqual({ surface: 'mcp', origin: 'agent' })
    expect(Object.isFrozen(MCP_FUNCTION_CALLER)).toBe(true)
  })
})

describe('C432-DECLARATION-KEYS: every caller the composition roots mint is attribution only', () => {
  it('C432-DECLARATION-KEYS: the MCP, run-service, daemon, CLI and dashboard mints carry exactly surface and origin', async () => {
    const { RUN_SERVICE_FUNCTION_CALLER, DASHBOARD_FUNCTION_CALLER } = await import('../commands/dashboard.js')
    const { DAEMON_FUNCTION_CALLER } = await import('../daemon/server.js')
    const { CLI_FUNCTION_CALLER } = await import('../composition/local-agent-host.js')
    const mints = {
      mcp: MCP_FUNCTION_CALLER,
      'run-service': RUN_SERVICE_FUNCTION_CALLER,
      daemon: DAEMON_FUNCTION_CALLER,
      cli: CLI_FUNCTION_CALLER,
      dashboard: DASHBOARD_FUNCTION_CALLER,
    }
    for (const [name, caller] of Object.entries(mints)) {
      expect(Object.keys(caller).sort(), name).toEqual(['origin', 'surface'])
    }
    expect(Object.values(mints).map((caller) => caller.surface).sort())
      .toEqual(['cli', 'daemon', 'dashboard', 'mcp', 'run-service'])
  })
})

describe('the listener reads no Authorization header (D-12)', () => {
  async function listener(): Promise<URL> {
    const registry = createFunctionRegistry({
      deps: {} as unknown as FunctionDeps,
      auditSink: { appendGuardrailAudit() {} } as unknown as CreateFunctionRegistryOptions['auditSink'],
    })
    const mask = composeMcpMasking({ env: {} })
    const server: Server = createServer(createMcpHttpRequestListener({ registry, maskText: (text) => mask.mask(text) }))
    await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready))
    cleanups.push(() => new Promise<void>((closed) => server.close(() => closed())))
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('no port')
    return new URL(`http://127.0.0.1:${String(address.port)}/mcp`)
  }

  async function namesWith(url: URL, authorization: string | undefined, frames: string[]): Promise<string[]> {
    const client = new Client({ name: 'agent-qa-432-21-tokenless', version: '0.0.0' })
    cleanups.push(() => client.close())
    await client.connect(new StreamableHTTPClientTransport(url, {
      fetch: (async (input: URL | string, init?: RequestInit) => {
        const headers = new Headers(init?.headers)
        if (authorization !== undefined) headers.set('authorization', authorization)
        const response = await fetch(input, { ...init, headers })
        frames.push(await response.clone().text())
        return response
      }) as typeof fetch,
    }))
    return (await client.listTools()).tools.map((tool) => tool.name).sort()
  }

  // RE-SPELLED from 'matchBearer answers three ways and never degrades a wrong credential (D-07)':
  // there is no verdict to degrade. Absent, malformed and unmatched headers are served identically.
  it('C432-TOKENLESS-MCP: absent, malformed and unmatched bearers list the identical catalogue', async () => {
    const url = await listener()
    const frames: string[] = []
    const absent = await namesWith(url, undefined, frames)
    expect(absent.length).toBeGreaterThan(0)
    expect(await namesWith(url, 'Basic not-a-bearer', frames)).toEqual(absent)
    expect(await namesWith(url, `Bearer ${PLANTED}`, frames)).toEqual(absent)
    const wire = frames.join('\n')
    expect(wire).not.toContain('invalid_token')
    expect(wire).not.toContain(PLANTED)
  })
})

// RE-SPELLED from 'the resolved values reach the masker by declaration, not by luck': nothing is
// declared any more, and environment secret masking is what remains (D-13).
describe('the MCP masker is seeded from the environment alone', () => {
  it('masks a suffix-recognised environment secret, and takes no declared-token argument', () => {
    const masking = composeMcpMasking({ env: { AGENT_QA_432_21_PROBE_TOKEN: PLANTED } })
    try {
      expect(masking.mask(`leaked ${PLANTED}`)).not.toContain(PLANTED)
    } finally {
      masking.dispose()
    }
    expect(composeMcpMasking.length).toBe(1)
  })
})

describe('the token entry vocabulary speaks names, never values (D-06 refs-only)', () => {
  it('accepts an entry declaring an env-var NAME and a scope set', () => {
    const parsed = McpTokenEntrySchema.parse({
      name: 'ci',
      tokenEnvVar: PLANTED_VAR,
      scopes: ['read', 'run'],
    })
    expect(parsed.tokenEnvVar).toBe(PLANTED_VAR)
  })

  it('REFUSES an entry that carries a token value beside the reference', () => {
    // The other side of the same line. `.strict()` is the mechanism, and this is the input it
    // exists for: somebody who found the indirection inconvenient and wrote the secret down.
    const refused = McpTokenEntrySchema.safeParse({
      name: 'ci',
      tokenEnvVar: PLANTED_VAR,
      token: PLANTED,
      scopes: ['read'],
    })
    expect(refused.success).toBe(false)
  })

  it('refuses an entry with no scopes at all', () => {
    expect(
      McpTokenEntrySchema.safeParse({ name: 'ci', tokenEnvVar: PLANTED_VAR, scopes: [] }).success,
    ).toBe(false)
  })

  it('refuses a scope the closed union does not declare', () => {
    expect(
      McpTokenEntrySchema.safeParse({
        name: 'ci',
        tokenEnvVar: PLANTED_VAR,
        scopes: ['everything'],
      }).success,
    ).toBe(false)
  })
})

describe('the config block lands on services.mcp and defaults safely', () => {
  const base = {
    workspace: {
      testMatch: ['tests/**/*.yaml'],
      testPathIgnore: [],
      suiteMatch: ['suites/**/*.suite.yaml'],
      hooksFile: 'hooks.yaml',
      envFile: '.env',
      secretsFile: '.env.secrets.local',
    },
    use: { mobile: { appState: 'preserve' } },
  }

  it('materialises an empty token list and a false stdio grant when nothing is declared', () => {
    const parsed = AgentQaConfigSchema.parse({ ...base, services: { mcp: {} } })
    expect(parsed.services?.mcp?.tokens).toEqual([])
    // `.prefault({})` and not `.default({})` — the inner default has to actually run.
    expect(parsed.services?.mcp?.stdio?.grantConfigWrite).toBe(false)
  })

  it('carries declared entries through the whole config parse', () => {
    const parsed = AgentQaConfigSchema.parse({
      ...base,
      services: {
        mcp: {
          tokens: [{ name: 'ci', tokenEnvVar: PLANTED_VAR, scopes: ['read', 'config-write'] }],
          stdio: { grantConfigWrite: true },
        },
      },
    })
    expect(parsed.services?.mcp?.tokens).toHaveLength(1)
    expect(parsed.services?.mcp?.tokens?.[0]?.scopes).toEqual(['read', 'config-write'])
    expect(parsed.services?.mcp?.stdio?.grantConfigWrite).toBe(true)
  })

  it('refuses a token value written into the config file', () => {
    const refused = AgentQaConfigSchema.safeParse({
      ...base,
      services: {
        mcp: { tokens: [{ name: 'ci', tokenEnvVar: PLANTED_VAR, token: PLANTED, scopes: ['read'] }] },
      },
    })
    expect(refused.success).toBe(false)
  })
})
