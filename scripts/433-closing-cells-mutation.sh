#!/usr/bin/env bash
# 433-closing-cells-mutation.sh — no standalone explorer and no terminal-door question can come back
# without a named RED (433-05, PXH-UAT-03; D-22).
#
# WHAT THIS PROVES, AND WHY A GREEN SUITE DOES NOT PROVE IT. Phase 433 added absence cells for what
# the milestone must not carry: a standalone Memory or Knowledge explorer (a route, a sidebar item, a
# palette entry, a spelling in production source, a route in the shipped bundle) and a question asked
# of a person who types `agent-qa run` at a real terminal. Every one of those cells is green today
# with nothing returned, which is what an absence cell that never looks at the right bytes would be
# too. So each leg below plants one guarded item back, in the source its cell exists to watch, and
# requires that NAMED cell to red while the listed controls hold.
#
# THE LEGS
#   X01  app.tsx gains a `memory` route object before the catch-all          -> NO-EXPLORER-ROUTE: /memory (and /Memory)
#   X02  app.tsx gains a `knowledge` route, rebuilt into the shipped bundle  -> NO-EXPLORER-IN-SHIPPED-BUNDLE
#   X03  app-sidebar.tsx navItems gains { title: "Knowledge", url: "/knowledge" } -> SIDEBAR-NAV-EXACT
#   X04  command-palette.tsx pages gains the same entry                      -> PALETTE-PAGES-EXACT
#   X05  app.tsx carries a comment naming a double-quoted memory URL         -> C433-EXPLORER-ABSENT: ... a double-quoted memory URL
#   X06  run.ts waits for a line of stdin at a TTY before the member runs,   -> C433-DOOR-TTY-NONPRODUCTION
#        rebuilt into the shipped dist/cli.js
#
# ALLOWED CO-REDS, each with its reason; nothing else may red.
#   X01  NO-EXPLORER-ROUTE: /Memory is a REQUIRED red beside /memory, not an allowance: React Router
#        matches paths case-insensitively by default (measured with react-router 7.18.1 `matchRoutes`
#        on 2026-10-04), so a returned `memory` route also serves /Memory. Every other path stays green.
#   X06  C433-DOOR-TTY-OPT-IN-RUNS: the opted-in production run goes through the same terminal door
#        and the same member executor, so the planted wait holds it as well.
#
# WHY X06 WAITS IN THE MEMBER EXECUTOR. The production refusal is the run core's (agent-local
# `refuseProductionWithoutOptIn`, called inside `runInProcessCliRun` after the members are produced).
# A wait planted in the run action before that drive would also hold the refused production run, and
# C433-DOOR-TTY-PRODUCTION-REFUSED is a GREEN control here. The member executor in
# `produceDirectRunMembers` is the first run.ts code the core reaches after it allows the run and
# before the member executes, so the wait sits there, guarded on `process.stdin.isTTY`.
#
# NO X07 (D-25). Plan 433-01 measured WebKit recording a playable webm through the shipped recording
# and took Branch B (`no-change-present`): the web adapter's recording getter is unchanged and no 433
# web cells exist, so there is no guard to remove and `expectedLegs` is 6
# (.planning/phases/433-milestone-walkthrough-and-regression-proof/433-01-SUMMARY.md).
#
# TWO LEGS CROSS A DIST, BY PATH. X02 rebuilds the dashboard UI and the DOM suite serves
# `join(PACKAGES_ROOT, 'dashboard-ui', 'dist')`; X06 rebuilds the CLI and the terminal door spawns
# `dist/cli.js` by its own path. Each plants an arrival marker (`explorer433`, `tty433wait`) that the
# engine must find in the rebuilt dist before the suite runs. Both of those instruments consume built
# output, so the workspace is built before their preflight (`dist: true`).
#
# THIS SCRIPT REWRITES PRODUCT SOURCE IN PLACE. Run it only in a checkout no other session is
# committing to (the pinned `agent-qa-433` worktree). In a shared checkout only the list mode below
# may run: it owns no byte.
#
# Engine, arrival proof, counted selection and restoration: scripts/423-mutation-engine.cjs.
#
# USAGE
#   pnpm run validate:433-closing-cells-mutation               # from the agent-qa root
#   bash agent-qa/scripts/433-closing-cells-mutation.sh        # from the super-repository root
#
# KNOBS — AGENT_QA_433_CLOSING_CELLS_MUTATION_SELFTEST
#   neutered  apply NO mutation; the run must FATAL with "<leg>: suite stayed green"
#   fatal     mutate every subject, then throw; every subject must be restored
#   SIGINT | SIGTERM | SIGHUP   the same, then deliver that signal to itself
# AGENT_QA_433_CLOSING_CELLS_MUTATION_LEG=X01..X06 runs one leg (normal or neutered runs only).
# AGENT_QA_433_CLOSING_CELLS_MUTATION_LIST=1 prints the declared inventory and exits.
#
# Installed Node 24, workspace tools and the pinned Chromium are required. No downloads or provider
# calls. Ends with a forced workspace build whenever a byte was mutated.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
exec node --input-type=commonjs - "$@" <<'NODE'
const path = require('node:path')
const { runGate, cell } = require(path.join(process.cwd(), 'scripts/423-mutation-engine.cjs'))

const APP_SRC = 'packages/dashboard-ui/src/app.tsx'
const SIDEBAR_SRC = 'packages/dashboard-ui/src/components/app-sidebar.tsx'
const PALETTE_SRC = 'packages/dashboard-ui/src/components/command-palette.tsx'
const RUN_SRC = 'packages/cli/src/commands/run.ts'

const ROUTE_T = 'src/components/__tests__/433-no-explorer-route.test.tsx'
const SIDEBAR_T = 'src/components/__tests__/app-sidebar.test.tsx'
const PALETTE_T = 'src/components/__tests__/command-palette.test.tsx'
const CENSUS_T = 'src/__tests__/433-knowledge-explorer-absent.test.ts'
const DOM_T = 'src/__tests__/conformance/dashboard-dom.test.ts'
const TTY_T = 'src/__tests__/conformance/433-tty-door.test.ts'

// Every count is measured from a fresh Vitest JSON report of exactly these files, run the way the
// engine runs them (2026-10-04, agent-qa 06b12ee29): route 9, nav 24, census 25, browser 7, tty 4.
const instruments = {
  route: { pkg: 'packages/dashboard-ui', files: [ROUTE_T], typecheck: false, count: 9 },
  nav: { pkg: 'packages/dashboard-ui', files: [SIDEBAR_T, PALETTE_T], typecheck: false, count: 24 },
  census: { pkg: 'packages/arch', files: [CENSUS_T], typecheck: false, count: 25 },
  browser: { pkg: 'packages/cli', files: [DOM_T], typecheck: false, count: 7, dist: true, env: { VITEST_MAX_WORKERS: '1' } },
  tty: { pkg: 'packages/cli', files: [TTY_T], typecheck: false, count: 4, dist: true, env: { VITEST_MAX_WORKERS: '1' } },
}

const routeCell = (spelled, message) => cell('route', ROUTE_T, `NO-EXPLORER-ROUTE: ${spelled} falls through the catch-all to Runs`, 1, message)
const sidebar = name => cell('nav', SIDEBAR_T, name)
const palette = name => cell('nav', PALETTE_T, name)
const census = (name, message) => cell('census', CENSUS_T, name, 1, message)
const dom = name => cell('browser', DOM_T, name)
const tty = (name, message) => cell('tty', TTY_T, name, 1, message)
const edit = (from, to) => ({ from, to })

const catchAll = '      { path: "*", element: <Navigate to={routes.runs} replace /> },\n'
const censusControls = [census('C433-EXPLORER-PLANTED-POSITIVE'), census('C433-EXPLORER-SELF-MATCH'),
  census('C433-EXPLORER-KEPT-NAMES-PRESENT')]
const executorEntry = '  const executor: MemberTestExecutor = async (member, ctx) => {\n'

const legs = [
  {
    subject: APP_SRC, instrument: 'route', claim: 'NO-EXPLORER-ROUTE',
    operation: 'add a memory route object before the catch-all',
    edits: [edit(catchAll, `      { path: "memory", element: <div data-explorer-page="" /> },\n${catchAll}`)],
    // The router matches case-insensitively, so the returned route serves both spellings.
    reds: [routeCell('/memory', '/memory mounted no Runs page'), routeCell('/Memory', '/Memory mounted no Runs page')],
    allowed: [],
    greens: ['/memories', '/knowledge', '/knowledge/', '/knowledges', '/knowledge-base', '/memory/MEM-1',
      '/knowledge/explorer'].map(spelled => routeCell(spelled)),
  },
  {
    subject: APP_SRC, instrument: 'browser', claim: 'NO-EXPLORER-IN-SHIPPED-BUNDLE',
    operation: 'add a knowledge route object before the catch-all in the shipped dashboard bundle',
    crossing: { pkg: '@vostride/agent-qa-dashboard-ui', dir: 'packages/dashboard-ui', marker: 'explorer433',
      reference: "join(PACKAGES_ROOT, 'dashboard-ui', 'dist')", byPath: true },
    edits: [edit(catchAll, `      { path: "knowledge", element: <div data-explorer-page="explorer433" /> },\n${catchAll}`)],
    reds: [dom('NO-EXPLORER-IN-SHIPPED-BUNDLE')],
    allowed: [],
    greens: [dom('NO-CHAT-IN-SHIPPED-BUNDLE'), dom('NO-CHAT-MOUNT-ON-ANY-PAGE')],
  },
  {
    subject: SIDEBAR_SRC, instrument: 'nav', claim: 'SIDEBAR-NAV-EXACT',
    operation: 'add a Knowledge item to the sidebar navItems',
    edits: [edit('  { title: "Config", url: routes.config, icon: SlidersHorizontal, tourId: "tour-nav-config" },\n',
      '  { title: "Config", url: routes.config, icon: SlidersHorizontal, tourId: "tour-nav-config" },\n  { title: "Knowledge", url: "/knowledge", icon: Play },\n')],
    reds: [sidebar('SIDEBAR-NAV-EXACT')],
    allowed: [],
    // The tour-anchor cell checks the five anchored items, /insights and /chat; a Knowledge item is none of them.
    greens: [sidebar('adds approved product tour anchors to primary nav items only'),
      sidebar('renders the Hooks nav item with the Webhook icon'), palette('PALETTE-PAGES-EXACT')],
  },
  {
    subject: PALETTE_SRC, instrument: 'nav', claim: 'PALETTE-PAGES-EXACT',
    operation: 'add a Knowledge entry to the palette pages',
    edits: [edit('  { title: "Config", url: routes.config, icon: SlidersHorizontal },\n',
      '  { title: "Config", url: routes.config, icon: SlidersHorizontal },\n  { title: "Knowledge", url: "/knowledge", icon: Play },\n')],
    reds: [palette('PALETTE-PAGES-EXACT')],
    allowed: [],
    greens: [palette('includes Hooks in the Pages group'), sidebar('SIDEBAR-NAV-EXACT')],
  },
  {
    subject: APP_SRC, instrument: 'census', claim: 'C433-EXPLORER-ABSENT',
    operation: 'name the explorer route as a double-quoted URL in a production comment',
    // One needle only: the lower-cased line opens a double quote onto the memory stem, and no name
    // needle, no other quote style and no router-path spelling is present.
    edits: [edit('const RunsPage = lazy(', '// The standalone explorer is served at "/memory".\nconst RunsPage = lazy(')],
    reds: [census('C433-EXPLORER-ABSENT: no production source spells a double-quoted memory URL',
      'a standalone explorer spelling arrived')],
    allowed: [],
    greens: censusControls,
  },
  {
    subject: RUN_SRC, instrument: 'tty', claim: 'C433-DOOR-TTY-NONPRODUCTION',
    operation: 'wait for one line of stdin at a TTY before the member runs, in the shipped CLI',
    crossing: { pkg: 'agent-qa', dir: 'packages/cli', marker: 'tty433wait',
      reference: "join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'dist', 'cli.js')", byPath: true },
    edits: [edit(executorEntry,
      `${executorEntry}    if (process.stdin.isTTY) await new Promise((resolve) => process.stdin.once('data', () => resolve('tty433wait')))\n`)],
    reds: [tty('C433-DOOR-TTY-NONPRODUCTION', 'the TTY door waited for input')],
    // The opted-in production run reaches the same executor through the same door.
    allowed: [tty('C433-DOOR-TTY-OPT-IN-RUNS')],
    greens: [tty('C433-TTY-WRAPPER-IS-TTY'), tty('C433-DOOR-TTY-PRODUCTION-REFUSED')],
  },
]

runGate({
  slug: '433-closing-cells-mutation', envPrefix: 'AGENT_QA_433_CLOSING_CELLS_MUTATION', idPrefix: 'X',
  instruments, legs, expectedLegs: 6, banner: 'CLOSING_CELLS_MUTATION_OK', parseCheck: true,
  argv: process.argv.slice(2),
})
NODE
