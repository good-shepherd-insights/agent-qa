// `agent-qa mcp` — the THIRD host over the function registry (Phase 396 plan 01, D-09 / D-10).
//
// WHY THIS FILE EXISTS IN THIS SHAPE. There are two hosts already: the interactive chat host and
// the daemon. Each composes the SAME registry through the SAME composition root and differs only in
// what it binds around it — who can be asked, what can be executed, who the caller is. This is the
// third, and the whole architectural claim of the phase is that being an MCP server is not a
// different KIND of thing: it is one more host, so this file composes and binds, and holds no
// capability of its own. The v1 server it replaces held thirty-three, and reached its data through
// the dashboard's REST API — a private power channel with no gate on it, which is exactly the shape
// the milestone abolishes.
//
// THE SPAWN MODEL IS PRESERVED DELIBERATELY. The command is still `mcp`, still stdio by default,
// because editor and client configurations out in the world encode `agent-qa mcp` and D-09 rates
// moving the server into the daemon as a costly reversal for precisely that reason.
//
// STDOUT IS THE PROTOCOL CHANNEL. Every diagnostic goes to stderr. One stray byte on stdout ahead
// of a response breaks every client on the connection, which is why the confirm port is refused
// below rather than merely absent, and why there is no `console.log` in this file.
//
// Protocol grounding: SEP-2575 (stateless — no `initialize` handshake, no session id; `serveStdio`
// owns era negotiation and serves 2025-era clients from the same factory), SEP-2567 (list results
// no longer vary per connection; the variance here is per CALLER, resolved once at start).

import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { buildAgentQaMcpServer } from '@vostride/agent-qa-mcp'
import { buildRunMaskingContext } from '@vostride/agent-qa-agent-local'
import { flushAnalytics } from '@vostride/agent-qa-core'
import { FunctionScopeSchema } from '@vostride/agent-qa-schema'
import type { FunctionCaller, FunctionScope } from '@vostride/agent-qa-schema'
import { Command } from 'commander'
import pc from 'picocolors'
import { dirname, resolve } from 'node:path'

import { composeCliLocalAgent } from '../composition/local-agent-host.js'
import { resolveConfig } from '../config.js'

/** The one line this host prints, on stderr, once the server is listening. */
export const MCP_STDIO_STARTUP_MESSAGE =
  'agent-qa MCP server running over stdio. Waiting for MCP client messages on stdin. '
  + 'Stdout is reserved for MCP protocol traffic.'

/**
 * What an unauthenticated local caller may do (D-07).
 *
 * DERIVED BY EXCLUSION from the scope enum, never restated. The set is "everything except
 * `config-write`", and writing that as a literal list would mean a scope minted tomorrow is
 * silently withheld from this host by an omission nobody reviewed — whereas derivation means a new
 * scope arrives here by default and the diff that adds it is the diff that decides. `config-write`
 * is the one exclusion because configuration is where irreversibility lives: the propose+apply
 * workflow still works out of the box (proposals commit nothing), and committing a config change
 * needs an explicit grant this host does not hand itself. Plan 05 adds per-caller bearer tokens
 * (D-06) on top; until then this is the whole answer.
 */
export const MCP_DEFAULT_GRANTED_SCOPES: readonly FunctionScope[] =
  FunctionScopeSchema.options.filter((scope) => scope !== 'config-write')

/**
 * The caller this host mints.
 *
 * `origin: 'agent'` and not `'human'`, which is the load-bearing field on this whole surface. 391
 * D-06's rule is that a caller never asserts its own grants and the composition root decides who a
 * call is on behalf of; nobody typed an MCP request, so an agent is what it is. The consequence is
 * concrete rather than philosophical: `proposals.accept` declares `requiresHumanOrigin`, so an MCP
 * caller structurally cannot accept its own proposals, and the commit door for this surface is the
 * gated apply instead (D-11, and 395-08 measured the same correction on the chat road).
 *
 * `safeMode: false` because the visibility law is now the scope subset itself (D-05): safe mode is
 * the instance of that law where the only granted scope is `read`, so leaving the registry's
 * cosmetic flag off keeps ONE filter deciding what a caller sees.
 */
export const MCP_FUNCTION_CALLER: FunctionCaller = {
  surface: 'mcp',
  grantedScopes: MCP_DEFAULT_GRANTED_SCOPES,
  safeMode: false,
  origin: 'agent',
}

export function createMcpCommand(): Command {
  const cmd = new Command('mcp')
    .description('Start MCP (Model Context Protocol) server over stdio')
    .action(async (command: Command) => {
      try {
        const program = command.parent
        const globalOpts = program?.opts<{ config?: string }>() ?? {}
        // Tolerant exactly as the v1 command was: a project whose configuration will not resolve
        // still gets a server, because analytics configuration is the only thing this read feeds
        // and refusing to start over it would be refusing the capability over the telemetry.
        let config: Awaited<ReturnType<typeof resolveConfig>> | undefined
        try {
          config = await resolveConfig({ configPath: globalOpts.config })
        } catch {
          config = undefined
        }

        const configPath = resolve(globalOpts.config ?? 'agent-qa.config.yaml')
        const agentQaRoot = resolve(dirname(configPath), '.agent-qa')

        // The masker, built through the run path's OWN producer rather than assembled here. That
        // matters for the reason 395-04 named as the sibling-input law: the values this host hides
        // and the values a run hides are then one set by construction instead of two lists that
        // agree today. The run's other two channels (a live secret store, captured auth state) are
        // run-scoped and do not exist in a server process, so seeding them would be inventing facts.
        const masking = buildRunMaskingContext({ env: process.env })

        const host = composeCliLocalAgent({
          agentQaRoot,
          configPath,
          // 396-01 D-09: the confirm port is REFUSED, not merely unsupplied. The field is present
          // and `undefined`, which this composition root reads as "this host must never ask" —
          // absent would default to a tty prompt, and on the one process whose stdout IS the
          // JSON-RPC channel a prompt written there does not go unanswered, it breaks the
          // connection. An ask-tier capability therefore fails closed here, which is the correct
          // answer for a caller with nobody behind it.
          confirm: undefined,
          // `applyDelegate` is deliberately NOT passed. The composition root's own default is
          // already a closure over `invokeViaDaemon` — the same socket every other capability
          // crosses — so an apply that needs a lease a running daemon holds is handed to that
          // daemon. Supplying one here would be a second transport for one job (D-09).
        })

        try {
          const handle = serveStdio(() =>
            buildAgentQaMcpServer({
              registry: host.registry,
              caller: MCP_FUNCTION_CALLER,
              maskText: (text: string) => masking.mask(text),
            }),
          )
          // stderr, never stdout — see the file header. Written after the serving entry is live so
          // the line is a fact about a running server rather than an intention.
          process.stderr.write(`${MCP_STDIO_STARTUP_MESSAGE}\n`)
          // The process serves until its stdin closes, which is how a spawning client stops it.
          await new Promise<void>((settle) => {
            process.stdin.once('end', () => settle())
            process.stdin.once('close', () => settle())
          })
          await handle.close()
        } finally {
          await host.close().catch(() => {})
          masking.dispose()
          await flushAnalytics(config ? { config } : undefined).catch(() => {})
        }
      } catch (err) {
        console.error(
          pc.red('Failed to start MCP server:'),
          err instanceof Error ? err.message : String(err),
        )
        process.exitCode = 1
      }
    })

  return cmd
}
