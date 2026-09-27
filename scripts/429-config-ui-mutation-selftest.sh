#!/usr/bin/env bash
# The task-oriented Config UI instrument's own test (429-35). Every declared leg is run NEUTERED —
# the mutation withheld — and must FATAL with "<leg>: suite stayed green" after an actual green child
# of its own suite. The interruption modes (fatal, SIGINT, SIGTERM, SIGHUP) must mutate every
# subject and hand back the exact bytes and mtimes, then rebuild; a dirty subject must be refused and
# left as found; invalid knobs refuse before ownership.
#
# THE INVENTORY BELOW IS WRITTEN OUT, NOT DERIVED. A leg silently dropped, re-aimed or renamed in
# 429-config-ui-mutation.sh reddens HERE instead of shrinking both in step — which is the whole
# reason a total read off the gate would be worthless: it would agree with the gate however the gate
# moved.
#
# 2026-09-27, 429-50: U32..U43 are the gap closure's legs and four subjects join (config-fields.ts,
# eval-section.tsx, model-workspace.ts, token-list.tsx), eighteen in all. The legs 429-50 re-spelled
# (U23, U25) moved only in their allowed lists, which this inventory does not spell, so their entries
# are unchanged.
#
# Runs in place on the real tree. Slow; a phase gate, not a per-commit sample.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
exec node --test-reporter=tap --input-type=commonjs - <<'NODE'
const path = require('node:path')
const { runSelftest } = require(path.join(process.cwd(), 'scripts/423-mutation-engine.cjs'))

const TABS_SRC = 'packages/dashboard-ui/src/lib/config-tabs.ts'
const COPY_SRC = 'packages/dashboard-ui/src/lib/config-copy.ts'
const AUTOSAVE_SRC = 'packages/dashboard-ui/src/lib/config-autosave.ts'
const DRAFT_SRC = 'packages/dashboard-ui/src/lib/add-model-draft.ts'
const HOOK_SRC = 'packages/dashboard-ui/src/hooks/use-config-autosave.ts'
const TIMEOUT_SRC = 'packages/dashboard-ui/src/components/config-manager/timeout-section.tsx'
const RUNS_SRC = 'packages/dashboard-ui/src/components/config-manager/runs-section.tsx'
const MODEL_ROW_SRC = 'packages/dashboard-ui/src/components/config-manager/model-row.tsx'
const FARMS_SRC = 'packages/dashboard-ui/src/components/config-manager/providers-section.tsx'
const FIELD_SRC = 'packages/dashboard-ui/src/components/config-manager/config-field.tsx'
const ADD_ROW_SRC = 'packages/dashboard-ui/src/components/config-manager/add-model-row.tsx'
const SECRET_SRC = 'packages/dashboard-ui/src/components/config-manager/secret-value.tsx'
const TAB_BAR_SRC = 'packages/dashboard-ui/src/components/config-manager/config-tabs.tsx'
const PAGE_SRC = 'packages/dashboard-ui/src/pages/config.tsx'
const FIELDS_SRC = 'packages/dashboard-ui/src/lib/config-fields.ts'
const EVAL_SRC = 'packages/dashboard-ui/src/components/config-manager/eval-section.tsx'
const WORKSPACE_SRC = 'packages/dashboard-ui/src/lib/model-workspace.ts'
const TOKEN_SRC = 'packages/dashboard-ui/src/components/config-manager/token-list.tsx'

const TABS_T = 'src/lib/__tests__/config-tabs.test.ts'
const TABS_D = 'src/lib/__tests__/config-tabs.test-d.ts'
const COPY_T = 'src/lib/__tests__/config-copy.test.ts'
const AUTOSAVE_T = 'src/lib/__tests__/config-autosave.test.ts'
const DRAFT_T = 'src/lib/__tests__/add-model-draft.test.ts'
const STATIC_T = 'src/lib/__tests__/config-static.test.ts'
const HOOK_T = 'src/hooks/__tests__/use-config-autosave.test.tsx'
const SECRET_T = 'src/components/config-manager/__tests__/secret-value.test.tsx'
const ADD_ROW_T = 'src/components/config-manager/__tests__/add-model-row.test.tsx'
const PAGE_T = 'src/pages/__tests__/config-page.test.tsx'
const COVERAGE_T = 'src/pages/__tests__/config-page.schema-coverage.test.tsx'
const A11Y_T = 'src/pages/__tests__/config-page.a11y.test.tsx'
const DOM_T = 'src/__tests__/conformance/429-config-dom.test.ts'
const FIELDS_T = 'src/lib/__tests__/config-fields.test.ts'
const WORKSPACE_T = 'src/lib/__tests__/model-workspace.test.ts'
const EVAL_T = 'src/components/config-manager/__tests__/eval-section.test.tsx'
const MODEL_ROW_T = 'src/components/config-manager/__tests__/model-row.test.tsx'
const TOKEN_T = 'src/components/config-manager/__tests__/token-list.test.tsx'

const UI = '@vostride/agent-qa-dashboard-ui'

runSelftest({
  slug: '429-config-ui-mutation',
  gateScript: 'scripts/429-config-ui-mutation.sh',
  envPrefix: 'AGENT_QA_429_CONFIG_UI_MUTATION',
  idPrefix: 'U',
  banner: 'CONFIG_UI_MUTATION_OK',
  registration: {
    'validate:429-config-ui-mutation': 'bash scripts/429-config-ui-mutation.sh',
    'validate:429-config-ui-mutation-selftest': 'bash scripts/429-config-ui-mutation-selftest.sh',
  },
  expected: [
    { id: 'U01', claim: 'C429-CONFIG-TABS-EXACT', subject: TABS_SRC,
      reds: [`${TABS_D} > C429-CONFIG-TABS-EXACT`] },
    { id: 'U02', claim: 'C429-CONFIG-SECTIONS-EXACT', subject: TABS_SRC,
      reds: [`${TABS_D} > C429-CONFIG-SECTIONS-EXACT`] },
    { id: 'U03', claim: 'C429-SAVE-STATES-EXACT', subject: TABS_SRC,
      reds: [`${TABS_D} > C429-SAVE-STATES-EXACT`] },
    { id: 'U04', claim: 'C429-FIELD-STATES-EXACT', subject: TABS_SRC,
      reds: [`${TABS_D} > C429-FIELD-STATES-EXACT`] },
    { id: 'U05', claim: 'C429-CONNECTION-CHOICES-EXACT', subject: TABS_SRC,
      reds: [`${TABS_D} > C429-CONNECTION-CHOICES-EXACT`] },
    { id: 'U06', claim: 'C429-MODEL-STATUSES-EXACT', subject: TABS_SRC,
      reds: [`${TABS_D} > C429-MODEL-STATUSES-EXACT`] },
    { id: 'U07', claim: 'C429-TEST-RESULTS-EXACT', subject: TABS_SRC,
      reds: [`${TABS_D} > C429-TEST-RESULTS-EXACT`] },
    { id: 'U08', claim: 'C429-EXPLICIT-ACTION-KINDS-EXACT', subject: TABS_SRC,
      reds: [`${TABS_D} > C429-EXPLICIT-ACTION-KINDS-EXACT`] },
    { id: 'U09', claim: 'C429-REVEAL-STATES-EXACT', subject: TABS_SRC,
      reds: [`${TABS_D} > C429-REVEAL-STATES-EXACT`] },
    { id: 'U10', claim: 'LEGACY-LINKS-TOTAL', subject: TABS_SRC,
      reds: [`${TABS_D} > LEGACY-LINKS-TOTAL`, `${TABS_T} > LEGACY-LINKS-TOTAL`] },
    { id: 'U11', claim: 'NO-SAVE-BUTTON-IN-CONFIG-SOURCE', subject: TIMEOUT_SRC,
      reds: [`${STATIC_T} > NO-SAVE-BUTTON-IN-CONFIG-SOURCE`] },
    { id: 'U12', claim: 'NO-TOAST-IN-CONFIG-SOURCE', subject: PAGE_SRC,
      reds: [`${STATIC_T} > NO-TOAST-IN-CONFIG-SOURCE`] },
    { id: 'U13', claim: 'NO-DIALOG-IN-CONFIG-SOURCE', subject: MODEL_ROW_SRC,
      reds: [`${STATIC_T} > NO-DIALOG-IN-CONFIG-SOURCE`] },
    { id: 'U14', claim: 'FAILED-WRITE-KEEPS-DRAFT', subject: AUTOSAVE_SRC,
      reds: [`${AUTOSAVE_T} > FAILED-WRITE-KEEPS-DRAFT`] },
    { id: 'U15', claim: 'FAILED-WRITE-NEVER-SAVED', subject: AUTOSAVE_SRC,
      reds: [`${AUTOSAVE_T} > FAILED-WRITE-NEVER-SAVED`] },
    { id: 'U16', claim: 'SECRET-NEVER-IN-STORAGE', subject: HOOK_SRC,
      reds: [`${HOOK_T} > SECRET-NEVER-IN-STORAGE (x2)`] },
    { id: 'U17', claim: 'ADD-DRAFT-NEVER-HOLDS-SECRETS', subject: DRAFT_SRC,
      reds: [`${DRAFT_T} > ADD-DRAFT-NEVER-HOLDS-SECRETS (x2)`] },
    { id: 'U18', claim: 'SAVE-VALUE-EXPLICIT', subject: SECRET_SRC,
      reds: [`${SECRET_T} > SAVE-VALUE-EXPLICIT`] },
    { id: 'U19', claim: 'NO-NAV-SELECT-SOURCE', subject: PAGE_SRC,
      reds: [`${STATIC_T} > NO-NAV-SELECT-SOURCE`] },
    { id: 'U20', claim: 'SCHEMA-COVERAGE-EVERY-LEAF', subject: RUNS_SRC,
      reds: [`${COVERAGE_T} > SCHEMA-COVERAGE-EVERY-LEAF`] },
    { id: 'U21', claim: 'NO-PATH-BADGES-SOURCE', subject: FIELD_SRC,
      reds: [`${STATIC_T} > NO-PATH-BADGES-SOURCE`] },
    { id: 'U22', claim: 'ADD-FLOW-NO-WRITE-BEFORE-CONNECT', subject: ADD_ROW_SRC,
      reds: [`${ADD_ROW_T} > ADD-FLOW-NO-WRITE-BEFORE-CONNECT`] },
    { id: 'U23', claim: 'ADD-NAME-VALIDATION', subject: ADD_ROW_SRC,
      reds: [`${ADD_ROW_T} > ADD-NAME-VALIDATION`] },
    { id: 'U24', claim: 'NO-RAIL-SOURCE', subject: PAGE_SRC,
      reds: [`${STATIC_T} > NO-RAIL-SOURCE`] },
    { id: 'U25', claim: 'REVEAL-ON-CLICK-ONLY', subject: SECRET_SRC,
      reds: [`${SECRET_T} > REVEAL-ON-CLICK-ONLY`] },
    { id: 'U26', claim: 'COPY-429', subject: COPY_SRC,
      reds: [`${COPY_T} > COPY-429: providerErrorSentence is the schema classifier function itself, never re-spelled`] },
    { id: 'U27', claim: 'STATUS-IN-TAB-BAR', subject: TAB_BAR_SRC,
      reds: [`${PAGE_T} > STATUS-IN-TAB-BAR`] },
    { id: 'U28', claim: 'FORCED-FAILURE-KEEPS-DRAFT', subject: AUTOSAVE_SRC,
      reds: [`${HOOK_T} > FORCED-FAILURE-KEEPS-DRAFT (x2)`] },
    { id: 'U29', claim: 'NO-DIALOG-IN-CONFIG', subject: FARMS_SRC,
      reds: [`${A11Y_T} > NO-DIALOG-IN-CONFIG`] },
    { id: 'U30', claim: 'TABS-FIVE-IN-ORDER-SHIPPED', subject: PAGE_SRC, crossing: UI,
      reds: [`${DOM_T} > TABS-FIVE-IN-ORDER-SHIPPED`] },
    { id: 'U31', claim: 'STATUS-NEVER-SCROLLS-AWAY', subject: TAB_BAR_SRC, crossing: UI,
      reds: [`${DOM_T} > STATUS-NEVER-SCROLLS-AWAY`] },
    // The gap closure's legs (429-50).
    { id: 'U32', claim: 'OUTSIDE-EDIT-INTERLEAVED-REREAD', subject: HOOK_SRC,
      reds: [`${HOOK_T} > OUTSIDE-EDIT-INTERLEAVED-REREAD`] },
    { id: 'U33', claim: 'MIRROR-CONTINUES-PAST-MISSING-PARENT', subject: HOOK_SRC,
      reds: [`${HOOK_T} > MIRROR-CONTINUES-PAST-MISSING-PARENT`] },
    { id: 'U34', claim: 'SIBLING-COMPLETION-NEVER-OVERWRITES', subject: FIELDS_SRC,
      reds: [`${FIELDS_T} > SIBLING-COMPLETION-NEVER-OVERWRITES`] },
    { id: 'U35', claim: 'COMPUTED-WRITE-MERGES-OUTSIDE-EDIT', subject: HOOK_SRC,
      reds: [`${HOOK_T} > COMPUTED-WRITE-MERGES-OUTSIDE-EDIT: a field_changed refusal re-reads, recomputes and lands on the file's list`] },
    { id: 'U36', claim: 'JUDGE-WRITE-EXPECTS-LIST', subject: EVAL_SRC,
      reds: [`${EVAL_T} > JUDGE-WRITE-EXPECTS-LIST`] },
    { id: 'U37', claim: 'DELETE-JUDGE-EXPECTS-LIST', subject: WORKSPACE_SRC,
      reds: [`${WORKSPACE_T} > DELETE-JUDGE-EXPECTS-LIST`] },
    { id: 'U38', claim: 'HEADER-RENAME-NEVER-REVEALS', subject: MODEL_ROW_SRC,
      reds: [`${MODEL_ROW_T} > HEADER-RENAME-NEVER-REVEALS (x2)`] },
    { id: 'U39', claim: 'DISCARD-NEVER-DELETES-SAVED-CREDENTIAL', subject: ADD_ROW_SRC,
      reds: [`${ADD_ROW_T} > DISCARD-NEVER-DELETES-SAVED-CREDENTIAL`] },
    { id: 'U40', claim: 'CONNECT-REFUSAL-COPY', subject: ADD_ROW_SRC,
      reds: [`${ADD_ROW_T} > CONNECT-REFUSAL-COPY`] },
    { id: 'U41', claim: 'CONNECT-REFUSAL-COPY-TOTAL', subject: COPY_SRC,
      reds: [`${COPY_T} > CONNECT-REFUSAL-COPY-TOTAL: every code the connect door can answer has its own full sentence`] },
    { id: 'U42', claim: 'ADD-MCP-TOKEN-KEEPS-EVERY-SCOPE', subject: TOKEN_SRC,
      reds: [`${TOKEN_T} > ADD-MCP-TOKEN-KEEPS-EVERY-SCOPE`] },
    { id: 'U43', claim: 'OUTSIDE-EDIT-INTERLEAVED-SHIPPED', subject: HOOK_SRC, crossing: UI,
      reds: [`${DOM_T} > OUTSIDE-EDIT-INTERLEAVED-SHIPPED`] },
  ],
})
NODE
