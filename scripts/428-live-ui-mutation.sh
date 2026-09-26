#!/usr/bin/env bash
# 428-live-ui-mutation.sh — the one live preview's UI side cannot silently regress (428-26,
# PXH-LIVE-01..04).
#
# WHAT THIS PROVES, AND WHY A GREEN SUITE DOES NOT PROVE IT. Phase 428 closed six UI vocabularies
# (the preview states, the dot states, the embed report events the page listens for, the corner's
# actions, the two page layouts and the step glyph table, made injective) and made a set of
# promises about what the preview and the live rows say: nothing on the live page animates and the
# one green dot is still, health is read from frames and never from the bus, a stall turns the dot
# amber while the bus keeps heartbeating, a static page stays green on the keepalive, snapshot
# frames carry the literal label, the editor hook polls for no screenshot, a secret placeholder is
# the masked chip, a row is a glyph and a label with no clock, count or bar, a single member's
# title is said once. It also deleted things that must stay deleted: the liveness pill, a second
# live embed, a bridge that trusts any window, an editor end that needs the socket, a Group keyed
# by the layout and a dot that animates at all. Every suite that pins those is green
# today with nothing taken away, which is exactly what a green suite cannot tell you. So each leg
# below plants the regression that would re-open one set, break one promise or bring one deletion
# back, and requires its NAMED cell to red while the listed controls hold. The contract-side legs
# are 428-25's.
#
# THE LEGS
#   U01  a thirteenth preview state joins LivePreviewStateName and its array        -> C428-PREVIEW-STATES-EXACT
#   U02  a fourth dot state joins LiveDotState, its array, its name and meaning     -> C428-DOT-STATES-EXACT
#   U03  a sixth report event joins the UI's LiveEmbedReportEvent and its array     -> C428-EMBED-REPORT-EVENTS-EXACT
#   U04  a fourth action joins LivePreviewAction, its array and its label           -> C428-PREVIEW-ACTIONS-EXACT
#   U05  a third layout joins LiveRunLayout and LIVE_RUN_LAYOUTS                     -> CLOSED-SETS-428-LAYOUT (D-06)
#   U06  cancelled maps to Minus again, the glyph skipped already has               -> GLYPH-TABLE-TOTAL-AND-INJECTIVE (D-19)
#   U07  the dot's mark takes Tailwind's pulse animation, on the rebuilt bundle     -> NO-ANIMATION-ON-LIVE-PAGE (owner 2026-09-26 (5), shipped)
#   U08  LivePreviewEvent gains a bus envelope that the machine reads as a frame    -> NO-BUS-INPUT (D-15)
#   U09  deriveLivePreview ignores a frame's age once one has arrived               -> STALL-TURNS-AMBER (D-16)
#   U10  U09's edit, on the rebuilt bundle over a heartbeating bus                  -> STALL-TURNS-AMBER-WHILE-HEARTBEAT-CONTINUES (SC3, shipped)
#   U11  LIVE_FRESHNESS_WINDOW_MS drops to 1_500, under the 2 s keepalive          -> STATIC-PAGE-STAYS-GREEN (D-15)
#   U12  SNAPSHOT_PREVIEW_LABEL loses its words and reads 'Snapshot'               -> SNAPSHOT-LABEL-IFF-SNAPSHOT-FRAME (D-13)
#   U13  the label drifts to every 2s, on the rebuilt bundle                       -> SNAPSHOT-LABEL-ON-SNAPSHOT-FRAMES (D-13, shipped)
#   U14  the editor hook sends the retired screenshot request every second again   -> HOOK-HAS-NO-SCREENSHOT-POLLING (SC1)
#   U15  the row renders row.text without liveLabelText (on the wrapping label)    -> SECRET-PLACEHOLDER-AS-CHIP (D-22, #289)
#   U16  the running row renders a mm:ss elapsed span before the wrapping label    -> NO-CLOCK-ON-ANY-ROW (D-19)
#   U17  the running row renders an 'N actions' span before the wrapping label     -> NO-ACTION-COUNT (D-19)
#   U18  the running row renders a progressbar before the wrapping label           -> ROW-IS-GLYPH-AND-LABEL (D-19)
#   U19  the member header renders for a single member                             -> NO-REPEATED-SINGLE-MEMBER-TITLE (D-19)
#   U20  the live page's header renders a data-liveness element again              -> NO-LIVENESS-PILL (D-03)
#   U21  the editor's run panel renders a second data-live-embed iframe            -> ONE-PREVIEW-COMPONENT (SC1)
#   U22  the message listener drops the event.source check                         -> BRIDGE-SOURCE-CHECKED (Q-BRIDGE)
#   U23  terminateSession ends the session only over the socket                    -> UNMOUNT-DELETES-WITH-SOCKET-CLOSED (D-09)
#   U24  the ResizablePanelGroup's key follows the layout                          -> GROUP-KEY-STABLE (D-06)
#   U25  .live-dot-green gets an infinite animation and its keyframes back         -> DOT-IS-STILL (owner 2026-09-26 (5))
#
# ALLOWED CO-REDS are listed on each leg with a one-line reason; nothing else may red.
#
# ONE INSTRUMENT PER LEG. The engine gives a leg one instrument, so U16 reds the page suite's
# NO-CLOCK-ON-ANY-ROW and U18 reds the row suite's ROW-IS-GLYPH-AND-LABEL; the row suite's
# no-clock assertion under U16 is the same rule measured once more, and is not a separate leg.
#
# U07, U10 AND U13 CROSS THE DIST BOUNDARY. Their cells read the shipped bundle a real Chromium
# loads from a production server, so each leg rebuilds `@vostride/agent-qa-dashboard-ui`, whose
# Vite bundle has no importable entry; it names the literal by which the instrument serves that
# dist and plants a marker the rebuilt bundle must carry (the dot mark's
# `live-dot animate-pulse` class, `stall428green`, `updates every 2s`), so the engine proves the mutation
# reached the page. The shipped-bundle suites run with one worker.
#
# U25's SUBJECT IS A STYLESHEET. The row and preview suites parse globals.css through a path
# relative to their own file, and the engine's closure follows that read (428-26).
#
# 2026-09-26 (428-35, owner review G-428-1..5). The owner's review of the shipped live page made
# five decisions: (1) a live row shows its whole label, wrapped; (2) no row reads `step N`; (3) the
# preview follows the running member and there is no handle selector; (4) the health dot sits at
# the preview container's top-left, in its chrome, clear of the picture; (5) the dot and the running
# glyph are still. 428-30..34 built them and re-spelled the cells, which left legs aimed at markup
# and titles that no longer exist. Re-spelled here, each still planting the regression its claim
# names:
#   U07  was ONE-PULSING-GREEN-DOT (the running glyph's wrapper took live-dot-green, so a second
#        element pulsed). Nothing pulses now, so the dot's own mark takes Tailwind's pulse
#        animation, on its new subject health-dot.tsx, and reds NO-ANIMATION-ON-LIVE-PAGE.
#   U15  same claim (SECRET-PLACEHOLDER-AS-CHIP); anchored on the label line without the retired
#        step-N fallback.
#   U16..U18  same claims; LABEL_SPAN names the new wrapping label container, and the planted
#        spans test `row.status === 'running'`, since the row's isRunning went with the motion.
#   U25  was REDUCED-MOTION-STILL-DOT (removed the reduced-motion rule that stilled the pulse). There
#        is no pulse to still, so the leg puts an infinite animation and its keyframes back on
#        .live-dot-green, and reds DOT-IS-STILL.
# Green controls follow the renamed cells: RUNNING-BREATHES-AND-REKEYS is RUNNING-GLYPH-STILL,
# REDUCED-MOTION-STILL-DOT is DOT-IS-STILL, ONE-PULSING-GREEN-DOT is NO-ANIMATION-ON-LIVE-PAGE,
# REDUCED-MOTION-DOT-STILL is DOT-STILL-UNDER-ANY-MOTION-PREFERENCE and CORNER-ON-PICTURE is
# DOT-TOP-LEFT-OF-CONTAINER. ui-lib also selects live-run-watch.test.ts, and every instrument's
# count is re-measured on the 428-34 tree.
#
# Engine, arrival proof, counted selection and restoration: scripts/423-mutation-engine.cjs.
#
# USAGE
#   pnpm run validate:428-live-ui-mutation              # from the agent-qa root
#   bash agent-qa/scripts/428-live-ui-mutation.sh       # from the super-repository root
#
# KNOBS — AGENT_QA_428_LIVE_UI_MUTATION_SELFTEST
#   neutered  apply NO mutation; the run must FATAL with "<leg>: suite stayed green"
#   fatal     mutate every subject, then throw; every subject must be restored
#   SIGINT | SIGTERM | SIGHUP   the same, then deliver that signal to itself
# AGENT_QA_428_LIVE_UI_MUTATION_LEG=U01..U25 runs one leg (normal or neutered runs only).
# AGENT_QA_428_LIVE_UI_MUTATION_LIST=1 prints the declared inventory and exits.
#
# Installed Node 24, workspace tools and the installed Playwright Chromium are required. No
# downloads or provider calls. Ends with a forced workspace build whenever a byte was mutated.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
exec node --input-type=commonjs - <<'NODE'
const path = require('node:path')
const { runGate, cell } = require(path.join(process.cwd(), 'scripts/423-mutation-engine.cjs'))

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

const LIB_T = 'src/lib/__tests__/live-preview.test.ts'
const LIB_D = 'src/lib/__tests__/live-preview.test-d.ts'
const LAYOUT_T = 'src/lib/__tests__/live-run-layout.test.ts'
const WATCH_T = 'src/lib/__tests__/live-run-watch.test.ts'
const PREVIEW_C = 'src/components/live-preview/__tests__/live-preview.test.tsx'
const ONE_C = 'src/components/live-preview/__tests__/one-preview.test.ts'
const ROW_C = 'src/components/__tests__/live-step-row.test.tsx'
const PANEL_C = 'src/components/__tests__/run-results-panel.test.tsx'
const HOOK_T = 'src/__tests__/use-live-editor.test.ts'
const PAGE_C = 'src/pages/__tests__/live-run.test.tsx'
const PREVIEW_DOM = 'src/__tests__/conformance/428-live-preview-dom.test.ts'
const LAYOUT_DOM = 'src/__tests__/conformance/428-live-layout-dom.test.ts'

const instruments = {
  'ui-lib': { pkg: 'packages/dashboard-ui', files: [LIB_T, LIB_D, LAYOUT_T, WATCH_T], typecheck: true, count: 42 },
  'ui-parts': { pkg: 'packages/dashboard-ui', files: [PREVIEW_C, ONE_C, ROW_C, PANEL_C, HOOK_T], typecheck: false, count: 60 },
  'ui-page': { pkg: 'packages/dashboard-ui', files: [PAGE_C], typecheck: false, count: 55 },
  dom: { pkg: 'packages/cli', files: [PREVIEW_DOM, LAYOUT_DOM], typecheck: false, count: 19, env: { VITEST_MAX_WORKERS: '1' } },
}

const UI_DIST = "join(PACKAGES_ROOT, 'dashboard-ui', 'dist')"
const ui = marker => ({ pkg: '@vostride/agent-qa-dashboard-ui', dir: 'packages/dashboard-ui', marker, reference: UI_DIST })

const lib = (name, count) => cell('ui-lib', LIB_T, name, count)
const libD = (name, count) => cell('ui-lib', LIB_D, name, count)
const layout = (name, count) => cell('ui-lib', LAYOUT_T, name, count)
const preview = (name, count) => cell('ui-parts', PREVIEW_C, name, count)
const one = (name, count) => cell('ui-parts', ONE_C, name, count)
const row = (name, count) => cell('ui-parts', ROW_C, name, count)
const panel = (name, count) => cell('ui-parts', PANEL_C, name, count)
const hook = (name, count) => cell('ui-parts', HOOK_T, name, count)
const page = (name, count) => cell('ui-page', PAGE_C, name, count)
const dom = (name, count) => cell('dom', PREVIEW_DOM, name, count)
const layoutDom = (name, count) => cell('dom', LAYOUT_DOM, name, count)

const AGE = '      const age = now - (frame.ts + (state.skew ?? 0))\n'
const AGE_IGNORED = "      const age = frame.kind === ('stall428green' as LiveStreamKind) ? now - frame.ts : 0\n"
const LABEL_SPAN = '      <span className="min-w-0 flex-1 whitespace-normal break-words leading-5 [overflow-wrap:anywhere]">\n'

const legs = [
  {
    subject: PREVIEW_SRC, instrument: 'ui-lib', claim: 'C428-PREVIEW-STATES-EXACT',
    operation: 'add a thirteenth preview state to LivePreviewStateName and LIVE_PREVIEW_STATES',
    edits: [
      { from: "  | 'unavailable'\n// prettier-ignore\nexport const LIVE_PREVIEW_STATES", to: "  | 'unavailable'\n  | 'paused'\n// prettier-ignore\nexport const LIVE_PREVIEW_STATES" },
      { from: "  'unavailable',\n] as const satisfies readonly LivePreviewStateName[]", to: "  'unavailable',\n  'paused',\n] as const satisfies readonly LivePreviewStateName[]" },
    ],
    reds: [libD('C428-PREVIEW-STATES-EXACT')],
    // The runtime twin pins the array by value; the digit census must reach every published state,
    // and no path of the machine reaches the new one.
    allowed: [lib('CLOSED-SETS-428'), lib('NO-NUMBERS-IN-WORDS')],
    greens: [libD('C428-DOT-STATES-EXACT'), libD('NO-BUS-INPUT'), lib('COPY-428')],
  },
  {
    subject: PREVIEW_SRC, instrument: 'ui-lib', claim: 'C428-DOT-STATES-EXACT',
    operation: 'add a fourth dot state to LiveDotState, LIVE_DOT_STATES, its name and its meaning',
    edits: [
      { from: "export type LiveDotState = 'green' | 'amber' | 'red'\n", to: "export type LiveDotState = 'green' | 'amber' | 'red' | 'blue'\n" },
      { from: "  'red',\n] as const satisfies readonly LiveDotState[]", to: "  'red',\n  'blue',\n] as const satisfies readonly LiveDotState[]" },
      { from: "  red: 'Live preview stopped',\n", to: "  red: 'Live preview stopped',\n  blue: 'Live preview paused',\n" },
      { from: "  red: 'The preview stopped receiving frames.',\n", to: "  red: 'The preview stopped receiving frames.',\n  blue: 'The preview is paused.',\n" },
    ],
    reds: [libD('C428-DOT-STATES-EXACT')],
    // The runtime twin pins the array by value, and the copy cell pins LIVE_DOT_NAMES by value.
    allowed: [lib('CLOSED-SETS-428'), lib('COPY-428')],
    greens: [libD('C428-PREVIEW-STATES-EXACT'), libD('C428-PREVIEW-ACTIONS-EXACT'), lib('STALL-TURNS-AMBER')],
  },
  {
    subject: PREVIEW_SRC, instrument: 'ui-lib', claim: 'C428-EMBED-REPORT-EVENTS-EXACT',
    operation: "add a sixth report event to the UI's LiveEmbedReportEvent and LIVE_EMBED_REPORT_EVENTS",
    edits: [
      {
        from: "export type LiveEmbedReportEvent = 'ready' | 'frame' | 'ended' | 'refused' | 'lost'\n",
        to: "export type LiveEmbedReportEvent = 'ready' | 'frame' | 'ended' | 'refused' | 'lost' | 'resized'\n",
      },
      { from: "  'lost',\n] as const satisfies readonly LiveEmbedReportEvent[]", to: "  'lost',\n  'resized',\n] as const satisfies readonly LiveEmbedReportEvent[]" },
    ],
    reds: [libD('C428-EMBED-REPORT-EVENTS-EXACT')],
    // The runtime twin pins the array by value.
    allowed: [lib('CLOSED-SETS-428')],
    greens: [libD('C428-DOT-STATES-EXACT'), libD('C428-EMBED-END-REASONS-EXACT'), lib('PARSE-EMBED-REPORT-CLOSED')],
  },
  {
    subject: PREVIEW_SRC, instrument: 'ui-lib', claim: 'C428-PREVIEW-ACTIONS-EXACT',
    operation: 'add a fourth action to LivePreviewAction, LIVE_PREVIEW_ACTIONS and its label',
    edits: [
      { from: "export type LivePreviewAction = 'reconnect' | 'refresh' | 'start-fresh'\n", to: "export type LivePreviewAction = 'reconnect' | 'refresh' | 'start-fresh' | 'pause'\n" },
      { from: "  'start-fresh',\n] as const satisfies readonly LivePreviewAction[]", to: "  'start-fresh',\n  'pause',\n] as const satisfies readonly LivePreviewAction[]" },
      { from: "  'start-fresh': 'Start fresh',\n", to: "  'start-fresh': 'Start fresh',\n  pause: 'Pause',\n" },
    ],
    reds: [libD('C428-PREVIEW-ACTIONS-EXACT')],
    // The runtime twin pins the array by value, and the copy cell pins the action labels by value.
    allowed: [lib('CLOSED-SETS-428'), lib('COPY-428')],
    greens: [libD('C428-PREVIEW-STATES-EXACT'), libD('C428-DOT-STATES-EXACT'), lib('SESSION-GONE-START-FRESH')],
  },
  {
    subject: LAYOUT_SRC, instrument: 'ui-lib', claim: 'CLOSED-SETS-428-LAYOUT',
    operation: 'add a third layout to LiveRunLayout and LIVE_RUN_LAYOUTS',
    edits: [
      { from: "export type LiveRunLayout = 'docked' | 'stacked'\n", to: "export type LiveRunLayout = 'docked' | 'stacked' | 'floating'\n" },
      { from: "  'stacked',\n] as const satisfies readonly LiveRunLayout[]", to: "  'stacked',\n  'floating',\n] as const satisfies readonly LiveRunLayout[]" },
    ],
    reds: [layout('CLOSED-SETS-428-LAYOUT')],
    allowed: [],
    greens: [layout('LAYOUT-BOUNDARY-768'), lib('CLOSED-SETS-428')],
  },
  {
    subject: ROW_SRC, instrument: 'ui-parts', claim: 'GLYPH-TABLE-TOTAL-AND-INJECTIVE',
    operation: 'map cancelled to Minus again, the glyph skipped already has',
    edits: [{ from: '  cancelled: Ban,\n', to: '  cancelled: Minus,\n' }],
    reds: [row('GLYPH-TABLE-TOTAL-AND-INJECTIVE')],
    allowed: [],
    greens: [row('ROW-IS-GLYPH-AND-LABEL'), row('STATUS-NAME-NOT-COLOUR'), row('RUNNING-GLYPH-STILL')],
  },
  {
    subject: HEALTH_SRC, instrument: 'dom', claim: 'NO-ANIMATION-ON-LIVE-PAGE',
    operation: "give the dot's mark Tailwind's pulse animation, on the rebuilt bundle a real Chromium loads",
    crossing: ui('live-dot animate-pulse'),
    // Re-spelled 2026-09-26 (428-35): it planted a second pulsing element beside the pulsing dot;
    // nothing on the page animates now, so the dot itself is what starts moving again.
    edits: [{
      from: '          <span data-live-dot-mark aria-hidden className={`live-dot live-dot-${state}`} />\n',
      to: '          <span data-live-dot-mark aria-hidden className={`live-dot animate-pulse live-dot-${state}`} />\n',
    }],
    reds: [dom('NO-ANIMATION-ON-LIVE-PAGE')],
    // It reads the same dot's computed animation, with and without reduced motion, and Tailwind's
    // pulse has no reduced-motion guard.
    allowed: [dom('DOT-STILL-UNDER-ANY-MOTION-PREFERENCE')],
    greens: [dom('DOT-TOP-LEFT-OF-CONTAINER'), dom('NO-LABEL-ON-SCREENCAST'), layoutDom('ROWS-GLYPH-AND-LABEL-SHIPPED')],
  },
  {
    subject: PREVIEW_SRC, instrument: 'ui-lib', claim: 'NO-BUS-INPUT',
    operation: 'let LivePreviewEvent carry a bus envelope and read it as a frame',
    edits: [
      {
        from: "import type { LiveStreamDeclaration, LiveStreamKind } from '@vostride/agent-qa-schema'\n",
        to: "import type { LiveStreamDeclaration, LiveStreamKind, RunEventEnvelope } from '@vostride/agent-qa-schema'\n",
      },
      { from: "  | { type: 'reset' }\n", to: "  | { type: 'reset' }\n  | { type: 'bus'; envelope: RunEventEnvelope }\n" },
      {
        from: '    case \'retry\':\n      return { ...carried(state), phase: \'minting\' }\n',
        to: "    case 'retry':\n      return { ...carried(state), phase: 'minting' }\n    case 'bus':\n      return reduceReport(state, { event: 'frame', width: state.frame?.width ?? 0, height: state.frame?.height ?? 0 }, now)\n",
      },
    ],
    reds: [libD('NO-BUS-INPUT')],
    // The import IS the mechanism: a machine that reads the bus has to name its envelope.
    allowed: [lib('NO-BUS-IMPORT')],
    greens: [libD('C428-PREVIEW-STATES-EXACT'), lib('PURE-AND-TOTAL'), lib('STALL-TURNS-AMBER')],
  },
  {
    subject: PREVIEW_SRC, instrument: 'ui-lib', claim: 'STALL-TURNS-AMBER',
    operation: "ignore a frame's age in deriveLivePreview, so the dot stays green once a frame arrived",
    edits: [{ from: AGE, to: AGE_IGNORED }],
    reds: [lib('STALL-TURNS-AMBER')],
    // Each of these needs a frame to age into amber: the one-machine trace's delayed step, the
    // window's closed edge, a stall under a skewed producer clock, the snapshot flag dropping once
    // amber, and the digit census, which reaches delayed through an eight-second-old frame.
    allowed: [lib('ONE-MACHINE-BOTH-ENTRY-POINTS', 2), lib('FRESHNESS-BOUNDARY'), lib('SKEW-CALIBRATED', 2),
      lib('SNAPSHOT-LABEL-IFF-SNAPSHOT-FRAME'), lib('NO-NUMBERS-IN-WORDS')],
    greens: [lib('STATIC-PAGE-STAYS-GREEN'), lib('LOST-RECONNECTS-THEN-DISCONNECTS'), lib('LOADING-UNTIL-FIRST-FRAME', 2)],
  },
  {
    subject: PREVIEW_SRC, instrument: 'dom', claim: 'STALL-TURNS-AMBER-WHILE-HEARTBEAT-CONTINUES',
    operation: "ignore a frame's age, on the rebuilt bundle over a bus that keeps heartbeating",
    crossing: ui('stall428green'),
    edits: [{ from: AGE, to: AGE_IGNORED }],
    reds: [dom('STALL-TURNS-AMBER-WHILE-HEARTBEAT-CONTINUES')],
    allowed: [],
    greens: [dom('NO-ANIMATION-ON-LIVE-PAGE'), dom('SNAPSHOT-LABEL-ON-SNAPSHOT-FRAMES'), dom('NO-LABEL-ON-SCREENCAST')],
  },
  {
    subject: PREVIEW_SRC, instrument: 'ui-lib', claim: 'STATIC-PAGE-STAYS-GREEN',
    operation: 'shrink the freshness window to 1_500 ms, under the 2 s keepalive',
    edits: [{ from: 'export const LIVE_FRESHNESS_WINDOW_MS = 5_000\n', to: 'export const LIVE_FRESHNESS_WINDOW_MS = 1_500\n' }],
    reds: [lib('STATIC-PAGE-STAYS-GREEN')],
    // The copy cell pins the 5_000 default, and each of these reads green up to 4_999 ms after the
    // newest frame: the window's open edge, the steady stall and the skewed stall.
    allowed: [lib('COPY-428'), lib('FRESHNESS-BOUNDARY'), lib('STALL-TURNS-AMBER'), lib('SKEW-CALIBRATED', 2)],
    greens: [lib('LOST-RECONNECTS-THEN-DISCONNECTS'), lib('CLOSED-SETS-428'), libD('NO-BUS-INPUT')],
  },
  {
    subject: PREVIEW_SRC, instrument: 'ui-lib', claim: 'SNAPSHOT-LABEL-IFF-SNAPSHOT-FRAME',
    operation: 'cut the snapshot label down to one word',
    edits: [{
      from: "export const SNAPSHOT_PREVIEW_LABEL = 'Snapshot preview · updates every 1s'\n",
      to: "export const SNAPSHOT_PREVIEW_LABEL = 'Snapshot'\n",
    }],
    reds: [lib('SNAPSHOT-LABEL-IFF-SNAPSHOT-FRAME')],
    // The copy cell pins the label literal, and the digit census requires the corner's one number
    // to be the snapshot label's, which a one-word label no longer has.
    allowed: [lib('COPY-428'), lib('NO-NUMBERS-IN-WORDS')],
    greens: [lib('STALL-TURNS-AMBER'), lib('CLOSED-SETS-428'), lib('PARSE-EMBED-REPORT-CLOSED')],
  },
  {
    subject: PREVIEW_SRC, instrument: 'dom', claim: 'SNAPSHOT-LABEL-ON-SNAPSHOT-FRAMES',
    operation: 'drift the snapshot label to every 2s, on the rebuilt bundle a real Chromium loads',
    crossing: ui('updates every 2s'),
    edits: [{
      from: "export const SNAPSHOT_PREVIEW_LABEL = 'Snapshot preview · updates every 1s'\n",
      to: "export const SNAPSHOT_PREVIEW_LABEL = 'Snapshot preview · updates every 2s'\n",
    }],
    reds: [dom('SNAPSHOT-LABEL-ON-SNAPSHOT-FRAMES')],
    allowed: [],
    // The fallback cell reads the page against the drifted source, so it stays green only if the
    // rebuilt bundle carries the drift: the page-side proof that the mutation arrived.
    greens: [dom('SNAPSHOT-LABEL-ON-FALLBACK-FRAMES'), dom('NO-LABEL-ON-SCREENCAST'), dom('NO-ANIMATION-ON-LIVE-PAGE')],
  },
  {
    subject: HOOK_SRC, instrument: 'ui-parts', claim: 'HOOK-HAS-NO-SCREENSHOT-POLLING',
    operation: 'send the retired screenshot request every second once the session is ready',
    edits: [{
      from: "          setConnectionState(interactive ? 'connected' : 'error')\n          setError(msg.error ?? null)\n",
      to: "          setConnectionState(interactive ? 'connected' : 'error')\n          setError(msg.error ?? null)\n          const poll = setInterval(() => {\n            if (ws.readyState !== 1) {\n              clearInterval(poll)\n              return\n            }\n            ws.send(JSON.stringify({ type: 'get-screenshot' }))\n          }, 1_000)\n",
    }],
    reds: [hook('HOOK-HAS-NO-SCREENSHOT-POLLING: a connected session sends no retired request in 10 s'),
      hook("HOOK-HAS-NO-SCREENSHOT-POLLING: the hook's source names no polling function or retired message")],
    allowed: [],
    greens: [hook('HOOK-HAS-NO-SCREENSHOT-POLLING: the return has no screenshot and no requestScreenshot'), one('ONE-PREVIEW-COMPONENT')],
  },
  {
    subject: ROW_SRC, instrument: 'ui-parts', claim: 'SECRET-PLACEHOLDER-AS-CHIP',
    operation: 'render row.text without turning its placeholders into the masked marker',
    edits: [{
      from: '        {splitMaskedText(liveLabelText(row.text)).map(',
      to: '        {splitMaskedText(row.text).map(',
    }],
    reds: [row('SECRET-PLACEHOLDER-AS-CHIP')],
    // Each of these paints a placeholder as its chip through the same label path, the editor's run
    // panel included, since it renders the same row.
    allowed: [row('LIVE-CHIP-LABEL'), row('CHIP-STAYS-WHOLE'), row('two placeholders are two chips, and an email placeholder keeps its own chip'),
      panel('PANEL-SECRET-AS-CHIP')],
    greens: [row('PLAIN-LABEL-UNCHANGED'), row('ROW-IS-GLYPH-AND-LABEL'), row('GLYPH-TABLE-TOTAL-AND-INJECTIVE')],
  },
  {
    subject: ROW_SRC, instrument: 'ui-page', claim: 'NO-CLOCK-ON-ANY-ROW',
    operation: 'render a mm:ss elapsed span on the running row',
    edits: [{
      from: LABEL_SPAN,
      to: "      {row.status === 'running' && (\n        <span data-step-clock className=\"shrink-0 tabular-nums text-muted-foreground\">\n          {(() => {\n            const seconds = Math.floor(Math.max(0, Date.now() - (row.startedAt ?? Date.now())) / 1_000)\n            return `${String(Math.floor(seconds / 60))}:${String(seconds % 60).padStart(2, '0')}`\n          })()}\n        </span>\n      )}\n" + LABEL_SPAN,
    }],
    reds: [page('NO-CLOCK-ON-ANY-ROW')],
    // Each reads the running row's whole text, which now carries the clock (428-35, measured).
    allowed: [page('PENDING-ROWS-SHOW-KNOWN-TEXT'), page('TEXTLESS-PENDING-ROWS-ABSENT')],
    greens: [page('NO-ACTION-COUNT'), page('NO-REPEATED-SINGLE-MEMBER-TITLE'), page('GROUP-KEY-STABLE')],
  },
  {
    subject: ROW_SRC, instrument: 'ui-page', claim: 'NO-ACTION-COUNT',
    operation: "render an 'N actions' span on the running row",
    edits: [{
      from: LABEL_SPAN,
      to: "      {row.status === 'running' && (\n        <span data-step-count className=\"shrink-0 text-xs text-muted-foreground\">\n          {`${String(row.ticks)} actions`}\n        </span>\n      )}\n" + LABEL_SPAN,
    }],
    reds: [page('NO-ACTION-COUNT')],
    // Each reads the running row's whole text, which now carries the count (428-35, measured).
    allowed: [page('PENDING-ROWS-SHOW-KNOWN-TEXT'), page('TEXTLESS-PENDING-ROWS-ABSENT')],
    greens: [page('NO-CLOCK-ON-ANY-ROW'), page('NO-REPEATED-SINGLE-MEMBER-TITLE'), page('GROUP-KEY-STABLE')],
  },
  {
    subject: ROW_SRC, instrument: 'ui-parts', claim: 'ROW-IS-GLYPH-AND-LABEL',
    operation: 'render a progressbar on the running row',
    edits: [{
      from: LABEL_SPAN,
      to: "      {row.status === 'running' && (\n        <span role=\"progressbar\" aria-valuenow={row.ticks} className=\"h-1 w-8 shrink-0 rounded bg-blue-500\" />\n      )}\n" + LABEL_SPAN,
    }],
    reds: [row('ROW-IS-GLYPH-AND-LABEL')],
    // Each reads the label as the row's second child, which is now the bar; the wrap and first-line
    // cells joined 428-31 (measured 428-35).
    allowed: [row('CHIP-STAYS-WHOLE'), row('FULL-LABEL-WRAPS'), row('GLYPH-ON-FIRST-LINE')],
    greens: [row('GLYPH-TABLE-TOTAL-AND-INJECTIVE'), row('STATUS-NAME-NOT-COLOUR'), row('SECRET-PLACEHOLDER-AS-CHIP')],
  },
  {
    subject: STEPS_SRC, instrument: 'ui-page', claim: 'NO-REPEATED-SINGLE-MEMBER-TITLE',
    operation: 'render the member header for a single member too',
    edits: [{ from: '  const showMemberHeaders = memberIndices.length > 1\n', to: '  const showMemberHeaders = memberIndices.length >= 1\n' }],
    reds: [page('NO-REPEATED-SINGLE-MEMBER-TITLE')],
    // A single member's did-not-run note moves from the pane's sentence into the header.
    allowed: [page('SINGLE-MEMBER-NOTE-AS-SENTENCE')],
    greens: [page('MULTI-MEMBER-COMPACT-HEADER'), page('NO-ACTION-COUNT'), page('NO-CLOCK-ON-ANY-ROW')],
  },
  {
    subject: PAGE_SRC, instrument: 'ui-page', claim: 'NO-LIVENESS-PILL',
    operation: "render a data-liveness element in the live page's header again",
    edits: [{
      from: '            <h2 className="truncate text-base font-semibold leading-tight">{title}</h2>\n',
      to: '            <h2 className="truncate text-base font-semibold leading-tight">{title}</h2>\n            <span data-liveness="live" className="text-xs text-emerald-500">live</span>\n',
    }],
    reds: [page('NO-LIVENESS-PILL', 3)],
    // The fourth cell of the same block and the no-verdict band both assert no data-liveness node,
    // and the header census holds exactly four things, where the pill is a fifth.
    allowed: [page('the preview keeps its own state across a dropped and restored socket, and nothing claims liveness'),
      page('NO-PULSING-RADIO'),
      page('a `runFinished` with NO verdict renders the terminal band, links run detail, and goes nowhere (D-14 fallback)')],
    greens: [page('NO-REPEATED-SINGLE-MEMBER-TITLE'), page('GROUP-KEY-STABLE'), page('NO-ACTION-COUNT')],
  },
  {
    subject: PANEL_SRC, instrument: 'ui-parts', claim: 'ONE-PREVIEW-COMPONENT',
    operation: "render a second data-live-embed iframe in the editor's run panel",
    edits: [{
      from: '      {/* Steps list */}\n',
      to: '      <iframe data-live-embed title="live preview" sandbox="allow-scripts" src={`/live/${runId}`} className="h-40 w-full border-0" />\n      {/* Steps list */}\n',
    }],
    reds: [one('ONE-PREVIEW-COMPONENT')],
    allowed: [],
    greens: [preview('BRIDGE-SOURCE-CHECKED'), preview('DOT-IS-STILL'), row('ROW-IS-GLYPH-AND-LABEL')],
  },
  {
    subject: COMPONENT_SRC, instrument: 'ui-parts', claim: 'BRIDGE-SOURCE-CHECKED',
    operation: "let the preview's message listener accept a report from any window",
    edits: [{
      from: '      const own = iframeRef.current?.contentWindow\n      if (own === undefined || own === null || event.source !== own) return\n',
      to: '',
    }],
    reds: [preview('BRIDGE-SOURCE-CHECKED')],
    allowed: [],
    greens: [preview('DOT-IS-STILL'), preview('CLEANUP-ON-UNMOUNT', 2), preview('HOST-HINT-IN-SRC'), one('ONE-PREVIEW-COMPONENT')],
  },
  {
    subject: HOOK_SRC, instrument: 'ui-parts', claim: 'UNMOUNT-DELETES-WITH-SOCKET-CLOSED',
    operation: 'end the editor session only over the control socket',
    edits: [{
      from: "    sendMessage({ type: 'terminate-session' })\n    if (sessionId) {\n      deleteLiveEditorSession(sessionId, { keepalive: true }).catch(() => {\n        logLiveDebug('hook', 'session delete refused or already gone', { sessionId })\n      })\n    }\n",
      to: "    sendMessage({ type: 'terminate-session' })\n",
    }],
    reds: [hook('UNMOUNT-DELETES-WITH-SOCKET-CLOSED', 3)],
    // pagehide ends the session through the same terminateSession, which no longer DELETEs.
    allowed: [hook('PAGEHIDE-DELETES')],
    greens: [hook('HOOK-HAS-NO-SCREENSHOT-POLLING', 3), one('ONE-PREVIEW-COMPONENT')],
  },
  {
    subject: PAGE_SRC, instrument: 'ui-page', claim: 'GROUP-KEY-STABLE',
    operation: 'key the ResizablePanelGroup by the layout, so a flip remounts it',
    edits: [{ from: '        key="live-run-panels"\n', to: '        key={layout}\n' }],
    reds: [page('GROUP-KEY-STABLE')],
    allowed: [],
    greens: [page('TWO-PANES-BOTH-LAYOUTS'), page('NO-LIVENESS-PILL', 3), page('NO-REPEATED-SINGLE-MEMBER-TITLE')],
  },
  {
    subject: CSS_SRC, instrument: 'ui-parts', claim: 'DOT-IS-STILL',
    operation: 'put an infinite animation and its keyframes back on the green dot',
    // Re-spelled 2026-09-26 (428-35): it removed the reduced-motion rule that stilled the pulse;
    // there is no pulse to still, so the pulse itself comes back.
    edits: [{
      from: '.live-dot-green {\n  background-color: var(--color-emerald-500);\n}\n',
      to: '.live-dot-green {\n  background-color: var(--color-emerald-500);\n  animation: live-dot-pulse 2s ease-in-out infinite;\n}\n\n@keyframes live-dot-pulse {\n  0%, 100% { opacity: 1; }\n  50% { opacity: 0.4; }\n}\n',
    }],
    reds: [preview('DOT-IS-STILL')],
    allowed: [],
    greens: [preview('BRIDGE-SOURCE-CHECKED'), row('RUNNING-GLYPH-STILL'), one('ONE-PREVIEW-COMPONENT')],
  },
]

runGate({
  slug: '428-live-ui-mutation', envPrefix: 'AGENT_QA_428_LIVE_UI_MUTATION', idPrefix: 'U',
  instruments, legs, expectedLegs: 25, banner: 'LIVE_UI_MUTATION_OK',
})
NODE
