#!/usr/bin/env bash
# 429-config-ui-mutation.sh — task-oriented Config's UI side cannot silently regress (429-35,
# PXH-CONF-01..05).
#
# WHAT THIS PROVES, AND WHY A GREEN SUITE DOES NOT PROVE IT. Phase 429 closed nine UI vocabularies
# (the tabs, the sections, the save states, the field states, the connection choices, the model
# statuses, the test results, the explicit action kinds and the reveal states) and a total map from
# the 21 live legacy links, and made a set of promises about the Config page: no Save button, no
# success toast and no dialog come back; a failed write keeps every draft and never reads Saved; a
# secret never reaches browser storage, never autosaves and is fetched only on a click; the tab
# strip is never swapped for a dropdown and no rail returns; every schema leaf has a field; no
# YAML-path badge is drawn; a new model is written only by its connection test, and its name may
# hold a dot; a connection-failure sentence is spelled once, in the shared classifier; and the one
# status sits outside the tab strip's scroll box, so it never scrolls away. Every suite that pins
# those is green today with nothing taken away, which is exactly what a green suite cannot tell
# you. So each leg below plants the regression that would re-open one set, break one promise or
# bring one deletion back, and requires its NAMED cell to red while the listed controls hold. The
# contract-side legs are 429-34's.
#
# THE LEGS
#   U01  a sixth tab joins ConfigTab, CONFIG_TABS and CONFIG_SECTIONS                -> C429-CONFIG-TABS-EXACT (D-02)
#   U02  a twenty-sixth section joins ConfigSectionId, its array and its aliases     -> C429-CONFIG-SECTIONS-EXACT (D-03)
#   U03  a seventh state joins SaveState and SAVE_STATES                             -> C429-SAVE-STATES-EXACT (D-20)
#   U04  a fifth state joins FieldState and FIELD_STATES                             -> C429-FIELD-STATES-EXACT (D-21)
#   U05  a sixth choice joins ConnectionChoice, its array and its provider           -> C429-CONNECTION-CHOICES-EXACT (D-14)
#   U06  a fifth status joins ModelStatus and MODEL_STATUSES                         -> C429-MODEL-STATUSES-EXACT (D-11)
#   U07  a fifth result joins TestResult and TEST_RESULTS                            -> C429-TEST-RESULTS-EXACT (D-17)
#   U08  a twelfth kind joins ExplicitActionKind and EXPLICIT_ACTION_KINDS           -> C429-EXPLICIT-ACTION-KINDS-EXACT (D-23/D-24)
#   U09  a fifth state joins RevealState and REVEAL_STATES                           -> C429-REVEAL-STATES-EXACT (D-09)
#   U10  use:mobile leaves LegacyConfigPair, LEGACY_CONFIG_PAIRS and the link map     -> LEGACY-LINKS-TOTAL (D-02, UI-SPEC S1)
#   U11  a button labelled Save Changes sits under the timeouts                      -> NO-SAVE-BUTTON-IN-CONFIG-SOURCE (D-19)
#   U12  the page announces every successful settle with a sonner toast              -> NO-TOAST-IN-CONFIG-SOURCE (D-20)
#   U13  the model's Delete asks first, in the ui alert-dialog primitive             -> NO-DIALOG-IN-CONFIG-SOURCE (D-24)
#   U14  write-failed drops every field the write carried                            -> FAILED-WRITE-KEEPS-DRAFT (D-21)
#   U15  saved outranks failed while the last success is fresh                       -> FAILED-WRITE-NEVER-SAVED (D-19/D-20)
#   U16  the draft store drops its secret-path filter on write and on read           -> SECRET-NEVER-IN-STORAGE (D-08/D-21)
#   U17  the typed key joins the add-row draft's allow-list                          -> ADD-DRAFT-NEVER-HOLDS-SECRETS (D-14)
#   U18  SecretValue hands every keystroke to the autosave edit                      -> SAVE-VALUE-EXPLICIT (D-23)
#   U19  config.tsx renders a native select that navigates the tabs                  -> NO-NAV-SELECT-SOURCE (D-04)
#   U20  the Runs section loses its use.workers field                                -> SCHEMA-COVERAGE-EVERY-LEAF (D-06)
#   U21  each field draws its schema pattern as a badge beside its label             -> NO-PATH-BADGES-SOURCE (D-03)
#   U22  the add row appends the draft to registry.llms once its name is valid       -> ADD-FLOW-NO-WRITE-BEFORE-CONNECT (D-15)
#   U23  the add row's name rule narrows back to hyphens only                        -> ADD-NAME-VALIDATION (D-13)
#   U24  the page renders the data-config-rail nav again                             -> NO-RAIL-SOURCE (D-03/D-04)
#   U25  a SecretValue fetches its unmasked value on mount                           -> REVEAL-ON-CLICK-ONLY (D-09)
#   U26  config-copy.ts spells the rate-limit sentence instead of re-exporting it    -> COPY-429 (D-18)
#   U27  the save status moves inside the tab strip's scroll box                     -> STATUS-IN-TAB-BAR (D-20)
#   U28  U14's edit, through the page's autosave hook                                -> FORCED-FAILURE-KEEPS-DRAFT (D-21)
#   U29  a device farm's Delete asks first, in the ui dialog primitive               -> NO-DIALOG-IN-CONFIG (D-24)
#   U30  U19's edit, on the rebuilt bundle a real Chromium loads                     -> TABS-FIVE-IN-ORDER-SHIPPED (D-04, shipped)
#   U31  U27's edit, on the rebuilt bundle                                           -> STATUS-NEVER-SCROLLS-AWAY (D-20, shipped)
#
# ALLOWED CO-REDS are listed on each leg with a one-line reason; nothing else may red.
#
# ONE INSTRUMENT PER LEG, SO 31 LEGS AND NOT 27. The plan names two cells for four regressions:
# a failed write's drafts (FAILED-WRITE-KEEPS-DRAFT in ui-lib, FORCED-FAILURE-KEEPS-DRAFT through the
# hook in ui-components), a dialog (NO-DIALOG-IN-CONFIG-SOURCE in ui-lib, NO-DIALOG-IN-CONFIG on the
# rendered page), the navigation dropdown (NO-NAV-SELECT-SOURCE, TABS-FIVE-IN-ORDER-SHIPPED) and the
# status in the scroll box (STATUS-IN-TAB-BAR, STATUS-NEVER-SCROLLS-AWAY). The engine gives a leg one
# instrument, so U01..U27 keep the plan's ids and first cells and U28..U31 plant the same regression
# for the second. U29 plants its dialog on the device farm's Delete, not the model's: the rendered
# cell deletes a device farm and never a model, so only that Delete can show it a dialog.
#
# THE STATIC CELLS READ SOURCE BY URL. config-static.test.ts walks components/config-manager/ and
# reads pages/config.tsx from a root URL beside its own file, so U11, U12, U13, U19, U21 and U24
# mutate files that no ui-lib suite imports; the engine counts that walk as reaching them (429-35).
#
# U01..U09 ADD ONE SPELLING PER SUBJECT. A new member also lacks its word in config-copy.ts, which is
# another subject; the type error that raises there is in a source file, not a cell, and the wall is
# proved by the TypeCheckError that points into config-tabs.test-d.ts.
#
# U30 AND U31 CROSS THE DIST BOUNDARY. Their cells read the shipped bundle a real Chromium loads from
# a production server, so each rebuilds `@vostride/agent-qa-dashboard-ui`, names the literal by which
# the dom instrument serves that dist, and plants a class the rebuilt bundle must carry
# (`navselect429`, `status429inside`). The shipped-bundle suite runs with one worker.
#
# Engine, arrival proof, counted selection and restoration: scripts/423-mutation-engine.cjs.
#
# USAGE
#   pnpm run validate:429-config-ui-mutation              # from the agent-qa root
#   bash agent-qa/scripts/429-config-ui-mutation.sh       # from the super-repository root
#
# KNOBS — AGENT_QA_429_CONFIG_UI_MUTATION_SELFTEST
#   neutered  apply NO mutation; the run must FATAL with "<leg>: suite stayed green"
#   fatal     mutate every subject, then throw; every subject must be restored
#   SIGINT | SIGTERM | SIGHUP   the same, then deliver that signal to itself
# AGENT_QA_429_CONFIG_UI_MUTATION_LEG=U01..U31 runs one leg (normal or neutered runs only).
# AGENT_QA_429_CONFIG_UI_MUTATION_LIST=1 prints the declared inventory and exits.
#
# Installed Node 24, workspace tools and the installed Playwright Chromium are required. No
# downloads or provider calls. Ends with a forced workspace build whenever a byte was mutated.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
exec node --input-type=commonjs - <<'NODE'
const path = require('node:path')
const { runGate, cell } = require(path.join(process.cwd(), 'scripts/423-mutation-engine.cjs'))

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

const TABS_T = 'src/lib/__tests__/config-tabs.test.ts'
const TABS_D = 'src/lib/__tests__/config-tabs.test-d.ts'
const COPY_T = 'src/lib/__tests__/config-copy.test.ts'
const AUTOSAVE_T = 'src/lib/__tests__/config-autosave.test.ts'
const AUTOSAVE_D = 'src/lib/__tests__/config-autosave.test-d.ts'
const DRAFT_T = 'src/lib/__tests__/add-model-draft.test.ts'
const STATIC_T = 'src/lib/__tests__/config-static.test.ts'
const HOOK_T = 'src/hooks/__tests__/use-config-autosave.test.tsx'
const STATUS_T = 'src/components/config-manager/__tests__/save-status.test.tsx'
const SECRET_T = 'src/components/config-manager/__tests__/secret-value.test.tsx'
const ADD_ROW_T = 'src/components/config-manager/__tests__/add-model-row.test.tsx'
const PAGE_T = 'src/pages/__tests__/config-page.test.tsx'
const COVERAGE_T = 'src/pages/__tests__/config-page.schema-coverage.test.tsx'
const A11Y_T = 'src/pages/__tests__/config-page.a11y.test.tsx'
const DOM_T = 'src/__tests__/conformance/429-config-dom.test.ts'

const instruments = {
  'ui-lib': {
    pkg: 'packages/dashboard-ui',
    files: [TABS_T, TABS_D, COPY_T, AUTOSAVE_T, AUTOSAVE_D, DRAFT_T, STATIC_T],
    typecheck: true,
    count: 62,
  },
  'ui-components': {
    pkg: 'packages/dashboard-ui',
    files: [HOOK_T, STATUS_T, SECRET_T, ADD_ROW_T, PAGE_T, COVERAGE_T, A11Y_T],
    typecheck: false,
    count: 183,
  },
  dom: { pkg: 'packages/cli', files: [DOM_T], typecheck: false, count: 11, env: { VITEST_MAX_WORKERS: '1' } },
}

const UI_DIST = "join(PACKAGES_ROOT, 'dashboard-ui', 'dist')"
const ui = marker => ({ pkg: '@vostride/agent-qa-dashboard-ui', dir: 'packages/dashboard-ui', marker, reference: UI_DIST })

const tabs = (name, count) => cell('ui-lib', TABS_T, name, count)
const tabsD = (name, count) => cell('ui-lib', TABS_D, name, count)
const copy = (name, count) => cell('ui-lib', COPY_T, name, count)
const autosave = (name, count) => cell('ui-lib', AUTOSAVE_T, name, count)
const autosaveD = (name, count) => cell('ui-lib', AUTOSAVE_D, name, count)
const draft = (name, count) => cell('ui-lib', DRAFT_T, name, count)
const statics = (name, count) => cell('ui-lib', STATIC_T, name, count)
const hook = (name, count) => cell('ui-components', HOOK_T, name, count)
const status = (name, count) => cell('ui-components', STATUS_T, name, count)
const secret = (name, count) => cell('ui-components', SECRET_T, name, count)
const addRow = (name, count) => cell('ui-components', ADD_ROW_T, name, count)
const page = (name, count) => cell('ui-components', PAGE_T, name, count)
const coverage = (name, count) => cell('ui-components', COVERAGE_T, name, count)
const a11y = (name, count) => cell('ui-components', A11Y_T, name, count)
const dom = (name, count) => cell('dom', DOM_T, name, count)

// One regression, measured in two instruments, is spelled once and planted by two legs.
const FAILED_WRITE_CLEARS = {
  from: "      const named = new Map(event.issues.map((issue) => [issue.fieldKey, issue.message]))\n      const fields = settleCarried(state, carried, (key, current) => {\n        const message = named.get(key)\n        return message === undefined\n          ? entry(current.raw, 'draft')\n          : entry(current.raw, 'failed', message)\n      })\n",
  to: '      const fields = { ...state.fields }\n      for (const key of carried) delete fields[key]\n',
}
const MODEL_DELETE_BUTTON = '            <Button\n              type="button"\n              variant="ghost"\n              size="sm"\n              className="text-muted-foreground hover:text-destructive"\n              onClick={() => void deleteModel()}\n            >\n              <Trash2 className="size-3.5" aria-hidden="true" />\n              {DELETE_MODEL_LABEL}\n            </Button>\n'
const NAV_SELECT = {
  from: '            <ConfigTabBar\n',
  to: '            <select\n              aria-label="Config section"\n              className="navselect429 mb-2 w-full rounded-md border bg-background px-2 py-1 text-sm sm:hidden"\n              value={tab}\n              onChange={(event) => handleTabChange(event.target.value)}\n            >\n              {CONFIG_TABS.map((id) => (\n                <option key={id} value={id}>\n                  {id}\n                </option>\n              ))}\n            </select>\n            <ConfigTabBar\n',
}
const STATUS_IN_SCROLL = {
  from: '        </TabsList>\n      </div>\n      <div data-config-status-slot className="shrink-0 pb-2">\n        {statusSlot}\n      </div>\n',
  to: '        </TabsList>\n        <div data-config-status-slot className="status429inside shrink-0 pb-2">\n          {statusSlot}\n        </div>\n      </div>\n',
}

const legs = [
  // ---- the UI closed sets (D-02/D-03, v54 bar) ------------------------------------------------
  {
    subject: TABS_SRC, instrument: 'ui-lib', claim: 'C429-CONFIG-TABS-EXACT',
    operation: 'add a sixth tab to ConfigTab, CONFIG_TABS and CONFIG_SECTIONS',
    edits: [
      { from: "export type ConfigTab = 'models' | 'targets' | 'execution' | 'project' | 'advanced'\n", to: "export type ConfigTab = 'models' | 'targets' | 'execution' | 'project' | 'advanced' | 'labs'\n" },
      { from: "  'advanced',\n] as const satisfies readonly ConfigTab[]", to: "  'advanced',\n  'labs',\n] as const satisfies readonly ConfigTab[]" },
      { from: "  advanced: ['mcp', 'run-service-tokens', 'eval', 'config-file'],\n", to: "  advanced: ['mcp', 'run-service-tokens', 'eval', 'config-file'],\n  labs: [],\n" },
    ],
    reds: [tabsD('C429-CONFIG-TABS-EXACT')],
    // The runtime twin pins the array by value, the sections cell pins CONFIG_SECTIONS by value (it now
    // carries the new tab's empty list), and the copy cell maps every tab to its label, which the new
    // one lacks.
    allowed: [tabs('C429-CONFIG-TABS-EXACT'), tabs('C429-CONFIG-SECTIONS-EXACT'), copy('COPY-429: the tab labels, status words and model status words are the locked words')],
    greens: [tabsD('C429-SAVE-STATES-EXACT'), tabsD('LEGACY-LINKS-TOTAL'), autosave('STATUS-PRECEDENCE')],
  },
  {
    subject: TABS_SRC, instrument: 'ui-lib', claim: 'C429-CONFIG-SECTIONS-EXACT',
    operation: 'add a twenty-sixth section to ConfigSectionId, CONFIG_SECTION_IDS and its aliases',
    edits: [
      { from: "  | 'config-file'\n// prettier-ignore\nexport const CONFIG_SECTION_IDS", to: "  | 'config-file'\n  | 'secrets'\n// prettier-ignore\nexport const CONFIG_SECTION_IDS" },
      { from: "  'config-file',\n] as const satisfies readonly ConfigSectionId[]", to: "  'config-file',\n  'secrets',\n] as const satisfies readonly ConfigSectionId[]" },
      { from: "  'config-file': ['yaml', 'config file path', 'raw config'],\n", to: "  'config-file': ['yaml', 'config file path', 'raw config'],\n  secrets: ['secret', 'vault'],\n" },
    ],
    reds: [tabsD('C429-CONFIG-SECTIONS-EXACT')],
    // The runtime twin pins the count and order; an empty search returns every id in tab order, and
    // the new id is in no tab; the copy cell requires a label key for every id.
    allowed: [tabs('C429-CONFIG-SECTIONS-EXACT'), tabs('SEARCH-ORDER-STABLE'), copy('COPY-429: the tab labels, status words and model status words are the locked words')],
    greens: [tabsD('C429-CONFIG-TABS-EXACT'), tabsD('C429-FIELD-STATES-EXACT'), tabs('LEGACY-LINKS-TOTAL')],
  },
  {
    subject: TABS_SRC, instrument: 'ui-lib', claim: 'C429-SAVE-STATES-EXACT',
    operation: 'add a seventh save state to SaveState and SAVE_STATES',
    edits: [
      { from: "export type SaveState = 'idle' | 'saving' | 'saved' | 'draft' | 'failed' | 'undo'\n", to: "export type SaveState = 'idle' | 'saving' | 'saved' | 'draft' | 'failed' | 'undo' | 'paused'\n" },
      { from: "  'undo',\n] as const satisfies readonly SaveState[]", to: "  'undo',\n  'paused',\n] as const satisfies readonly SaveState[]" },
    ],
    reds: [tabsD('C429-SAVE-STATES-EXACT')],
    // The runtime twin pins the array by value.
    allowed: [tabs('C429-SAVE-STATES-EXACT')],
    greens: [tabsD('C429-FIELD-STATES-EXACT'), autosave('STATUS-PRECEDENCE'), copy('COPY-429: the timing constants')],
  },
  {
    subject: TABS_SRC, instrument: 'ui-lib', claim: 'C429-FIELD-STATES-EXACT',
    operation: 'add a fifth field state to FieldState and FIELD_STATES',
    edits: [
      { from: "export type FieldState = 'clean' | 'draft' | 'saving' | 'failed'\n", to: "export type FieldState = 'clean' | 'draft' | 'saving' | 'failed' | 'stale'\n" },
      { from: "  'failed',\n] as const satisfies readonly FieldState[]", to: "  'failed',\n  'stale',\n] as const satisfies readonly FieldState[]" },
    ],
    reds: [tabsD('C429-FIELD-STATES-EXACT')],
    // The runtime twin pins the array by value.
    allowed: [tabs('C429-FIELD-STATES-EXACT')],
    greens: [tabsD('C429-SAVE-STATES-EXACT'), autosave('FAILED-WRITE-KEEPS-DRAFT'), tabsD('C429-REVEAL-STATES-EXACT')],
  },
  {
    subject: TABS_SRC, instrument: 'ui-lib', claim: 'C429-CONNECTION-CHOICES-EXACT',
    operation: 'add a sixth connection choice to ConnectionChoice, CONNECTION_CHOICES and its provider',
    edits: [
      { from: "  | 'gemini-key'\n// prettier-ignore\nexport const CONNECTION_CHOICES", to: "  | 'gemini-key'\n  | 'mistral-key'\n// prettier-ignore\nexport const CONNECTION_CHOICES" },
      { from: "  'gemini-key',\n] as const satisfies readonly ConnectionChoice[]", to: "  'gemini-key',\n  'mistral-key',\n] as const satisfies readonly ConnectionChoice[]" },
      { from: "  'gemini-key': 'gemini',\n} as const satisfies Record<ConnectionChoice, string>", to: "  'gemini-key': 'gemini',\n  'mistral-key': 'mistral',\n} as const satisfies Record<ConnectionChoice, string>" },
    ],
    reds: [tabsD('C429-CONNECTION-CHOICES-EXACT')],
    // The runtime twin pins the array and the provider map by value.
    allowed: [tabs('C429-CONNECTION-CHOICES-EXACT')],
    greens: [tabsD('C429-MODEL-STATUSES-EXACT'), draft('SUGGEST-MODEL-NAME'), tabsD('C429-CONFIG-TABS-EXACT')],
  },
  {
    subject: TABS_SRC, instrument: 'ui-lib', claim: 'C429-MODEL-STATUSES-EXACT',
    operation: 'add a fifth model status to ModelStatus and MODEL_STATUSES',
    edits: [
      { from: "export type ModelStatus = 'signed-in' | 'key-saved' | 'not-connected' | 'sign-in-expired'\n", to: "export type ModelStatus = 'signed-in' | 'key-saved' | 'not-connected' | 'sign-in-expired' | 'rate-limited'\n" },
      { from: "  'sign-in-expired',\n] as const satisfies readonly ModelStatus[]", to: "  'sign-in-expired',\n  'rate-limited',\n] as const satisfies readonly ModelStatus[]" },
    ],
    reds: [tabsD('C429-MODEL-STATUSES-EXACT')],
    // The runtime twin pins the array by value; the copy walk calls connectionSentence over every
    // status, and the new one has no word, so both cells that read the walk see a missing string.
    allowed: [tabs('C429-MODEL-STATUSES-EXACT'), copy('COPY-429: every exported string is non-empty'), copy('COPY-429: no string carries storage vocabulary')],
    greens: [tabsD('C429-TEST-RESULTS-EXACT'), tabsD('C429-CONNECTION-CHOICES-EXACT'), autosave('STATUS-PRECEDENCE')],
  },
  {
    subject: TABS_SRC, instrument: 'ui-lib', claim: 'C429-TEST-RESULTS-EXACT',
    operation: 'add a fifth test result to TestResult and TEST_RESULTS',
    edits: [
      { from: "export type TestResult = 'testing' | 'connected' | 'connected-without-key' | 'failed'\n", to: "export type TestResult = 'testing' | 'connected' | 'connected-without-key' | 'failed' | 'skipped'\n" },
      { from: "  'failed',\n] as const satisfies readonly TestResult[]", to: "  'failed',\n  'skipped',\n] as const satisfies readonly TestResult[]" },
    ],
    reds: [tabsD('C429-TEST-RESULTS-EXACT')],
    // The runtime twin pins the array by value.
    allowed: [tabs('C429-TEST-RESULTS-EXACT')],
    greens: [tabsD('C429-MODEL-STATUSES-EXACT'), copy('COPY-429: a passed test says Connected with no milliseconds'), tabsD('C429-REVEAL-STATES-EXACT')],
  },
  {
    subject: TABS_SRC, instrument: 'ui-lib', claim: 'C429-EXPLICIT-ACTION-KINDS-EXACT',
    operation: 'add a twelfth explicit action kind to ExplicitActionKind and EXPLICIT_ACTION_KINDS',
    edits: [
      { from: "  | 'change-artifacts-dir'\n// prettier-ignore\nexport const EXPLICIT_ACTION_KINDS", to: "  | 'change-artifacts-dir'\n  | 'delete-plugin'\n// prettier-ignore\nexport const EXPLICIT_ACTION_KINDS" },
      { from: "  'change-artifacts-dir',\n] as const satisfies readonly ExplicitActionKind[]", to: "  'change-artifacts-dir',\n  'delete-plugin',\n] as const satisfies readonly ExplicitActionKind[]" },
    ],
    reds: [tabsD('C429-EXPLICIT-ACTION-KINDS-EXACT')],
    // The runtime twin pins the array by value; the copy walk calls undoLine over every kind, and the
    // new one has no line, so both cells that read the walk see a missing string.
    allowed: [tabs('C429-EXPLICIT-ACTION-KINDS-EXACT'), copy('COPY-429: every exported string is non-empty'), copy('COPY-429: no string carries storage vocabulary')],
    greens: [tabsD('C429-REVEAL-STATES-EXACT'), autosave('UNDO-WINDOW'), copy('COPY-429: the Undo lines name what happened, with the judge variant')],
  },
  {
    subject: TABS_SRC, instrument: 'ui-lib', claim: 'C429-REVEAL-STATES-EXACT',
    operation: 'add a fifth reveal state to RevealState and REVEAL_STATES',
    edits: [
      { from: "export type RevealState = 'masked' | 'loading' | 'revealed' | 'failed'\n", to: "export type RevealState = 'masked' | 'loading' | 'revealed' | 'failed' | 'expired'\n" },
      { from: "  'failed',\n] as const satisfies readonly RevealState[]", to: "  'failed',\n  'expired',\n] as const satisfies readonly RevealState[]" },
    ],
    reds: [tabsD('C429-REVEAL-STATES-EXACT')],
    // The runtime twin pins the array by value.
    allowed: [tabs('C429-REVEAL-STATES-EXACT')],
    greens: [tabsD('C429-EXPLICIT-ACTION-KINDS-EXACT'), tabsD('C429-FIELD-STATES-EXACT'), tabs('C429-CONFIG-TABS-EXACT')],
  },
  {
    subject: TABS_SRC, instrument: 'ui-lib', claim: 'LEGACY-LINKS-TOTAL',
    operation: 'drop use:mobile from LegacyConfigPair, LEGACY_CONFIG_PAIRS and LEGACY_CONFIG_LINKS',
    edits: [
      { from: "  | 'use:mobile'\n", to: '' },
      { from: "  'use:mobile',\n", to: '' },
      { from: "  'use:mobile': { tab: 'targets', section: 'mobile-app-state' },\n", to: '' },
    ],
    reds: [tabsD('LEGACY-LINKS-TOTAL'), tabs('LEGACY-LINKS-TOTAL')],
    allowed: [],
    greens: [tabs('LEGACY-LINK-EMPTY'), tabs('LEGACY-LINK-UNKNOWN'), tabsD('C429-CONFIG-TABS-EXACT')],
  },
  // ---- the deletions stay deleted (D-03, D-24, UI-SPEC "Removed copy") -------------------------
  {
    subject: TIMEOUT_SRC, instrument: 'ui-lib', claim: 'NO-SAVE-BUTTON-IN-CONFIG-SOURCE',
    operation: 'add a button labelled Save Changes under the timeouts',
    edits: [
      { from: 'import { ConfigField, type ConfigFieldTarget } from "@/components/config-manager/config-field"\n', to: 'import { ConfigField, type ConfigFieldTarget } from "@/components/config-manager/config-field"\nimport { Button } from "@/components/ui/button"\n' },
      { from: '      ))}\n    </>\n', to: '      ))}\n      <Button type="button" size="sm">\n        Save Changes\n      </Button>\n    </>\n' },
    ],
    reds: [statics('NO-SAVE-BUTTON-IN-CONFIG-SOURCE')],
    // Save Changes is also on the removed-copy list.
    allowed: [statics('REMOVED-COPY-ABSENT')],
    greens: [statics('NO-TOAST-IN-CONFIG-SOURCE'), statics('NO-DIALOG-IN-CONFIG-SOURCE'), statics('reads every Config source file (witness)')],
  },
  {
    subject: PAGE_SRC, instrument: 'ui-lib', claim: 'NO-TOAST-IN-CONFIG-SOURCE',
    operation: 'announce every successful settle with a sonner toast',
    edits: [
      { from: 'import { useNavigate, useParams, useSearchParams } from "react-router"\n', to: 'import { useNavigate, useParams, useSearchParams } from "react-router"\nimport { toast } from "sonner"\n' },
      { from: '  const saveState = autosave.status.state\n', to: '  const saveState = autosave.status.state\n\n  useEffect(() => {\n    if (saveState === "saved") toast.success("Saved")\n  }, [saveState])\n' },
    ],
    reds: [statics('NO-TOAST-IN-CONFIG-SOURCE')],
    allowed: [],
    greens: [statics('NO-SAVE-BUTTON-IN-CONFIG-SOURCE'), statics('NO-NAV-SELECT-SOURCE'), statics('NO-RAIL-SOURCE')],
  },
  {
    subject: MODEL_ROW_SRC, instrument: 'ui-lib', claim: 'NO-DIALOG-IN-CONFIG-SOURCE',
    operation: "wrap the model's Delete in the ui alert-dialog primitive, so deleting asks first",
    edits: [
      { from: 'import { Badge } from "@/components/ui/badge"\n', to: 'import {\n  AlertDialog,\n  AlertDialogAction,\n  AlertDialogCancel,\n  AlertDialogContent,\n  AlertDialogTitle,\n  AlertDialogTrigger,\n} from "@/components/ui/alert-dialog"\nimport { Badge } from "@/components/ui/badge"\n' },
      {
        from: MODEL_DELETE_BUTTON,
        to: '            <AlertDialog>\n              <AlertDialogTrigger asChild>\n                <Button type="button" variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive">\n                  <Trash2 className="size-3.5" aria-hidden="true" />\n                  {DELETE_MODEL_LABEL}\n                </Button>\n              </AlertDialogTrigger>\n              <AlertDialogContent>\n                <AlertDialogTitle>{`Delete ${model.name}?`}</AlertDialogTitle>\n                <AlertDialogCancel>Keep the model</AlertDialogCancel>\n                <AlertDialogAction onClick={() => void deleteModel()}>{DELETE_MODEL_LABEL}</AlertDialogAction>\n              </AlertDialogContent>\n            </AlertDialog>\n',
      },
    ],
    reds: [statics('NO-DIALOG-IN-CONFIG-SOURCE')],
    allowed: [],
    greens: [statics('NO-TOAST-IN-CONFIG-SOURCE'), statics('NO-SAVE-BUTTON-IN-CONFIG-SOURCE'), statics('NO-PATH-BADGES-SOURCE')],
  },
  // ---- autosave truthfulness (D-19..D-21) -------------------------------------------------------
  {
    subject: AUTOSAVE_SRC, instrument: 'ui-lib', claim: 'FAILED-WRITE-KEEPS-DRAFT',
    operation: 'let write-failed drop every field the write carried',
    edits: [FAILED_WRITE_CLEARS],
    reds: [autosave('FAILED-WRITE-KEEPS-DRAFT')],
    allowed: [],
    greens: [autosave('STATUS-PRECEDENCE'), autosave('SAVED-FADES'), autosaveD('C429-AUTOSAVE-EVENTS-EXACT')],
  },
  {
    subject: AUTOSAVE_SRC, instrument: 'ui-lib', claim: 'FAILED-WRITE-NEVER-SAVED',
    operation: 'rank saved above failed while the last success is fresh, and let a failed write keep that time',
    edits: [
      { from: "      const rest = without(state, 'savedAt')\n", to: '      const rest = state\n' },
      { from: '  if (state.failure !== undefined) {\n    const message = state.failure.message\n', to: "  if (state.failure !== undefined && state.savedAt !== undefined && now - state.savedAt < SAVED_VISIBLE_MS) return status('saved')\n  if (state.failure !== undefined) {\n    const message = state.failure.message\n" },
    ],
    reds: [autosave('FAILED-WRITE-NEVER-SAVED')],
    // It pins failed first over every combination of flags, saved included.
    allowed: [autosave('STATUS-PRECEDENCE')],
    greens: [autosave('FAILED-WRITE-KEEPS-DRAFT'), autosave('UNDO-WINDOW'), autosaveD('C429-SAVE-STATUS-STATE-EXACT')],
  },
  // ---- secrets (D-08, D-09, D-14) -----------------------------------------------------------------
  {
    subject: HOOK_SRC, instrument: 'ui-components', claim: 'SECRET-NEVER-IN-STORAGE',
    operation: "drop the secret-path filter from the draft store's write and read",
    edits: [
      { from: '  if (isSecretPath(segments)) return undefined\n', to: '' },
      { from: '    if (!location || !field || isSecretPath(location.segments) || !isStorableRaw(field.raw)) continue\n', to: '    if (!location || !field || !isStorableRaw(field.raw)) continue\n' },
    ],
    reds: [hook('SECRET-NEVER-IN-STORAGE', 2)],
    allowed: [],
    greens: [hook('INVALID-STAYS-DRAFT-NO-WRITE', 2), hook('ONE-WRITE-PER-SETTLE', 2), secret('REVEALED-NEVER-ELSEWHERE')],
  },
  {
    subject: DRAFT_SRC, instrument: 'ui-lib', claim: 'ADD-DRAFT-NEVER-HOLDS-SECRETS',
    operation: "add the typed key to the add-row draft's allow-list",
    edits: [
      { from: '  createdCredential?: boolean\n}\n', to: '  createdCredential?: boolean\n  key?: string\n}\n' },
      { from: "  createdCredential: (value) => typeof value === 'boolean',\n", to: "  createdCredential: (value) => typeof value === 'boolean',\n  key: (value) => typeof value === 'string',\n" },
    ],
    reds: [draft('ADD-DRAFT-NEVER-HOLDS-SECRETS', 2)],
    allowed: [],
    greens: [draft('SUGGEST-MODEL-NAME'), draft('keys the draft by config file path, clears it, and survives storage that throws'), tabsD('C429-CONNECTION-CHOICES-EXACT')],
  },
  {
    subject: SECRET_SRC, instrument: 'ui-components', claim: 'SAVE-VALUE-EXPLICIT',
    operation: 'hand every keystroke in Replace value to the autosave edit',
    edits: [{
      from: '              onChange={(event) => setTyped(event.target.value)}\n',
      to: '              onChange={(event) => {\n                setTyped(event.target.value)\n                autosave.edit({ segments: field.segments, tab: "targets" }, event.target.value, { valid: true, value: event.target.value })\n              }}\n',
    }],
    reds: [secret('SAVE-VALUE-EXPLICIT')],
    // It types before its failed Save value and counts the writes; the typing now writes by itself.
    allowed: [secret('SAVE-VALUE-FAILURE-KEEPS-TYPED')],
    greens: [secret('REVEAL-ON-CLICK-ONLY'), secret('REPLACE-VALUE-EMPTY-INPUT'), hook('SECRET-NEVER-IN-STORAGE', 2)],
  },
  // ---- navigation and chrome (D-01, D-03, D-04) ---------------------------------------------------
  {
    subject: PAGE_SRC, instrument: 'ui-lib', claim: 'NO-NAV-SELECT-SOURCE',
    operation: 'render a native select that navigates the tabs, shown at narrow widths',
    edits: [NAV_SELECT],
    reds: [statics('NO-NAV-SELECT-SOURCE')],
    allowed: [],
    greens: [statics('NO-RAIL-SOURCE'), statics('NO-TOAST-IN-CONFIG-SOURCE'), statics('NO-PATH-BADGES-SOURCE')],
  },
  // ---- coverage (D-05) ----------------------------------------------------------------------------
  {
    subject: RUNS_SRC, instrument: 'ui-components', claim: 'SCHEMA-COVERAGE-EVERY-LEAF',
    operation: 'remove the use.workers field from the Runs section',
    edits: [{
      from: '      <ConfigField\n        field={runsField("workers")}\n        label={RUNS_FIELD_LABELS.workers}\n        kind="number"\n        number={WORKER_RULES}\n        help={RUNS_FIELD_HELP.workers}\n        placeholder={String(DEFAULT_PARALLEL_WORKERS)}\n      />\n',
      to: '',
    }],
    reds: [coverage('SCHEMA-COVERAGE-EVERY-LEAF')],
    // It pins a field for every Execution leaf that had none at HEAD, use.workers among them.
    allowed: [page('EXECUTION-LEAVES-HAVE-FIELDS')],
    greens: [coverage('SCHEMA-COVERAGE-EXACTLY-ONCE'), page('TABS-FIVE-IN-ORDER'), a11y('NO-DIALOG-IN-CONFIG')],
  },
  {
    subject: FIELD_SRC, instrument: 'ui-lib', claim: 'NO-PATH-BADGES-SOURCE',
    operation: "render each field's schema pattern as a badge beside its label",
    edits: [
      { from: 'import { Input } from "@/components/ui/input"\n', to: 'import { Badge } from "@/components/ui/badge"\nimport { Input } from "@/components/ui/input"\n' },
      {
        from: '  return (\n    <div data-config-field data-field-path={field.pattern} data-field-state={fieldState} className="space-y-2">\n      <Label htmlFor={controlId}>{label}</Label>\n',
        to: '  const fieldPaths = [field.pattern]\n  return (\n    <div data-config-field data-field-path={field.pattern} data-field-state={fieldState} className="space-y-2">\n      <div className="flex items-center gap-2">\n        <Label htmlFor={controlId}>{label}</Label>\n        {fieldPaths.map((path) => (\n          <Badge key={path} variant="outline" className="font-mono text-[10px]">\n            {path}\n          </Badge>\n        ))}\n      </div>\n',
      },
    ],
    reds: [statics('NO-PATH-BADGES-SOURCE')],
    allowed: [],
    greens: [statics('NO-SAVE-BUTTON-IN-CONFIG-SOURCE'), statics('NO-DIALOG-IN-CONFIG-SOURCE'), statics('NO-RAIL-SOURCE')],
  },
  // ---- the connection-first add flow (D-13..D-17) -------------------------------------------------
  {
    subject: ADD_ROW_SRC, instrument: 'ui-components', claim: 'ADD-FLOW-NO-WRITE-BEFORE-CONNECT',
    operation: 'append the draft to registry.llms as soon as its name is valid',
    edits: [
      { from: 'import {\n  connectLLM,\n', to: 'import {\n  applyConfigChanges,\n  connectLLM,\n' },
      {
        from: '  function changeName(raw: string) {\n    setName(raw)\n    setNameEdited(true)\n    recheck("name", raw)\n',
        to: '  function changeName(raw: string) {\n    setName(raw)\n    setNameEdited(true)\n    recheck("name", raw)\n    if (provider !== undefined && validateModelName(raw, existingNames) === undefined) {\n      void applyConfigChanges([{ op: "append", path: ["registry", "llms"], value: { name: raw, provider, model: model.trim() } }])\n    }\n',
      },
    ],
    reds: [addRow('ADD-FLOW-NO-WRITE-BEFORE-CONNECT')],
    // Each types a valid name and then asserts no config write happened before its sign-in or test.
    allowed: [addRow('SIGN-IN-DRAFT-BROWSER-POLL'), addRow('LEGACY-LLM-SAVE-BEFORE-SIGN-IN-GONE')],
    greens: [addRow('ADD-STEPS-IN-ORDER'), addRow('CONNECT-FAIL-KEEPS-DRAFT'), addRow('ADD-NAME-VALIDATION')],
  },
  {
    subject: ADD_ROW_SRC, instrument: 'ui-components', claim: 'ADD-NAME-VALIDATION',
    operation: 'narrow the name rule back to hyphens only, refusing a dot',
    edits: [{ from: 'const NAME_RULE = /^[a-z0-9][a-z0-9.-]*$/\n', to: 'const NAME_RULE = /^[a-z0-9][a-z0-9-]*$/\n' }],
    reds: [addRow('ADD-NAME-VALIDATION')],
    // Each connects, signs in, renames or discards a draft named after a dotted model id (gpt-5.6,
    // claude-sonnet-4.5, the suggested name), which the narrowed rule now refuses before anything
    // starts; LEGACY-LLM-DOTTED-NAME-ACCEPTED pins the same D-13 rule on the add row (measured 429-35).
    allowed: [
      addRow('CONNECT-PASS-BECOMES-SAVED-ROW'), addRow('CONNECT-FAIL-KEEPS-DRAFT'),
      addRow('SAVE-WITHOUT-TESTING-ONLY-AFTER-FAILURE'), addRow('a refused name from the server marks the name field and keeps the draft'),
      addRow('SIGN-IN-DRAFT-BROWSER-POLL'), addRow('SIGN-IN-DRAFT-MANUAL-CODE'), addRow('SIGN-IN-FAILED-LINE'),
      addRow('SIGN-IN-WAITING-CANCEL-AND-TIMEOUT'), addRow('NAME-EDIT-AFTER-SIGN-IN-MOVES'),
      addRow('DISCARD-REMOVES-ONLY-CREATED-CREDENTIAL'), addRow('LEGACY-LLM-REQUIRED-MARKERS-GONE'),
      addRow('LEGACY-LLM-DOTTED-NAME-ACCEPTED'),
    ],
    greens: [addRow('ADD-STEPS-IN-ORDER'), addRow('ADD-FLOW-NO-WRITE-BEFORE-CONNECT'), addRow('DISCARD-DRAFT')],
  },
  {
    subject: PAGE_SRC, instrument: 'ui-lib', claim: 'NO-RAIL-SOURCE',
    operation: 'render the data-config-rail nav beside the tabs again',
    edits: [{
      from: '      <h1 className="text-2xl font-semibold tracking-tight">{CONFIG_PAGE_TITLE}</h1>\n',
      to: '      <h1 className="text-2xl font-semibold tracking-tight">{CONFIG_PAGE_TITLE}</h1>\n      <nav data-config-rail className="hidden lg:block">\n        {CONFIG_TABS.map((id) => (\n          <a key={id} href={configTabPath(id)}>\n            {id}\n          </a>\n        ))}\n      </nav>\n',
    }],
    reds: [statics('NO-RAIL-SOURCE')],
    allowed: [],
    greens: [statics('NO-NAV-SELECT-SOURCE'), statics('NO-TOAST-IN-CONFIG-SOURCE'), statics('NO-SAVE-BUTTON-IN-CONFIG-SOURCE')],
  },
  {
    subject: SECRET_SRC, instrument: 'ui-components', claim: 'REVEAL-ON-CLICK-ONLY',
    operation: 'fetch the unmasked value as soon as a SecretValue mounts',
    edits: [{ from: '    mounted.current = true\n    const hide = () => mask()\n', to: '    mounted.current = true\n    void revealConfigValue([...field.segments])\n    const hide = () => mask()\n' }],
    reds: [secret('REVEAL-ON-CLICK-ONLY')],
    // The neighbour it keeps unfetched is now fetched on mount too.
    allowed: [secret('REVEAL-ONE-VALUE')],
    greens: [secret('SAVE-VALUE-EXPLICIT'), secret('REPLACE-VALUE-EMPTY-INPUT'), hook('SECRET-NEVER-IN-STORAGE', 2)],
  },
  {
    subject: COPY_SRC, instrument: 'ui-lib', claim: 'COPY-429',
    operation: 'spell the rate-limit sentence in config-copy.ts instead of re-exporting the classifier',
    edits: [{
      from: "export { providerErrorSentence } from '@vostride/agent-qa-schema'\n",
      to: "import { providerErrorSentence as classifiedSentence, type ProviderErrorClass } from '@vostride/agent-qa-schema'\n\nexport function providerErrorSentence(errorClass: ProviderErrorClass, message: string): string {\n  return errorClass === 'rate_limit' ? 'Rate limited. Try again later.' : classifiedSentence(errorClass, message)\n}\n",
    }],
    reds: [copy('COPY-429: providerErrorSentence is the schema classifier function itself, never re-spelled')],
    allowed: [],
    greens: [copy('COPY-429: every exported string is non-empty'), copy('COPY-429: no string carries storage vocabulary'), copy('CONSEQUENCE-LINES-PINNED')],
  },
  {
    subject: TAB_BAR_SRC, instrument: 'ui-components', claim: 'STATUS-IN-TAB-BAR',
    operation: "move the save status inside the tab strip's scroll box",
    edits: [STATUS_IN_SCROLL],
    reds: [page('STATUS-IN-TAB-BAR')],
    // It also asserts the status slot is the bar's own child and outside the scroll box.
    allowed: [page('TABS-FIVE-IN-ORDER')],
    greens: [page('TAB-DRAFT-DOT'), page('NO-NAV-SELECT'), status('SAVE-STATUS-TONES')],
  },
  // ---- one regression, a second instrument (the engine gives a leg one instrument) ---------------
  {
    subject: AUTOSAVE_SRC, instrument: 'ui-components', claim: 'FORCED-FAILURE-KEEPS-DRAFT',
    operation: "let write-failed drop every field the write carried, measured through the page's hook",
    edits: [FAILED_WRITE_CLEARS],
    reds: [hook('FORCED-FAILURE-KEEPS-DRAFT', 2)],
    // Its first edit rides a failed write and must stay a draft; a refused write must mark its field
    // and announce it, and the field is now gone.
    allowed: [hook('SECRET-NEVER-IN-STORAGE: drafts on secret-class paths never reach browser storage'), page('ERROR-ANNOUNCED-FOCUS-STAYS')],
    greens: [hook('ONE-WRITE-PER-SETTLE', 2), hook('UNDO-CALLS-SERVER', 2), status('SAVE-STATUS-TONES')],
  },
  {
    subject: FARMS_SRC, instrument: 'ui-components', claim: 'NO-DIALOG-IN-CONFIG',
    operation: "ask in a ui dialog before a device farm's Delete acts",
    edits: [
      { from: 'import { Button } from "@/components/ui/button"\n', to: 'import { Button } from "@/components/ui/button"\nimport { Dialog, DialogContent, DialogFooter, DialogTitle } from "@/components/ui/dialog"\n' },
      { from: '  const [adding, setAdding] = useState(false)\n', to: '  const [adding, setAdding] = useState(false)\n  const [confirming, setConfirming] = useState<string | undefined>(undefined)\n' },
      { from: '                  onClick={() => void deleteFarm(name)}\n', to: '                  onClick={() => setConfirming(name)}\n' },
      {
        from: '      {adding ? <AddFarm takenNames={names} onClose={closeAddFarm} /> : null}\n',
        to: '      {adding ? <AddFarm takenNames={names} onClose={closeAddFarm} /> : null}\n      <Dialog open={confirming !== undefined} onOpenChange={(open) => { if (!open) setConfirming(undefined) }}>\n        <DialogContent>\n          <DialogTitle>{`Delete ${confirming ?? ""}?`}</DialogTitle>\n          <DialogFooter>\n            <Button\n              type="button"\n              variant="destructive"\n              onClick={() => {\n                const name = confirming\n                setConfirming(undefined)\n                if (name !== undefined) void deleteFarm(name)\n              }}\n            >\n              {deleteActionName("delete-device-farm", confirming ?? "")}\n            </Button>\n          </DialogFooter>\n        </DialogContent>\n      </Dialog>\n',
      },
    ],
    reds: [a11y('NO-DIALOG-IN-CONFIG')],
    // Both run the same device-farm Delete and require its Undo line and write, which the dialog
    // now withholds until someone answers it.
    allowed: [a11y('EVERY-CONTROL-NAMED'), page('DEVICE-FARM-DELETE-ON-PAGE')],
    greens: [coverage('SCHEMA-COVERAGE-EVERY-LEAF'), page('TABS-FIVE-IN-ORDER'), page('STATUS-IN-TAB-BAR')],
  },
  {
    subject: PAGE_SRC, instrument: 'dom', claim: 'TABS-FIVE-IN-ORDER-SHIPPED',
    operation: 'render a native select that navigates the tabs, on the rebuilt bundle a real Chromium loads',
    crossing: ui('navselect429'),
    edits: [NAV_SELECT],
    reds: [dom('TABS-FIVE-IN-ORDER-SHIPPED')],
    allowed: [],
    greens: [dom('LEGACY-LINKS-SHIPPED'), dom('NO-DIALOG-SHIPPED'), dom('FILE-VIEW-MASKING-SHIPPED')],
  },
  {
    subject: TAB_BAR_SRC, instrument: 'dom', claim: 'STATUS-NEVER-SCROLLS-AWAY',
    operation: "move the save status inside the tab strip's scroll box, on the rebuilt bundle",
    crossing: ui('status429inside'),
    edits: [STATUS_IN_SCROLL],
    reds: [dom('STATUS-NEVER-SCROLLS-AWAY')],
    allowed: [],
    greens: [dom('TABS-FIVE-IN-ORDER-SHIPPED'), dom('LEGACY-LINKS-SHIPPED'), dom('NO-DIALOG-SHIPPED')],
  },
]

runGate({
  slug: '429-config-ui-mutation', envPrefix: 'AGENT_QA_429_CONFIG_UI_MUTATION', idPrefix: 'U',
  instruments, legs, expectedLegs: 31, banner: 'CONFIG_UI_MUTATION_OK',
})
NODE
