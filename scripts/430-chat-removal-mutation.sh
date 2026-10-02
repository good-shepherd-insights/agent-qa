#!/usr/bin/env bash
# 430-chat-removal-mutation.sh — no removed dashboard Chat member can come back without a named RED
# (430-13, PXH-SURF-03, D-01's deletion bar).
#
# WHAT THIS PROVES, AND WHY A GREEN SUITE DOES NOT PROVE IT. Phase 430 deleted the dashboard's
# conversation: the /chat page and its route, the sidebar and palette entries, the launcher and the
# session provider, the server's conversation routes and their dispatch, the dashboard's conversation
# row on the parity roster, the host's conversation members, the dashboard's remedy memberships and
# its remedy text, the markdown parser, the whole chat directory, a roll-call sink and the
# session-surface writer. Every cell that pins those absences is green today with nothing returned,
# which is exactly what a green suite cannot tell you: an absence cell that never looks at the right
# bytes is green too. So each leg below plants one removed member back, in the source its cell
# exists to watch, and requires that NAMED cell to red while the listed controls hold.
#
# THE LEGS
#   R01  app.tsx gains a `chat` route object before the catch-all              -> NO-CHAT-ROUTE
#   R02  app.tsx gains the old launcher button as a shell child                -> SHELL-CHILDREN-EXACT
#   R03  app.tsx declares the session provider's name again                    -> census: the session provider
#   R04  app-sidebar.tsx navItems gains { title: "Chat", url: "/chat" }        -> SIDEBAR-NAV-EXACT
#   R05  command-palette.tsx pages gains the same entry                        -> PALETTE-PAGES-EXACT
#   R06  a route-table module is created beside the host seam                  -> C430-CHAT-ROUTE-TABLE-EXACT (runtime)
#   R07  routes.ts answers the deleted chat prefix from its own arm            -> C430-DELETED-CHAT-ROUTES-SHARED-404
#   R08  AgentHost regains the router-fed confirm member                       -> C430-CHAT-ROUTE-TABLE-EXACT (type)
#   R09  roster.ts gains a `dashboard` row                                     -> pins the roster at the four surfaces
#   R10  MODULE_FOR_DOOR gains dashboard: 'dashboard.ts'                       -> (5) no rostered door supplies a minting surface
#   R11  AgentHost gains the ask-function id member                            -> C430-AGENT-HOST-MEMBERS-EXACT (type)
#   R12  the remedy module returns with only the answer-confirm membership    -> C432-430-R12-ANSWER-CONFIRM-ABSENT
#   R13  the remedy module returns with only the session-pin-final membership -> C432-430-R13-SESSION-PIN-ABSENT
#   R14  DenialBlock renders a remedy line inside its box                      -> C432-430-R14-REASON-ONLY
#   R15  denial-block.tsx declares the dashboard remedy text table again       -> C432-430-R15-REMEDY-TABLE-ABSENT
#   R16  app.tsx imports the markdown parser                                   -> census: the parser import, double-quoted
#   R17  the ownership contract lists the markdown parser again                -> census: the parser in the ownership contract
#   R18  app.tsx imports from the deleted chat directory                       -> census: the UI chat module import alias
#   R19  lib/api.ts holds the deleted turn URL (the browser transport path)    -> census: the deleted route prefix
#   R20  routes.ts carries a comment naming the deleted route prefix           -> census: the deleted route prefix
#   R21  the door passes the session-surface writer to composeCliLocalAgent    -> census: the session-surface composition option
#   R22  ComposeLocalAgentInput regains the session-surface option             -> C430-NO-SESSION-SURFACE-OPTION
#   R23  SURFACE_ROLLCALL regains the dashboard turn-response sink             -> every walked surface is enrolled exactly once
#
# ALLOWED CO-REDS are listed on each leg with a one-line reason; nothing else may red.
#
# 2026-10-02 (432-44, D-14/D-15): THE LEGS WHOSE SUBJECTS PHASE 432 DELETED ARE CARRIED, NOT DROPPED.
#   R06-R08: 432-14 deleted the run-confirm router, its route table and its handler-name union, and
#   re-spelled C430-CHAT-ROUTE-TABLE-EXACT as an absence (runtime: the server's chat directory holds
#   the host seam only; type: no router-fed member on AgentHost). R06 now CREATES a route-table module
#   beside the host seam, R07 answers the deleted prefix from a dedicated arm (no shared wildcard
#   grant), and R08 gives AgentHost the router-fed `confirms` member back.
#   R12-R15: 432-19 deleted the remedy vocabulary with the gate. Each remedy leg now reds its own
#   current absence cell (432-MUTATION-MAP.md): R12 and R13 each CREATE the remedy module holding one
#   dashboard membership (C432-430-R12-ANSWER-CONFIRM-ABSENT / C432-430-R13-SESSION-PIN-ABSENT, each
#   green under the other), R14 renders a remedy line (C432-430-R14-REASON-ONLY, the DOM owner) and
#   R15 declares the remedy text table (C432-430-R15-REMEDY-TABLE-ABSENT, the source census). The
#   original witnesses' names are recorded beside each leg.
#   R22: 432-17 deleted `mintingSurface`, the member R22 anchored after; it now anchors on `config`.
#
# A FILE UNDER dashboard-ui/src/chat/ RETURNING is proven three ways: R18 plants an import from that
# directory, the census's directory rule carries its own synthetic control, and
# entity-card.test.ts's NO-CARD-MODULE refuses the card module by path. (Since 432-43 the engine can
# create a file; R06, R12 and R13 use that to return deleted modules.)
#
# TEST-TREE SUBJECTS follow the 399.1 ROSTER precedent. roster.ts lies in the parity instrument's
# import closure; MODULE_FOR_DOOR and SURFACE_ROLLCALL live in the cli instrument's own files.
#
# NO LEG CROSSES A DIST. Every subject lies in its instrument's closure; the census reaches the UI,
# server and door sources through its `new URL` literal roots.
#
# Engine, arrival proof, counted selection and restoration: scripts/423-mutation-engine.cjs.
#
# USAGE
#   pnpm run validate:430-chat-removal-mutation               # from the agent-qa root
#   bash agent-qa/scripts/430-chat-removal-mutation.sh        # from the super-repository root
#
# KNOBS — AGENT_QA_430_CHAT_REMOVAL_MUTATION_SELFTEST
#   neutered  apply NO mutation; the run must FATAL with "<leg>: suite stayed green"
#   fatal     mutate every subject, then throw; every subject must be restored
#   SIGINT | SIGTERM | SIGHUP   the same, then deliver that signal to itself
# AGENT_QA_430_CHAT_REMOVAL_MUTATION_LEG=R01..R23 runs one leg (normal or neutered runs only).
# AGENT_QA_430_CHAT_REMOVAL_MUTATION_LIST=1 prints the declared inventory and exits.
#
# Installed Node 24 and workspace tools are required. No downloads or provider calls. Ends with a
# forced workspace build whenever a byte was mutated.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
exec node --input-type=commonjs - <<'NODE'
const path = require('node:path')
const { runGate, cell } = require(path.join(process.cwd(), 'scripts/423-mutation-engine.cjs'))

const APP_SRC = 'packages/dashboard-ui/src/app.tsx'
const SIDEBAR_SRC = 'packages/dashboard-ui/src/components/app-sidebar.tsx'
const PALETTE_SRC = 'packages/dashboard-ui/src/components/command-palette.tsx'
const DENIAL_SRC = 'packages/dashboard-ui/src/components/run-detail/denial-block.tsx'
const CONTRACT_SRC = 'packages/dashboard-ui/src/ownership-contract.ts'
const API_SRC = 'packages/dashboard-ui/src/lib/api.ts'
const CHAT_ROUTES_SRC = 'packages/dashboard-server/src/chat/chat-routes.ts'
const HOST_SRC = 'packages/dashboard-server/src/chat/host.ts'
const ROUTES_SRC = 'packages/dashboard-server/src/server/routes.ts'
const REMEDIES_SRC = 'packages/schema/src/safety/remedies.ts'
const ROSTER_SRC = 'packages/cli/src/__tests__/conformance/roster.ts'
const DOOR_SRC = 'packages/cli/src/commands/dashboard.ts'
const COMPOSE_SRC = 'packages/agent-local/src/composition/compose-local-agent.ts'

const REMEDY_T = 'src/safety/__tests__/430-remedy-memberships.test.ts'
const REMEDY_D = 'src/safety/__tests__/430-remedy-memberships.test-d.ts'
const SETS_T = 'src/__tests__/430-chat-closed-sets.test.ts'
const SETS_D = 'src/__tests__/430-chat-closed-sets.test-d.ts'
const DELETED_T = 'src/__tests__/430-chat-routes-deleted.test.ts'
const SHELL_T = 'src/components/__tests__/update-banner.test.tsx'
const SIDEBAR_T = 'src/components/__tests__/app-sidebar.test.tsx'
const PALETTE_T = 'src/components/__tests__/command-palette.test.tsx'
const DENIAL_T = 'src/components/run-detail/__tests__/denial-block.test.tsx'
const PARITY_T = 'src/__tests__/conformance/parity.test.ts'
const ROLLCALL_T = 'src/__tests__/unmask-boundary-rollcall.test.ts'
const ATTRIBUTION_T = 'src/__tests__/proposal-author-attribution.test.ts'
const SESSION_D = 'src/composition/__tests__/430-no-session-surface-option.test-d.ts'
const CENSUS_T = 'src/__tests__/430-dashboard-chat-deleted.test.ts'

const ROLLCALL_SRC = `packages/cli/${ROLLCALL_T}`
const ATTRIBUTION_SRC = `packages/cli/${ATTRIBUTION_T}`

// Every count is measured from a fresh Vitest JSON report of exactly these files, run the way the
// engine runs them (2026-09-28). The census count is 430-12's measurement, re-measured here.
// 2026-10-02 (432-44): re-measured on the 432 tree; see the leg notes for each re-spelled subject.
const instruments = {
  schema: { pkg: 'packages/schema', files: [REMEDY_T, REMEDY_D], typecheck: true, count: 6 },
  server: { pkg: 'packages/dashboard-server', files: [SETS_T, SETS_D, DELETED_T], typecheck: true, count: 13 },
  ui: { pkg: 'packages/dashboard-ui', files: [SHELL_T, SIDEBAR_T, PALETTE_T, DENIAL_T], typecheck: false, count: 57 },
  parity: { pkg: 'packages/cli', files: [PARITY_T], typecheck: false, count: 64, env: { VITEST_MAX_WORKERS: '1' } },
  cli: { pkg: 'packages/cli', files: [ROLLCALL_T, ATTRIBUTION_T], typecheck: false, count: 43, env: { VITEST_MAX_WORKERS: '1' } },
  'agent-local': { pkg: 'packages/agent-local', files: [SESSION_D], typecheck: true, count: 2 },
  census: { pkg: 'packages/arch', files: [CENSUS_T], typecheck: false, count: 87 },
}

const remedyT = (name, count, message) => cell('schema', REMEDY_T, name, count, message)
const remedyD = name => cell('schema', REMEDY_D, name)
const setsT = name => cell('server', SETS_T, name)
const setsD = name => cell('server', SETS_D, name)
const deleted = (name, count) => cell('server', DELETED_T, name, count)
const shell = name => cell('ui', SHELL_T, name)
const sidebar = name => cell('ui', SIDEBAR_T, name)
const palette = name => cell('ui', PALETTE_T, name)
const denial = (name, count, message) => cell('ui', DENIAL_T, name, count, message)
const parity = name => cell('parity', PARITY_T, name)
const rollcall = name => cell('cli', ROLLCALL_T, name)
const attribution = name => cell('cli', ATTRIBUTION_T, name)
const session = name => cell('agent-local', SESSION_D, name)
const census = (name, count, message) => cell('census', CENSUS_T, name, count, message)
const spells = label => census(`no source or test spells ${label}`)
const edit = (from, to) => ({ from, to })

const SHARED_404 = 'C430-DELETED-CHAT-ROUTES-SHARED-404'
const censusControls = [census('PLANTED-POSITIVE'), census('SELF-MATCH'), census('TOLERATED-NAMES-PRESENT')]
const catchAll = '      { path: "*", element: <Navigate to={routes.runs} replace /> },\n'

const legs = [
  {
    subject: APP_SRC, instrument: 'ui', claim: 'NO-CHAT-ROUTE',
    operation: 'add a chat route object before the catch-all',
    edits: [edit(catchAll, `      { path: "chat", element: <div data-chat-page="" /> },\n${catchAll}`)],
    reds: [shell('NO-CHAT-ROUTE')],
    allowed: [],
    greens: [shell('SHELL-CHILDREN-EXACT'), shell('renders route content immediately before app metadata resolves')],
  },
  {
    subject: APP_SRC, instrument: 'ui', claim: 'SHELL-CHILDREN-EXACT',
    operation: 'mount the old launcher button as a shell child',
    edits: [edit('        <CommandPalette />\n', '        <CommandPalette />\n        <button data-testid="chat-panel-launcher" />\n')],
    reds: [shell('SHELL-CHILDREN-EXACT')],
    allowed: [],
    greens: [shell('NO-CHAT-ROUTE'), shell('renders route content immediately before app metadata resolves')],
  },
  {
    subject: APP_SRC, instrument: 'census', claim: 'CENSUS-SESSION-PROVIDER',
    operation: "declare the session provider's name in the app shell",
    edits: [edit('const RunsPage = lazy(', 'const ChatSessionProvider = Suspense\nconst RunsPage = lazy(')],
    reds: [spells('the session provider')],
    allowed: [],
    greens: censusControls,
  },
  {
    subject: SIDEBAR_SRC, instrument: 'ui', claim: 'SIDEBAR-NAV-EXACT',
    operation: 'add a Chat item to the sidebar navItems',
    edits: [edit('  { title: "Config", url: routes.config, icon: SlidersHorizontal, tourId: "tour-nav-config" },\n',
      '  { title: "Config", url: routes.config, icon: SlidersHorizontal, tourId: "tour-nav-config" },\n  { title: "Chat", url: "/chat", icon: Play },\n')],
    reds: [sidebar('SIDEBAR-NAV-EXACT')],
    // The tour-anchor cell also asserts that no nav link targets /chat, which is the planted item.
    allowed: [sidebar('adds approved product tour anchors to primary nav items only')],
    greens: [sidebar('renders the Hooks nav item with the Webhook icon'), palette('PALETTE-PAGES-EXACT')],
  },
  {
    subject: PALETTE_SRC, instrument: 'ui', claim: 'PALETTE-PAGES-EXACT',
    operation: 'add a Chat entry to the palette pages',
    edits: [edit('  { title: "Config", url: routes.config, icon: SlidersHorizontal },\n',
      '  { title: "Config", url: routes.config, icon: SlidersHorizontal },\n  { title: "Chat", url: "/chat", icon: Play },\n')],
    reds: [palette('PALETTE-PAGES-EXACT')],
    allowed: [],
    greens: [palette('includes Hooks in the Pages group'), sidebar('SIDEBAR-NAV-EXACT')],
  },
  {
    // 432-44: the table's module is deleted (432-14), so the row returns with the module that held it.
    subject: CHAT_ROUTES_SRC, instrument: 'server', claim: 'C430-CHAT-ROUTE-TABLE-EXACT',
    operation: 'create a route-table module holding the deleted turn row beside the host seam',
    create: "// 432-44 R06: a conversation route table returns beside the host seam.\nexport const CHAT_ROUTE_TABLE = Object.freeze([\n  { method: 'POST', path: '/api/' + 'chat/turn', handler: 'turn' },\n] as const)\n",
    reds: [setsT('C430-CHAT-ROUTE-TABLE-EXACT')],
    allowed: [],
    // The module is unreachable: nothing imports it and routes.ts dispatches no chat prefix.
    greens: [deleted(SHARED_404, 5), setsD('C430-CHAT-ROUTE-TABLE-EXACT'), setsT('C430-AGENT-HOST-MEMBERS-EXACT')],
  },
  {
    subject: ROUTES_SRC, instrument: 'server', claim: SHARED_404,
    // 432-44: the confirm router is deleted (432-14), so the prefix returns as its own dispatch arm.
    operation: 'answer the deleted chat prefix from a dedicated arm ahead of the shared ones',
    edits: [edit('    // 2026-10-01 (432-14, D-14): the run-confirm prefix is no longer dispatched. It was mounted\n',
      "    if (path.startsWith('/api/' + 'chat/')) {\n      jsonNoCors(res, { error: 'Not found' }, 404)\n      return\n    }\n\n    // 2026-10-01 (432-14, D-14): the run-confirm prefix is no longer dispatched. It was mounted\n")],
    // A dedicated arm's answer carries no wildcard grant, so every deleted path loses it.
    reds: [deleted(SHARED_404, 5)],
    allowed: [],
    // The retired run-confirm pair still answers what a never-served path answers.
    greens: [deleted('C432-CONFIRM-ROUTES-404', 4), setsT('C430-CHAT-ROUTE-TABLE-EXACT')],
  },
  {
    // 432-44: the handler-name union is deleted (432-14); the type half that survives is the host
    // seam's, so the router-fed member returns on AgentHost.
    subject: HOST_SRC, instrument: 'server', claim: 'C430-CHAT-ROUTE-HANDLERS-EXACT',
    operation: 'give AgentHost the router-fed confirms member back',
    edits: [edit('  unmaskForDisplay(text: string, scope?: { runId: string }): string\n}\n',
      '  unmaskForDisplay(text: string, scope?: { runId: string }): string\n  readonly confirms?: unknown\n}\n')],
    reds: [setsD('C430-CHAT-ROUTE-TABLE-EXACT')],
    // A member AGENT_HOST_MEMBERS does not list is outside the listed set as well.
    allowed: [setsD('C430-AGENT-HOST-MEMBERS-EXACT')],
    greens: [setsT('C430-CHAT-ROUTE-TABLE-EXACT'), setsT('C430-AGENT-HOST-MEMBERS-EXACT'), deleted(SHARED_404, 5)],
  },
  {
    subject: ROSTER_SRC, instrument: 'parity', claim: 'ROSTER-FOUR-SURFACES',
    operation: 'add a dashboard row back to SURFACE_ROSTER',
    edits: [edit("  Object.freeze({ id: 'fn', adapter: fnSurfaceAdapter }),\n",
      "  Object.freeze({ id: 'fn', adapter: fnSurfaceAdapter }),\n  Object.freeze({ id: 'dashboard', adapter: fnSurfaceAdapter }),\n")],
    reds: [parity('pins the roster at the four surfaces that exist today')],
    allowed: [],
    greens: [parity('makes every door state what it cannot do, by shape rather than by omission'),
      parity('carries exactly one scenario row per registered capability, in both directions')],
  },
  {
    subject: ATTRIBUTION_SRC, instrument: 'cli', claim: 'MODULE-FOR-DOOR-EXACT',
    operation: 'name a dashboard command module in MODULE_FOR_DOOR',
    edits: [edit("      fn: 'fn.ts',\n    }\n", "      fn: 'fn.ts',\n      dashboard: 'dashboard.ts',\n    }\n")],
    reds: [attribution('(5) no rostered door supplies a minting surface — the census, over the roster itself')],
    allowed: [],
    greens: [attribution('C432-NO-GIT-COMMIT: the CLI host exports no commit, preserve-commit, trailer or author machinery'),
      rollcall('every walked surface is enrolled in the SURFACE_ROLLCALL union exactly once')],
  },
  {
    subject: HOST_SRC, instrument: 'server', claim: 'C430-AGENT-HOST-MEMBERS-EXACT',
    operation: 'give AgentHost the ask-function id member back',
    edits: [edit('  unmaskForDisplay(text: string, scope?: { runId: string }): string\n}\n',
      '  unmaskForDisplay(text: string, scope?: { runId: string }): string\n  readonly agentAskFunctionId?: string\n}\n')],
    reds: [setsD('C430-AGENT-HOST-MEMBERS-EXACT')],
    allowed: [],
    // AGENT_HOST_MEMBERS is unchanged, so the runtime half holds; only the type half sees the member.
    greens: [setsT('C430-AGENT-HOST-MEMBERS-EXACT'), setsD('C430-CHAT-ROUTE-TABLE-EXACT')],
  },
  {
    // 432-44: was C430-REMEDY-MEMBERSHIPS-EXACT + C430-DASHBOARD-PROJECTION-EMPTY (runtime and type).
    // The vocabulary is deleted (432-19), so the membership returns as a remedy module holding it.
    subject: REMEDIES_SRC, instrument: 'schema', claim: 'C430-ANSWER-CONFIRM-MEMBERSHIP',
    operation: 'create the remedy module holding only the answer-confirm membership, the dashboard in it',
    create: "// 432-44 R12: the answer-confirm dashboard membership returns.\nexport const GATE_REMEDY_SURFACES_BY_KIND = {\n  'answer-confirm': ['cli', 'chat', 'dashboard'],\n} as const\n",
    reds: [remedyT('C432-430-R12-ANSWER-CONFIRM-ABSENT', 1, 'the confirm-answering remedy returned')],
    // The module-absence cell reads the remedy module's path, which this leg creates.
    allowed: [remedyT('C432-REMEDY-TYPES-ABSENT: the remedy module and the policy-result DTO are deleted; the risk tier stays')],
    greens: [remedyT('C432-430-R13-SESSION-PIN-ABSENT'), remedyD('C432-REMEDY-TYPES-ABSENT')],
  },
  {
    // 432-44: was C430-REMEDY-MEMBERSHIPS-EXACT + C430-DASHBOARD-PROJECTION-EMPTY (runtime and type).
    subject: REMEDIES_SRC, instrument: 'schema', claim: 'C430-SESSION-PIN-FINAL-MEMBERSHIP',
    operation: 'create the remedy module holding only the session-pin-final membership, the dashboard in it',
    create: "// 432-44 R13: the session-pin-final dashboard membership returns.\nexport const GATE_REMEDY_SURFACES_BY_KIND = {\n  'session-pin-final': ['chat', 'dashboard'],\n} as const\n",
    reds: [remedyT('C432-430-R13-SESSION-PIN-ABSENT', 1, 'the session-pin finality remedy returned')],
    allowed: [remedyT('C432-REMEDY-TYPES-ABSENT: the remedy module and the policy-result DTO are deleted; the risk tier stays')],
    greens: [remedyT('C432-430-R12-ANSWER-CONFIRM-ABSENT'), remedyD('C432-REMEDY-TYPES-ABSENT')],
  },
  {
    subject: DENIAL_SRC, instrument: 'ui', claim: 'DENIAL-REASON-ONLY',
    operation: 'render an answer-confirm remedy line inside the denial box',
    edits: [edit('      <p className="text-foreground">{neutralReason}</p>\n',
      '      <p className="text-foreground">{neutralReason}</p>\n      <p data-remedy-kind="answer-confirm">Answer the confirm prompt to run it.</p>\n')],
    // 432-44: was DENIAL-REASON-ONLY, which still reds beside it (allowed below).
    reds: [denial('C432-430-R14-REASON-ONLY', 1, 'a remedy line rendered beside the reason')],
    // Every cell that counts the box's lines or remedy markers sees the same returned line.
    allowed: [denial('DENIAL-REASON-ONLY'), denial('DENIAL-NOTHING-INVENTED'), denial('C432-PLAIN-REFUSAL'),
      denial('C432-HISTORICAL-READER')],
    greens: [denial('DENIAL-CANONICAL-PROSE-NEVER-IN-DOM')],
  },
  {
    subject: DENIAL_SRC, instrument: 'census', claim: 'CENSUS-DASHBOARD-REMEDY-TEXT',
    operation: 'declare the dashboard remedy text table again',
    edits: [edit('export function DenialBlock(', 'const DASHBOARD_REMEDY_TEXT = {}\n\nexport function DenialBlock(')],
    // 432-44: was the census needle cell, which still reds beside it (allowed below).
    reds: [census('C432-430-R15-REMEDY-TABLE-ABSENT', 1, 'the dashboard remedy text table returned')],
    allowed: [spells('the dashboard remedy text table')],
    greens: censusControls,
  },
  {
    subject: APP_SRC, instrument: 'census', claim: 'CENSUS-PARSER-IMPORT',
    operation: 'import the markdown parser into the app shell',
    edits: [edit('import { cn } from "@/lib/utils"\n', 'import { cn } from "@/lib/utils"\nimport { marked } from "marked"\n')],
    reds: [spells('the parser import, double-quoted')],
    allowed: [],
    greens: [...censusControls, census('DASHBOARD-UI-DECLARES-NO-MARKDOWN-PARSER')],
  },
  {
    subject: CONTRACT_SRC, instrument: 'census', claim: 'CENSUS-PARSER-IN-CONTRACT',
    operation: 'list the markdown parser in AGENT_QA_DASHBOARD_UI_EXTERNAL_DEPENDENCIES again',
    edits: [edit("  'lucide-react',\n  'monaco-editor',\n", "  'lucide-react',\n  'marked',\n  'monaco-editor',\n")],
    reds: [spells('the parser in the ownership contract')],
    allowed: [],
    greens: [...censusControls, census('DASHBOARD-UI-DECLARES-NO-MARKDOWN-PARSER')],
  },
  {
    subject: APP_SRC, instrument: 'census', claim: 'CENSUS-CHAT-DIRECTORY-IMPORT',
    operation: 'import a module from the deleted chat directory into the app shell',
    edits: [edit('import { CommandPalette } from "@/components/command-palette"\n',
      'import { CommandPalette } from "@/components/command-palette"\nimport "@/chat/chat-transcript"\n')],
    reds: [spells('the UI chat module import alias')],
    // The imported module's own file stem is a needle too, and it is the planted return itself.
    allowed: [spells('the transcript module file')],
    greens: [...censusControls, census('NO-FILE-UNDER-THE-UI-CHAT-DIRECTORY')],
  },
  {
    subject: API_SRC, instrument: 'census', claim: 'CENSUS-ROUTE-PREFIX-IN-UI',
    operation: 'hold the deleted turn URL in the browser transport',
    edits: [edit("const API_BASE = ''\n", "const API_BASE = ''\nconst TURN_URL = `${API_BASE}/api/chat/turn`\n")],
    reds: [spells('the deleted route prefix')],
    allowed: [],
    greens: censusControls,
  },
  {
    subject: ROUTES_SRC, instrument: 'census', claim: 'CENSUS-ROUTE-PREFIX-IN-SERVER',
    operation: 'name the deleted route prefix in a server comment',
    edits: [edit('    // 429-01 D-19: the field-merge config write, ahead of the shared OPTIONS arm so its answers\n',
      '    // /api/chat/ is served beside the run-confirm prefix again.\n    // 429-01 D-19: the field-merge config write, ahead of the shared OPTIONS arm so its answers\n')],
    reds: [spells('the deleted route prefix')],
    allowed: [],
    greens: censusControls,
  },
  {
    subject: DOOR_SRC, instrument: 'census', claim: 'CENSUS-SESSION-SURFACE-WRITER',
    operation: 'pass the session-surface writer to composeCliLocalAgent again',
    edits: [edit('    resolveExecutionContext,\n    ...(input.runBridge === undefined ? {} : { runBridge: input.runBridge }),\n',
      '    resolveExecutionContext,\n    sessionSurface: DASHBOARD_FUNCTION_CALLER.surface,\n    ...(input.runBridge === undefined ? {} : { runBridge: input.runBridge }),\n')],
    reds: [spells('the session-surface composition option')],
    allowed: [],
    greens: censusControls,
  },
  {
    subject: COMPOSE_SRC, instrument: 'agent-local', claim: 'C430-NO-SESSION-SURFACE-OPTION',
    operation: 'give ComposeLocalAgentInput the session-surface option back',
    // 432-44: re-anchored; `mintingSurface` is deleted (432-17).
    edits: [edit('  readonly config: ConfigReaderPort\n', '  readonly config: ConfigReaderPort\n  readonly sessionSurface?: string\n')],
    reds: [session('C430-NO-SESSION-SURFACE-OPTION: ComposeLocalAgentInput takes no session-surface tag')],
    allowed: [],
    greens: [session('C430-NO-SESSION-SURFACE-OPTION: ComposeLocalAgentInput keeps the CLI chat and ask options')],
  },
  {
    subject: ROLLCALL_SRC, instrument: 'cli', claim: 'ROLLCALL-ENROLLMENT-EXACT',
    operation: 'enrol the deleted dashboard turn-response sink in SURFACE_ROLLCALL again',
    edits: [edit("  'machine:chat-clause-results',\n", "  'machine:chat-clause-results',\n  'dashboard:chat-turn-response',\n")],
    reds: [rollcall('every walked surface is enrolled in the SURFACE_ROLLCALL union exactly once')],
    // The fixture cell compares the walked total with the roll-call length, which the sink moves.
    allowed: [rollcall('both sides derive from ONE fixture (single MaskingContext, single envelope stream)')],
    greens: [attribution('(5) no rostered door supplies a minting surface — the census, over the roster itself')],
  },
]

runGate({
  slug: '430-chat-removal-mutation', envPrefix: 'AGENT_QA_430_CHAT_REMOVAL_MUTATION', idPrefix: 'R',
  instruments, legs, expectedLegs: 23, banner: 'CHAT_REMOVAL_MUTATION_OK', parseCheck: true,
})
NODE
