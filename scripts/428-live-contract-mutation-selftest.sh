#!/usr/bin/env bash
# The live preview contract instrument's own test (428-25). Every declared leg is run NEUTERED — the
# mutation withheld — and must FATAL with "<leg>: suite stayed green" after an actual green child of
# its own suite. The interruption modes (fatal, SIGINT, SIGTERM, SIGHUP) must mutate every subject
# and hand back the exact bytes and mtimes, then rebuild; a dirty subject must be refused and left
# as found; invalid knobs refuse before ownership.
#
# THE INVENTORY BELOW IS WRITTEN OUT, NOT DERIVED. A leg silently dropped, re-aimed or renamed in
# 428-live-contract-mutation.sh reddens HERE instead of shrinking both in step — which is the whole
# reason a total read off the gate would be worthless: it would agree with the gate however the gate
# moved.
#
# 2026-09-26 (428-29, G-428-2): the inventory grows 23 → 27 rows with the gate. C24..C27 pin the
# optional, masked stepTexts that 428-28 added to testStarted.
#
# Runs in place on the real tree. Slow; a phase gate, not a per-commit sample.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
exec node --test-reporter=tap --input-type=commonjs - <<'NODE'
const path = require('node:path')
const { runSelftest } = require(path.join(process.cwd(), 'scripts/423-mutation-engine.cjs'))

const STREAM_SRC = 'packages/schema/src/run/live-stream.ts'
const URL_SRC = 'packages/schema/src/run/live-url.ts'
const TOKEN_SRC = 'packages/agent/src/functions/live-url.ts'
const HUB_SRC = 'packages/runner/src/run/live-stream-hub.ts'
const SNAPSHOT_SRC = 'packages/runner/src/run/snapshot-live-stream.ts'
const WEB_SRC = 'packages/web/src/adapter.ts'
const ANDROID_SRC = 'packages/android/src/adapter.ts'
const PROTOCOL_SRC = 'packages/dashboard-server/src/live-view/protocol.ts'
const PROXY_SRC = 'packages/dashboard-server/src/live-view/frame-proxy.ts'
const EMBED_SRC = 'packages/dashboard-server/src/live-view/embed-page.ts'
const HANDLER_SRC = 'packages/dashboard-server/src/live-editor/ws-handler.ts'
const SERVER_SRC = 'packages/dashboard-server/src/server/server.ts'
const ROUTES_SRC = 'packages/dashboard-server/src/server/routes.ts'
const MAPPING_SRC = 'packages/mcp/src/mapping.ts'
const BUS_EVENTS_SRC = 'packages/schema/src/run/bus-events.ts'
const SHELL_SRC = 'packages/runner/src/run/shell.ts'
const MEMBERS_SRC = 'packages/cli/src/commands/direct-run-members.ts'

const SCHEMA_D = 'src/__tests__/428-live-contracts.test-d.ts'
const TOKEN_T = 'src/functions/__tests__/live-url.test.ts'
const HUB_T = 'src/run/__tests__/live-stream-hub.test.ts'
const SNAPSHOT_T = 'src/run/__tests__/snapshot-live-stream.test.ts'
const SCREENCAST_T = 'src/__tests__/live-stream.screencast.test.ts'
const ANDROID_T = 'src/__tests__/adapter.test.ts'
const PROXY_T = 'src/__tests__/live-view.frame-proxy.test.ts'
const SETS_D = 'src/__tests__/428-live-closed-sets.test-d.ts'
const DOORS_T = 'src/__tests__/428-live-editor-doors.test.ts'
const HANDLER_T = 'src/__tests__/ws-handler.test.ts'
const DELETED_T = 'src/__tests__/428-screenshot-path-deleted.test.ts'
const GUARD_T = 'src/__tests__/mapping-bump-guard.test.ts'
const PIN_T = 'src/__tests__/conformance/embed-contract-pin.test.ts'
const SHELL_T = 'src/run/__tests__/run-shell.test.ts'
const MASKING_T = 'src/run/__tests__/masking-proof.test.ts'
const MEMBERS_T = 'src/__tests__/direct-run-members.test.ts'

const DASHBOARD = '@vostride/agent-qa-dashboard'

runSelftest({
  slug: '428-live-contract-mutation',
  gateScript: 'scripts/428-live-contract-mutation.sh',
  envPrefix: 'AGENT_QA_428_LIVE_CONTRACT_MUTATION',
  idPrefix: 'C',
  banner: 'LIVE_CONTRACT_MUTATION_OK',
  registration: {
    'validate:428-live-contract-mutation': 'bash scripts/428-live-contract-mutation.sh',
    'validate:428-live-contract-mutation-selftest': 'bash scripts/428-live-contract-mutation-selftest.sh',
  },
  expected: [
    { id: 'C01', claim: 'C428-LIVE-STREAM-KINDS-EXACT', subject: STREAM_SRC,
      reds: [`${SCHEMA_D} > C428-LIVE-STREAM-KINDS-EXACT`] },
    { id: 'C02', claim: 'C428-FRAME-END-REASONS-EXACT', subject: STREAM_SRC,
      reds: [`${SCHEMA_D} > C428-FRAME-END-REASONS-EXACT`] },
    { id: 'C03', claim: 'C428-LIVE-VIEW-SUBJECT-KINDS-EXACT', subject: URL_SRC,
      reds: [`${SCHEMA_D} > C428-LIVE-VIEW-SUBJECT-KINDS-EXACT`] },
    { id: 'C04', claim: 'C428-REFUSAL-REASONS-EXACT', subject: PROTOCOL_SRC,
      reds: [`${SETS_D} > C428-REFUSAL-REASONS-EXACT`] },
    { id: 'C05', claim: 'C428-END-REASONS-EXACT', subject: PROTOCOL_SRC,
      reds: [`${SETS_D} > C428-END-REASONS-EXACT`] },
    { id: 'C06', claim: 'C428-EMBED-STATES-EXACT', subject: EMBED_SRC,
      reds: [`${SETS_D} > C428-EMBED-STATES-EXACT`] },
    { id: 'C07', claim: 'C428-EMBED-REPORT-EVENTS-EXACT', subject: EMBED_SRC,
      reds: [`${SETS_D} > C428-EMBED-REPORT-EVENTS-EXACT`] },
    { id: 'C08', claim: 'RUN-TOKEN-REFUSED-FOR-EDITOR-SUBJECT', subject: TOKEN_SRC,
      reds: [`${TOKEN_T} > RUN-TOKEN-REFUSED-FOR-EDITOR-SUBJECT`] },
    { id: 'C09', claim: 'KIND-DISPATCH-BY-SIGNED-SUBJECT', subject: PROXY_SRC,
      reds: [`${PROXY_T} > (30) KIND-DISPATCH-BY-SIGNED-SUBJECT: one id, two subjects, and each token opens only its own`] },
    { id: 'C10', claim: 'EDITOR-UPGRADE-CROSS-SITE-DESTROYED', subject: SERVER_SRC,
      reds: [`${DOORS_T} > EDITOR-UPGRADE-CROSS-SITE-DESTROYED (x2)`] },
    { id: 'C11', claim: 'UNEXPECTED-CLOSE-DETACHES', subject: HANDLER_SRC,
      reds: [`${HANDLER_T} > UNEXPECTED-CLOSE-DETACHES`] },
    { id: 'C12', claim: 'STALE-CLIENT-GETS-UNKNOWN-TYPE', subject: HANDLER_SRC,
      reds: [`${DELETED_T} > STALE-CLIENT-GETS-UNKNOWN-TYPE`, `${DELETED_T} > SERVER-HAS-NO-SCREENSHOT-MESSAGE (x2)`] },
    { id: 'C13', claim: 'STATIC-PAGE-KEEPALIVE', subject: WEB_SRC,
      reds: [`${SCREENCAST_T} > STATIC-PAGE-KEEPALIVE`] },
    { id: 'C14', claim: 'TAB-FOLLOW', subject: WEB_SRC,
      reds: [`${SCREENCAST_T} > TAB-FOLLOW`] },
    { id: 'C15', claim: 'CLOSE-EVICTS-AND-TELLS', subject: HUB_SRC,
      reds: [`${HUB_T} > CLOSE-EVICTS-AND-TELLS`] },
    { id: 'C16', claim: 'READY-AFTER-SUBSCRIBE', subject: PROXY_SRC,
      reds: [`${PROXY_T} > (27) READY-AFTER-SUBSCRIBE`] },
    { id: 'C17', claim: 'TS-KEPT-WHEN-PRESENT', subject: HUB_SRC,
      reds: [`${HUB_T} > (u) TS-KEPT-WHEN-PRESENT`] },
    { id: 'C18', claim: 'SKIP-WHILE-IN-FLIGHT', subject: SNAPSHOT_SRC,
      reds: [`${SNAPSHOT_T} > SKIP-WHILE-IN-FLIGHT`] },
    { id: 'C19', claim: 'LIVE-STREAM-IS-CONTEXT-NEUTRAL-SNAPSHOT', subject: ANDROID_SRC,
      reds: [`${ANDROID_T} > LIVE-STREAM-IS-CONTEXT-NEUTRAL-SNAPSHOT`] },
    { id: 'C20', claim: 'START-FAILURE-FALLS-BACK', subject: HUB_SRC,
      reds: [`${HUB_T} > START-FAILURE-FALLS-BACK`] },
    { id: 'C21', claim: 'MAPPING-BUMP-GUARD-COUNT', subject: MAPPING_SRC,
      reds: [`${GUARD_T} > measures the registry at the count this suite header records`] },
    { id: 'C22', claim: 'LIVE-EDITOR-DOORS-CARRY-NO-ACAO', subject: ROUTES_SRC,
      reds: [`${DOORS_T} > LIVE-EDITOR-DOORS-CARRY-NO-ACAO: no admitted answer carries a wildcard grant`] },
    { id: 'C23', claim: 'EMBED-PAGE-SHA256', subject: EMBED_SRC, crossing: DASHBOARD,
      reds: [`${PIN_T} > hashes the served embed page to the constant recorded when 408 froze it`] },
    { id: 'C24', claim: 'C428-TEST-STARTED-STEP-TEXTS-OPTIONAL', subject: BUS_EVENTS_SRC,
      reds: [`${SCHEMA_D} > C428-TEST-STARTED-STEP-TEXTS-OPTIONAL`] },
    { id: 'C25', claim: 'STEP-TEXTS-MASKED-LIKE-STEP-TEXT', subject: SHELL_SRC,
      reds: [`${MASKING_T} > STEP-TEXTS-MASKED-LIKE-STEP-TEXT`] },
    { id: 'C26', claim: 'STEP-TEXTS-ON-TESTSTARTED', subject: SHELL_SRC,
      reds: [`${SHELL_T} > STEP-TEXTS-ON-TESTSTARTED`] },
    { id: 'C27', claim: 'STEP-TEXTS-FROM-PARSED-STEPS', subject: MEMBERS_SRC,
      reds: [`${MEMBERS_T} > STEP-TEXTS-FROM-PARSED-STEPS`] },
  ],
})
NODE
