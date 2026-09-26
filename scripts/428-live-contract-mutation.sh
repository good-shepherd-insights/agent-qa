#!/usr/bin/env bash
# 428-live-contract-mutation.sh — the one live preview's contract side cannot silently regress
# (428-25, PXH-LIVE-01..03).
#
# WHAT THIS PROVES, AND WHY A GREEN SUITE DOES NOT PROVE IT. Phase 428 closed seven vocabularies
# (the stream kinds, the frame end reasons, the live-view subject kinds, the refusal words, the end
# reasons, the embed states and the embed report events) and made a set of promises about the
# preview's transport: a run token never opens an editor session and the reverse, the frame proxy
# dispatches on the token's SIGNED subject kind rather than on the path id, the editor control
# socket refuses a cross-site upgrade, an unexpected drop detaches an editor session instead of
# ending it, the retired screenshot request gets the unknown-type error, a static page keeps
# producing fresh captures, the screencast follows the tab the test acts on, the hub tells its
# subscribers when it closes (#277), ready is said only once a subscription exists (#274), a
# producer's capture time is never overwritten, a slow capture is skipped rather than queued, a
# mobile snapshot never switches the Appium context, a failed start falls back to snapshots,
# editor.liveurl stays unprojected by ruling, the live-editor doors carry no wildcard grant and
# the embed page's bytes are pinned. Every suite that pins those is green today with nothing taken
# away, which is exactly what a green suite cannot tell you. So each leg below plants the
# regression that would re-open one set or break one promise, and requires its NAMED cell to red
# while the listed controls hold. The UI-side legs are 428-26's.
#
# THE LEGS
#   C01  a fifth stream kind joins LiveStreamKind and LIVE_STREAM_KINDS           -> C428-LIVE-STREAM-KINDS-EXACT
#   C02  a third frame end reason joins the union and the array                   -> C428-FRAME-END-REASONS-EXACT
#   C03  a third subject kind joins LiveViewSubject and LIVE_VIEW_SUBJECT_KINDS    -> C428-LIVE-VIEW-SUBJECT-KINDS-EXACT
#   C04  an extra refusal word joins LiveViewRefusalReason and its array          -> C428-REFUSAL-REASONS-EXACT
#   C05  a fourth end reason joins LiveViewEndReason and its array                -> C428-END-REASONS-EXACT
#   C06  a tenth embed state joins LiveEmbedState and LIVE_EMBED_STATES           -> C428-EMBED-STATES-EXACT
#   C07  a sixth report event joins LiveEmbedReportEvent and its array            -> C428-EMBED-REPORT-EVENTS-EXACT
#   C08  validateLiveUrlToken drops the subject-kind comparison                   -> RUN-TOKEN-REFUSED-FOR-EDITOR-SUBJECT (D-07)
#   C09  the frame proxy asks the editor registry by path id, whatever the kind   -> KIND-DISPATCH-BY-SIGNED-SUBJECT (D-07)
#   C10  the /api/live-editor/ws upgrade skips refuseCrossSiteRequest             -> EDITOR-UPGRADE-CROSS-SITE-DESTROYED (D-08, #275)
#   C11  the control socket's close listener ends the session again              -> UNEXPECTED-CLOSE-DETACHES (D-09)
#   C12  the retired screenshot request case returns to ws-handler.ts             -> STALE-CLIENT-GETS-UNKNOWN-TYPE (SC1)
#   C13  the keepalive re-emits the last screencast frame's bytes and stamp       -> STATIC-PAGE-KEEPALIVE (D-15)
#   C14  setActivePage stops chaining the screencast re-bind                      -> TAB-FOLLOW (D-18, #273)
#   C15  hub close() clears its subscribers without telling them                  -> CLOSE-EVICTS-AND-TELLS (D-14, #277)
#   C16  the frame proxy says ready before it subscribes                          -> READY-AFTER-SUBSCRIBE (D-14, #274)
#   C17  the hub stamps its own clock over a producer's capture time              -> TS-KEPT-WHEN-PRESENT (D-15)
#   C18  the snapshot tick captures while a capture is still in flight            -> SKIP-WHILE-IN-FLIGHT (D-13)
#   C19  the android snapshot captures through the context-switching screenshot() -> LIVE-STREAM-IS-CONTEXT-NEUTRAL-SNAPSHOT (D-11)
#   C20  the hub's start-failure branch ignores the fallback                      -> START-FAILURE-FALLS-BACK (D-12)
#   C21  editor.liveurl leaves UNPROJECTED_OPS                                    -> the mapping-bump-guard count (D-07)
#   C22  the live-editor session list answers through json() and its wildcard    -> LIVE-EDITOR-DOORS-CARRY-NO-ACAO (D-08)
#   C23  one byte of the embed page's STYLE changes, on the rebuilt dashboard     -> the embed pin's sha cell (D-10)
#
# 2026-09-26 (428-29, G-428-2): legs 23 → 27. The owner's live-preview review found pending rows
# reading "step 2" while step 1 ran, because testStarted carried a step count and no step texts.
# 428-28 added an optional stepTexts to testStarted, masked at the producer by the run's own
# MaskingContext and filled by the CLI member builders (PXH-LIVE-04). That is four promises, and a
# green suite cannot tell you any of them still holds, so each new leg reds the cell that pins one:
#   C24  TestStartedPayload.stepTexts turns required                              -> C428-TEST-STARTED-STEP-TEXTS-OPTIONAL
#   C25  the shell publishes stepTexts without the run's mask                     -> STEP-TEXTS-MASKED-LIKE-STEP-TEXT
#   C26  the shell stops carrying stepTexts on testStarted                        -> STEP-TEXTS-ON-TESTSTARTED
#   C27  buildDirectRunMembers drops stepTexts                                    -> STEP-TEXTS-FROM-PARSED-STEPS
# The schema instrument's files are unchanged; its count moves 7 → 9 only because 428-28 added one
# cell to each of its two files. C25 and C26 run on a new runner-shell instrument and C27 on a new
# cli-members instrument, each over its own package's source, so none of them crosses a dist. C01..C23
# and the eight earlier instruments are otherwise unchanged.
#
# ALLOWED CO-REDS are listed on each leg with a one-line reason; nothing else may red.
#
# C10 IS MEASURED AT THE SOURCE. The engine gives a leg one instrument, so C10 reds the server
# suite's production upgrade handler; the shipped binary's twin, live-view-cross-site (8), reads
# the bundle built from the same arm and is not a separate leg.
#
# C23 CROSSES THE DIST BOUNDARY. Its cell renders the embed page through the built
# `@vostride/agent-qa-dashboard` package, so the leg rebuilds that package and plants a marker (the
# changed colour, #0b0d11) the rebuilt dist must carry, so the engine proves the mutation reached
# what ships. The cli suites spawn the shipped binary and run with one worker, as does the real
# Chromium screencast suite.
#
# Engine, arrival proof, counted selection and restoration: scripts/423-mutation-engine.cjs.
#
# USAGE
#   pnpm run validate:428-live-contract-mutation              # from the agent-qa root
#   bash agent-qa/scripts/428-live-contract-mutation.sh       # from the super-repository root
#
# KNOBS — AGENT_QA_428_LIVE_CONTRACT_MUTATION_SELFTEST
#   neutered  apply NO mutation; the run must FATAL with "<leg>: suite stayed green"
#   fatal     mutate every subject, then throw; every subject must be restored
#   SIGINT | SIGTERM | SIGHUP   the same, then deliver that signal to itself
# AGENT_QA_428_LIVE_CONTRACT_MUTATION_LEG=C01..C27 runs one leg (normal or neutered runs only).
# AGENT_QA_428_LIVE_CONTRACT_MUTATION_LIST=1 prints the declared inventory and exits.
#
# Installed Node 24, workspace tools and the installed Playwright Chromium are required. No
# downloads or provider calls. Ends with a forced workspace build whenever a byte was mutated.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
exec node --input-type=commonjs - <<'NODE'
const path = require('node:path')
const { runGate, cell } = require(path.join(process.cwd(), 'scripts/423-mutation-engine.cjs'))

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

const SCHEMA_T = 'src/__tests__/428-live-contracts.test.ts'
const SCHEMA_D = 'src/__tests__/428-live-contracts.test-d.ts'
const TOKEN_T = 'src/functions/__tests__/live-url.test.ts'
const EDITOR_URL_T = 'src/functions/__tests__/editor-live-url.test.ts'
const HUB_T = 'src/run/__tests__/live-stream-hub.test.ts'
const SNAPSHOT_T = 'src/run/__tests__/snapshot-live-stream.test.ts'
const SCREENCAST_T = 'src/__tests__/live-stream.screencast.test.ts'
const ANDROID_T = 'src/__tests__/adapter.test.ts'
const PROXY_T = 'src/__tests__/live-view.frame-proxy.test.ts'
const SETS_T = 'src/__tests__/428-live-closed-sets.test.ts'
const SETS_D = 'src/__tests__/428-live-closed-sets.test-d.ts'
const DOORS_T = 'src/__tests__/428-live-editor-doors.test.ts'
const HANDLER_T = 'src/__tests__/ws-handler.test.ts'
const DELETED_T = 'src/__tests__/428-screenshot-path-deleted.test.ts'
const GUARD_T = 'src/__tests__/mapping-bump-guard.test.ts'
const PIN_T = 'src/__tests__/conformance/embed-contract-pin.test.ts'
const EDITOR_VIEW_T = 'src/__tests__/conformance/428-editor-live-view.test.ts'
const CROSS_SITE_T = 'src/__tests__/conformance/live-view-cross-site.test.ts'
const SHELL_T = 'src/run/__tests__/run-shell.test.ts'
const MASKING_T = 'src/run/__tests__/masking-proof.test.ts'
const MEMBERS_T = 'src/__tests__/direct-run-members.test.ts'

const instruments = {
  schema: { pkg: 'packages/schema', files: [SCHEMA_T, SCHEMA_D], typecheck: true, count: 9 },
  agent: { pkg: 'packages/agent', files: [TOKEN_T, EDITOR_URL_T], typecheck: false, count: 27 },
  runner: { pkg: 'packages/runner', files: [HUB_T, SNAPSHOT_T], typecheck: false, count: 52 },
  web: { pkg: 'packages/web', files: [SCREENCAST_T], typecheck: false, count: 10, env: { VITEST_MAX_WORKERS: '1' } },
  android: { pkg: 'packages/android', files: [ANDROID_T], typecheck: false, count: 52 },
  server: {
    pkg: 'packages/dashboard-server',
    files: [PROXY_T, SETS_T, SETS_D, DOORS_T, HANDLER_T, DELETED_T],
    typecheck: true,
    count: 97,
  },
  mcp: { pkg: 'packages/mcp', files: [GUARD_T], typecheck: false, count: 26 },
  cli: {
    pkg: 'packages/cli',
    files: [PIN_T, EDITOR_VIEW_T, CROSS_SITE_T],
    typecheck: false,
    count: 18,
    env: { VITEST_MAX_WORKERS: '1' },
  },
  'runner-shell': { pkg: 'packages/runner', files: [SHELL_T, MASKING_T], typecheck: false, count: 47 },
  'cli-members': { pkg: 'packages/cli', files: [MEMBERS_T], typecheck: false, count: 5 },
}

const server = marker => ({ pkg: '@vostride/agent-qa-dashboard', dir: 'packages/dashboard-server', marker })

const schemaT = (name, count) => cell('schema', SCHEMA_T, name, count)
const schemaD = (name, count) => cell('schema', SCHEMA_D, name, count)
const token = (name, count) => cell('agent', TOKEN_T, name, count)
const editorUrl = (name, count) => cell('agent', EDITOR_URL_T, name, count)
const hub = (name, count) => cell('runner', HUB_T, name, count)
const snapshot = (name, count) => cell('runner', SNAPSHOT_T, name, count)
const screencast = (name, count) => cell('web', SCREENCAST_T, name, count)
const android = (name, count) => cell('android', ANDROID_T, name, count)
const proxy = (name, count) => cell('server', PROXY_T, name, count)
const setsT = (name, count) => cell('server', SETS_T, name, count)
const setsD = (name, count) => cell('server', SETS_D, name, count)
const doors = (name, count) => cell('server', DOORS_T, name, count)
const handler = (name, count) => cell('server', HANDLER_T, name, count)
const deleted = (name, count) => cell('server', DELETED_T, name, count)
const guard = (name, count) => cell('mcp', GUARD_T, name, count)
const pin = (name, count) => cell('cli', PIN_T, name, count)
const editorView = (name, count) => cell('cli', EDITOR_VIEW_T, name, count)
const crossSite = (name, count) => cell('cli', CROSS_SITE_T, name, count)
const shellRun = (name, count) => cell('runner-shell', SHELL_T, name, count)
const masking = (name, count) => cell('runner-shell', MASKING_T, name, count)
const members = (name, count) => cell('cli-members', MEMBERS_T, name, count)

const legs = [
  {
    subject: STREAM_SRC, instrument: 'schema', claim: 'C428-LIVE-STREAM-KINDS-EXACT',
    operation: 'add a fifth stream kind to LiveStreamKind and LIVE_STREAM_KINDS',
    edits: [
      {
        from: "export type LiveStreamKind = 'cdp-screencast' | 'snapshot' | 'mjpeg' | 'webrtc'\n",
        to: "export type LiveStreamKind = 'cdp-screencast' | 'snapshot' | 'mjpeg' | 'webrtc' | 'hls'\n",
      },
      {
        from: "  'webrtc',\n] as const satisfies readonly LiveStreamKind[]",
        to: "  'webrtc',\n  'hls',\n] as const satisfies readonly LiveStreamKind[]",
      },
    ],
    reds: [schemaD('C428-LIVE-STREAM-KINDS-EXACT')],
    // The runtime twin pins the array by value, so the extra member moves it too.
    allowed: [schemaT('C428-LIVE-STREAM-KINDS-EXACT')],
    greens: [schemaD('C428-FRAME-END-REASONS-EXACT'), schemaD('C428-LIVE-VIEW-SUBJECT-KINDS-EXACT'), schemaT('EDITOR-LIVE-URL-DTOS-STRICT')],
  },
  {
    subject: STREAM_SRC, instrument: 'schema', claim: 'C428-FRAME-END-REASONS-EXACT',
    operation: 'add a third frame end reason to LiveFrameEndReason and LIVE_FRAME_END_REASONS',
    edits: [
      {
        from: "export type LiveFrameEndReason = 'withdrawn' | 'closed'\n",
        to: "export type LiveFrameEndReason = 'withdrawn' | 'closed' | 'evicted'\n",
      },
      {
        from: "  'closed',\n] as const satisfies readonly LiveFrameEndReason[]",
        to: "  'closed',\n  'evicted',\n] as const satisfies readonly LiveFrameEndReason[]",
      },
    ],
    reds: [schemaD('C428-FRAME-END-REASONS-EXACT')],
    // The runtime twin pins the array by value, so the extra member moves it too.
    allowed: [schemaT('C428-FRAME-END-REASONS-EXACT')],
    greens: [schemaD('C428-LIVE-STREAM-KINDS-EXACT'), schemaD('C428-LIVE-VIEW-SUBJECT-KINDS-EXACT'), schemaT('C428-LIVE-STREAM-KINDS-EXACT')],
  },
  {
    subject: URL_SRC, instrument: 'schema', claim: 'C428-LIVE-VIEW-SUBJECT-KINDS-EXACT',
    operation: 'add a third subject kind to LiveViewSubject and LIVE_VIEW_SUBJECT_KINDS',
    edits: [
      {
        from: "  | { kind: 'editor'; sessionId: string }\n",
        to: "  | { kind: 'editor'; sessionId: string }\n  | { kind: 'device'; deviceId: string }\n",
      },
      {
        from: "  'editor',\n] as const satisfies readonly LiveViewSubject['kind'][]",
        to: "  'editor',\n  'device',\n] as const satisfies readonly LiveViewSubject['kind'][]",
      },
    ],
    reds: [schemaD('C428-LIVE-VIEW-SUBJECT-KINDS-EXACT')],
    // The runtime twin pins the array by value, so the extra member moves it too.
    allowed: [schemaT('C428-LIVE-VIEW-SUBJECT-KINDS-EXACT')],
    greens: [schemaD('C428-LIVE-STREAM-KINDS-EXACT'), schemaD('C428-FRAME-END-REASONS-EXACT'), schemaT('EDITOR-LIVE-URL-DTOS-STRICT')],
  },
  {
    subject: PROTOCOL_SRC, instrument: 'server', claim: 'C428-REFUSAL-REASONS-EXACT',
    operation: 'add an eighth refusal word to LiveViewRefusalReason and LIVE_VIEW_REFUSAL_REASONS',
    edits: [
      { from: "  | 'unknown_session'\n// prettier-ignore\n", to: "  | 'unknown_session'\n  | 'unknown_device'\n// prettier-ignore\n" },
      { from: "  'unknown_session',\n] as const satisfies readonly LiveViewRefusalReason[]", to: "  'unknown_session',\n  'unknown_device',\n] as const satisfies readonly LiveViewRefusalReason[]" },
    ],
    reds: [setsD('C428-REFUSAL-REASONS-EXACT')],
    // The runtime twin pins the array by value, so the extra member moves it too.
    allowed: [setsT('C428-REFUSAL-REASONS-EXACT')],
    greens: [setsD('C428-END-REASONS-EXACT'), setsD('C428-EMBED-STATES-EXACT'), proxy('(31) UNKNOWN-SESSION-BY-NAME')],
  },
  {
    subject: PROTOCOL_SRC, instrument: 'server', claim: 'C428-END-REASONS-EXACT',
    operation: 'add a fourth end reason to LiveViewEndReason and LIVE_VIEW_END_REASONS',
    edits: [
      {
        from: "export type LiveViewEndReason = 'runFinished' | 'handleFinished' | 'sessionEnded'\n",
        to: "export type LiveViewEndReason = 'runFinished' | 'handleFinished' | 'sessionEnded' | 'deviceGone'\n",
      },
      { from: "  'sessionEnded',\n] as const satisfies readonly LiveViewEndReason[]", to: "  'sessionEnded',\n  'deviceGone',\n] as const satisfies readonly LiveViewEndReason[]" },
    ],
    reds: [setsD('C428-END-REASONS-EXACT')],
    // The runtime twin pins the array by value, so the extra member moves it too.
    allowed: [setsT('C428-END-REASONS-EXACT')],
    greens: [setsD('C428-REFUSAL-REASONS-EXACT'), setsD('C428-EMBED-STATES-EXACT'), proxy('(33) SESSION-END-SAYS-SESSION-ENDED')],
  },
  {
    subject: EMBED_SRC, instrument: 'server', claim: 'C428-EMBED-STATES-EXACT',
    operation: 'add a tenth embed state to LiveEmbedState and LIVE_EMBED_STATES',
    edits: [
      { from: "  | 'ended'\n  | 'lost'\n", to: "  | 'ended'\n  | 'lost'\n  | 'paused'\n" },
      { from: "  'lost',\n] as const satisfies readonly LiveEmbedState[]", to: "  'lost',\n  'paused',\n] as const satisfies readonly LiveEmbedState[]" },
    ],
    reds: [setsD('C428-EMBED-STATES-EXACT')],
    // The runtime twin pins the array by value, so the extra member moves it too.
    allowed: [setsT('C428-EMBED-STATES-EXACT')],
    greens: [setsD('C428-EMBED-REPORT-EVENTS-EXACT'), setsD('C428-REFUSAL-REASONS-EXACT'), proxy('(34) SERVED-SESSION-ENDED-COPY')],
  },
  {
    subject: EMBED_SRC, instrument: 'server', claim: 'C428-EMBED-REPORT-EVENTS-EXACT',
    operation: 'add a sixth report event to LiveEmbedReportEvent and LIVE_EMBED_REPORT_EVENTS',
    edits: [
      {
        from: "export type LiveEmbedReportEvent = 'ready' | 'frame' | 'ended' | 'refused' | 'lost'\n",
        to: "export type LiveEmbedReportEvent = 'ready' | 'frame' | 'ended' | 'refused' | 'lost' | 'resized'\n",
      },
      { from: "  'lost',\n] as const satisfies readonly LiveEmbedReportEvent[]", to: "  'lost',\n  'resized',\n] as const satisfies readonly LiveEmbedReportEvent[]" },
    ],
    reds: [setsD('C428-EMBED-REPORT-EVENTS-EXACT')],
    // The runtime twin pins the array by value; (37) requires the served page to report exactly
    // LIVE_EMBED_REPORT_EVENTS, and the page reports no sixth event.
    allowed: [setsT('C428-EMBED-REPORT-EVENTS-EXACT'), proxy('(37) SERVED-REPORT-HAS-NO-TOKEN')],
    greens: [setsD('C428-EMBED-STATES-EXACT'), setsD('C428-END-REASONS-EXACT'), proxy('(36) SERVED-HOST-HINT-RULE')],
  },
  {
    subject: TOKEN_SRC, instrument: 'agent', claim: 'RUN-TOKEN-REFUSED-FOR-EDITOR-SUBJECT',
    operation: 'drop the subject-kind comparison from validateLiveUrlToken, so the path id alone decides',
    edits: [{
      from: '  const sameSubject =\n    claims.subject.kind === expect.subject.kind && subjectIdOf(claims.subject) === expect.subject.id\n',
      to: '  const sameSubject = subjectIdOf(claims.subject) === expect.subject.id\n',
    }],
    reds: [token('RUN-TOKEN-REFUSED-FOR-EDITOR-SUBJECT')],
    // The reverse direction of the same rule, and the editor mint's own cell, which presents its
    // editor token at a run with the same id and requires scope_mismatch.
    allowed: [token('EDITOR-TOKEN-REFUSED-FOR-RUN-SUBJECT'), editorUrl('MINTS-EDITOR-SUBJECT')],
    greens: [token('refuses another run id as scope_mismatch'), token('SUBJECT-BODY-FIELD-ORDER'), token('UNKNOWN-SUBJECT-KIND-MALFORMED'),
      editorUrl('ON-MINTED-CALLED')],
  },
  {
    subject: PROXY_SRC, instrument: 'server', claim: 'KIND-DISPATCH-BY-SIGNED-SUBJECT',
    operation: 'attach whatever editor session holds the path id before reading the signed kind',
    edits: [{
      from: "      subjectKind = subject.kind\n      if (subject.kind === 'run') {\n",
      to: "      subjectKind = subject.kind\n      const byPath = deps.attachEditor?.(runId)\n      if (byPath !== undefined) {\n        open(byPath, 0, verdict.claims.exp, { ended: byPath.ended, reason: 'sessionEnded' })\n        return\n      }\n      if (subject.kind === 'run') {\n",
    }],
    reds: [proxy('(30) KIND-DISPATCH-BY-SIGNED-SUBJECT: one id, two subjects, and each token opens only its own')],
    // (31) pins the registry lookups to the one editor lookup, and the path-id probe adds a second.
    allowed: [proxy('(31) UNKNOWN-SESSION-BY-NAME')],
    greens: [proxy('(30) KIND-DISPATCH-BY-SIGNED-SUBJECT: a token presented'), proxy('(32) RENEW-KEEPS-SUBJECT-KIND'),
      proxy('(1) hello → ready → frame header + binary JPEG → ack reaches the run session')],
  },
  {
    subject: SERVER_SRC, instrument: 'server', claim: 'EDITOR-UPGRADE-CROSS-SITE-DESTROYED',
    operation: 'let the /api/live-editor/ws upgrade skip the same-site guard',
    edits: [{
      from: "      const crossSite = refuseCrossSiteRequest(request)\n      if (crossSite !== undefined) {\n        socket.destroy()\n        return\n      }\n      const sessionId = url.searchParams.get('sessionId')\n",
      to: "      const sessionId = url.searchParams.get('sessionId')\n",
    }],
    reds: [doors('EDITOR-UPGRADE-CROSS-SITE-DESTROYED', 2)],
    allowed: [],
    greens: [doors('EDITOR-UPGRADE-ADMITS-SAME-ORIGIN', 2), doors('EDITOR-UPGRADE-UNKNOWN-SESSION-4404'),
      doors('EDITOR-MINT-ROUTE refuses a cross-site caller before the mint is dispatched')],
  },
  {
    subject: HANDLER_SRC, instrument: 'server', claim: 'UNEXPECTED-CLOSE-DETACHES',
    operation: "end the session from the control socket's close listener instead of detaching it",
    edits: [{ from: "    ws.on('close', detach)\n", to: "    ws.on('close', () => { void cleanupSession() })\n" }],
    reds: [handler('UNEXPECTED-CLOSE-DETACHES')],
    // Each of these drives a close through the detach path: the idle expiry, the superseded socket's
    // inert close, the in-flight step's cancel and the re-attach inside the window all need the
    // session to survive the drop.
    allowed: [handler('EXPIRY-TERMINATES-ONCE', 2), handler('SUPERSEDED-CLOSE-IS-INERT'), handler('DETACH-CANCELS-IN-FLIGHT-STEP'),
      handler('REATTACH-RESUMES-AND-FLUSHES')],
    greens: [handler('TERMINATE-MESSAGE-ENDS-AT-ONCE'), handler('sends session-ready on handler attach'),
      handler('terminate-session calls cleanup and sends session-terminated')],
  },
  {
    subject: HANDLER_SRC, instrument: 'server', claim: 'STALE-CLIENT-GETS-UNKNOWN-TYPE',
    operation: 'give the control socket its retired screenshot request case back',
    edits: [{
      from: "        case 'get-state': {\n",
      to: "        case 'get-screenshot': {\n          const shot = await (session as any).getScreenshot?.()\n          if (shot) send(ws, { type: 'screenshot', data: shot.toString('base64') } as any)\n          else send(ws, { type: 'error', message: 'Screenshot unavailable' })\n          break\n        }\n\n        case 'get-state': {\n",
    }],
    reds: [deleted('STALE-CLIENT-GETS-UNKNOWN-TYPE'), deleted('SERVER-HAS-NO-SCREENSHOT-MESSAGE', 2)],
    // The census twins: ws-handler's two get-screenshot cells keep their titles and assert the
    // retirement against the same handler.
    allowed: [handler('get-screenshot sends base64 screenshot'), handler('get-screenshot sends error when unavailable')],
    greens: [handler('sends error for unknown message type'), handler('get-state sends session-state'), handler('UNEXPECTED-CLOSE-DETACHES')],
  },
  {
    subject: WEB_SRC, instrument: 'web', claim: 'STATIC-PAGE-KEEPALIVE',
    operation: "re-emit the last screencast frame's bytes and capture time from the keepalive in place of its fresh capture",
    edits: [
      {
        from: '      onFrame({\n        id,\n        bytes: decodeBase64(event.data),\n',
        to: '      onFrame((this as unknown as { lastFrame428?: LiveFrame }).lastFrame428 = {\n        id,\n        bytes: decodeBase64(event.data),\n',
      },
      {
        from: '    onFrame({\n      id: ++this.screencastFrameSeq,\n      bytes: decodeBase64(data),\n      metadata: { width: size.width, height: size.height, timestamp: Date.now() },\n    })\n',
        to: '    const last = (this as unknown as { lastFrame428?: LiveFrame }).lastFrame428\n    onFrame({\n      id: ++this.screencastFrameSeq,\n      bytes: last?.bytes ?? decodeBase64(data),\n      metadata: { width: size.width, height: size.height, timestamp: last?.metadata.timestamp ?? Date.now() },\n    })\n',
      },
    ],
    reds: [screencast('STATIC-PAGE-KEEPALIVE')],
    allowed: [],
    greens: [screencast('POSITIVE ARM'), screencast('TIMESTAMP-EPOCH-MS'), screencast('TAB-FOLLOW')],
  },
  {
    subject: WEB_SRC, instrument: 'web', claim: 'TAB-FOLLOW',
    operation: 'stop setActivePage chaining the screencast re-bind onto the new page',
    edits: [{
      from: '      void this.onScreencastChain(() => this.rebindScreencast())\n',
      to: '      void this.onScreencastChain(async () => undefined)\n',
    }],
    reds: [screencast('TAB-FOLLOW')],
    // A tab switch after a withdrawal restores the screencast through the same re-bind.
    allowed: [screencast('WITHDRAWN-FALLS-BACK (re-bind)')],
    greens: [screencast('STATIC-PAGE-KEEPALIVE'), screencast('POSITIVE ARM'), screencast('WITHDRAWN-FALLS-BACK: a screencast withdrawn')],
  },
  {
    subject: HUB_SRC, instrument: 'runner', claim: 'CLOSE-EVICTS-AND-TELLS',
    operation: 'clear the subscribers in close() without ending their stream',
    edits: [{ from: "        stopStream(state)\n        endStream(state, 'closed')\n", to: '        stopStream(state)\n        state.subscribers.clear()\n' }],
    reds: [hub('CLOSE-EVICTS-AND-TELLS')],
    // Only endStream marks a state dead, so a release held past close() now arms a grace again.
    allowed: [hub('RELEASE-AFTER-CLOSE-ARMS-NOTHING')],
    greens: [hub('(h) close() stops every started stream'), hub('WITHDRAW-SAYS-WITHDRAWN'), hub('START-FAILURE-FALLS-BACK')],
  },
  {
    subject: PROXY_SRC, instrument: 'server', claim: 'READY-AFTER-SUBSCRIBE',
    operation: 'say ready before the subscription exists',
    edits: [
      {
        from: "      if (stream.kind !== 'none') {\n        subscription = source.subscribeFrames(handle, onFrame, onStreamEnd)\n",
        to: "      send(ws, { type: 'ready', runId, handle, stream, expiresAt })\n      if (stream.kind !== 'none') {\n        subscription = source.subscribeFrames(handle, onFrame, onStreamEnd)\n",
      },
      {
        from: "      // and `handle` is 0; no subject field is added.\n      send(ws, { type: 'ready', runId, handle, stream, expiresAt })\n",
        to: '      // and `handle` is 0; no subject field is added.\n',
      },
    ],
    reds: [proxy('(27) READY-AFTER-SUBSCRIBE')],
    // (28) requires the refusal to be the only message, and ready now goes out before it.
    allowed: [proxy('(28) UNKNOWN-HANDLE-EMITTED')],
    greens: [proxy('(1) hello → ready → frame header + binary JPEG → ack reaches the run session'),
      proxy('(11) `stream: { kind: none }` is READY with no frames'), proxy('(30) KIND-DISPATCH-BY-SIGNED-SUBJECT: one id, two subjects, and each token opens only its own')],
  },
  {
    subject: HUB_SRC, instrument: 'runner', claim: 'TS-KEPT-WHEN-PRESENT',
    operation: "stamp the hub's clock over a producer-supplied capture time",
    edits: [{
      from: '      metadata:\n        produced.metadata.timestamp === undefined\n          ? { ...produced.metadata, timestamp: timer.now() }\n          : produced.metadata,\n',
      to: '      metadata: { ...produced.metadata, timestamp: timer.now() },\n',
    }],
    reds: [hub('(u) TS-KEPT-WHEN-PRESENT')],
    allowed: [],
    greens: [hub('(t) TS-STAMPED-WHEN-ABSENT'), hub('(v) KIND-STAMPED-FROM-CAPABILITY'), snapshot('TIMESTAMP-AT-RESOLVE')],
  },
  {
    subject: SNAPSHOT_SRC, instrument: 'runner', claim: 'SKIP-WHILE-IN-FLIGHT',
    operation: 'let a snapshot tick start a capture while the previous one is still pending',
    edits: [{ from: '    if (inFlight) return\n    inFlight = true\n', to: '    inFlight = true\n' }],
    reds: [snapshot('SKIP-WHILE-IN-FLIGHT')],
    allowed: [],
    greens: [snapshot('FIRST-CAPTURE-ON-START'), snapshot('TICK-EVERY-1S'), snapshot('STOP-DROPS-LATE-CAPTURE')],
  },
  {
    subject: ANDROID_SRC, instrument: 'android', claim: 'LIVE-STREAM-IS-CONTEXT-NEUTRAL-SNAPSHOT',
    operation: 'capture the android snapshot preview through the context-switching screenshot()',
    edits: [{
      from: '    this.liveStreamCapability ??= createSnapshotLiveStream({ capture: () => this.captureScreenshot() })\n',
      to: '    this.liveStreamCapability ??= createSnapshotLiveStream({ capture: () => this.screenshot() })\n',
    }],
    reds: [android('LIVE-STREAM-IS-CONTEXT-NEUTRAL-SNAPSHOT')],
    allowed: [],
    greens: [android('the getter answers one capability, before the driver exists too, and cleanup() stops and drops it')],
  },
  {
    subject: HUB_SRC, instrument: 'runner', claim: 'START-FAILURE-FALLS-BACK',
    operation: "ignore the registered fallback in the hub's start-failure branch",
    edits: [{ from: '              const fallback = state.fallback\n', to: '              const fallback = undefined as LiveStreamCapability | undefined\n' }],
    reds: [hub('START-FAILURE-FALLS-BACK')],
    // Each of these needs the fallback to start after a failed primary: its acks and graced stop,
    // the declared kind under it, the next interval's retry of the primary, and its own failure.
    allowed: [hub('FALLBACK-ACK-ROUTES-TO-ACTIVE'), hub('CAPABILITY-OF-DECLARED-UNDER-FALLBACK'),
      hub('a later watched interval tries the primary first again'),
      hub('a fallback that also fails to start is recorded a second time, naming the fallback, and delivers nothing')],
    greens: [hub('NO-FALLBACK-STAYS-DOWN'), hub('CLOSE-EVICTS-AND-TELLS'), hub('(u) TS-KEPT-WHEN-PRESENT')],
  },
  {
    subject: MAPPING_SRC, instrument: 'mcp', claim: 'MAPPING-BUMP-GUARD-COUNT',
    operation: 'remove editor.liveurl from UNPROJECTED_OPS',
    edits: [{
      from: "  Object.freeze({\n    opId: 'editor.liveurl',\n    reason:\n      'D-07 (dated 2026-09-25, 428): the op MINTS A CREDENTIAL — a view credential for a live '\n      + 'EDITOR session, which is private to the dashboard page that owns it; it is reachable only '\n      + 'through the dashboard door and never through an MCP tool or the MCP App live-run '\n      + 'resource. Projecting it would give an agent a watch carrier for a draft execution, which '\n      + 'the owner declined in D-07. Unprojected by ruling, not by deferral.',\n    adjudication: '428',\n  }),\n",
      to: '',
    }],
    reds: [guard('measures the registry at the count this suite header records')],
    // The partition is no longer complete (the op is in neither set), and the 428 adjudicator set
    // names an op the scoping note no longer lists.
    allowed: [guard('disposition every registry op exactly once, in exactly one of the two sets'),
      guard('gives every unprojected op a non-empty reason and a NAMED adjudicator')],
    greens: [guard('lists no op twice in the scoping note'), guard('projects no op that requires a human origin'),
      guard('declares exactly the pinned sorted tool-name list')],
  },
  {
    subject: ROUTES_SRC, instrument: 'server', claim: 'LIVE-EDITOR-DOORS-CARRY-NO-ACAO',
    operation: 'answer the live-editor session list through json() and its wildcard grant',
    edits: [{
      from: '      jsonNoCors(res, { sessions: sessionManager.listSessions() })\n',
      to: '      json(res, { sessions: sessionManager.listSessions() })\n',
    }],
    reds: [doors('LIVE-EDITOR-DOORS-CARRY-NO-ACAO: no admitted answer carries a wildcard grant')],
    allowed: [],
    greens: [doors('LIVE-EDITOR-DOORS-CARRY-NO-ACAO: no refused answer carries a wildcard grant'),
      doors('EDITOR-MINT-ROUTE answers the mint result verbatim, with no wildcard grant')],
  },
  {
    subject: EMBED_SRC, instrument: 'cli', claim: 'EMBED-PAGE-SHA256',
    operation: "change one byte of the embed page's STYLE, on the rebuilt dashboard package",
    crossing: server('#0b0d11'),
    edits: [{ from: 'background: #0b0d10;', to: 'background: #0b0d11;' }],
    reds: [pin('hashes the served embed page to the constant recorded when 408 froze it')],
    allowed: [],
    greens: [pin('renders through an artifact no older than the sources it pins'),
      pin('pins the two path constants the whole live-view transport is addressed by'),
      editorView('EDITOR-LIVE-VIEW-END-TO-END')],
  },
  {
    subject: BUS_EVENTS_SRC, instrument: 'schema', claim: 'C428-TEST-STARTED-STEP-TEXTS-OPTIONAL',
    operation: 'turn the TestStartedPayload stepTexts member from optional to required',
    edits: [{ from: '  stepTexts?: readonly string[]\n}\n', to: '  stepTexts: readonly string[]\n}\n' }],
    reds: [schemaD('C428-TEST-STARTED-STEP-TEXTS-OPTIONAL')],
    // Measured: nothing else reds. The runtime twin builds a typed bare payload, but the runtime
    // file is not type-checked, and the envelope's payload stays an open record at run time.
    allowed: [],
    greens: [schemaT('C428-TEST-STARTED-STEP-TEXTS-ADDITIVE'), schemaD('C428-LIVE-STREAM-KINDS-EXACT'),
      schemaT('C428-LIVE-STREAM-KINDS-EXACT')],
  },
  {
    subject: SHELL_SRC, instrument: 'runner-shell', claim: 'STEP-TEXTS-MASKED-LIKE-STEP-TEXT',
    operation: "publish testStarted's stepTexts without the run's mask, so the raw texts ride it",
    edits: [{ from: '{ stepTexts: member.stepTexts.map(mask) }', to: '{ stepTexts: member.stepTexts }' }],
    reds: [masking('STEP-TEXTS-MASKED-LIKE-STEP-TEXT')],
    // The shell's own stepTexts cell expects the planted secret as [masked] and absent from the payload.
    allowed: [shellRun('STEP-TEXTS-ON-TESTSTARTED')],
    greens: [masking('a synthetic MaskingContext scrubs the secret from bus payloads, event-log lines, AND the handoff'),
      shellRun('testStarted carries the member descriptor parity fields when present'),
      shellRun('a bare member (no optional parity fields) yields a testStarted with no undefined-holes (JSON round-trip)')],
  },
  {
    subject: SHELL_SRC, instrument: 'runner-shell', claim: 'STEP-TEXTS-ON-TESTSTARTED',
    operation: 'delete the stepTexts conditional spread from the testStarted publish',
    edits: [{ from: '        ...(member.stepTexts !== undefined ? { stepTexts: member.stepTexts.map(mask) } : {}),\n', to: '' }],
    reds: [shellRun('STEP-TEXTS-ON-TESTSTARTED')],
    // The masking cell compares testStarted's stepTexts with the announced texts, and they are now absent.
    allowed: [masking('STEP-TEXTS-MASKED-LIKE-STEP-TEXT')],
    greens: [shellRun('testStarted carries the member descriptor parity fields when present'),
      shellRun('a bare member (no optional parity fields) yields a testStarted with no undefined-holes (JSON round-trip)'),
      masking('leaves stepText, plannedAction and interpolatedVariables byte-identical under a firing mask (G-381-3)')],
  },
  {
    subject: MEMBERS_SRC, instrument: 'cli-members', claim: 'STEP-TEXTS-FROM-PARSED-STEPS',
    operation: 'delete the stepTexts line from the direct-run member builder',
    edits: [{ from: '      stepTexts: test.steps.map((step) => memberStepText(step)),\n', to: '' }],
    reds: [members('STEP-TEXTS-FROM-PARSED-STEPS')],
    allowed: [],
    greens: [members('keeps each member and digest bound to its parsed source file'),
      members('mints an identity no checkout root leaks into'),
      members('projects equal-named tests from different files as distinct outcome rows')],
  },
]

runGate({
  slug: '428-live-contract-mutation', envPrefix: 'AGENT_QA_428_LIVE_CONTRACT_MUTATION', idPrefix: 'C',
  instruments, legs, expectedLegs: 27, banner: 'LIVE_CONTRACT_MUTATION_OK',
})
NODE
