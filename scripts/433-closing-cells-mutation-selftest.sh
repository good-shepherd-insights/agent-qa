#!/usr/bin/env bash
# The 433 closing-cells instrument's own test (433-05). Every declared leg is run NEUTERED — the
# mutation withheld — and must FATAL with "<leg>: suite stayed green" after an actual green child of
# its own suite. The interruption modes (fatal, SIGINT, SIGTERM, SIGHUP) must mutate every subject
# and hand back the exact bytes and mtimes, then rebuild; a dirty subject must be refused and left
# as found; invalid knobs refuse before ownership.
#
# THE INVENTORY BELOW IS WRITTEN OUT, NOT DERIVED. A leg silently dropped, re-aimed or renamed in
# 433-closing-cells-mutation.sh reddens HERE instead of shrinking both in step — which is the whole
# reason a total read off the gate would be worthless: it would agree with the gate however the gate
# moved. There is no X07: plan 433-01 took D-25 Branch B, so no recording guard shipped.
#
# RUNS IN PLACE ON THE REAL TREE, and its interruption modes and dirty-subject check rewrite product
# source. Run it only in a checkout no other session is committing to (the pinned `agent-qa-433`
# worktree). Slow; a phase gate, not a per-commit sample.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
exec node --test-reporter=tap --input-type=commonjs - <<'NODE'
const path = require('node:path')
const { runSelftest } = require(path.join(process.cwd(), 'scripts/423-mutation-engine.cjs'))

const APP_SRC = 'packages/dashboard-ui/src/app.tsx'
const SIDEBAR_SRC = 'packages/dashboard-ui/src/components/app-sidebar.tsx'
const PALETTE_SRC = 'packages/dashboard-ui/src/components/command-palette.tsx'
const RUN_SRC = 'packages/cli/src/commands/run.ts'

const ROUTE = 'src/components/__tests__/433-no-explorer-route.test.tsx'
const CENSUS = 'src/__tests__/433-knowledge-explorer-absent.test.ts'

runSelftest({
  slug: '433-closing-cells-mutation',
  gateScript: 'scripts/433-closing-cells-mutation.sh',
  envPrefix: 'AGENT_QA_433_CLOSING_CELLS_MUTATION',
  idPrefix: 'X', banner: 'CLOSING_CELLS_MUTATION_OK',
  registration: {
    'validate:433-closing-cells-mutation': 'bash scripts/433-closing-cells-mutation.sh',
    'validate:433-closing-cells-mutation-selftest': 'bash scripts/433-closing-cells-mutation-selftest.sh',
  },
  expected: [
    { id: 'X01', claim: 'NO-EXPLORER-ROUTE', subject: APP_SRC, reds: [
      `${ROUTE} > NO-EXPLORER-ROUTE: /memory falls through the catch-all to Runs [/memory mounted no Runs page]`,
      `${ROUTE} > NO-EXPLORER-ROUTE: /Memory falls through the catch-all to Runs [/Memory mounted no Runs page]`,
    ] },
    { id: 'X02', claim: 'NO-EXPLORER-IN-SHIPPED-BUNDLE', subject: APP_SRC, crossing: '@vostride/agent-qa-dashboard-ui',
      reds: ['src/__tests__/conformance/dashboard-dom.test.ts > NO-EXPLORER-IN-SHIPPED-BUNDLE'] },
    { id: 'X03', claim: 'SIDEBAR-NAV-EXACT', subject: SIDEBAR_SRC, reds: ['src/components/__tests__/app-sidebar.test.tsx > SIDEBAR-NAV-EXACT'] },
    { id: 'X04', claim: 'PALETTE-PAGES-EXACT', subject: PALETTE_SRC, reds: ['src/components/__tests__/command-palette.test.tsx > PALETTE-PAGES-EXACT'] },
    { id: 'X05', claim: 'C433-EXPLORER-ABSENT', subject: APP_SRC, reds: [
      `${CENSUS} > C433-EXPLORER-ABSENT: no production source spells a double-quoted memory URL [a standalone explorer spelling arrived]`,
    ] },
    { id: 'X06', claim: 'C433-DOOR-TTY-NONPRODUCTION', subject: RUN_SRC, crossing: 'agent-qa',
      reds: ['src/__tests__/conformance/433-tty-door.test.ts > C433-DOOR-TTY-NONPRODUCTION [the TTY door waited for input]'] },
  ],
})
NODE
