#!/usr/bin/env bash
# 423-read-sinks-mutation.sh — every scoped UI sink converts restored text, both human doors sanitize
# after restoring, review pointers never lead to Chat, and a failed chain keeps its learned rows
# (423-23, PXH-EVID-04 / PXH-FDBK-06 / PXH-KNOW-06).
#
# WHAT THIS PROVES, AND WHY A GREEN SUITE DOES NOT PROVE IT. The local human door RESTORES masked
# placeholders for display, which makes every place a restored string can leave the page an egress
# sink: the clipboard, the document title, the drawer's DOM text and attributes. One missed
# conversion at one sink looks identical to a working page until a marker or a credential is copied
# out. Both human reads (run detail and step evidence) must restore and THEN sanitize auth state,
# which is T-405-38; skipping the sanitizer still returns a correct-looking body. The run-detail
# review controls must stay runnable copy commands rather than routes into the Chat page this
# milestone removes, and a failed curation chain must keep the rows it had already committed
# (WIN #313). So each leg plants exactly one of those regressions, rebuilds the bundle or server it
# lives in, drives the BUILT page or the real HTTP adapter, and requires its named cell to red while
# the other sinks, doors and controls hold. Clipboard, title and DOM are three separate legs so each
# sink is proved to fail on its own.
#
# THE LEGS
#   S01  the drawer copies an unconverted value to the clipboard               -> SINK-CLIPBOARD
#   S02  the run page puts the unconverted run name in the document title      -> SINK-TITLE
#   S03  the drawer paints an unconverted attribute key into the DOM           -> SINK-DOM
#   S04  the human run-detail door restores without sanitizing auth state      -> C423-HUMAN-DETAIL-SANITIZED (T-405-38)
#   S05  the human evidence door restores without sanitizing auth state        -> HTTP-EVIDENCE-HUMAN
#   S06  the composer history's review control becomes a link to /chat         -> NO-CHAT-TARGET
#   S07  the composer history's review control copies a Chat route              -> NO-CHAT-TARGET
#   S08  the Knowledge proposals copy control becomes a link to /chat           -> NO-CHAT-TARGET
#   S09  a failed chain's learned half returns the early-empty arm              -> FAILED-CHAIN-ROWS-RETAINED (view)
#   S10  the same early-empty arm on the built page over a real failed chain    -> knowledge-tab-dom (c4)
#
# DIST CROSSINGS. S01-S03, S06-S08 and S10 rebuild `@vostride/agent-qa-dashboard-ui`, whose Vite
# bundle has no importable entry, so each names the literal by which its instrument serves that
# dist and plants a string marker the rebuilt bundle must carry. S04 and S05 rebuild
# `@vostride/agent-qa-dashboard`, which the sinks suite imports. The DOM suites run with one worker
# and knowledge-tab-dom runs as its own instrument (WIN #426).
#
# Engine, arrival proof, counted selection and restoration: scripts/423-mutation-engine.cjs.
#
# USAGE
#   pnpm run validate:423-read-sinks-mutation            # from the agent-qa root
#   bash agent-qa/scripts/423-read-sinks-mutation.sh     # from the super-repository root
#
# KNOBS — AGENT_QA_423_READ_SINKS_MUTATION_SELFTEST
#   neutered  apply NO mutation; the run must FATAL with "<leg>: suite stayed green"
#   fatal     mutate every subject, then throw; every subject must be restored
#   SIGINT | SIGTERM | SIGHUP   the same, then deliver that signal to itself
# AGENT_QA_423_READ_SINKS_MUTATION_LEG=S01..S10 runs one leg (normal or neutered runs only).
# AGENT_QA_423_READ_SINKS_MUTATION_LIST=1 prints the declared inventory and exits.
#
# Installed Node 24, workspace tools and the installed Playwright Chromium are required. No
# downloads or provider calls. Ends with a forced workspace build whenever a byte was mutated.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
exec node --input-type=commonjs - <<'NODE'
const path = require('node:path')
const { runGate, cell } = require(path.join(process.cwd(), 'scripts/423-mutation-engine.cjs'))

const DRAWER = 'packages/dashboard-ui/src/components/run-detail/artifact-attribute-rows.tsx'
const RUN_PAGE = 'packages/dashboard-ui/src/pages/run-detail.tsx'
const ROUTES = 'packages/dashboard-server/src/run-service/run-detail-routes.ts'
const HISTORY = 'packages/dashboard-ui/src/components/run-detail/feedback-history.tsx'
const LEARNED = 'packages/dashboard-ui/src/components/run-detail/knowledge-learned.tsx'
const VIEW = 'packages/dashboard-ui/src/lib/knowledge-view.ts'

const SINKS = 'src/__tests__/conformance/423-read-sinks.test.ts'
const LEARNED_T = 'src/components/run-detail/__tests__/knowledge-learned.test.tsx'
const TAB_T = 'src/components/run-detail/__tests__/tab-knowledge.test.tsx'
const KTD = 'src/__tests__/conformance/knowledge-tab-dom.test.ts'

const instruments = {
  'read-sinks': { pkg: 'packages/cli', files: [SINKS], typecheck: false, count: 10, env: { VITEST_MAX_WORKERS: '1' } },
  'knowledge-views': { pkg: 'packages/dashboard-ui', files: [LEARNED_T, TAB_T], typecheck: false, count: 70 },
  'knowledge-tab-dom': { pkg: 'packages/cli', files: [KTD], typecheck: false, count: 22, env: { VITEST_MAX_WORKERS: '1' } },
}

const UI_DIST = "join(PACKAGES_ROOT, 'dashboard-ui', 'dist')"
const ui = marker => ({ pkg: '@vostride/agent-qa-dashboard-ui', dir: 'packages/dashboard-ui', marker, reference: UI_DIST })
const server = marker => ({ pkg: '@vostride/agent-qa-dashboard', dir: 'packages/dashboard-server', marker })

const sink = (name, count) => cell('read-sinks', SINKS, name, count)
const CLIPBOARD = sink('SINK-CLIPBOARD')
const TITLE = sink('SINK-TITLE')
const DOM = sink('SINK-DOM')
const DETAIL = sink('C423-HUMAN-DETAIL-SANITIZED: T-405-38 restores then sanitizes durable HTTP output')
const EVIDENCE_HUMAN = sink('HTTP-EVIDENCE-HUMAN')
const EVIDENCE_MACHINE = sink('HTTP-EVIDENCE-MACHINE')
const MACHINE_MASKED = sink('C423-HUMAN-DETAIL-SANITIZED: machine HTTP output and durable rows remain masked')
const CROSS_SITE = sink('C423-HUMAN-DETAIL-SANITIZED: cross-site reads are refused before restoration')
const NO_CHAT = sink('NO-CHAT-TARGET')
const view = (file, name) => cell('knowledge-views', file, name)
const page = name => cell('knowledge-tab-dom', KTD, name)

const chatLeg = (subject, where, marker, from, to) => ({
  subject, instrument: 'read-sinks', claim: 'NO-CHAT-TARGET', operation: `turn the ${where} into a link to the Chat page`,
  crossing: ui(marker), edits: [{ from, to }],
  reds: [NO_CHAT], allowed: [],
  greens: [CLIPBOARD, TITLE, DOM, DETAIL, EVIDENCE_HUMAN],
})

const legs = [
  {
    subject: DRAWER, instrument: 'read-sinks', claim: 'SINK-CLIPBOARD', operation: 'copy the unconverted attribute value to the clipboard',
    crossing: ui('sink423clipboard'),
    edits: [{ from: '  void navigator.clipboard?.writeText(copyTextOf(value))\n', to: '  void navigator.clipboard?.writeText(value || "sink423clipboard")\n' }],
    reds: [CLIPBOARD], allowed: [],
    greens: [TITLE, DOM, DETAIL, EVIDENCE_HUMAN, NO_CHAT],
  },
  {
    subject: RUN_PAGE, instrument: 'read-sinks', claim: 'SINK-TITLE', operation: 'put the unconverted run name in the document title',
    crossing: ui('sink423title'),
    edits: [{ from: '  usePageTitle(copyTextOf(runTitle))\n', to: '  usePageTitle(runTitle || "sink423title")\n' }],
    reds: [TITLE], allowed: [],
    greens: [CLIPBOARD, DOM, DETAIL, EVIDENCE_HUMAN, NO_CHAT],
  },
  {
    subject: DRAWER, instrument: 'read-sinks', claim: 'SINK-DOM', operation: 'paint the unconverted attribute key into the drawer DOM',
    crossing: ui('sink423dom'),
    edits: [{ from: '                  {copyTextOf(key)}\n', to: '                  {key || "sink423dom"}\n' }],
    reds: [DOM], allowed: [],
    greens: [CLIPBOARD, TITLE, DETAIL, EVIDENCE_HUMAN, NO_CHAT],
  },
  {
    subject: ROUTES, instrument: 'read-sinks', claim: 'C423-HUMAN-DETAIL-SANITIZED', operation: 'restore the human run-detail body without sanitizing auth state',
    crossing: server('sanitize423detail'),
    edits: [{ from: '          ? sanitizeAuthStateForResponse(\n            unmaskTreeForDisplay(deps.host, outcome.body, { runId: deps.runId }),\n          )\n',
      to: '          ? (unmaskTreeForDisplay(deps.host, outcome.body, { runId: deps.runId }) ?? "sanitize423detail")\n' }],
    reds: [DETAIL], allowed: [],
    greens: [EVIDENCE_HUMAN, EVIDENCE_MACHINE, MACHINE_MASKED, CROSS_SITE, CLIPBOARD, DOM],
  },
  {
    subject: ROUTES, instrument: 'read-sinks', claim: 'HTTP-EVIDENCE-HUMAN', operation: 'restore the human step-evidence body without sanitizing auth state',
    crossing: server('sanitize423evidence'),
    edits: [{ from: "    const body = RunsEvidenceResultSchema.parse(result)\n    respondJson(res, 200, deps.boundary === 'human'\n      ? sanitizeAuthStateForResponse(unmaskTreeForDisplay(deps.host, body, { runId: deps.runId }))\n",
      to: "    const body = RunsEvidenceResultSchema.parse(result)\n    respondJson(res, 200, deps.boundary === 'human'\n      ? (unmaskTreeForDisplay(deps.host, body, { runId: deps.runId }) ?? \"sanitize423evidence\")\n" }],
    reds: [EVIDENCE_HUMAN], allowed: [],
    greens: [DETAIL, EVIDENCE_MACHINE, MACHINE_MASKED, CROSS_SITE, CLIPBOARD],
  },
  chatLeg(HISTORY, 'history review control', 'chat423history',
    '            <ReviewCommandButton\n              data-history-review\n              command={proposalReviewCommand(disposition.proposalId)}\n              label={COPY_REVIEW_COMMAND_LABEL}\n              className="font-mono text-xs text-muted-foreground hover:text-foreground"\n            />\n',
    '            <a\n              data-history-review\n              data-chat423="chat423history"\n              href="/chat"\n              className="font-mono text-xs text-muted-foreground hover:text-foreground"\n            >{proposalReviewCommand(disposition.proposalId)}</a>\n'),
  {
    ...chatLeg(HISTORY, 'history review control', 'chat423route',
      '              data-history-review\n              command={proposalReviewCommand(disposition.proposalId)}\n',
      '              data-history-review\n              command={`/chat?proposal=${disposition.proposalId}&chat423=chat423route`}\n'),
    operation: 'make the history review control copy a Chat route',
  },
  chatLeg(LEARNED, 'Knowledge proposals copy control', 'chat423proposals',
    '            <ReviewCommandButton\n              data-review-proposals\n              variant="icon"\n              command={proposals.command}\n              label={proposals.copyLabel}\n            />\n',
    '            <a\n              data-review-proposals\n              data-chat423="chat423proposals"\n              href="/chat"\n            >{proposals.copyLabel}</a>\n'),
  {
    subject: VIEW, instrument: 'knowledge-views', claim: 'FAILED-CHAIN-ROWS-RETAINED', operation: "return a failed chain's early-empty arm even when rows were committed",
    edits: [{ from: "    return rows.length > 0\n      ? {\n          state: 'failed',\n          rows,\n          chainNote", to: "    return rows.length < 0\n      ? {\n          state: 'failed',\n          rows,\n          chainNote" }],
    reds: [view(LEARNED_T, 'FAILED-CHAIN-ROWS-RETAINED'), view(TAB_T, 'FAILED-CHAIN-ROWS-RETAINED')],
    allowed: [view(LEARNED_T, 'FAILED-NO-SNAPSHOT: an absent snapshot is stated on the half, with no since-then count and no invented counts'),
      view(TAB_T, 'FAILED-NO-SNAPSHOT')],
    greens: [view(LEARNED_T, 'LATER-LINKED-ROWS'), view(TAB_T, 'LATER-LINKED-ROWS'),
      view(LEARNED_T, 'FAILED-NO-SNAPSHOT: a historical settled chain states the same absence and keeps its legacy counts'),
      view(LEARNED_T, 'carries the failed word and says nothing was learned — and offers no retry')],
  },
  {
    subject: VIEW, instrument: 'knowledge-tab-dom', claim: 'FAILED-CHAIN-ROWS-RETAINED', operation: "return the early-empty failed arm on the built page over a real failed chain",
    crossing: ui('failed423'),
    edits: [
      { from: "    return rows.length > 0\n      ? {\n          state: 'failed',\n          rows,\n          chainNote", to: "    return rows.length < 0\n      ? {\n          state: 'failed',\n          rows,\n          chainNote" },
      { from: "      : { state: 'failed', sentence: CURATION_FAILED_TEXT, rows: [],", to: "      : { state: 'failed', sentence: CURATION_FAILED_TEXT, rows: [], failed423: \"early-empty\"," },
    ],
    reds: [page('(c4)')], allowed: [],
    greens: [page('(c5)'), page('(c1)'), page('(c3)'), page('(b4)'), page('(a3)')],
  },
]

runGate({
  slug: '423-read-sinks-mutation', envPrefix: 'AGENT_QA_423_READ_SINKS_MUTATION', idPrefix: 'S',
  instruments, legs, expectedLegs: 10, banner: 'READ_SINKS_MUTATION_OK',
})
NODE
