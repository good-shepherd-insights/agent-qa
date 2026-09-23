#!/usr/bin/env bash
# 426-feedback-mutation.sh — the contextual feedback composer's closed sets and its guarantees
# cannot silently regress (426-18, PXH-FDBK-01/02/04/05).
#
# WHAT THIS PROVES, AND WHY A GREEN SUITE DOES NOT PROVE IT. Phase 426 closed seven vocabularies
# (outcome classes, the choice order per class, entry scopes, composer, preview and history states,
# layouts) and made a handful of promises about the page: two doors and no pills, plain words where
# the internal mark names used to be, no Send feedback without a current preview, no modal on the
# mark path, the latest-mark-wins explanation, the replaces line, a note that never re-asks the
# preview and a target that never follows the selection. Every suite that pins those is green today
# with nothing taken away, which is exactly what a green suite cannot tell you. So each leg below
# plants the regression that would re-open one set or break one promise, and requires its NAMED
# cell to red while the listed controls hold.
#
# THE LEGS
#   F01  a third outcome class joins the union, the array and its keyed records -> C426-OUTCOME-CLASSES-EXACT
#   F02  the failed choice order swaps its first and third kinds                 -> CHOICE-ORDER-FAILED
#   F03  a third entry scope joins the union, the array and its keyed records    -> C426-ENTRY-SCOPES-EXACT
#   F04  a sixth composer state joins the union and the array                    -> C426-COMPOSER-STATES-EXACT
#   F05  an eighth preview state joins the union and the array                   -> C426-PREVIEW-STATES-EXACT
#   F06  an eighth history state joins the union and the array                   -> C426-HISTORY-STATES-EXACT
#   F07  a third layout joins the union and the array                            -> C426-LAYOUTS-EXACT
#   F08  the step door's render condition is false                               -> TRIGGER-COUNT (SC1)
#   F09  a pill naming the internal mark kind returns to the step row            -> NO-PILL-ANYWHERE
#   F10  the should-have-passed choice is labelled with its internal kind        -> NO-INTERNAL-NAME-IN-COPY
#   F11  submitBlockedReason loses its preview-currency row                      -> SUBMIT-NEEDS-CURRENT-PREVIEW
#   F12  the inline mark approval sits inside a modal dialog (shipped bundle)    -> NO-DIALOG-ON-MARK-PATH
#   F13  the history stops rendering the replacement explanation                 -> HISTORY-REPLACED-EXPLAINED
#   F14  the preview stops rendering the replaces line                           -> PREVIEW-REPLACES-LINE
#   F15  a note edit schedules the preview again                                 -> NOTE-DOES-NOT-REFETCH (D-16)
#   F16  an effect moves a step target to the viewed step                        -> TARGET-PINNED (D-08)
#
# ALLOWED CO-REDS are listed on each leg with a one-line reason; nothing else may red.
#
# F12 CROSSES THE DIST BOUNDARY. Its cell reads the shipped bundle a spawned dashboard serves, so the
# leg rebuilds `@vostride/agent-qa-dashboard-ui`, whose Vite bundle has no importable entry; it names
# the literal by which the instrument serves that dist and plants a marker the rebuilt bundle must
# carry. The shipped-binary suite runs with one worker.
#
# Engine, arrival proof, counted selection and restoration: scripts/423-mutation-engine.cjs.
#
# USAGE
#   pnpm run validate:426-feedback-mutation              # from the agent-qa root
#   bash agent-qa/scripts/426-feedback-mutation.sh       # from the super-repository root
#
# KNOBS — AGENT_QA_426_FEEDBACK_MUTATION_SELFTEST
#   neutered  apply NO mutation; the run must FATAL with "<leg>: suite stayed green"
#   fatal     mutate every subject, then throw; every subject must be restored
#   SIGINT | SIGTERM | SIGHUP   the same, then deliver that signal to itself
# AGENT_QA_426_FEEDBACK_MUTATION_LEG=F01..F16 runs one leg (normal or neutered runs only).
# AGENT_QA_426_FEEDBACK_MUTATION_LIST=1 prints the declared inventory and exits.
#
# Installed Node 24, workspace tools and the installed Playwright Chromium are required. No
# downloads or provider calls. Ends with a forced workspace build whenever a byte was mutated.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
exec node --input-type=commonjs - <<'NODE'
const path = require('node:path')
const { runGate, cell } = require(path.join(process.cwd(), 'scripts/423-mutation-engine.cjs'))

const VIEW_SRC = 'packages/dashboard-ui/src/lib/feedback-view.ts'
const HOOK_SRC = 'packages/dashboard-ui/src/hooks/use-run-feedback.ts'
const ROW_SRC = 'packages/dashboard-ui/src/components/run-detail/step-tree-item.tsx'
const HISTORY_SRC = 'packages/dashboard-ui/src/components/run-detail/feedback-history.tsx'
const PREVIEW_SRC = 'packages/dashboard-ui/src/components/run-detail/feedback-preview.tsx'
const APPROVAL_SRC = 'packages/dashboard-ui/src/components/run-detail/feedback-approval.tsx'

const VIEW = 'src/lib/__tests__/feedback-view.test.ts'
const VIEW_D = 'src/lib/__tests__/feedback-view.test-d.ts'
const PAGE = 'src/pages/__tests__/run-detail.feedback.test.tsx'
const COMPOSER = 'src/components/run-detail/__tests__/feedback-composer.test.tsx'
const PREVIEW = 'src/components/run-detail/__tests__/feedback-preview.test.tsx'
const HISTORY = 'src/components/run-detail/__tests__/feedback-history.test.tsx'
const DOM = 'src/__tests__/conformance/426-feedback-dom.test.ts'

const instruments = {
  'ui-view': { pkg: 'packages/dashboard-ui', files: [VIEW, VIEW_D], typecheck: true, count: 59 },
  'ui-page': { pkg: 'packages/dashboard-ui', files: [PAGE], typecheck: false, count: 65 },
  'ui-parts': { pkg: 'packages/dashboard-ui', files: [COMPOSER, PREVIEW, HISTORY], typecheck: false, count: 60 },
  'feedback-dom': { pkg: 'packages/cli', files: [DOM], typecheck: false, count: 12, env: { VITEST_MAX_WORKERS: '1' } },
}

const UI_DIST = "join(PACKAGES_ROOT, 'dashboard-ui', 'dist')"
const ui = marker => ({ pkg: '@vostride/agent-qa-dashboard-ui', dir: 'packages/dashboard-ui', marker, reference: UI_DIST })

const view = (name, count) => cell('ui-view', VIEW, name, count)
const viewD = (name, count) => cell('ui-view', VIEW_D, name, count)
const page = (name, count) => cell('ui-page', PAGE, name, count)
const composer = (name, count) => cell('ui-parts', COMPOSER, name, count)
const preview = (name, count) => cell('ui-parts', PREVIEW, name, count)
const history = (name, count) => cell('ui-parts', HISTORY, name, count)
const dom = (name, count) => cell('feedback-dom', DOM, name, count)

const legs = [
  {
    subject: VIEW_SRC, instrument: 'ui-view', claim: 'C426-OUTCOME-CLASSES-EXACT',
    operation: 'add a third outcome class to the union, the array and the two class-keyed records',
    edits: [
      {
        from: "export type FeedbackOutcomeClass = 'passed' | 'failed'\n\n// prettier-ignore\nexport const FEEDBACK_OUTCOME_CLASSES = [\n  'passed',\n  'failed',\n] as const",
        to: "export type FeedbackOutcomeClass = 'passed' | 'failed' | 'unknown'\n\n// prettier-ignore\nexport const FEEDBACK_OUTCOME_CLASSES = [\n  'passed',\n  'failed',\n  'unknown',\n] as const",
      },
      {
        from: "  passed: [\n    'false-pass',\n    'confirmed-bug',\n    'false-fail',\n  ],\n} as const satisfies Record<FeedbackOutcomeClass",
        to: "  passed: [\n    'false-pass',\n    'confirmed-bug',\n    'false-fail',\n  ],\n  unknown: [\n    'false-fail',\n    'confirmed-bug',\n    'false-pass',\n  ],\n} as const satisfies Record<FeedbackOutcomeClass",
      },
      {
        from: "    'false-pass': 'The app was broken here, but the test passed anyway.',\n  },\n} satisfies Record<FeedbackOutcomeClass",
        to: "    'false-pass': 'The app was broken here, but the test passed anyway.',\n  },\n  unknown: {\n    'false-fail': 'The test was wrong.',\n    'confirmed-bug': 'The app is broken here.',\n    'false-pass': 'The test missed a problem.',\n  },\n} satisfies Record<FeedbackOutcomeClass",
      },
    ],
    reds: [viewD('C426-OUTCOME-CLASSES-EXACT')],
    // The runtime twin pins the same array by value, so a third member moves it too.
    allowed: [view('CLOSED-SETS-RUNTIME')],
    greens: [viewD('C426-CHOICE-ORDER-SHAPE'), view('CHOICE-ORDER-FAILED'), view('CHOICE-ORDER-PASSED'),
      view('LAYOUTS-RUNTIME')],
  },
  {
    subject: VIEW_SRC, instrument: 'ui-view', claim: 'CHOICE-ORDER-FAILED',
    operation: "swap the failed order's first and third kinds",
    edits: [{
      from: "  failed: [\n    'false-fail',\n    'confirmed-bug',\n    'false-pass',\n  ],\n",
      to: "  failed: [\n    'false-pass',\n    'confirmed-bug',\n    'false-fail',\n  ],\n",
    }],
    reds: [view('CHOICE-ORDER-FAILED')],
    allowed: [],
    greens: [view('CHOICE-ORDER-PASSED'), view('CLOSED-SETS-RUNTIME'), viewD('C426-CHOICE-ORDER-SHAPE'),
      viewD('C426-OUTCOME-CLASSES-EXACT')],
  },
  {
    subject: VIEW_SRC, instrument: 'ui-view', claim: 'C426-ENTRY-SCOPES-EXACT',
    operation: 'add a third entry scope to the union, the array and the two scope-keyed records',
    edits: [
      {
        from: "export type FeedbackEntryScope = 'test' | 'step'\n\n// prettier-ignore\nexport const FEEDBACK_ENTRY_SCOPES = [\n  'test',\n  'step',\n] as const",
        to: "export type FeedbackEntryScope = 'test' | 'step' | 'member'\n\n// prettier-ignore\nexport const FEEDBACK_ENTRY_SCOPES = [\n  'test',\n  'step',\n  'member',\n] as const",
      },
      { from: "  test: 'Feedback on this test',\n", to: "  test: 'Feedback on this test',\n  member: 'Feedback on this member',\n" },
      { from: "  test: 'No feedback on this test yet.',\n", to: "  test: 'No feedback on this test yet.',\n  member: 'No feedback on this member yet.',\n" },
    ],
    reds: [viewD('C426-ENTRY-SCOPES-EXACT')],
    // The runtime twin pins the array by value; HISTORY-COPY pins both scope-keyed sentence records
    // whole, and the leg must grow them for the widened union to compile.
    allowed: [view('ENTRY-SCOPES-RUNTIME'), view('HISTORY-COPY')],
    greens: [viewD('C426-COMPOSER-STATES-EXACT'), view('ENTRY-LABEL'), view('CHOICE-ORDER-FAILED')],
  },
  {
    subject: VIEW_SRC, instrument: 'ui-view', claim: 'C426-COMPOSER-STATES-EXACT',
    operation: 'add a sixth composer state to the union and the runtime array',
    edits: [{
      from: "  | 'recorded'\n  | 'retained'\n\n// prettier-ignore\nexport const FEEDBACK_COMPOSER_STATES = [\n  'composing',\n  'submitting',\n  'awaiting-approval',\n  'recorded',\n  'retained',\n]",
      to: "  | 'recorded'\n  | 'retained'\n  | 'dismissed'\n\n// prettier-ignore\nexport const FEEDBACK_COMPOSER_STATES = [\n  'composing',\n  'submitting',\n  'awaiting-approval',\n  'recorded',\n  'retained',\n  'dismissed',\n]",
    }],
    reds: [viewD('C426-COMPOSER-STATES-EXACT')],
    // The runtime twin pins the same array by value, so a sixth member moves it too.
    allowed: [view('CLOSED-SETS-RUNTIME')],
    greens: [viewD('C426-ENTRY-SCOPES-EXACT'), view('CHOICE-ORDER-FAILED'), view('PREVIEW-STATES-RUNTIME')],
  },
  {
    subject: VIEW_SRC, instrument: 'ui-view', claim: 'C426-PREVIEW-STATES-EXACT',
    operation: 'add an eighth preview state to the union and the runtime array',
    edits: [{
      from: "  | 'refused'\n  | 'failed'\n\n// prettier-ignore\nexport const FEEDBACK_PREVIEW_STATES = [\n  'idle',\n  'loading',\n  'consequences',\n  'quarantined',\n  'already-marked',\n  'refused',\n  'failed',\n]",
      to: "  | 'refused'\n  | 'failed'\n  | 'stale'\n\n// prettier-ignore\nexport const FEEDBACK_PREVIEW_STATES = [\n  'idle',\n  'loading',\n  'consequences',\n  'quarantined',\n  'already-marked',\n  'refused',\n  'failed',\n  'stale',\n]",
    }],
    reds: [viewD('C426-PREVIEW-STATES-EXACT')],
    // The runtime twin pins the same array by value, so an eighth member moves it too.
    allowed: [view('PREVIEW-STATES-RUNTIME')],
    greens: [viewD('C426-HISTORY-STATES-EXACT'), view('PREVIEW-STATE-MAPPING'), view('LAYOUTS-RUNTIME')],
  },
  {
    subject: VIEW_SRC, instrument: 'ui-view', claim: 'C426-HISTORY-STATES-EXACT',
    operation: 'add an eighth history state to the union and the runtime array',
    edits: [{
      from: "  | 'ledger-unavailable'\n  | 'failed'\n\n// prettier-ignore\nexport const FEEDBACK_HISTORY_STATES = [\n  'loading',\n  'history',\n  'empty',\n  'run-not-found',\n  'ledger-corrupt',\n  'ledger-unavailable',\n  'failed',\n]",
      to: "  | 'ledger-unavailable'\n  | 'failed'\n  | 'withheld'\n\n// prettier-ignore\nexport const FEEDBACK_HISTORY_STATES = [\n  'loading',\n  'history',\n  'empty',\n  'run-not-found',\n  'ledger-corrupt',\n  'ledger-unavailable',\n  'failed',\n  'withheld',\n]",
    }],
    reds: [viewD('C426-HISTORY-STATES-EXACT')],
    // The runtime twin pins the same array by value, so an eighth member moves it too.
    allowed: [view('C426-HISTORY-STATES-EXACT (runtime)')],
    greens: [viewD('C426-PREVIEW-STATES-EXACT'), view('HISTORY-COPY'), view('PREVIEW-STATES-RUNTIME')],
  },
  {
    subject: VIEW_SRC, instrument: 'ui-view', claim: 'C426-LAYOUTS-EXACT',
    operation: 'add a third layout to the union and the runtime array',
    edits: [{
      from: "export type FeedbackLayout = 'docked' | 'stacked'\n\n// prettier-ignore\nexport const FEEDBACK_LAYOUTS = [\n  'docked',\n  'stacked',\n] as const",
      to: "export type FeedbackLayout = 'docked' | 'stacked' | 'floating'\n\n// prettier-ignore\nexport const FEEDBACK_LAYOUTS = [\n  'docked',\n  'stacked',\n  'floating',\n] as const",
    }],
    reds: [viewD('C426-LAYOUTS-EXACT')],
    // The runtime twin pins the same array by value, so a third member moves it too.
    allowed: [view('LAYOUTS-RUNTIME')],
    greens: [view('LAYOUT-RULE', 3), viewD('C426-ENTRY-SCOPES-EXACT'), view('CLOSED-SETS-RUNTIME')],
  },
  {
    subject: ROW_SRC, instrument: 'ui-page', claim: 'TRIGGER-COUNT',
    operation: "make the step door's render condition false",
    edits: [{
      from: '  const showTrigger = isSelected && onOpenFeedback !== undefined && marks !== undefined && address !== undefined\n',
      to: '  const showTrigger = false && isSelected && onOpenFeedback !== undefined && marks !== undefined && address !== undefined\n',
    }],
    reds: [page('TRIGGER-COUNT')],
    // EVERY CELL THAT OPENS THE COMPOSER THROUGH A STEP DOOR MOVES WITH IT, and must: with no door
    // there is nothing to click. Admitted rather than required — the fact this leg is aimed at is the
    // door count itself.
    allowed: [
      page('STEP-TRIGGER-OPENS-STEP-TARGET'), page('REOPEN-DRAFT-REPREVIEWS'), page('TARGET-PINNED'),
      page('DRAFT-PER-ADDRESS-ROUNDTRIP'), page('UNSENT-DRAFT-LINK'), page('DRAFTS-NOT-PERSISTED'),
      page('ESC-CLOSES-RETURNS-FOCUS: ✕ after the opening step door unmounts returns focus to the header entry'),
      page('STATUS-PER-ADDRESS'), page('RESOLVED-STEP-LINE-ARMS'), page('INVALID-JSON-SURVIVES-RETARGET'),
      page('HISTORY-READ-ON-OPEN'), page('HISTORY-STALE-DROPPED'), page('APPROVAL-WAITING-LINK'),
    ],
    greens: [page('SUITE-HEADER-TARGET-ON-LOAD', 2), page('NO-PILL-ANYWHERE'), page('SUBMIT-NEEDS-CURRENT-PREVIEW')],
  },
  {
    subject: ROW_SRC, instrument: 'ui-page', claim: 'NO-PILL-ANYWHERE',
    operation: 'return a pill naming the internal mark kind to the step row',
    edits: [{
      from: '          <StepNameWithPills step={step} />\n',
      to: '          <StepNameWithPills step={step} />\n          <span data-mark-kind="false-fail" className="rounded border px-1 text-[10px]">false-fail</span>\n',
    }],
    reds: [page('NO-PILL-ANYWHERE')],
    // TRIGGER-COUNT opens by asserting no [data-mark-kind] is on the loaded page, so a returned pill
    // reds it as well.
    allowed: [page('TRIGGER-COUNT')],
    greens: [page('SUITE-HEADER-TARGET-ON-LOAD', 2), page('SUBMIT-NEEDS-CURRENT-PREVIEW'), page('TARGET-PINNED')],
  },
  {
    subject: VIEW_SRC, instrument: 'ui-parts', claim: 'NO-INTERNAL-NAME-IN-COPY',
    operation: 'label the should-have-passed choice with its internal kind',
    edits: [{
      from: "  'false-fail': 'This should have passed',\n",
      to: "  'false-fail': 'false-fail',\n",
    }],
    reds: [composer('NO-INTERNAL-NAME-IN-COPY', 3)],
    // A history entry names its choice by the same label, so the history's own internal-name walk
    // sees the leak too.
    allowed: [history('HISTORY-NO-INTERNAL-NAME')],
    greens: [preview('PREVIEW-REPLACES-LINE'), history('HISTORY-REPLACED-EXPLAINED'), composer('APPROVAL-IS-A-GROUP')],
  },
  {
    subject: VIEW_SRC, instrument: 'ui-page', claim: 'SUBMIT-NEEDS-CURRENT-PREVIEW',
    operation: "drop the preview-currency row from submitBlockedReason",
    edits: [{
      from: '  if (outcome === undefined || input.landedKey !== input.currentKey) return SUBMIT_REASON_CHECKING\n',
      to: '  if (outcome === undefined) return SUBMIT_REASON_CHECKING\n',
    }],
    reds: [page('SUBMIT-NEEDS-CURRENT-PREVIEW')],
    allowed: [],
    greens: [page('TRIGGER-COUNT'), page('NO-PILL-ANYWHERE'), page('TARGET-PINNED')],
  },
  {
    subject: APPROVAL_SRC, instrument: 'feedback-dom', claim: 'NO-DIALOG-ON-MARK-PATH',
    operation: 'make the inline mark approval a modal dialog',
    crossing: ui('feedback426modal'),
    // The question stays a named group INSIDE the modal: re-roling the group itself would time out the
    // drive's own locator before the cell measures anything, and a red from a missing observation is
    // not the modal count this cell exists to take.
    edits: [
      {
        from: '  return (\n    <div\n      role="group"\n      aria-labelledby={titleId}\n',
        to: '  return (\n    <div role="dialog" aria-modal="true" data-modal426="feedback426modal">\n    <div\n      role="group"\n      aria-labelledby={titleId}\n',
      },
      { from: '      )}\n    </div>\n  )\n}\n', to: '      )}\n    </div>\n    </div>\n  )\n}\n' },
    ],
    reds: [dom('NO-DIALOG-ON-MARK-PATH')],
    allowed: [],
    greens: [dom('FEEDBACK-FIXTURE-SETTLED'), dom('TRIGGER-COUNT-ON-BINARY'), dom('NO-PILL-ON-BINARY'),
      dom('SC4-COMPOSE-WHILE-INSPECTING')],
  },
  {
    subject: HISTORY_SRC, instrument: 'ui-parts', claim: 'HISTORY-REPLACED-EXPLAINED',
    operation: 'stop rendering the replacement explanation above the target list',
    edits: [{
      from: '      {replaced ? (\n        <p data-feedback-replaced-note',
      to: '      {replaced && false ? (\n        <p data-feedback-replaced-note',
    }],
    reds: [history('HISTORY-REPLACED-EXPLAINED')],
    allowed: [],
    greens: [history('HISTORY-TARGET-FIRST'), preview('PREVIEW-REPLACES-LINE'), composer('NO-INTERNAL-NAME-IN-COPY', 3)],
  },
  {
    subject: PREVIEW_SRC, instrument: 'ui-parts', claim: 'PREVIEW-REPLACES-LINE',
    operation: 'stop rendering the replaces line under a superseding preview',
    edits: [{
      from: "      {latest.kind === 'supersedes' ? (\n        <p data-preview-line=\"replaces\"",
      to: "      {latest.kind === 'supersedes' && false ? (\n        <p data-preview-line=\"replaces\"",
    }],
    reds: [preview('PREVIEW-REPLACES-LINE')],
    allowed: [],
    greens: [preview('PREVIEW-FOUR-LINES', 2), history('HISTORY-REPLACED-EXPLAINED'), composer('APPROVAL-IS-A-GROUP')],
  },
  {
    subject: HOOK_SRC, instrument: 'ui-page', claim: 'NOTE-DOES-NOT-REFETCH',
    operation: 'schedule the preview again on every note edit',
    edits: [{
      from: '    setDrafts((previous) => new Map(previous).set(address, { ...(previous.get(address) ?? EMPTY_DRAFT), note }))\n    composeAt(address)\n',
      to: '    setDrafts((previous) => new Map(previous).set(address, { ...(previous.get(address) ?? EMPTY_DRAFT), note }))\n    composeAt(address)\n    if (target !== null && draft.kind !== undefined) schedulePreview(target, draft.kind, correction)\n',
    }],
    reds: [page('NOTE-DOES-NOT-REFETCH')],
    allowed: [],
    greens: [page('TRIGGER-COUNT'), page('TARGET-PINNED'), page('NO-PILL-ANYWHERE')],
  },
  {
    subject: HOOK_SRC, instrument: 'ui-page', claim: 'TARGET-PINNED',
    operation: 'move a step target to the viewed step whenever the selection moves',
    edits: [{
      from: '  useEffect(() => { if (focusRequest > 0) headingRef.current?.focus() }, [focusRequest])\n',
      to: '  useEffect(() => { if (focusRequest > 0) headingRef.current?.focus() }, [focusRequest])\n  useEffect(() => {\n    if (selectedStep === null) return\n    setTarget((previous) => previous === null || previous.stepIndex === undefined ? previous : { testIndex: selectedStep.testIndex, stepIndex: selectedStep.stepIndex })\n  }, [selectedStep?.testIndex, selectedStep?.stepIndex])\n',
    }],
    reds: [page('TARGET-PINNED')],
    // EVERY CELL THAT SELECTS ANOTHER STEP WHILE A STEP TARGET IS OPEN MOVES WITH IT, and must: the
    // regression IS "the target follows the selection", so each re-targets where it expected a pin.
    // Admitted rather than required — the fact this leg is aimed at is the pinned line and its switch.
    allowed: [
      page('DRAFT-PER-ADDRESS-ROUNDTRIP'), page('UNSENT-DRAFT-LINK'), page('INVALID-JSON-SURVIVES-RETARGET'),
      page('HISTORY-READ-ON-OPEN'), page('HISTORY-STALE-DROPPED'),
    ],
    greens: [page('TRIGGER-COUNT'), page('NOTE-DOES-NOT-REFETCH'), page('NO-PILL-ANYWHERE')],
  },
]

runGate({
  slug: '426-feedback-mutation', envPrefix: 'AGENT_QA_426_FEEDBACK_MUTATION', idPrefix: 'F',
  instruments, legs, expectedLegs: 16, banner: 'FEEDBACK_MUTATION_OK',
})
NODE
