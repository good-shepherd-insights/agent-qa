#!/usr/bin/env bash
# The live preview UI instrument's own test (428-26). Every declared leg is run NEUTERED — the
# mutation withheld — and must FATAL with "<leg>: suite stayed green" after an actual green child of
# its own suite. The interruption modes (fatal, SIGINT, SIGTERM, SIGHUP) must mutate every subject
# and hand back the exact bytes and mtimes, then rebuild; a dirty subject must be refused and left
# as found; invalid knobs refuse before ownership.
#
# THE INVENTORY BELOW IS WRITTEN OUT, NOT DERIVED. A leg silently dropped, re-aimed or renamed in
# 428-live-ui-mutation.sh reddens HERE instead of shrinking both in step — which is the whole reason
# a total read off the gate would be worthless: it would agree with the gate however the gate moved.
#
# Runs in place on the real tree. Slow; a phase gate, not a per-commit sample.
#
# 2026-09-26 (428-35, owner review G-428-1..5): U07 and U25 are re-aimed (NO-ANIMATION-ON-LIVE-PAGE
# on health-dot.tsx, DOT-IS-STILL on globals.css), and U26..U37 guard the five owner decisions. The
# inventory grows from 25 rows over 9 subjects to 37 rows over 12.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
exec node --test-reporter=tap --input-type=commonjs - <<'NODE'
const path = require('node:path')
const { runSelftest } = require(path.join(process.cwd(), 'scripts/423-mutation-engine.cjs'))

const PREVIEW_SRC = 'packages/dashboard-ui/src/lib/live-preview.ts'
const LAYOUT_SRC = 'packages/dashboard-ui/src/lib/live-run-layout.ts'
const ROW_SRC = 'packages/dashboard-ui/src/components/live-step-row.tsx'
const COMPONENT_SRC = 'packages/dashboard-ui/src/components/live-preview/live-preview.tsx'
const PANEL_SRC = 'packages/dashboard-ui/src/components/run-results-panel.tsx'
const STEPS_SRC = 'packages/dashboard-ui/src/components/live-run/step-list.tsx'
const PAGE_SRC = 'packages/dashboard-ui/src/pages/live-run.tsx'
const HOOK_SRC = 'packages/dashboard-ui/src/hooks/use-live-editor.ts'
const CSS_SRC = 'packages/dashboard-ui/src/styles/globals.css'
const HEALTH_SRC = 'packages/dashboard-ui/src/components/live-preview/health-dot.tsx'
const REDUCER_SRC = 'packages/dashboard-ui/src/lib/run-stream-reducer.ts'
const WATCH_SRC = 'packages/dashboard-ui/src/lib/live-run-watch.ts'

const LIB_T = 'src/lib/__tests__/live-preview.test.ts'
const LIB_D = 'src/lib/__tests__/live-preview.test-d.ts'
const LAYOUT_T = 'src/lib/__tests__/live-run-layout.test.ts'
const WATCH_T = 'src/lib/__tests__/live-run-watch.test.ts'
const PREVIEW_C = 'src/components/live-preview/__tests__/live-preview.test.tsx'
const ONE_C = 'src/components/live-preview/__tests__/one-preview.test.ts'
const ROW_C = 'src/components/__tests__/live-step-row.test.tsx'
const HOOK_T = 'src/__tests__/use-live-editor.test.ts'
const PAGE_C = 'src/pages/__tests__/live-run.test.tsx'
const PREVIEW_DOM = 'src/__tests__/conformance/428-live-preview-dom.test.ts'
const LAYOUT_DOM = 'src/__tests__/conformance/428-live-layout-dom.test.ts'

const DASHBOARD_UI = '@vostride/agent-qa-dashboard-ui'

runSelftest({
  slug: '428-live-ui-mutation',
  gateScript: 'scripts/428-live-ui-mutation.sh',
  envPrefix: 'AGENT_QA_428_LIVE_UI_MUTATION',
  idPrefix: 'U',
  banner: 'LIVE_UI_MUTATION_OK',
  registration: {
    'validate:428-live-ui-mutation': 'bash scripts/428-live-ui-mutation.sh',
    'validate:428-live-ui-mutation-selftest': 'bash scripts/428-live-ui-mutation-selftest.sh',
  },
  expected: [
    { id: 'U01', claim: 'C428-PREVIEW-STATES-EXACT', subject: PREVIEW_SRC,
      reds: [`${LIB_D} > C428-PREVIEW-STATES-EXACT`] },
    { id: 'U02', claim: 'C428-DOT-STATES-EXACT', subject: PREVIEW_SRC,
      reds: [`${LIB_D} > C428-DOT-STATES-EXACT`] },
    { id: 'U03', claim: 'C428-EMBED-REPORT-EVENTS-EXACT', subject: PREVIEW_SRC,
      reds: [`${LIB_D} > C428-EMBED-REPORT-EVENTS-EXACT`] },
    { id: 'U04', claim: 'C428-PREVIEW-ACTIONS-EXACT', subject: PREVIEW_SRC,
      reds: [`${LIB_D} > C428-PREVIEW-ACTIONS-EXACT`] },
    { id: 'U05', claim: 'CLOSED-SETS-428-LAYOUT', subject: LAYOUT_SRC,
      reds: [`${LAYOUT_T} > CLOSED-SETS-428-LAYOUT`] },
    { id: 'U06', claim: 'GLYPH-TABLE-TOTAL-AND-INJECTIVE', subject: ROW_SRC,
      reds: [`${ROW_C} > GLYPH-TABLE-TOTAL-AND-INJECTIVE`] },
    { id: 'U07', claim: 'NO-ANIMATION-ON-LIVE-PAGE', subject: HEALTH_SRC, crossing: DASHBOARD_UI,
      reds: [`${PREVIEW_DOM} > NO-ANIMATION-ON-LIVE-PAGE`] },
    { id: 'U08', claim: 'NO-BUS-INPUT', subject: PREVIEW_SRC,
      reds: [`${LIB_D} > NO-BUS-INPUT`] },
    { id: 'U09', claim: 'STALL-TURNS-AMBER', subject: PREVIEW_SRC,
      reds: [`${LIB_T} > STALL-TURNS-AMBER`] },
    { id: 'U10', claim: 'STALL-TURNS-AMBER-WHILE-HEARTBEAT-CONTINUES', subject: PREVIEW_SRC, crossing: DASHBOARD_UI,
      reds: [`${PREVIEW_DOM} > STALL-TURNS-AMBER-WHILE-HEARTBEAT-CONTINUES`] },
    { id: 'U11', claim: 'STATIC-PAGE-STAYS-GREEN', subject: PREVIEW_SRC,
      reds: [`${LIB_T} > STATIC-PAGE-STAYS-GREEN`] },
    { id: 'U12', claim: 'SNAPSHOT-LABEL-IFF-SNAPSHOT-FRAME', subject: PREVIEW_SRC,
      reds: [`${LIB_T} > SNAPSHOT-LABEL-IFF-SNAPSHOT-FRAME`] },
    { id: 'U13', claim: 'SNAPSHOT-LABEL-ON-SNAPSHOT-FRAMES', subject: PREVIEW_SRC, crossing: DASHBOARD_UI,
      reds: [`${PREVIEW_DOM} > SNAPSHOT-LABEL-ON-SNAPSHOT-FRAMES`] },
    { id: 'U14', claim: 'HOOK-HAS-NO-SCREENSHOT-POLLING', subject: HOOK_SRC,
      reds: [`${HOOK_T} > HOOK-HAS-NO-SCREENSHOT-POLLING: a connected session sends no retired request in 10 s`,
        `${HOOK_T} > HOOK-HAS-NO-SCREENSHOT-POLLING: the hook's source names no polling function or retired message`] },
    { id: 'U15', claim: 'SECRET-PLACEHOLDER-AS-CHIP', subject: ROW_SRC,
      reds: [`${ROW_C} > SECRET-PLACEHOLDER-AS-CHIP`] },
    { id: 'U16', claim: 'NO-CLOCK-ON-ANY-ROW', subject: ROW_SRC,
      reds: [`${PAGE_C} > NO-CLOCK-ON-ANY-ROW`] },
    { id: 'U17', claim: 'NO-ACTION-COUNT', subject: ROW_SRC,
      reds: [`${PAGE_C} > NO-ACTION-COUNT`] },
    { id: 'U18', claim: 'ROW-IS-GLYPH-AND-LABEL', subject: ROW_SRC,
      reds: [`${ROW_C} > ROW-IS-GLYPH-AND-LABEL`] },
    { id: 'U19', claim: 'NO-REPEATED-SINGLE-MEMBER-TITLE', subject: STEPS_SRC,
      reds: [`${PAGE_C} > NO-REPEATED-SINGLE-MEMBER-TITLE`] },
    { id: 'U20', claim: 'NO-LIVENESS-PILL', subject: PAGE_SRC,
      reds: [`${PAGE_C} > NO-LIVENESS-PILL (x3)`] },
    { id: 'U21', claim: 'ONE-PREVIEW-COMPONENT', subject: PANEL_SRC,
      reds: [`${ONE_C} > ONE-PREVIEW-COMPONENT`] },
    { id: 'U22', claim: 'BRIDGE-SOURCE-CHECKED', subject: COMPONENT_SRC,
      reds: [`${PREVIEW_C} > BRIDGE-SOURCE-CHECKED`] },
    { id: 'U23', claim: 'UNMOUNT-DELETES-WITH-SOCKET-CLOSED', subject: HOOK_SRC,
      reds: [`${HOOK_T} > UNMOUNT-DELETES-WITH-SOCKET-CLOSED (x3)`] },
    { id: 'U24', claim: 'GROUP-KEY-STABLE', subject: PAGE_SRC,
      reds: [`${PAGE_C} > GROUP-KEY-STABLE`] },
    { id: 'U25', claim: 'DOT-IS-STILL', subject: CSS_SRC,
      reds: [`${PREVIEW_C} > DOT-IS-STILL`] },
    { id: 'U26', claim: 'FULL-LABEL-WRAPS', subject: ROW_SRC,
      reds: [`${ROW_C} > FULL-LABEL-WRAPS`] },
    { id: 'U27', claim: 'LONG-LABEL-FULLY-VISIBLE-SHIPPED', subject: ROW_SRC, crossing: DASHBOARD_UI,
      reds: [`${LAYOUT_DOM} > LONG-LABEL-FULLY-VISIBLE-SHIPPED`] },
    { id: 'U28', claim: 'NO-STEP-PLACEHOLDER', subject: ROW_SRC,
      reds: [`${ROW_C} > NO-STEP-PLACEHOLDER`] },
    { id: 'U29', claim: 'PENDING-ROWS-SHOW-KNOWN-TEXT', subject: REDUCER_SRC,
      reds: [`${PAGE_C} > PENDING-ROWS-SHOW-KNOWN-TEXT`] },
    { id: 'U30', claim: 'NO-STEP-PLACEHOLDER-SHIPPED', subject: STEPS_SRC, crossing: DASHBOARD_UI,
      reds: [`${LAYOUT_DOM} > NO-STEP-PLACEHOLDER-SHIPPED`] },
    { id: 'U31', claim: 'NO-HANDLE-PICKER', subject: COMPONENT_SRC,
      reds: [`${PAGE_C} > NO-HANDLE-PICKER`] },
    { id: 'U32', claim: 'FOLLOWS-RUNNING-MEMBER', subject: PAGE_SRC,
      reds: [`${PAGE_C} > FOLLOWS-RUNNING-MEMBER`] },
    { id: 'U33', claim: 'WATCH-SWITCHES-WHEN-NEXT-STARTS', subject: WATCH_SRC,
      reds: [`${WATCH_T} > WATCH-SWITCHES-WHEN-NEXT-STARTS`] },
    { id: 'U34', claim: 'FOLLOWS-RUNNING-MEMBER-SHIPPED', subject: PAGE_SRC, crossing: DASHBOARD_UI,
      reds: [`${LAYOUT_DOM} > FOLLOWS-RUNNING-MEMBER-SHIPPED`] },
    { id: 'U35', claim: 'DOT-IN-CHROME-TOP-LEFT', subject: COMPONENT_SRC,
      reds: [`${PREVIEW_C} > DOT-IN-CHROME-TOP-LEFT`] },
    { id: 'U36', claim: 'DOT-TOP-LEFT-OF-CONTAINER', subject: COMPONENT_SRC, crossing: DASHBOARD_UI,
      reds: [`${PREVIEW_DOM} > DOT-TOP-LEFT-OF-CONTAINER`] },
    { id: 'U37', claim: 'RUNNING-GLYPH-STILL', subject: ROW_SRC,
      reds: [`${ROW_C} > RUNNING-GLYPH-STILL`] },
  ],
})
NODE
