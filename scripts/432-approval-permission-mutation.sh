#!/usr/bin/env bash
# 432-approval-permission-mutation.sh — no removed approval or permission member can come back, and
# no retained control can break, without its own named RED (432-43, PXH-SAFE-05; D-03, D-12, D-14,
# D-15, D-16, D-17, D-22).
#
# WHAT THIS PROVES, AND WHY A GREEN SUITE DOES NOT PROVE IT. Phase 432 deleted every y/n question and
# every permission. The census (`arch/src/__tests__/432-approval-permission-deleted.test.ts`) names one
# cell per removed member, C432-RETURN-A01 … A78, and every one of them is green today with nothing
# returned — which is exactly what a census that looks at the wrong bytes would be too. So each A leg
# plants ONE removed member back, in the module the mutation map names, and requires that member's own
# cell to red BY ITS OWN ASSERTION (the census reports every returned spelling at once, and the leg
# names the one that is its member). Each B leg breaks one retained behaviour — the production refusal,
# explicit CI promotion, automatic CI disposition, mark retry, the fresh config transaction, the
# rejected final write, the config leaf and page counts, the inconsistency hold, Host, Origin, the
# dashboard's cross-site refusal, live-link subject binding and the guardrail audit — and requires the
# cell that exists to hold it to red.
#
# THE LEGS ARE THE MUTATION MAP'S ROWS, BY ID. Every leg carries its row id (`explicitIds`), so the
# registration order is not the identity: reordering this table cannot re-aim a leg at another member,
# and the selftest and `scripts/__tests__/432-mutation-map.test.cjs` each spell the 94 rows on their own.
#
# A DELETED MODULE RETURNS BY BEING CREATED. Where the member lived in a module that is gone (a dialog,
# the confirm registry, the gate, the grant ledger, the proposal envelope, the scope union, the remedy
# vocabulary, the config DTOs) the leg creates that module at its old path, valid and self-contained,
# and restoring it is deleting it. A restored obsolete module may be unreferenced: the claim is that it
# is absent.
#
# PUBLIC CONFIG AND THE TRUST FLAG ARE OBSERVED BUILT (A59, A61, A63, A64, A65). Their cells read the
# REBUILT public `AgentQaConfigSchema` (`core/dist/index.js`) and the rebuilt binary's `run --help`
# (`cli/dist/cli.js`; tsup emits no per-command module). Each leg restores the real declaration — the
# key on `McpConfigSchema` / `DashboardConfigSchema` in core's `services-schema.ts` with its entry DTO,
# its config and root barrel exports and core's import; `McpStdioGrantSchema` composed as `stdio`; the
# strict `safety` object at the config root; `.option('--trust-session', …)` on `createRunCommand()` —
# rebuilds schema then core (or the CLI), finds its marker in the rebuilt dist, and requires the
# PARSER's (or Commander's) own assertion among the cell's failures. Restoring rebuilds the same chain.
#
# THE B11 AND B02 TARGETS FOLLOW THE CODE, NOT THE MAP'S FIRST GUESS (deferred 432-10 #1, 432-03): the
# gate-inconsistent hold is the one line in `schema/src/knowledge/promotion-gate.ts`, and the per-member
# production list is built in `cli/src/commands/run.ts` › `resolveMemberTargetFacts`.
#
# NOT RED: a missing target, zero or a different number of selected cells, a skipped cell, a runner
# error or timeout, a suite that fails to load, a failed build, a planted text that does not parse, or a
# cell that reds on anything but its named assertion. Each of those is a FATAL, never a measurement.
#
# Engine, arrival proof, counted selection and restoration: scripts/423-mutation-engine.cjs.
#
# USAGE
#   pnpm run validate:432-approval-permission-mutation          # from the agent-qa root
#   bash agent-qa/scripts/432-approval-permission-mutation.sh   # from the super-repository root
#
# KNOBS — AGENT_QA_432_APPROVAL_PERMISSION_MUTATION_SELFTEST
#   neutered  apply NO mutation; the run must FATAL with "<leg>: suite stayed green"
#   fatal     mutate every subject, then throw; every subject must be restored
#   SIGINT | SIGTERM | SIGHUP   the same, then deliver that signal to itself
# AGENT_QA_432_APPROVAL_PERMISSION_MUTATION_LEG=A01..A78|B01..B16 runs one leg (normal or neutered runs).
# AGENT_QA_432_APPROVAL_PERMISSION_MUTATION_LIST=1 prints the declared inventory and exits.
#
# Installed Node 24 and workspace tools are required. No downloads or provider calls. Ends with a
# forced workspace build whenever a byte was mutated.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
exec node --input-type=commonjs - <<'NODE'
const path = require('node:path')
const { runGate, cell } = require(path.join(process.cwd(), 'scripts/423-mutation-engine.cjs'))

const P = 'packages/'
const CENSUS_T = 'src/__tests__/432-approval-permission-deleted.test.ts'

// Every count is measured from a fresh Vitest JSON report of exactly these files, run the way the
// engine runs them (2026-10-02, agent-qa 4feb834c1 plus this plan's census cells).
const instruments = {
  census: { pkg: 'packages/arch', files: [CENSUS_T], typecheck: false, count: 100, dist: true },
  boundary: { pkg: 'packages/agent-local', files: ['src/composition/__tests__/432-production-boundary.test.ts'], typecheck: false, count: 15 },
  producers: { pkg: 'packages/cli', files: ['src/composition/__tests__/432-production-producers.test.ts'], typecheck: false, count: 19, env: { VITEST_MAX_WORKERS: '1' } },
  editor: { pkg: 'packages/dashboard-server', files: ['src/__tests__/432-editor-production.test.ts'], typecheck: false, count: 28 },
  review: { pkg: 'packages/knowledge-local', files: ['src/review/__tests__/432-direct-review.test.ts'], typecheck: false, count: 13 },
  disposition: { pkg: 'packages/knowledge-local', files: ['src/curator/__tests__/disposition.test.ts'], typecheck: false, count: 48 },
  feedback: { pkg: 'packages/cli', files: ['src/gates/__tests__/feedback-host.test.ts'], typecheck: false, count: 25, env: { VITEST_MAX_WORKERS: '1' } },
  config: { pkg: 'packages/cli', files: ['src/composition/__tests__/432-direct-config.test.ts'], typecheck: false, count: 16, env: { VITEST_MAX_WORKERS: '1' } },
  authoring: { pkg: 'packages/agent-local', files: ['src/__tests__/authoring-loop.e2e.test.ts'], typecheck: false, count: 27 },
  leaves: { pkg: 'packages/core', files: ['src/__tests__/config-schema-leaves.test.ts'], typecheck: false, count: 3 },
  page: { pkg: 'packages/dashboard-ui', files: ['src/pages/__tests__/config-page.schema-coverage.test.tsx'], typecheck: false, count: 24 },
  hold: { pkg: 'packages/knowledge-local', files: ['src/review/__tests__/gate-inconsistency.test.ts'], typecheck: false, count: 7 },
  mcp: { pkg: 'packages/cli', files: ['src/__tests__/mcp-mark-credential.test.ts'], typecheck: false, count: 6, env: { VITEST_MAX_WORKERS: '1' } },
  door: { pkg: 'packages/cli', files: ['src/__tests__/dashboard-door-security.test.ts'], typecheck: false, count: 13, env: { VITEST_MAX_WORKERS: '1' } },
  live: { pkg: 'packages/cli', files: ['src/__tests__/live-view-masking.test.ts'], typecheck: false, count: 7, env: { VITEST_MAX_WORKERS: '1' } },
  audit: { pkg: 'packages/safety-local', files: ['src/__tests__/jsonl-audit-sink.test.ts'], typecheck: false, count: 11 },
}

const edit = (from, to) => ({ from, to })
const census = (name, message) => cell('census', CENSUS_T, name, 1, message)
const returned = (id, message) => census(`C432-RETURN-${id}`, message)
const DELETED_FILES = census('C432-DELETED-SYMBOLS: every deleted module file is absent')
const DELETED_BARREL = census('C432-DELETED-SYMBOLS: no package barrel names a deleted export in code')
const DELETED_DECLARED = census('C432-DELETED-SYMBOLS: no production source in any package declares a deleted export in code')
const LEGACY_PATHS = census('C432-LEFTOVERS-UNREAD: no production code spells a legacy grant, proposal or execution-audit path')
const CENSUS_CONTROLS = [census('UNIVERSE-FLOORS'), census('LEXER-CONTROL'), census('PLANTED-POSITIVE'), census('SELF-MATCH')]

/** The census reports a returned spelling as `<leg>: <member> returned (<needle>)`. */
const needle = (id, member, spelled) => `${id}: ${member} returned (${spelled})`
/** …and a returned declaration shape as `<leg>: <member> returned:`. */
const shape = (id, member) => `${id}: ${member} returned:`

/**
 * One A leg: one removed member back, its own cell red by its own assertion. `parts` are the files it
 * touches, the first being the map's mutation target; `allowed` are the census cells a returning
 * module or export necessarily reds beside it (the deleted-module and deleted-export inventories, a
 * sibling member of the same deleted module).
 */
function aLeg(id, claim, operation, parts, message, allowed = []) {
  const [own, ...also] = parts
  return {
    id, claim, operation, instrument: 'census',
    subject: own.subject, ...(own.create === undefined ? { edits: own.edits } : { create: own.create }),
    ...(also.length === 0 ? {} : { also }),
    reds: [returned(id, message)], allowed, greens: CENSUS_CONTROLS,
  }
}
const editing = (file, ...edits) => ({ subject: `${P}${file}`, edits })
const creating = (file, text) => ({ subject: `${P}${file}`, create: text })

// ---- A: the removed members, row by row ---------------------------------------------------------

const CLI_HOST = 'cli/src/composition/local-agent-host.ts'
const CHAT = 'cli/src/commands/chat.ts'
const MAINTAIN = 'cli/src/commands/knowledge-maintain.ts'
const REGISTRY = 'agent/src/functions/registry.ts'
const MAPPING = 'mcp/src/mapping.ts'
const SPEC = 'agent/src/functions/spec.ts'
const CALLER = 'schema/src/functions/function-caller.ts'
const SERVICES = 'core/src/schema/services-schema.ts'
const SCOPE_MODULE = 'schema/src/functions/function-scope.ts'
const REMEDY_MODULE = 'schema/src/safety/remedies.ts'
const PROTECTED_MODULE = 'schema/src/safety/protected-classes.ts'
const GATE_MODULE = 'safety/src/policy/gate.ts'

const HOST_ANCHOR = 'export const CLI_FUNCTION_CALLER: FunctionCaller = {'
const CHAT_ANCHOR = 'function globalOptions(command: Command): { config?: string } {'
const REGISTRY_ANCHOR = 'const BUILT_IN_FUNCTION_SPECS: readonly FunctionSpec[] = [\n'
const MAPPING_ANCHOR = 'export const AGENT_QA_TOOL_PROJECTIONS: readonly ToolProjection[] = Object.freeze([\n'
// 2026-10-03 (quick-261003-tsr, IN-02): the anchor follows the re-worded risk doc in spec.ts.
const SPEC_ANCHOR = '  /** The risk descriptor of this op: listings, MCP tool annotations and the read scope read it (no gate since 432-13). */\n  risk: RiskActionDescriptor\n}'
const CALLER_ANCHOR = '  origin: FunctionCallerOrigin\n}'

/** A retired op id registered again over a live op's spec, so the registry holds a valid member. */
const registered = (id, opId, base) => aLeg(id, `C432-RETURN-${id}`, `register ${opId} again over ${base}`,
  [editing(REGISTRY, edit(REGISTRY_ANCHOR,
    `${REGISTRY_ANCHOR}  { ...${base}, id: '${opId}', risk: { ...${base}.risk, name: 'fn:${opId}' } } as FunctionSpec,\n`))],
  needle(id, opId, `'${opId}'`))

/** A retired MCP tool projected again over a live op. */
const projected = (id, member, tool, op, kind) => aLeg(id, `C432-RETURN-${id}`, `project ${tool} again over ${op}`,
  [editing(MAPPING, edit(MAPPING_ANCHOR,
    `${MAPPING_ANCHOR}  Object.freeze({\n    name: '${tool}',\n    ops: Object.freeze(['${op}']),\n    kind: '${kind}',\n  }),\n`))],
  needle(id, member, tool))

/** A single-member capability scope union, created where the union lived. */
const scopeMember = (id, literal) => aLeg(id, `C432-RETURN-${id}`, `restore FunctionScopeSchema with the one member '${literal}'`,
  [creating(SCOPE_MODULE, `import { z } from 'zod'\n\nexport const FunctionScopeSchema = z.enum(['${literal}'])\n\nexport type FunctionScope = z.infer<typeof FunctionScopeSchema>\n`)],
  shape(id, `the capability member ${literal}`),
  [...['A46', 'A47', 'A48', 'A49', 'A50', 'A51', 'A52'].filter(other => other !== id).map(other => returned(other)),
    DELETED_FILES, DELETED_DECLARED])

/** A single-member remedy vocabulary, created where the vocabulary lived. */
const remedyMember = (id, literal) => aLeg(id, `C432-RETURN-${id}`, `restore GATE_REMEDY_KINDS with the one member '${literal}'`,
  [creating(REMEDY_MODULE, `export const GATE_REMEDY_KINDS = ['${literal}'] as const\n\nexport type GateRemedyKind = (typeof GATE_REMEDY_KINDS)[number]\n`)],
  needle(id, `the ${literal} remedy`, `'${literal}'`),
  [...['A69', 'A70', 'A71', 'A72'].filter(other => other !== id).map(other => returned(other)), DELETED_FILES, DELETED_DECLARED])

/** A retired caller member declared on FunctionCaller again. */
const callerKey = (id, member, key, type) => aLeg(id, `C432-RETURN-${id}`, `declare FunctionCaller.${key} again`,
  [editing(CALLER, edit(CALLER_ANCHOR, `  origin: FunctionCallerOrigin\n  ${key}?: ${type}\n}`))],
  needle(id, member, key))

const MCP_DTO_HEAD = "import { z } from 'zod'\n\n"
const MCP_TOKEN_DTO = `${MCP_DTO_HEAD}// 432-43 A59: the retired MCP token entry, its scope enum spelled here (no deleted FunctionScope).
export const McpTokenEntrySchema = z.object({
  name: z.string().trim().min(1),
  tokenEnvVar: z.string().trim().min(1),
  scopes: z.array(z.enum(['read', 'run', 'config-write', 'knowledge-write', 'approval-write', 'test-write'])).min(1),
}).strict()

export type McpTokenEntry = z.infer<typeof McpTokenEntrySchema>
`
const MCP_STDIO_DTO = `${MCP_DTO_HEAD}// 432-43 A63: the retired stdio config-write opt-in.
export const McpStdioGrantSchema = z.object({
  grantConfigWrite: z.boolean().default(false),
}).strict()

export type McpStdioGrant = z.infer<typeof McpStdioGrantSchema>
`
const RUN_SERVICE_DTO = `${MCP_DTO_HEAD}// 432-43 A61: the retired run-service token entry, its trust scope spelled inline (no deleted grant-ops).
export const RunServiceTokenEntrySchema = z.object({
  name: z.string().trim().min(1),
  tokenEnvVar: z.string().trim().min(1),
  trustScope: z.object({
    project: z.string().trim().min(1).optional(),
    org: z.string().trim().min(1).optional(),
  }).strict(),
}).strict()

export type RunServiceTokenEntry = z.infer<typeof RunServiceTokenEntrySchema>
`
const SERVICES_IMPORT = "import { DurationString, SizeString } from './primitives.js'"
const MCP_LAST_KEY = "  path: z.string().trim().min(1).regex(/^\\//, 'MCP path must start with /').optional(),\n}).strict()"
const DASHBOARD_LAST_KEY = '  host: z.string().trim().min(1).optional(),\n}).strict()'
const CONFIG_BARREL_ANCHOR = "export { deviceConfigSchema } from './device'\n"
/** The public parser reads core's dist; core reads schema's. Both are rebuilt, schema first. */
const coreCrossing = marker => ({ pkg: '@vostride/agent-qa-core', dir: 'packages/core', marker,
  reference: "'core/dist/index.js'", byPath: true, before: [{ pkg: '@vostride/agent-qa-schema', dir: 'packages/schema' }] })

const aLegs = [
  aLeg('A01', 'C432-RETURN-A01', 'restore the terminal y/N question literal in the CLI host',
    [editing(CLI_HOST, edit(HOST_ANCHOR,
      'export const TERMINAL_APPROVAL_QUESTION = (actionName: string): string =>\n  `${actionName} needs your approval. Proceed? [y/N] `\n\n' + HOST_ANCHOR))],
    needle('A01', 'the terminal y/N approval prompt', '[y/N]')),
  aLeg('A02', 'C432-RETURN-A02', 'restore the chat two-answer approval prompt',
    [editing(CHAT, edit(CHAT_ANCHOR, "const CHAT_APPROVAL_PROMPT = 'Run this action? [y/N] '\n\n" + CHAT_ANCHOR))],
    needle('A02', 'the chat two-answer approval prompt', '[y/N]')),
  aLeg('A03', 'C432-RETURN-A03', 'restore the chat always-answer branch',
    [editing(CHAT, edit(CHAT_ANCHOR,
      "function chatApprovalAnswer(line: string): 'yes' | 'no' | 'always' {\n  const answer = line.trim().toLowerCase()\n  if (answer === 'a') return 'always'\n  return answer === 'y' ? 'yes' : 'no'\n}\n\n" + CHAT_ANCHOR))],
    needle('A03', 'the chat always-answer branch', "'always'")),
  aLeg('A04', 'C432-RETURN-A04', 'ask the rollback confirmation on the terminal before the lease',
    [editing(MAINTAIN,
      edit("import { readdirSync } from 'node:fs'\n", "import { readdirSync } from 'node:fs'\nimport { createInterface } from 'node:readline'\n"),
      edit('        emitHuman(renderRollbackPreview(previewAffected), previewStream(options.json === true))\n',
        '        emitHuman(renderRollbackPreview(previewAffected), previewStream(options.json === true))\n'
        + '        const confirmed = await new Promise<boolean>((done) => {\n'
        + '          const rl = createInterface({ input: process.stdin, output: process.stderr })\n'
        + "          rl.question('Apply this rollback? (y/N) ', (answer) => {\n"
        + '            rl.close()\n'
        + "            done(answer.trim().toLowerCase() === 'y')\n"
        + '          })\n'
        + '        })\n'
        + '        if (!confirmed) return\n'))],
    needle('A04', 'the knowledge rollback confirmation', 'Apply this rollback')),
  aLeg('A05', 'C432-RETURN-A05', 'ask the purge confirmation before purging every cached plan',
    [editing('cli/src/commands/cache.ts',
      edit('export async function purgeAll(cacheDir: string): Promise<number> {',
        'export async function purgeAll(\n  cacheDir: string,\n  confirm: (question: string) => Promise<boolean> = async () => true,\n): Promise<number> {'),
      edit('  if (total === 0) return 0\n  return removeCacheEntries(resolvedDir)',
        '  if (total === 0) return 0\n  if (!(await confirm(`Purge ${total} cached plans. Continue? (y/N) `))) return 0\n  return removeCacheEntries(resolvedDir)'))],
    needle('A05', 'the cache purge confirmation', 'Continue? (y/N)')),
  aLeg('A06', 'C432-RETURN-A06', 'require the record id repeated through --confirm before a purge',
    [editing(MAINTAIN,
      edit('interface PurgeOptions {\n  json?: boolean\n}', 'interface PurgeOptions {\n  json?: boolean\n  confirm?: string\n}'),
      edit("    .option('--json', 'output the typed PurgeReceipt as masked JSON')\n",
        "    .option('--json', 'output the typed PurgeReceipt as masked JSON')\n    .option('--confirm <record-id>', 'repeat the record id to confirm irreversible purge')\n"),
      edit('        const recordId = asRecordId(recordIdValue)\n',
        "        const recordId = asRecordId(recordIdValue)\n        if (options.confirm !== recordIdValue) throw new Error('confirmation-mismatch: repeat the record id with --confirm')\n"))],
    needle('A06', 'the knowledge purge repeated-id confirmation', "'--confirm")),
  aLeg('A07', 'C432-RETURN-A07', 'register the GET run-confirm channel route with a buildable handler',
    [creating('dashboard-server/src/chat/chat-routes.ts', `import type { IncomingMessage, ServerResponse } from 'node:http'

export const RUN_CONFIRM_CHANNEL_ROUTE = '/api/run-confirm/channel'

export function serveRunConfirmChannel(path: string, req: IncomingMessage, res: ServerResponse): boolean {
  if (path !== RUN_CONFIRM_CHANNEL_ROUTE || req.method !== 'GET') return false
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' })
  res.end()
  return true
}
`)],
    needle('A07', 'the GET run-confirm channel route', '/api/run-confirm/channel'), [DELETED_FILES, DELETED_DECLARED]),
  aLeg('A08', 'C432-RETURN-A08', 'register the POST run-confirm answer route with a buildable handler',
    [creating('dashboard-server/src/chat/chat-routes.ts', `import type { IncomingMessage, ServerResponse } from 'node:http'

export const RUN_CONFIRM_ANSWER_ROUTE = '/api/run-confirm/answer'

export function serveRunConfirmAnswer(path: string, req: IncomingMessage, res: ServerResponse): boolean {
  if (path !== RUN_CONFIRM_ANSWER_ROUTE || req.method !== 'POST') return false
  res.writeHead(204)
  res.end()
  return true
}
`)],
    needle('A08', 'the POST run-confirm answer route', '/api/run-confirm/answer'), [DELETED_FILES, DELETED_DECLARED]),
  aLeg('A09', 'C432-RETURN-A09', 'restore the dashboard run-confirm dialog module',
    [creating('dashboard-ui/src/components/run-confirm-dialog.tsx', `export function RunConfirmDialog({ onAnswer }: { onAnswer: (run: boolean) => void }) {
  return (
    <div role="dialog" data-run-confirm-dialog="">
      <button type="button" onClick={() => onAnswer(true)}>Run</button>
      <button type="button" onClick={() => onAnswer(false)}>Cancel</button>
    </div>
  )
}
`)],
    needle('A09', 'the dashboard run-confirm dialog', 'RunConfirmDialog'), [DELETED_FILES, DELETED_DECLARED]),
  aLeg('A10', 'C432-RETURN-A10', 'restore the dashboard mark approval module',
    [creating('dashboard-ui/src/components/run-detail/feedback-approval.tsx', `export function FeedbackApproval({ onAnswer }: { onAnswer: (apply: boolean) => void }) {
  return (
    <div role="group" data-feedback-approval="">
      <button type="button" onClick={() => onAnswer(true)}>Apply fix</button>
      <button type="button" onClick={() => onAnswer(false)}>Dismiss</button>
    </div>
  )
}
`)],
    needle('A10', 'the dashboard mark approval', 'FeedbackApproval'), [DELETED_FILES, DELETED_DECLARED]),
  aLeg('A11', 'C432-RETURN-A11', 'restore the ConfirmRegistry class module',
    [creating('dashboard-server/src/chat/confirm-registry.ts', `export class ConfirmRegistry {
  private readonly pending = new Map<string, (answer: boolean) => void>()

  ask(id: string): Promise<boolean> {
    return new Promise((resolve) => this.pending.set(id, resolve))
  }

  answer(id: string, answer: boolean): boolean {
    const resolve = this.pending.get(id)
    if (resolve === undefined) return false
    this.pending.delete(id)
    resolve(answer)
    return true
  }
}
`)],
    needle('A11', 'the confirm registry', 'ConfirmRegistry'), [DELETED_FILES, DELETED_DECLARED]),
  aLeg('A12', 'C432-RETURN-A12', 'restore resolveAsk alone as a valid gate module',
    [creating(GATE_MODULE, `export type AskAnswer = 'yes' | 'no'

export function resolveAsk(answer: string | undefined): AskAnswer {
  return answer?.trim().toLowerCase() === 'y' ? 'yes' : 'no'
}
`)],
    needle('A12', 'resolveAsk', 'resolveAsk'), [DELETED_FILES, DELETED_DECLARED]),
  aLeg('A13', 'C432-RETURN-A13', 'restore the execution-policy evaluate export alone as a valid gate module',
    [creating(GATE_MODULE, `export type ExecutionPolicyOutcome = 'allow' | 'deny'

export function evaluate(actionClass: string): ExecutionPolicyOutcome {
  return actionClass.length > 0 ? 'allow' : 'deny'
}
`)],
    shape('A13', 'the execution-policy evaluate export'), [DELETED_FILES]),
  aLeg('A14', 'C432-RETURN-A14', 'restore the baseVerdict ask ladder in an isolated valid gate module',
    [creating(GATE_MODULE, `export type BaseVerdict = 'allow' | 'ask' | 'deny'

export function baseVerdict(riskTier: 'low' | 'medium' | 'high'): BaseVerdict {
  if (riskTier === 'low') return 'allow'
  if (riskTier === 'medium') return 'ask'
  return 'deny'
}
`)],
    needle('A14', 'the baseVerdict ask ladder', 'baseVerdict'), [DELETED_FILES, DELETED_DECLARED]),
  aLeg('A15', 'C432-RETURN-A15', 'restore the execution gate hook export',
    [creating('safety/src/policy/gate-hook.ts', `export interface PolicyGateHookDeps {
  readonly allow: (actionName: string) => boolean
}

export function createPolicyGateToolCallHook(deps: PolicyGateHookDeps) {
  return (actionName: string): 'continue' | 'deny' => (deps.allow(actionName) ? 'continue' : 'deny')
}
`)],
    needle('A15', 'the execution gate hook', 'createPolicyGateToolCallHook'), [DELETED_FILES, DELETED_DECLARED]),
  aLeg('A16', 'C432-RETURN-A16', 'restore only the confirm port contract',
    [creating('safety/src/ports/policy-ports.ts', `export interface ConfirmPort {
  confirm(question: string): Promise<boolean>
}
`)],
    needle('A16', 'ConfirmPort', 'ConfirmPort'), [DELETED_FILES, DELETED_DECLARED]),
  aLeg('A17', 'C432-RETURN-A17', 'restore the readline confirmation module',
    [creating('safety-local/src/readline-confirm.ts', `import { createInterface } from 'node:readline'

export function createReadlineConfirm(
  input: NodeJS.ReadableStream = process.stdin,
  output: NodeJS.WritableStream = process.stderr,
): (question: string) => Promise<boolean> {
  return (question) => new Promise((resolve) => {
    const rl = createInterface({ input, output })
    rl.question(question, (answer) => {
      rl.close()
      resolve(answer.trim().toLowerCase() === 'y')
    })
  })
}
`)],
    needle('A17', 'the readline confirmation', 'createReadlineConfirm'), [DELETED_FILES, DELETED_DECLARED]),
  registered('A18', 'grants.list', 'quarantineListSpec'),
  registered('A19', 'grants.revoke', 'quarantineReleaseSpec'),
  aLeg('A20', 'C432-RETURN-A20', 'restore the grants.jsonl writer module',
    [creating('knowledge-local/src/grants/ledger.ts', `import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

export const GRANT_LEDGER_FILENAME = 'grants.jsonl'

export function appendGrantLedgerEvents(knowledgeRoot: string, events: readonly object[]): void {
  mkdirSync(knowledgeRoot, { recursive: true })
  appendFileSync(join(knowledgeRoot, GRANT_LEDGER_FILENAME), events.map((event) => \`\${JSON.stringify(event)}\\n\`).join(''))
}
`)],
    needle('A20', 'the grant ledger writer', 'appendGrantLedgerEvents'), [DELETED_FILES, DELETED_DECLARED, LEGACY_PATHS]),
  aLeg('A21', 'C432-RETURN-A21', 'restore the grants.jsonl reader module',
    [creating('knowledge-local/src/grants/reader.ts', `import { existsSync, readFileSync } from 'node:fs'

export function readGrantLedger(file: string): readonly unknown[] {
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8')
    .split('\\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as unknown)
}
`)],
    needle('A21', 'the grant ledger reader', 'readGrantLedger'), [DELETED_FILES, DELETED_DECLARED]),
  aLeg('A22', 'C432-RETURN-A22', 'restore the standing approval contract',
    [creating('schema/src/safety/standing-approval.ts', `export interface StandingApprovalGrant {
  readonly grantId: string
  readonly actionClass: string
  readonly grantedAt: string
}
`)],
    needle('A22', 'the standing approval contract', 'StandingApprovalGrant'), [DELETED_FILES, DELETED_DECLARED]),
  aLeg('A23', 'C432-RETURN-A23', 'restore only fn:proposals.accept protected membership',
    [creating(PROTECTED_MODULE, "export const PROTECTED_ACTION_CLASSES: readonly string[] = ['fn:proposals.accept']\n")],
    needle('A23', 'the protected proposals class', 'fn:proposals.accept'), [returned('A24'), DELETED_FILES, DELETED_DECLARED]),
  aLeg('A24', 'C432-RETURN-A24', 'restore only fn:grants.revoke protected membership',
    [creating(PROTECTED_MODULE, "export const PROTECTED_ACTION_CLASSES: readonly string[] = ['fn:grants.revoke']\n")],
    needle('A24', 'the protected grants class', 'fn:grants.revoke'), [returned('A23'), DELETED_FILES, DELETED_DECLARED]),
  registered('A25', 'proposals.list', 'quarantineListSpec'),
  registered('A26', 'proposals.show', 'knowledgeRecordShowSpec'),
  registered('A27', 'proposals.accept', 'knowledgeAcceptSpec'),
  registered('A28', 'proposals.reject', 'knowledgeRejectSpec'),
  registered('A29', 'knowledge.proposal.apply', 'knowledgeAcceptSpec'),
  registered('A30', 'config.proposal.apply', 'configFieldSetSpec'),
  registered('A31', 'config.undo.propose', 'configFieldSetSpec'),
  registered('A32', 'knowledge.accept.propose', 'knowledgeAcceptSpec'),
  registered('A33', 'knowledge.reject.propose', 'knowledgeRejectSpec'),
  registered('A34', 'knowledge.forget.propose', 'knowledgeForgetSpec'),
  projected('A35', 'the propose-knowledge-change tool', 'agent_qa_propose_knowledge_change', 'knowledge.accept', 'workflow'),
  projected('A36', 'the apply-proposal tool', 'agent_qa_apply_proposal', 'knowledge.accept', 'workflow'),
  projected('A37', 'the propose-config-change tool', 'agent_qa_propose_config_change', 'config.field.set', 'workflow'),
  projected('A38', 'the apply-config-proposal tool', 'agent_qa_apply_config_proposal', 'config.field.set', 'workflow'),
  projected('A39', 'the list-proposals tool', 'agent_qa_list_proposals', 'knowledge.bundles.list', 'read'),
  projected('A40', 'the show-proposal tool', 'agent_qa_show_proposal', 'knowledge.record.show', 'read'),
  aLeg('A41', 'C432-RETURN-A41', 'restore the proposal envelope export in its deleted directory',
    [creating('schema/src/proposal/envelope.ts', `import { z } from 'zod'

export const PROPOSAL_KINDS = ['knowledge', 'config', 'test-draft'] as const

export const ProposalEnvelopeSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(PROPOSAL_KINDS),
}).strict()

export type ProposalEnvelope = z.infer<typeof ProposalEnvelopeSchema>
`)],
    needle('A41', 'the proposal envelope', 'ProposalEnvelope'), [DELETED_FILES, DELETED_DECLARED]),
  aLeg('A42', 'C432-RETURN-A42', 'restore the pending-proposal file writer module',
    [creating('knowledge-local/src/review/proposals-store.ts', `import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export function writePendingProposal(dir: string, id: string, envelope: object): string {
  mkdirSync(dir, { recursive: true })
  const file = join(dir, \`\${id}.json\`)
  writeFileSync(file, \`\${JSON.stringify(envelope)}\\n\`, { flag: 'wx' })
  return file
}
`)],
    needle('A42', 'the proposal store', 'writePendingProposal'), [DELETED_FILES, DELETED_DECLARED]),
  aLeg('A43', 'C432-RETURN-A43', 'restore the proposal inbox reader module',
    [creating('knowledge-local/src/review/proposals-inbox.ts', `import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface ProposalsInboxOptions {
  readonly dir: string
}

export function createProposalsInbox(options: ProposalsInboxOptions) {
  return {
    list(): readonly unknown[] {
      return readdirSync(options.dir)
        .filter((name) => name.endsWith('.json'))
        .map((name) => JSON.parse(readFileSync(join(options.dir, name), 'utf8')) as unknown)
    },
  }
}
`)],
    needle('A43', 'the proposal inbox reader', 'createProposalsInbox'), [DELETED_FILES, DELETED_DECLARED]),
  aLeg('A44', 'C432-RETURN-A44', 'restore the proposals command module',
    [creating('cli/src/commands/proposals.ts', `import { Command } from 'commander'

export function createProposalsCommand(): Command {
  return new Command('proposals').description('Review pending proposals')
}
`)],
    needle('A44', 'the proposals CLI', 'createProposalsCommand'), [DELETED_FILES, DELETED_DECLARED]),
  aLeg('A45', 'C432-RETURN-A45', 'declare requiresHumanOrigin on the function metadata contract again',
    [editing(SPEC, edit(SPEC_ANCHOR,
      '  /** The risk descriptor of this op: listings, MCP tool annotations and the read scope read it (no gate since 432-13). */\n  risk: RiskActionDescriptor\n  requiresHumanOrigin?: boolean\n}'))],
    needle('A45', 'requiresHumanOrigin', 'requiresHumanOrigin')),
  aLeg('A46', 'C432-RETURN-A46', 'restore the capability scope export',
    [creating(SCOPE_MODULE, "import { z } from 'zod'\n\nexport const FunctionScopeSchema = z.string().min(1)\n\nexport type FunctionScope = z.infer<typeof FunctionScopeSchema>\n")],
    needle('A46', 'FunctionScope', 'FunctionScopeSchema'),
    [...['A47', 'A48', 'A49', 'A50', 'A51', 'A52'].map(other => returned(other)), DELETED_FILES, DELETED_DECLARED]),
  scopeMember('A47', 'read'),
  scopeMember('A48', 'run'),
  scopeMember('A49', 'config-write'),
  scopeMember('A50', 'knowledge-write'),
  scopeMember('A51', 'approval-write'),
  scopeMember('A52', 'test-write'),
  aLeg('A53', 'C432-RETURN-A53', 'declare requiredScopes on the function metadata contract again',
    [editing(SPEC, edit(SPEC_ANCHOR,
      '  /** The risk descriptor of this op: listings, MCP tool annotations and the read scope read it (no gate since 432-13). */\n  risk: RiskActionDescriptor\n  requiredScopes?: readonly string[]\n}'))],
    needle('A53', 'requiredScopes metadata', 'requiredScopes')),
  callerKey('A54', 'the grantedScopes caller key', 'grantedScopes', 'readonly string[]'),
  callerKey('A55', 'the safeMode caller key', 'safeMode', 'boolean'),
  callerKey('A56', 'the credential caller key', 'credential', 'string'),
  callerKey('A57', 'the sessionId overlay caller key', 'sessionId', 'string'),
  aLeg('A58', 'C432-RETURN-A58', 'restore the visibleToCaller module',
    [creating('mcp/src/visibility.ts', `export function visibleToCaller(toolName: string, allowed: ReadonlySet<string>): boolean {
  return allowed.has(toolName)
}
`)],
    needle('A58', 'MCP permission visibility', 'visibleToCaller'), [DELETED_FILES, DELETED_DECLARED]),
  {
    ...aLeg('A59', 'C432-RETURN-A59', 'restore services.mcp.tokens: its entry DTO, the config and root barrel exports, and core’s key and import',
      [editing(SERVICES,
        edit(SERVICES_IMPORT, `import { McpTokenEntrySchema } from '@vostride/agent-qa-schema'\n${SERVICES_IMPORT}`),
        edit(MCP_LAST_KEY, MCP_LAST_KEY.replace('\n}).strict()', '\n  tokens: z.array(McpTokenEntrySchema).default([]),\n}).strict()'))),
      creating('schema/src/config/mcp.ts', MCP_TOKEN_DTO),
      editing('schema/src/config/index.ts', edit(CONFIG_BARREL_ANCHOR,
        `${CONFIG_BARREL_ANCHOR}export type { McpTokenEntry } from './mcp'\nexport { McpTokenEntrySchema } from './mcp'\n`)),
      editing('schema/src/index.ts',
        edit('  MaskingClass,\n', '  MaskingClass,\n  McpTokenEntry,\n'),
        edit('  MASKING_CLASSES,\n', '  MASKING_CLASSES,\n  McpTokenEntrySchema,\n'))],
      'the public parser accepts the removed member (services.mcp.tokens)', [DELETED_FILES, DELETED_BARREL, DELETED_DECLARED]),
    crossing: coreCrossing('McpTokenEntrySchema'),
  },
  aLeg('A60', 'C432-RETURN-A60', 'restore one bearer-denial branch on the MCP request listener',
    [editing('cli/src/commands/mcp.ts', edit("      return refuse(res, 403, 'forbidden_origin')\n    }\n",
      "      return refuse(res, 403, 'forbidden_origin')\n    }\n"
      + '    const bearer = (input as { readonly bearerToken?: string }).bearerToken\n'
      + '    if (bearer !== undefined && req.headers.authorization !== `Bearer ${bearer}`) {\n'
      + "      res.setHeader('WWW-Authenticate', 'Bearer')\n"
      + "      return refuse(res, 401, 'unauthorized')\n"
      + '    }\n'))],
    needle('A60', 'the MCP bearer check', 'Bearer')),
  {
    ...aLeg('A61', 'C432-RETURN-A61', 'restore services.dashboard.runServiceTokens: its entry DTO, the config and root barrel exports, and core’s key and import',
      [editing(SERVICES,
        edit(SERVICES_IMPORT, `import { RunServiceTokenEntrySchema } from '@vostride/agent-qa-schema'\n${SERVICES_IMPORT}`),
        edit(DASHBOARD_LAST_KEY, '  runServiceTokens: z.array(RunServiceTokenEntrySchema).default([]),\n' + DASHBOARD_LAST_KEY)),
      creating('schema/src/config/run-service.ts', RUN_SERVICE_DTO),
      editing('schema/src/config/index.ts', edit(CONFIG_BARREL_ANCHOR,
        `${CONFIG_BARREL_ANCHOR}export type { RunServiceTokenEntry } from './run-service'\nexport { RunServiceTokenEntrySchema } from './run-service'\n`)),
      editing('schema/src/index.ts',
        edit('  RemoteDeviceConfig,\n', '  RemoteDeviceConfig,\n  RunServiceTokenEntry,\n'),
        edit('  resolveEffectiveWorkers,\n', '  resolveEffectiveWorkers,\n  RunServiceTokenEntrySchema,\n'))],
      'the public parser accepts the removed member (services.dashboard.runServiceTokens)', [DELETED_FILES, DELETED_BARREL, DELETED_DECLARED]),
    crossing: coreCrossing('RunServiceTokenEntrySchema'),
  },
  aLeg('A62', 'C432-RETURN-A62', 'restore one bearer-denial branch above the run-service route table',
    [editing('dashboard-server/src/run-service/run-service-routes.ts',
      edit("      if (refuseCrossSiteRequest(req) !== undefined) {\n        refuse(res, 403, 'cross_site_refused')\n        return\n      }\n",
        "      if (refuseCrossSiteRequest(req) !== undefined) {\n        refuse(res, 403, 'cross_site_refused')\n        return\n      }\n"
        + '      const bearer = (ports as { readonly bearerToken?: string }).bearerToken\n'
        + '      if (bearer !== undefined && req.headers.authorization !== `Bearer ${bearer}`) {\n'
        + "        res.writeHead(401, { 'content-type': 'application/json' })\n"
        + "        res.end(JSON.stringify({ error: 'unauthorized' }))\n"
        + '        return\n'
        + '      }\n'))],
    needle('A62', 'the run-service bearer check', 'Bearer')),
  {
    ...aLeg('A63', 'C432-RETURN-A63', 'restore McpStdioGrantSchema, its exports and import, and stdio on McpConfigSchema',
      [editing(SERVICES,
        edit(SERVICES_IMPORT, `import { McpStdioGrantSchema } from '@vostride/agent-qa-schema'\n${SERVICES_IMPORT}`),
        edit(MCP_LAST_KEY, MCP_LAST_KEY.replace('\n}).strict()', '\n  stdio: McpStdioGrantSchema.prefault({}),\n}).strict()'))),
      creating('schema/src/config/mcp.ts', MCP_STDIO_DTO),
      editing('schema/src/config/index.ts', edit(CONFIG_BARREL_ANCHOR,
        `${CONFIG_BARREL_ANCHOR}export type { McpStdioGrant } from './mcp'\nexport { McpStdioGrantSchema } from './mcp'\n`)),
      editing('schema/src/index.ts',
        edit('  MaskingClass,\n', '  MaskingClass,\n  McpStdioGrant,\n'),
        edit('  MASKING_CLASSES,\n', '  MASKING_CLASSES,\n  McpStdioGrantSchema,\n'))],
      'the public parser accepts the removed member (services.mcp.stdio)', [DELETED_FILES, DELETED_BARREL, DELETED_DECLARED]),
    crossing: coreCrossing('McpStdioGrantSchema'),
  },
  {
    ...aLeg('A64', 'C432-RETURN-A64', 'register .option(\'--trust-session\', …) on createRunCommand() again',
      [editing('cli/src/commands/run.ts', edit("    .option('--bail', 'stop on first test failure')\n",
        "    .option('--bail', 'stop on first test failure')\n    .option('--trust-session', 'trust every action in this session')\n"))],
      'the run command registers the trust flag again'),
    crossing: { pkg: 'agent-qa', dir: 'packages/cli', marker: '--trust-session', reference: "'cli/dist/cli.js'", byPath: true },
  },
  {
    ...aLeg('A65', 'C432-RETURN-A65', 'restore the strict optional safety object with trustMode at the config root',
      [editing('core/src/schema/config-schema.ts', edit('  allowProduction: z.boolean().optional(),\n',
        '  allowProduction: z.boolean().optional(),\n  safety: z.object({ trustMode: z.boolean().optional() }).strict().optional(),\n'))],
      'the public parser accepts the removed member (safety)'),
    crossing: { pkg: '@vostride/agent-qa-core', dir: 'packages/core', marker: 'trustMode:', reference: "'core/dist/index.js'", byPath: true },
  },
  aLeg('A66', 'C432-RETURN-A66', 'restore requiresFailClosed beside the retained execution context',
    [editing('safety/src/policy/execution-context.ts', edit('export function getActiveExecutionContext(): ExecutionContext {\n  return active()\n}\n',
      "export function getActiveExecutionContext(): ExecutionContext {\n  return active()\n}\n\nexport function requiresFailClosed(context: ExecutionContext): boolean {\n  return context === 'ci' || context === 'cloud'\n}\n"))],
    needle('A66', 'the fail-closed policy', 'requiresFailClosed'), [DELETED_DECLARED]),
  aLeg('A67', 'C432-RETURN-A67', 'restore the pin directive branch in the turn engine',
    [editing('agent/src/chat/turn-engine.ts', edit("  try {\n    switch (entry.directive) {\n      case 'model': {\n",
      "  try {\n    if ((entry.directive as string) === 'pin') return notBound()\n    switch (entry.directive) {\n      case 'model': {\n"))],
    needle('A67', 'the pin directive', "'pin'")),
  aLeg('A68', 'C432-RETURN-A68', 'restore the pin overlay resolver module',
    [creating('agent/src/chat/pin-overlay.ts', `export class ChatPinError extends Error {
  constructor(actionClass: string) {
    super(\`Action \${actionClass} is not pinned for this session\`)
    this.name = 'ChatPinError'
  }
}

export function createPinOverlay() {
  const pinned = new Set<string>()
  return {
    pin(actionClass: string): void {
      pinned.add(actionClass)
    },
    check(actionClass: string): void {
      if (!pinned.has(actionClass)) throw new ChatPinError(actionClass)
    },
  }
}
`)],
    needle('A68', 'the pin overlay resolver', 'createPinOverlay'), [DELETED_FILES, DELETED_DECLARED]),
  remedyMember('A69', 'answer-confirm'),
  remedyMember('A70', 'trust-session-flag'),
  remedyMember('A71', 'session-pin-final'),
  remedyMember('A72', 'present-bearer-scope'),
  aLeg('A73', 'C432-RETURN-A73', 'restore one approval-remedy line under the CLI receipt',
    [editing('cli/src/commands/receipt-line.ts', edit('    + `  ${pc.dim(receipt.clause)}\\n    ${pc.dim(receipt.outcome)}`\n}\n',
      '    + `  ${pc.dim(receipt.clause)}\\n    ${pc.dim(receipt.outcome)}`\n    + remedyLine((receipt as { readonly remedy?: string }).remedy)\n}\n\n'
      + 'function remedyLine(remedy: string | undefined): string {\n  return remedy === undefined ? \'\' : `\\n    ${pc.dim(`To proceed: ${remedy}`)}`\n}\n'))],
    needle('A73', 'the CLI remedy renderer', 'remed')),
  aLeg('A74', 'C432-RETURN-A74', 'restore one approval-remedy line in the dashboard denial block',
    [editing('dashboard-ui/src/components/run-detail/denial-block.tsx',
      edit('export function DenialBlock({ neutralReason }: { neutralReason: string }) {',
        'export function DenialBlock({ neutralReason, remedy }: { neutralReason: string; remedy?: string }) {'),
      edit('      <p className="text-foreground">{neutralReason}</p>\n',
        '      <p className="text-foreground">{neutralReason}</p>\n      {remedy === undefined ? null : <p className="text-muted-foreground">{remedy}</p>}\n'))],
    needle('A74', 'the dashboard remedy renderer', 'remed')),
  aLeg('A75', 'C432-RETURN-A75', 'restore only the unused command-pattern export beside the name signals',
    [editing('safety/src/policy/lexicon.ts', edit('function tokens(value: string): string[] {',
      'export const HARD_DESTRUCTIVE_PATTERNS: readonly RegExp[] = [/\\brm\\s+-rf\\b/, /\\bdrop\\s+table\\b/i]\n\nfunction tokens(value: string): string[] {'))],
    needle('A75', 'the hard destructive command patterns', 'HARD_DESTRUCTIVE_PATTERNS'), [DELETED_DECLARED]),
  aLeg('A76', 'C432-RETURN-A76', 'restore appendExecutionAudit and its path beside appendGuardrailAudit',
    [editing('safety-local/src/jsonl-audit-sink.ts', edit('  private append(file: string, persisted: object): void {',
      "  appendExecutionAudit(row: object): void {\n    this.append('execution_audit.jsonl', { ts: new Date().toISOString(), ...row })\n  }\n\n  private append(file: string, persisted: object): void {"))],
    needle('A76', 'the execution audit writer', 'appendExecutionAudit'), [LEGACY_PATHS]),
  aLeg('A77', 'C432-RETURN-A77', 'restore only the execution-policy row contract',
    [editing('safety/src/ports/audit-sink.ts', edit('export interface AuditSink {',
      "export interface ExecutionAuditRow {\n  runId?: string\n  actionClass: string\n  verdict: 'allow' | 'deny'\n}\n\nexport interface AuditSink {"))],
    needle('A77', 'ExecutionAuditRow', 'ExecutionAuditRow'), [DELETED_DECLARED]),
  aLeg('A78', 'C432-RETURN-A78', 'restore the product commit invocation behind an injected subprocess spy',
    [editing(CLI_HOST, edit(HOST_ANCHOR,
      'export function commitPublishedFile(\n  cwd: string,\n  filePath: string,\n'
      + '  spawn: (command: string, args: readonly string[], options: { readonly cwd: string }) => unknown,\n'
      + '): unknown {\n'
      + "  return spawn('git', ['commit', '-m', `Agent-QA-Proposal: ${filePath}`, '--', filePath], { cwd })\n"
      + '}\n\n' + HOST_ANCHOR))],
    needle('A78', 'the product git commit', "'commit'")),
]

// ---- B: the retained behaviours, row by row -------------------------------------------------------

const B = (instrument, file) => (name, count = 1) => cell(instrument, file, name, count)
const boundary = B('boundary', instruments.boundary.files[0])
const producers = B('producers', instruments.producers.files[0])
const editor = B('editor', instruments.editor.files[0])
const review = B('review', instruments.review.files[0])
const disposition = B('disposition', instruments.disposition.files[0])
const feedback = B('feedback', instruments.feedback.files[0])
const config = B('config', instruments.config.files[0])
const authoring = B('authoring', instruments.authoring.files[0])
const leaves = B('leaves', instruments.leaves.files[0])
const page = B('page', instruments.page.files[0])
const hold = B('hold', instruments.hold.files[0])
const mcp = B('mcp', instruments.mcp.files[0])
const door = B('door', instruments.door.files[0])
const live = B('live', instruments.live.files[0])
const audit = B('audit', instruments.audit.files[0])

const RETRY = 'C432-MARK-RETRY-ONCE: a knowledge mark interrupted'
const OUTSIDE_EDIT = 'C432-CONFIG-OUTSIDE-EDIT: a generated change merges onto the file as it is at its turn'
const PATH_QUEUE = 'C432-CONFIG-PATH-QUEUE: the direct writer and the dashboard manager share one queue per path'
const WRITE = 'C432-TEST-WRITE-DISPOSITION'
const dashboardCrossing = marker => ({ pkg: '@vostride/agent-qa-dashboard', dir: 'packages/dashboard-server', marker })
const schemaCrossing = marker => ({ pkg: '@vostride/agent-qa-schema', dir: 'packages/schema', marker })

const bLegs = [
  {
    id: 'B01', claim: 'C432-PRODUCTION-BEFORE-EFFECTS', instrument: 'boundary',
    operation: 'bypass the pre-assembly production refusal in the run core',
    subject: `${P}agent-local/src/composition/run-invocation-core.ts`,
    edits: [edit('      refuseProductionWithoutOptIn(runId, declaration)\n', '      void declaration.productionTargetNames\n')],
    reds: [boundary('C432-PRODUCTION-BEFORE-EFFECTS')],
    // A bypassed refusal refuses nothing: every other refusal cell in the file reds with it.
    allowed: [
      'a production CLASS with an empty name list still refuses — the core fails closed',
      'EDGE-04: a mixed local/undeclared/production member set refuses and names every production member',
      'C432-PRODUCTION-OPTIN: allowProduction false refuses exactly as absence does (EDGE-05)',
      'a non-boolean truthy value is not an opt-in (only the literal true counts)',
      'EDGE-07: repeated and mixed production names render once each, in first-occurrence order',
      'EDGE-07: the order is the declaration’s own, not an alphabetical re-sort',
      'EDGE-01: two refusals for the same target keep their own distinct run ids',
      'EDGE-06: a Unicode production target name appears byte-for-byte in the plain refusal',
      'EDGE-06: a control byte in a name is replaced, so the refusal stays one line',
      'EDGE-06: a production member named like a loopback host is still production',
    ].map(name => boundary(name)),
    greens: [],
  },
  {
    id: 'B02', claim: 'C432-MIXED-SUITE-PRODUCTION', instrument: 'producers',
    operation: 'drop the second production member in resolveMemberTargetFacts',
    subject: `${P}cli/src/commands/run.ts`,
    edits: [edit("      if (resolved.environment === 'production' && !productionTargetNames.includes(targetName)) {",
      "      if (resolved.environment === 'production' && productionTargetNames.length === 0) {")],
    reds: [producers('C432-MIXED-SUITE-PRODUCTION', 2)],
    // The same facts reach the single-run producer: it drops the second member too.
    allowed: [
      producers('C432-PRODUCTION-PRODUCERS: the direct producer returns every production member, first occurrence first'),
      producers('C432-PRODUCTION-PRODUCERS: real declaration resolution, fake effects behind it, and none of them run'),
    ],
    greens: [],
  },
  {
    id: 'B03', claim: 'C432-EDITOR-PRODUCTION', instrument: 'editor',
    operation: 'move the live editor production refusal after the setup hooks',
    subject: `${P}dashboard-server/src/live-editor/live-session.ts`,
    edits: [
      edit('    if (refusal !== undefined) throw refusal\n\n    this.platform = config.platform\n', '\n    this.platform = config.platform\n'),
      edit("    const setupResult = await this.runLifecycleHooks('setup', this.setupHooks)\n",
        "    const setupResult = await this.runLifecycleHooks('setup', this.setupHooks)\n    if (refusal !== undefined) throw refusal\n"),
    ],
    reds: [editor('C432-EDITOR-PRODUCTION: direct initialize refuses a production', 3)],
    // Every cell that drives initialize with setup hooks sees the hooks run before the refusal.
    allowed: [
      'only the literal true opts in: allowProduction false refuses as its absence does',
      'only the literal true opts in: allowProduction the string "true" refuses as its absence does',
      'only the literal true opts in: allowProduction 1 refuses as its absence does',
      'only the literal true opts in: allowProduction yes refuses as its absence does',
      'EDGE-06: control and bidi characters in a declared name are replaced, and the refusal stays one line',
      "initialize honours the door's finding: a caller cannot clear it, and only the config opts in",
      'SessionManager.createSession refuses and holds nothing: no subject, no idle timer, no number',
    ].map(name => editor(name)),
    greens: [editor('C432-EDITOR-PRODUCTION: the create door refuses a production', 3)],
  },
  {
    id: 'B04', claim: 'C432-EXPLICIT-ALL-CONTEXTS', instrument: 'review',
    operation: 'route an explicit write back through the automatic disposition profile',
    subject: `${P}knowledge-local/src/curator/knowledge-store.ts`,
    edits: [edit("  return authority === 'explicit' ? EXPLICIT_PROFILE : resolveDispositionProfile(config.executionContext)",
      '  return resolveDispositionProfile(config.executionContext)')],
    reds: [review('C432-EXPLICIT-ALL-CONTEXTS')],
    // Every explicit write in ci becomes a proposal again, so each explicit-CI cell reds with it.
    allowed: [
      'explicit policy accept materializes in ci under the actual context',
      'C432-EXPLICIT-LEASE-EGRESS: a held lease is delegated the direct request, bounded and never stolen, and bundle egress refuses a secret-bearing fix',
      'C432-EXPLICIT-RETRY: a repeated operation identity lands its effects once and returns the same record ids, and a later mark leaves the earlier fix intact',
      'a retried Add-shaped mark lands its fix once and answers the same receipt',
      'a retried Confirm-shaped mark lands its fix once and answers the same receipt',
      'explicit ci authority keeps every promotion gate: an unavailable posture holds the fix as a candidate',
      'an explicit accept over a tombstoned target refuses by type and moves no committed byte',
      'a retried reject deprecates once and answers the same record ids',
      'recovers an interrupted mark on retry without a second lineage transition',
      'explicit ci promotion leaves automatic ci curation proposed and its promotion refused',
    ].map(name => review(name)),
    greens: [],
  },
  {
    id: 'B05', claim: 'C432-CURATION-CONTEXT', instrument: 'disposition',
    operation: 'make automatic CI curation drain to active',
    subject: `${P}knowledge-local/src/curator/author-contract.ts`,
    edits: [edit("    case 'local-headless':\n      return { mode: 'drain-to-active' }\n    case 'ci':\n    case 'cloud':\n",
      "    case 'local-headless':\n    case 'ci':\n      return { mode: 'drain-to-active' }\n    case 'cloud':\n")],
    reds: [disposition('C432-CURATION-CONTEXT')],
    // The context-to-mode table itself is pinned beside it.
    allowed: [disposition('maps all SAFE-01 execution contexts to their authority mode')],
    greens: [],
  },
  {
    id: 'B06', claim: 'C432-MARK-RETRY-ONCE', instrument: 'feedback',
    operation: 'ignore the persisted applied checkpoint, so a retry applies the fix again',
    subject: `${P}cli/src/gates/feedback-host.ts`,
    edits: [edit("        if (intent.stage !== 'applied') {\n", '        if (true) {\n')],
    reds: [feedback(`${RETRY} before receipt lands its fix exactly once on retry`),
      feedback('C432-MARK-RETRY-ONCE: a test-edit mark interrupted before its receipt reuses the written file without a second edit')],
    allowed: [],
    greens: [feedback(`${RETRY} after gold lands its fix exactly once on retry`),
      feedback(`${RETRY} after evidence lands its fix exactly once on retry`),
      feedback(`${RETRY} after fix publication lands its fix exactly once on retry`)],
  },
  {
    id: 'B07', claim: 'C432-CONFIG-OUTSIDE-EDIT', instrument: 'config',
    operation: 'read the config bytes before the queue and publish them stale after an outside edit',
    subject: `${P}dashboard-server/src/config/config-manager.ts`,
    crossing: dashboardCrossing('stale432bytes'),
    edits: [
      edit('    return this.serialized(() => this.applyChangesOnce(changes, options.capturePriors === true))\n',
        '    const stale432bytes = await readFile(this.configPath).catch(() => undefined)\n'
        + '    return this.serialized(() => this.applyChangesOnce(changes, options.capturePriors === true, stale432bytes))\n'),
      edit('    capturePriors: boolean,\n  ): Promise<ApplyChangesOutcome> {\n',
        '    capturePriors: boolean,\n    staleBytes?: Buffer,\n  ): Promise<ApplyChangesOutcome> {\n'),
      edit('      const bytes = await readFile(this.configPath)\n      baseRevision =',
        '      const bytes = staleBytes ?? await readFile(this.configPath)\n      baseRevision ='),
    ],
    reds: [config(`${OUTSIDE_EDIT} > a field change queued behind another writer keeps the outside edit made while it waited`)],
    // The shared queue's cells merge at their turn too, so stale bytes drop their writes as well.
    allowed: [
      config(`${PATH_QUEUE} > overlapping disjoint writes from both writers all land`),
      config(`${PATH_QUEUE} > a stale same-field expectation refuses once the co-hosted writer changed that field`),
    ],
    greens: [config(`${OUTSIDE_EDIT} > an outside edit between two direct changes is kept by the second, comments and all`)],
  },
  {
    id: 'B08', claim: 'C432-TEST-WRITE-DISPOSITION', instrument: 'authoring',
    operation: 'let a rejected final draft through the final-write branch',
    subject: `${P}agent/src/authoring/loop.ts`,
    crossing: { pkg: '@vostride/agent-qa-agent', dir: 'packages/agent', marker: 'rejected432final' },
    edits: [edit('  return draftDispositionWritesTarget(disposition)\n}\n',
      "  const rejected432final = disposition === 'rejected'\n  return draftDispositionWritesTarget(disposition) || rejected432final\n}\n")],
    reds: [authoring(`${WRITE}: never writes a REJECTED draft to its target`)], allowed: [],
    greens: [authoring(`${WRITE}: writes a KEEP-ELIGIBLE draft to its target with its receipt`),
      authoring(`${WRITE}: writes an UNVERIFIED draft-mode draft, saying it is unverified`)],
  },
  {
    id: 'B09', claim: 'C432-CONFIG-LEAVES-92', instrument: 'leaves',
    operation: 'omit the retained services.mcp.path leaf from the masking map',
    subject: `${P}schema/src/config/masking.ts`,
    crossing: schemaCrossing('omitted432leaf'),
    edits: [
      edit("  'services.mcp.path': 'plain',\n", ''),
      edit('export function classifyConfigPath(segments: readonly (string | number)[]): MaskingClass {\n',
        "export function classifyConfigPath(segments: readonly (string | number)[]): MaskingClass {\n  const omitted432leaf = 'services.mcp.path'\n  void omitted432leaf\n"),
    ],
    reds: [leaves('C432-CONFIG-LEAVES-92')],
    // The map/schema equality pin is the other half of the same leaf set.
    allowed: [leaves('CONFIG-SCHEMA-LEAVES-PINNED')],
    greens: [],
  },
  {
    id: 'B10', claim: 'C432-CONFIG-WRITABLE-88', instrument: 'page',
    operation: 'omit the pass-rate scope control from the config page',
    subject: `${P}dashboard-ui/src/pages/config.tsx`,
    edits: [edit('  "pass-rate-scope": [AnalyticsSection],\n', '  "pass-rate-scope": [],\n')],
    reds: [page('C432-CONFIG-WRITABLE-88')],
    // The section's controls are its leaves' only owners, so the coverage and shell cells red too.
    allowed: [
      'SCHEMA-COVERAGE-EVERY-LEAF: every schema leaf but plugins has a field or list owner on some tab',
      'renders a real editor surface for every schema-backed destination',
      'Config section shells: all 21 legacy destinations',
      'Config section shells: Analytics sections',
    ].map(name => page(name)),
    greens: [],
  },
  {
    id: 'B11', claim: 'C432-INCONSISTENCY-HOLD', instrument: 'hold',
    operation: 'remove only the gate-inconsistent hold from the promotion gate',
    subject: `${P}schema/src/knowledge/promotion-gate.ts`,
    crossing: schemaCrossing('skipped432hold'),
    edits: [edit("  if (detectGateInconsistency(standing) !== undefined) return hold('gate-inconsistent')\n",
      '  const skipped432hold = detectGateInconsistency(standing)\n  void skipped432hold\n')],
    reds: [hold('C432-INCONSISTENCY-HOLD')],
    // Every contradiction cell in the file rides the same one hold.
    allowed: [
      'files nothing: repeated contradictory canary evidence holds each time without creating an inbox',
      'newer clean evidence alone clears the hold, and the record is never deprecated automatically',
      'never reads the legacy inbox: pending, claimed, decided or corrupt files neither hold clean receipts nor clear a contradiction',
      'holds the held-out shape: a Gate-2 pass beside a Gate-1 failure that harmed a held-out row',
    ].map(name => hold(name)),
    greens: [],
  },
  {
    id: 'B12', claim: 'C432-RETAINED-HOST', instrument: 'mcp',
    operation: 'admit a non-localhost Host while the Origin guard stays',
    subject: `${P}cli/src/commands/mcp.ts`,
    edits: [edit('    if (!host.ok) {\n', '    if (false && !host.ok) {\n')],
    reds: [mcp('C432-RETAINED-HOST')], allowed: [], greens: [mcp('C432-RETAINED-ORIGIN')],
  },
  {
    id: 'B13', claim: 'C432-RETAINED-ORIGIN', instrument: 'mcp',
    operation: 'admit a non-localhost Origin while the Host guard stays',
    subject: `${P}cli/src/commands/mcp.ts`,
    edits: [edit('    if (!origin.ok) {\n', '    if (false && !origin.ok) {\n')],
    reds: [mcp('C432-RETAINED-ORIGIN')],
    // The legacy-bearer cell sends a foreign Origin too.
    allowed: [mcp('C432-RETAINED-MCP-HOST-ORIGIN: a legacy bearer opens neither guard, and the refusal echoes nothing sent')],
    greens: [mcp('C432-RETAINED-HOST')],
  },
  {
    id: 'B14', claim: 'C432-RETAINED-CROSS-SITE', instrument: 'door',
    operation: 'mount the dashboard mark route on the machine boundary, admitting cross-site requests',
    subject: `${P}dashboard-server/src/server/routes.ts`,
    crossing: dashboardCrossing('crossSite432boundary'),
    edits: [edit("      registerRunMarkRoute(req, res, { host: deps.agentHost, runId, boundary: 'human' })\n",
      "      const crossSite432boundary = 'machine' as const\n      registerRunMarkRoute(req, res, { host: deps.agentHost, runId, boundary: crossSite432boundary })\n")],
    reds: [door('C432-RETAINED-CROSS-SITE')],
    // Gap 6 drives the same mark arm cross-site; 7b-ii's throwing responder now runs behind it.
    // 2026-10-03 (quick-261003-tsr, WR-07): 6g is re-titled; it probes each arm at its own seam.
    allowed: [
      '6a — refuses the CORS simple request, before the mark reaches the host',
      '6b — refuses a cross-origin drive that declares application/json (the Origin leg alone)',
      '6f — refuses a cross-origin mark, and the identical request from the page itself dispatches',
      '6g — refuses EVERY retained same-site mutating arm before its own side effect, and each arm acts for its own page',
      '6i — refuses the literal `null` Origin, which is not the same fact as no Origin at all',
      '6h — refuses a same-origin-looking drive whose Sec-Fetch-Site says cross-site',
      "7b-ii — a throwing responder is caught by the handler's own backstop",
    ].map(name => door(name)),
    greens: [],
  },
  {
    id: 'B15', claim: 'C432-RETAINED-LIVE-LINK', instrument: 'live',
    operation: 'skip the live-url door’s own subject (handle) check and mint for any parameter',
    subject: `${P}dashboard-server/src/run-service/run-service-routes.ts`,
    crossing: dashboardCrossing('unchecked432handle'),
    edits: [edit("    const parsedHandle = parseHandleParam(handleParamOf(req))\n    if (parsedHandle.kind === 'invalid') {\n      refuse(res, 400, 'invalid_handle')\n      return\n    }\n    const handle = parsedHandle.kind === 'absent' ? 0 : parsedHandle.index\n",
      "    const parsedHandle = parseHandleParam(handleParamOf(req))\n    const unchecked432handle = parsedHandle.kind === 'handle' ? parsedHandle.index : 0\n    const handle = unchecked432handle\n")],
    reds: [live('C432-RETAINED-LIVE-LINK')], allowed: [], greens: [],
  },
  {
    id: 'B16', claim: 'C432-GUARDRAIL-AUDIT-RETAINED', instrument: 'audit',
    operation: 'suppress the guardrail row’s durable append',
    subject: `${P}safety-local/src/jsonl-audit-sink.ts`,
    edits: [edit("    this.append('guardrail_audit.jsonl', { ts: new Date().toISOString(), ...row })\n", '    void row\n')],
    reds: [audit('C432-GUARDRAIL-AUDIT-RETAINED', 2)],
    // Every cell that reads a guardrail row back finds none.
    allowed: [
      'stores fingerprints without writing matched secrets into raw audit bytes',
      'writes timestamped guardrail row shapes, and no execution row shape exists to write',
      'appends one newline-terminated line per guardrail row without truncating',
      'logs pass guardrail rows without detector or fingerprint fields',
      'keeps small same-file appends parseable on local POSIX filesystems',
      'C432-AUDIT-UNREAD: a planted legacy trail stays byte-identical, with its mtime, across guardrail appends',
      'C432-AUDIT-UNREAD: a damaged or unreadable-as-JSON legacy trail changes nothing about a guardrail append',
    ].map(name => audit(name)),
    greens: [],
  },
]

runGate({
  slug: '432-approval-permission-mutation',
  envPrefix: 'AGENT_QA_432_APPROVAL_PERMISSION_MUTATION',
  idPrefix: 'A',
  explicitIds: true,
  parseCheck: true,
  banner: 'APPROVAL_PERMISSION_MUTATION_OK',
  expectedLegs: 94,
  argv: process.argv.slice(2),
  instruments,
  legs: [...aLegs, ...bLegs],
})
NODE
