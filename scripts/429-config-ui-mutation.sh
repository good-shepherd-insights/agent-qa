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
#   U32  write() adopts a write's revision whatever base it merged onto              -> OUTSIDE-EDIT-INTERLEAVED-REREAD (429-37, CR-01)
#   U33  the landed-write mirror gives up at an unset whose parent is absent         -> MIRROR-CONTINUES-PAST-MISSING-PARENT (429-37)
#   U34  required-sibling completion sends each sibling as set                        -> SIBLING-COMPLETION-NEVER-OVERWRITES (429-45, CR-01)
#   U35  a computed write gives up on its first field_changed                        -> COMPUTED-WRITE-MERGES-OUTSIDE-EDIT (429-46, CR-01)
#   U36  the judge picker's write drops its expect ops                               -> JUDGE-WRITE-EXPECTS-LIST (429-46, CR-01)
#   U37  judgeChangesAfterDelete drops its expect ops                                -> DELETE-JUDGE-EXPECTS-LIST (429-47, CR-01)
#   U38  a header rename reads the value through the reveal door again               -> HEADER-RENAME-NEVER-REVEALS (429-47, D-09)
#   U39  Discard deletes a created credential whose name is a saved model            -> DISCARD-NEVER-DELETES-SAVED-CREDENTIAL (429-48, WR-03)
#   U40  every Connect refusal code falls back to the network sentence               -> CONNECT-REFUSAL-COPY (429-48, WR-02)
#   U41  field_changed leaves CONNECT_REFUSAL_COPY                                   -> CONNECT-REFUSAL-COPY-TOTAL (429-48, WR-02)
#   U42  a scope checkbox settles the add-token row on its own                        -> ADD-MCP-TOKEN-KEEPS-EVERY-SCOPE (429-39, WR-04)
#   U43  U32's edit, on the rebuilt bundle                                           -> OUTSIDE-EDIT-INTERLEAVED-SHIPPED (429-37, shipped)
#   U44  write-failed keeps the marker of a failed keyless write                     -> EMPTY-RETRY-NEVER-SAVING (429-53, WR-06)
#   U45  write-failed drops the in-flight marker whatever write failed               -> FOREIGN-FAILURE-KEEPS-WRITE (429 review, WR-10)
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
# THE GAP CLOSURE (2026-09-27, 429-50). U32..U43 give each UI promise 429-37..429-48 added its
# planted regression: the write's base revision and the mirror past a missing parent (429-37), the
# add-token scopes that settle with their row (429-39), sibling completion by set-if-absent (429-45),
# the computed write and the judge picker's expects (429-46), the delete's expects and the header
# rename by move (429-47), and the Connect refusal copy and the Discard guard (429-48). U43 plants
# U32's edit on the rebuilt bundle, with a string comparison the minifier keeps (`stale429trusted`),
# so OUTSIDE-EDIT-INTERLEAVED-SHIPPED has a leg of its own. U39 plants both halves of the pre-429-48
# guard: with Discard's check removed alone, all 232 ui-components cells stayed green (measured),
# because restoredSignIn already refuses a created sign-in under a saved name, so
# RESTORED-DRAFT-DROPS-SAVED-CREATED is its co-red. No older leg's anchor moved: 429-47 rewrote the
# model delete's body, not the Delete button U13 wraps, and U29 plants on providers-section.tsx; U22's
# anchors in add-model-row.tsx are where 429-35 left them. Two older legs are re-spelled in their
# allowed lists only, because the instruments now select the gap closure's files: U23 (the two Connect
# refusal cells connect a draft named gpt-5.6) and U25 (the model-row cells that render a saved
# header's SecretValue and assert the reveal door is never called). Re-measured: ui-lib 76 (adds
# config-fields and model-workspace; config-copy grew by three), ui-components 232 (adds eval-section,
# model-row and token-list; the hook, the add row and schema coverage grew), dom 12.
#
# THE RE-VERIFICATION GAP (2026-09-27, 429-53). U44 plants the reducer arm the re-verification found
# (WR-06): a failed write that carried no field keys kept its marker, so a Retry with nothing to send
# read Saving… with nothing in flight. The subjects stay at eighteen (config-autosave.ts already is
# one); ui-components is re-measured, because the hook suite grew by the two EMPTY-RETRY-NEVER-SAVING
# cells.
#
# THE REVIEW FIX (2026-09-27, WR-10). U45 plants the other half of U44's line: a failure for any id
# drops the in-flight marker, so a foreign failure (an explicit action's or Undo's) orphans an
# autosave that then lands unseen. Its red is the reducer cell FOREIGN-FAILURE-KEEPS-WRITE, the only
# cell that fails a foreign id onto a live write; ui-lib is re-measured at 77 (was 76).
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
# AGENT_QA_429_CONFIG_UI_MUTATION_LEG=U01..U45 runs one leg (normal or neutered runs only).
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
const FIELDS_SRC = 'packages/dashboard-ui/src/lib/config-fields.ts'
const EVAL_SRC = 'packages/dashboard-ui/src/components/config-manager/eval-section.tsx'
const WORKSPACE_SRC = 'packages/dashboard-ui/src/lib/model-workspace.ts'
const TOKEN_SRC = 'packages/dashboard-ui/src/components/config-manager/token-list.tsx'

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
const FIELDS_T = 'src/lib/__tests__/config-fields.test.ts'
const WORKSPACE_T = 'src/lib/__tests__/model-workspace.test.ts'
const EVAL_T = 'src/components/config-manager/__tests__/eval-section.test.tsx'
const MODEL_ROW_T = 'src/components/config-manager/__tests__/model-row.test.tsx'
const TOKEN_T = 'src/components/config-manager/__tests__/token-list.test.tsx'

const instruments = {
  'ui-lib': {
    pkg: 'packages/dashboard-ui',
    files: [TABS_T, TABS_D, COPY_T, AUTOSAVE_T, AUTOSAVE_D, DRAFT_T, STATIC_T, FIELDS_T, WORKSPACE_T],
    typecheck: true,
    count: 77,
  },
  'ui-components': {
    pkg: 'packages/dashboard-ui',
    files: [HOOK_T, STATUS_T, SECRET_T, ADD_ROW_T, PAGE_T, COVERAGE_T, A11Y_T, EVAL_T, MODEL_ROW_T, TOKEN_T],
    typecheck: false,
    count: 234,
  },
  dom: { pkg: 'packages/cli', files: [DOM_T], typecheck: false, count: 12, env: { VITEST_MAX_WORKERS: '1' } },
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
const fields = (name, count) => cell('ui-lib', FIELDS_T, name, count)
const workspace = (name, count) => cell('ui-lib', WORKSPACE_T, name, count)
const evals = (name, count) => cell('ui-components', EVAL_T, name, count)
const modelRow = (name, count) => cell('ui-components', MODEL_ROW_T, name, count)
const tokens = (name, count) => cell('ui-components', TOKEN_T, name, count)

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
// 429-37: a write answers the base it merged onto; trusting its revision whatever that base is
// hides an outside edit the write absorbed. The literal survives the minifier, so U43 can find it.
const BASE_TRUSTED = {
  from: '      const stale =\n        typeof result.baseRevision === "string" && (revision === undefined || result.baseRevision !== revision)\n      revision = stale ? undefined : result.revision\n',
  to: '      const stale = result.baseRevision === "stale429trusted"\n      revision = stale ? undefined : result.revision\n',
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
      // 429-50: both refusal cells connect a draft named gpt-5.6, now refused before Connect.
      addRow('CONNECT-REFUSAL-COPY'), addRow('CONNECT-REFUSAL-CONFLICT-ON-NAME'),
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
    // The neighbour it keeps unfetched is now fetched on mount too. 429-50: each model-row cell renders
    // a saved header's SecretValue and asserts the reveal door is never called, so the mount reveal reds it.
    allowed: [secret('REVEAL-ONE-VALUE'), modelRow('MODEL-SETTINGS-AUTOSAVE'), modelRow('HEADER-RENAME-NEVER-REVEALS', 2)],
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
  // ---- the gap closure (429-37..429-48; legs 429-50) --------------------------------------------
  {
    subject: HOOK_SRC, instrument: 'ui-components', claim: 'OUTSIDE-EDIT-INTERLEAVED-REREAD',
    operation: "adopt a write's revision whatever base it merged onto",
    edits: [BASE_TRUSTED],
    reds: [hook('OUTSIDE-EDIT-INTERLEAVED-REREAD')],
    // It needs the re-read the stale base starts; without it the next planner leaf is completed again.
    allowed: [hook('INTERLEAVED-EDIT-KEEPS-OUTSIDE-SIBLING')],
    greens: [hook('OWN-WRITE-NO-REFETCH'), hook('OUTSIDE-EDIT-MERGES-QUIETLY'), hook('MIRROR-CONTINUES-PAST-MISSING-PARENT')],
  },
  {
    subject: HOOK_SRC, instrument: 'ui-components', claim: 'MIRROR-CONTINUES-PAST-MISSING-PARENT',
    operation: 'let the landed-write mirror give up at an unset whose parent is absent',
    edits: [{
      from: '      // Nothing is there to remove; the rest of the set still applies (deferred 429-28).\n      return change.op === "unset"\n',
      to: '      return false\n',
    }],
    reds: [hook('MIRROR-CONTINUES-PAST-MISSING-PARENT')],
    allowed: [],
    greens: [hook('MIRROR-APPLIES-NEW-OPS'), hook('OWN-WRITE-NO-REFETCH'), hook('ONE-WRITE-PER-SETTLE', 2)],
  },
  {
    subject: FIELDS_SRC, instrument: 'ui-lib', claim: 'SIBLING-COMPLETION-NEVER-OVERWRITES',
    operation: 'complete each required sibling with set, so the snapshot decides it may be replaced',
    edits: [{ from: "        result.push({ op: 'set-if-absent', path: siblingPath, value })\n", to: "        result.push({ op: 'set', path: siblingPath, value })\n" }],
    reds: [fields('SIBLING-COMPLETION-NEVER-OVERWRITES')],
    // Each pins the op of the siblings it expects added, re-spelled to set-if-absent in 429-45.
    allowed: [fields('SIBLING-COMPLETION', 3), fields('OPTIONAL-SIBLINGS-OMITTED')],
    greens: [fields('DURATION-PARSE'), fields('LIST-TEXT'), workspace('DELETE-JUDGE-EXPECTS-LIST')],
  },
  {
    subject: HOOK_SRC, instrument: 'ui-components', claim: 'COMPUTED-WRITE-MERGES-OUTSIDE-EDIT',
    operation: 'let a computed write give up on its first field_changed',
    edits: [{ from: '        if (compute === undefined || !attached || !isFieldChanged(error)) throw error\n', to: '        throw error\n' }],
    reds: [hook("COMPUTED-WRITE-MERGES-OUTSIDE-EDIT: a field_changed refusal re-reads, recomputes and lands on the file's list")],
    // Each needs the one automatic recompute first: the second refusal, the judge toggle and the model
    // delete all land through it.
    allowed: [
      hook('COMPUTED-WRITE-GIVES-UP-HONESTLY'),
      evals("JUDGE-TOGGLE-MERGES-OUTSIDE-JUDGE: a toggle refused field_changed lands on the file's new list after one re-read"),
      modelRow('DELETE-MERGES-OUTSIDE-JUDGE-EDIT'),
    ],
    greens: [hook('COMPUTED-WRITE-MERGES-OUTSIDE-EDIT: an empty change set writes nothing'), hook('UNDO-CALLS-SERVER', 2), hook('MIRROR-APPLIES-NEW-OPS')],
  },
  {
    subject: EVAL_SRC, instrument: 'ui-components', claim: 'JUDGE-WRITE-EXPECTS-LIST',
    operation: "drop the expect ops from the judge picker's write",
    edits: [
      { from: '  const block = isRecord(config.eval) ? config.eval : {}\n  const current = configuredJudges(config)\n', to: '  const current = configuredJudges(config)\n' },
      {
        from: '  return [\n    { op: "expect", path: ["eval", "judge"], value: block.judge ?? null },\n    { op: "expect", path: ["eval", "judges"], value: block.judges ?? null },\n    ...judgeChanges(next),\n  ]\n',
        to: '  return judgeChanges(next)\n',
      },
    ],
    reds: [evals('JUDGE-WRITE-EXPECTS-LIST')],
    // Each asserts the exact judge write, which leads with the two expect ops since 429-46.
    allowed: [
      evals('JUDGE-ONE-WRITES-JUDGE'), evals('JUDGE-THREE-DISABLES-REST'),
      evals("JUDGE-TOGGLE-MERGES-OUTSIDE-JUDGE: a toggle refused field_changed lands on the file's new list after one re-read"),
    ],
    greens: [evals('JUDGE-NO-MODELS'), evals('EVAL-EVERY-LEAF-GROUPED'), hook('COMPUTED-WRITE-MERGES-OUTSIDE-EDIT', 2)],
  },
  {
    subject: WORKSPACE_SRC, instrument: 'ui-lib', claim: 'DELETE-JUDGE-EXPECTS-LIST',
    operation: 'drop the expect ops judgeChangesAfterDelete leads with',
    edits: [{
      from: "  const block = isRecord(evalConfig) ? evalConfig : {}\n  const changes: ConfigChange[] = [\n    { op: 'expect', path: ['eval', 'judge'], value: block.judge ?? null },\n    { op: 'expect', path: ['eval', 'judges'], value: block.judges ?? null },\n  ]\n",
      to: '  const changes: ConfigChange[] = []\n',
    }],
    reds: [workspace('DELETE-JUDGE-EXPECTS-LIST')],
    // It asserts the exact output for every eval shape, re-spelled to lead with the expects in 429-47.
    allowed: [workspace('JUDGE-CHANGES-AFTER-DELETE')],
    greens: [workspace('isEvalJudge reads eval.judge and eval.judges, and anything else is not a judge'), workspace('modelFieldSegments names one leaf of one saved model by its name'), fields('SIBLING-COMPLETION-NEVER-OVERWRITES')],
  },
  {
    subject: MODEL_ROW_SRC, instrument: 'ui-components', claim: 'HEADER-RENAME-NEVER-REVEALS',
    operation: 'read the header value through the reveal door and rename it with an unset and a set',
    edits: [
      { from: '  deleteAuthCredential,\n  saveCredential,\n', to: '  deleteAuthCredential,\n  revealConfigValue,\n  saveCredential,\n' },
      {
        from: '      const landed = await autosave.runExplicit([\n        { op: "move", from: [...segments, header], path: [...segments, next] },\n      ])\n',
        to: '      const { value } = await revealConfigValue([...segments, header])\n      const landed = await autosave.runExplicit([\n        { op: "unset", path: [...segments, header] },\n        { op: "set", path: [...segments, next], value },\n      ])\n',
      },
    ],
    reds: [modelRow('HEADER-RENAME-NEVER-REVEALS', 2)],
    // Its rename step asserts the move and no reveal (re-spelled in 429-47).
    allowed: [modelRow('MODEL-SETTINGS-AUTOSAVE')],
    greens: [modelRow('LEGACY-LLM-HEADERS-ANTHROPIC-ONLY'), modelRow('DELETE-MODEL-UNDO'), secret('REVEAL-ON-CLICK-ONLY')],
  },
  {
    subject: ADD_ROW_SRC, instrument: 'ui-components', claim: 'DISCARD-NEVER-DELETES-SAVED-CREDENTIAL',
    operation: 'let Discard delete a created credential whose name is a saved model',
    edits: [
      { from: '  if (savedNames.includes(draft.name)) return undefined\n', to: '' },
      { from: '    if (signedIn?.created === true && !existingNames.includes(signedIn.name)) {\n', to: '    if (signedIn?.created === true) {\n' },
    ],
    reds: [addRow('DISCARD-NEVER-DELETES-SAVED-CREDENTIAL')],
    // The restore-side guard is half of this leg's plant; that cell pins it on its own.
    allowed: [addRow('RESTORED-DRAFT-DROPS-SAVED-CREATED')],
    greens: [addRow('DISCARD-REMOVES-ONLY-CREATED-CREDENTIAL'), addRow('DISCARD-DRAFT'), addRow('CONNECT-REFUSAL-COPY')],
  },
  {
    subject: ADD_ROW_SRC, instrument: 'ui-components', claim: 'CONNECT-REFUSAL-COPY',
    operation: 'let every Connect refusal code fall back to the network sentence',
    edits: [{
      from: '      setLine({ state: "failed", sentence: refusal.message ?? connectRefusalSentence(refusal.code, refusal.issues) })\n',
      to: '      setLine({ state: "failed", sentence: refusal.message ?? providerErrorSentence("network_error", "") })\n',
    }],
    reds: [addRow('CONNECT-REFUSAL-COPY')],
    allowed: [],
    greens: [addRow('CONNECT-REFUSAL-CONFLICT-ON-NAME'), addRow('CONNECT-FAIL-KEEPS-DRAFT'), addRow('DISCARD-NEVER-DELETES-SAVED-CREDENTIAL')],
  },
  {
    subject: COPY_SRC, instrument: 'ui-lib', claim: 'CONNECT-REFUSAL-COPY-TOTAL',
    operation: 'drop field_changed from CONNECT_REFUSAL_COPY',
    edits: [{ from: '  field_changed: COULD_NOT_SAVE_MODEL,\n', to: '' }],
    reds: [copy('CONNECT-REFUSAL-COPY-TOTAL: every code the connect door can answer has its own full sentence')],
    allowed: [],
    greens: [copy('CONNECT-REFUSAL-COPY-TOTAL: the network sentence only without a code the map knows; issues follow two codes'), copy('FIELD-CHANGED-COPY'), copy('COPY-429: every exported string is non-empty')],
  },
  {
    subject: TOKEN_SRC, instrument: 'ui-components', claim: 'ADD-MCP-TOKEN-KEEPS-EVERY-SCOPE',
    operation: 'let a scope checkbox settle the add-token row on its own',
    edits: [{
      from: '    change({ ...draft, scopes: SCOPES.filter((item) => next.has(item)).join(",") })\n',
      to: '    const updated = { ...draft, scopes: SCOPES.filter((item) => next.has(item)).join(",") }\n    change(updated)\n    void settle(updated, false)\n',
    }],
    reds: [tokens('ADD-MCP-TOKEN-KEEPS-EVERY-SCOPE')],
    // Each checks a scope and asserts no write before the row settles (429-39).
    allowed: [tokens('ADD-MCP-TOKEN-NEEDS-SCOPE'), tokens('ADD-TOKEN-SCOPES-LOCKED-WHILE-SAVING')],
    greens: [tokens('ADD-RUN-SERVICE-TOKEN'), tokens('TOKEN-DELETE-UNDO'), tokens('TOKEN-ENV-NAME-IN-CLEAR')],
  },
  {
    subject: HOOK_SRC, instrument: 'dom', claim: 'OUTSIDE-EDIT-INTERLEAVED-SHIPPED',
    operation: "adopt a write's revision whatever base it merged onto, on the rebuilt bundle",
    crossing: ui('stale429trusted'),
    edits: [BASE_TRUSTED],
    reds: [dom('OUTSIDE-EDIT-INTERLEAVED-SHIPPED')],
    allowed: [],
    greens: [dom('OUTSIDE-EDIT-SHIPPED'), dom('FILE-VIEW-MASKING-SHIPPED'), dom('TABS-FIVE-IN-ORDER-SHIPPED')],
  },
  // ---- the re-verification gap (WR-06; leg 429-53) ----------------------------------------------
  {
    subject: AUTOSAVE_SRC, instrument: 'ui-components', claim: 'EMPTY-RETRY-NEVER-SAVING',
    operation: 'keep the write marker of a failed write that carried no field keys',
    edits: [{ from: '      return state.write?.id === event.id\n', to: '      return carried.length > 0\n' }],
    reds: [hook('EMPTY-RETRY-NEVER-SAVING', 2)],
    // It retries the real model row's Delete through the hook and pins idle since 429-53.
    allowed: [modelRow('EXPLICIT-FAILURE-RESTORES-ROW')],
    greens: [hook('FORCED-FAILURE-KEEPS-DRAFT', 2), hook('COMPUTED-WRITE-GIVES-UP-HONESTLY'), hook('UNDO-CALLS-SERVER', 2)],
  },
  // ---- the review fix (WR-10) ---------------------------------------------------------------------
  {
    subject: AUTOSAVE_SRC, instrument: 'ui-lib', claim: 'FOREIGN-FAILURE-KEEPS-WRITE',
    operation: 'let write-failed drop the in-flight marker whatever write failed',
    edits: [{ from: '      return state.write?.id === event.id\n', to: '      return true\n' }],
    reds: [autosave('FOREIGN-FAILURE-KEEPS-WRITE')],
    allowed: [],
    greens: [autosave('FAILED-WRITE-KEEPS-DRAFT'), autosave('FAILED-WRITE-NEVER-SAVED'), autosaveD('C429-AUTOSAVE-EVENTS-EXACT')],
  },
]

runGate({
  slug: '429-config-ui-mutation', envPrefix: 'AGENT_QA_429_CONFIG_UI_MUTATION', idPrefix: 'U',
  instruments, legs, expectedLegs: 45, banner: 'CONFIG_UI_MUTATION_OK',
})
NODE
