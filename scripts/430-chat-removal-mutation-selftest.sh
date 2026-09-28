#!/usr/bin/env bash
# The dashboard chat removal instrument's own test (430-13). Every declared leg is run NEUTERED — the
# mutation withheld — and must FATAL with "<leg>: suite stayed green" after an actual green child of
# its own suite. The interruption modes (fatal, SIGINT, SIGTERM, SIGHUP) must mutate every subject
# and hand back the exact bytes and mtimes, then rebuild; a dirty subject must be refused and left
# as found; invalid knobs refuse before ownership.
#
# THE INVENTORY BELOW IS WRITTEN OUT, NOT DERIVED. A leg silently dropped, re-aimed or renamed in
# 430-chat-removal-mutation.sh reddens HERE instead of shrinking both in step — which is the whole
# reason a total read off the gate would be worthless: it would agree with the gate however the gate
# moved.
#
# Runs in place on the real tree. Slow; a phase gate, not a per-commit sample.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
exec node --test-reporter=tap --input-type=commonjs - <<'NODE'
const path = require('node:path')
const { runSelftest } = require(path.join(process.cwd(), 'scripts/423-mutation-engine.cjs'))

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
const ATTRIBUTION_SRC = 'packages/cli/src/__tests__/proposal-author-attribution.test.ts'
const DOOR_SRC = 'packages/cli/src/commands/dashboard.ts'
const COMPOSE_SRC = 'packages/agent-local/src/composition/compose-local-agent.ts'
const ROLLCALL_SRC = 'packages/cli/src/__tests__/unmask-boundary-rollcall.test.ts'

const SHELL = 'src/components/__tests__/update-banner.test.tsx'
const CENSUS = 'src/__tests__/430-dashboard-chat-deleted.test.ts'
const SETS_T = 'src/__tests__/430-chat-closed-sets.test.ts'
const SETS_D = 'src/__tests__/430-chat-closed-sets.test-d.ts'
const REMEDY_T = 'src/safety/__tests__/430-remedy-memberships.test.ts'
const REMEDY_D = 'src/safety/__tests__/430-remedy-memberships.test-d.ts'
const remedyReds = [
  `${REMEDY_T} > C430-REMEDY-MEMBERSHIPS-EXACT`,
  `${REMEDY_D} > C430-REMEDY-MEMBERSHIPS-EXACT`,
  `${REMEDY_T} > C430-DASHBOARD-PROJECTION-EMPTY`,
  `${REMEDY_D} > C430-DASHBOARD-PROJECTION-EMPTY`,
]

runSelftest({
  slug: '430-chat-removal-mutation',
  gateScript: 'scripts/430-chat-removal-mutation.sh',
  envPrefix: 'AGENT_QA_430_CHAT_REMOVAL_MUTATION',
  idPrefix: 'R', banner: 'CHAT_REMOVAL_MUTATION_OK',
  registration: {
    'validate:430-chat-removal-mutation': 'bash scripts/430-chat-removal-mutation.sh',
    'validate:430-chat-removal-mutation-selftest': 'bash scripts/430-chat-removal-mutation-selftest.sh',
  },
  expected: [
    { id: 'R01', claim: 'NO-CHAT-ROUTE', subject: APP_SRC, reds: [`${SHELL} > NO-CHAT-ROUTE`] },
    { id: 'R02', claim: 'SHELL-CHILDREN-EXACT', subject: APP_SRC, reds: [`${SHELL} > SHELL-CHILDREN-EXACT`] },
    { id: 'R03', claim: 'CENSUS-SESSION-PROVIDER', subject: APP_SRC, reds: [`${CENSUS} > no source or test spells the session provider`] },
    { id: 'R04', claim: 'SIDEBAR-NAV-EXACT', subject: SIDEBAR_SRC, reds: ['src/components/__tests__/app-sidebar.test.tsx > SIDEBAR-NAV-EXACT'] },
    { id: 'R05', claim: 'PALETTE-PAGES-EXACT', subject: PALETTE_SRC, reds: ['src/components/__tests__/command-palette.test.tsx > PALETTE-PAGES-EXACT'] },
    { id: 'R06', claim: 'C430-CHAT-ROUTE-TABLE-EXACT', subject: CHAT_ROUTES_SRC, reds: [`${SETS_T} > C430-CHAT-ROUTE-TABLE-EXACT`] },
    { id: 'R07', claim: 'C430-DELETED-CHAT-ROUTES-SHARED-404', subject: ROUTES_SRC, reds: ['src/__tests__/430-chat-routes-deleted.test.ts > C430-DELETED-CHAT-ROUTES-SHARED-404 (x5)'] },
    { id: 'R08', claim: 'C430-CHAT-ROUTE-HANDLERS-EXACT', subject: CHAT_ROUTES_SRC, reds: [`${SETS_D} > C430-CHAT-ROUTE-TABLE-EXACT`] },
    { id: 'R09', claim: 'ROSTER-FOUR-SURFACES', subject: ROSTER_SRC, reds: ['src/__tests__/conformance/parity.test.ts > pins the roster at the four surfaces that exist today'] },
    { id: 'R10', claim: 'MODULE-FOR-DOOR-EXACT', subject: ATTRIBUTION_SRC, reds: ['src/__tests__/proposal-author-attribution.test.ts > (5) every rostered door supplies a minting surface — the census, over the roster itself'] },
    { id: 'R11', claim: 'C430-AGENT-HOST-MEMBERS-EXACT', subject: HOST_SRC, reds: [`${SETS_D} > C430-AGENT-HOST-MEMBERS-EXACT`] },
    { id: 'R12', claim: 'C430-ANSWER-CONFIRM-MEMBERSHIP', subject: REMEDIES_SRC, reds: remedyReds },
    { id: 'R13', claim: 'C430-SESSION-PIN-FINAL-MEMBERSHIP', subject: REMEDIES_SRC, reds: remedyReds },
    { id: 'R14', claim: 'DENIAL-REASON-ONLY', subject: DENIAL_SRC, reds: ['src/components/run-detail/__tests__/denial-block.test.tsx > DENIAL-REASON-ONLY'] },
    { id: 'R15', claim: 'CENSUS-DASHBOARD-REMEDY-TEXT', subject: DENIAL_SRC, reds: [`${CENSUS} > no source or test spells the dashboard remedy text table`] },
    { id: 'R16', claim: 'CENSUS-PARSER-IMPORT', subject: APP_SRC, reds: [`${CENSUS} > no source or test spells the parser import, double-quoted`] },
    { id: 'R17', claim: 'CENSUS-PARSER-IN-CONTRACT', subject: CONTRACT_SRC, reds: [`${CENSUS} > no source or test spells the parser in the ownership contract`] },
    { id: 'R18', claim: 'CENSUS-CHAT-DIRECTORY-IMPORT', subject: APP_SRC, reds: [`${CENSUS} > no source or test spells the UI chat module import alias`] },
    { id: 'R19', claim: 'CENSUS-ROUTE-PREFIX-IN-UI', subject: API_SRC, reds: [`${CENSUS} > no source or test spells the deleted route prefix`] },
    { id: 'R20', claim: 'CENSUS-ROUTE-PREFIX-IN-SERVER', subject: ROUTES_SRC, reds: [`${CENSUS} > no source or test spells the deleted route prefix`] },
    { id: 'R21', claim: 'CENSUS-SESSION-SURFACE-WRITER', subject: DOOR_SRC, reds: [`${CENSUS} > no source or test spells the session-surface composition option`] },
    { id: 'R22', claim: 'C430-NO-SESSION-SURFACE-OPTION', subject: COMPOSE_SRC, reds: ['src/composition/__tests__/430-no-session-surface-option.test-d.ts > C430-NO-SESSION-SURFACE-OPTION: ComposeLocalAgentInput takes no session-surface tag'] },
    { id: 'R23', claim: 'ROLLCALL-ENROLLMENT-EXACT', subject: ROLLCALL_SRC, reds: ['src/__tests__/unmask-boundary-rollcall.test.ts > every walked surface is enrolled in the SURFACE_ROLLCALL union exactly once'] },
  ],
})
NODE
