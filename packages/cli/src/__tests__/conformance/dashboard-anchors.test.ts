// The fourth door's WIRE anchors: the served channel, compared with the in-process seam (400-09).
//
// WHAT THE REST OF THIS DIRECTORY CANNOT ASK. `surface-dispatch.ts` drives the dashboard door by
// composing `composeDashboardDoor` inside the test process and mounting `createChatRouter` on a
// `node:http` server it stood up itself. That is the right fidelity for a matrix — it is the shipped
// composer and the shipped router — and it leaves exactly one question unanswerable from inside:
// whether the thing a person actually starts, `agent-qa dashboard` out of `dist`, serves the same
// wire. Between the two lies everything the shipped command path adds: argument parsing,
// configuration resolution, workspace-file requirements, the LLM-auth resolution, the dynamic
// `@vostride/agent-qa-dashboard` import, the database, the UI-directory resolution, the confirm
// registry, the bound-origin overlay and the real `startServer` routing table. D-09's roster note
// warns that the HTTP path is a PRIVATE channel between a browser and this process; these anchors
// are what measure that the private channel carries what the seam carries.
//
// THE COMPARAND IS THE RECORD, NEVER A RENDER. Every observation below is read off the session log's
// own JSONL events and `execution_audit.jsonl`, through `readRuntimeObservations` — the SAME reader
// the in-process driver uses, imported rather than copied, so an anchor cannot be measuring the
// difference between two reading recipes. A source assertion at the bottom of this file keeps that
// true after the next edit, because a prohibition nothing measures is a comment.
//
// A FEW ANCHORS, DELIBERATELY (the 397 wall-clock posture). Each one spawns a real server process,
// so they are expensive and there are three: the turn, the stream, and the refusal. Breadth across
// capabilities is already covered in-process by the scenario table; what cannot be covered there is
// depth through the shipped command path, and depth is what these buy.
//
// HERMETIC AND MODEL-FREE, inherited from `spawned-chat.ts`: an `mkdtemp` project with no token
// entry, no key and no LLM block, and a constructed child environment. Every drive takes the
// deterministic resolver route and no provider can be spent against.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  CONFORMANCE_DIR,
  DASHBOARD_ANCHORED_BUILDS,
  REBUILD_INSTRUCTION,
  buildFreshness,
  cleanupTempRoots,
  dashboardFixtureProject,
  reserveEphemeralPort,
  spawnDashboard,
} from './spawned-chat.js'
import type { SpawnedDashboard } from './spawned-chat.js'
import { driveDashboardLines, readRuntimeObservations } from './surface-dispatch.js'

afterEach(() => {
  cleanupTempRoots()
})

/**
 * The op every anchor drives, and why it is this one.
 *
 * `config.get` is bound in this composition, reads nothing a fixture has to stage, returns a real
 * typed payload, and is the op the `/pin` refusal wall is already driven against on both doors. So
 * a green anchor means the whole path MOVED A VALUE rather than that a refusal travelled cleanly,
 * and the refusal anchor changes exactly one thing — the pin — while everything else stays put.
 */
const ANCHOR_OP = 'config.get'
const ANCHOR_CLAUSE = `/fn ${ANCHOR_OP} {}`

/** The pin spelling the gate compares, and the outcome its refusal arm writes into the audit. */
const ANCHOR_PIN = `fn:${ANCHOR_OP}`
const SESSION_PIN_DENIED = 'session-pin-denied'

// ---- The comparands ----------------------------------------------------------------------------

/**
 * One receipt, as a comparable record.
 *
 * `origin` rides along because it is the field that says a HUMAN typed the clause; two doors that
 * agreed on the verdict and disagreed on who asked would be a real difference wearing a green.
 */
interface ComparableReceipt {
  readonly clause: string
  readonly functionId: string
  readonly origin: string
  readonly status: string
  readonly outcome: string
}

/**
 * One gate decision, as a comparable record.
 *
 * THE FIELDS ARE THE DECISION AND NOT ITS BOOKKEEPING. `runId` and `actionId` are per-invocation
 * identifiers that differ by construction, and comparing them would make every anchor red for a
 * reason that has nothing to do with the door. What is compared is what the gate DECIDED — the
 * action, the tier it decided under, the verdict, the coded outcome and the reason.
 *
 * `executionContext` IS IN THE PROJECTION AND IS VACUOUS TODAY, said plainly rather than left for a
 * later reader to discover. `ExecutionAuditRow` declares it, and its own docstring says the run
 * stamps it "so gate rows are self-describing" — but no row this door writes carries one. It was
 * measured: mutating the SHIPPED COMMAND to resolve a different posture than the seam
 * (`resolveExecutionContext: () => 'ci'`) left every anchor GREEN, because the one field that would
 * have moved is absent from both sides. It stays in the projection because it costs nothing and
 * starts discriminating the day the stamp lands; the cell below pins the absence so that day is
 * noticed, and the gap is filed as WINDOWS #197.
 */
interface ComparableAuditRow {
  readonly action: string
  readonly riskTier: string
  readonly verdict: string
  readonly outcome: string
  readonly reason: string
  readonly executionContext: string | undefined
}

interface Comparand {
  readonly receipts: readonly ComparableReceipt[]
  /** Result FUNCTION IDS in clause order — see `comparandOf` for why not the payloads. */
  readonly resultOps: readonly string[]
  readonly auditRows: readonly ComparableAuditRow[]
  readonly unhandled: readonly string[]
}

/**
 * Everything one drive wrote down, projected onto what two DIFFERENT PROJECTS may be compared on.
 *
 * THE PAYLOADS ARE DELIBERATELY NOT IN IT, and the omission is reasoned rather than convenient. The
 * two halves of every anchor run in two different `mkdtemp` projects — they must, since one is this
 * process and one is a child with its own `HOME` — so `config.get`'s payload legitimately carries
 * two different config paths and two different bound origins. Comparing them would red on the
 * fixture rather than on the door. What DOES compare is the shape of what came back (which ops
 * produced results, in which order) beside the receipts and the gate's own rows, which is where
 * every difference a door can introduce actually lands.
 */
function comparandOf(observed: ReturnType<typeof readRuntimeObservations>): Comparand {
  return {
    receipts: observed.receipts.map((receipt) => ({
      clause: receipt.clause,
      functionId: receipt.functionId,
      origin: receipt.origin,
      status: receipt.status,
      outcome: receipt.outcome,
    })),
    resultOps: observed.results.map((result) => result.functionId),
    auditRows: observed.auditRows.map((row) => ({
      action: row.action,
      riskTier: row.riskTier,
      verdict: row.verdict,
      outcome: row.outcome,
      reason: row.reason,
      executionContext: row.executionContext,
    })),
    unhandled: [...observed.unhandled],
  }
}

// ---- Driving the SHIPPED binary over a real socket ----------------------------------------------

/** One SSE frame, as the wire carries it. */
interface SseFrame {
  readonly id: string | undefined
  readonly event: string | undefined
  readonly data: string
}

/**
 * Read frames off a real SSE connection until a predicate is satisfied or the budget runs out.
 *
 * The connection is ABORTED rather than left to time out, because that is what a browser tab
 * closing does — and the reconnect anchor's whole subject is what the server replays afterwards.
 *
 * A LOCAL READER RATHER THAN AN IMPORTED ONE, for a reason worth stating: plan 400-01's copy lives
 * inside `dashboard-chat-door.test.ts`, and importing a `.test.ts` from another `.test.ts` runs its
 * suites twice. This is 25 lines of SSE framing, not a second answer to "what did the child
 * inherit" — the property the no-second-copy law is actually about — and the two are held together
 * by both reading against the same durable session log.
 */
async function readFrames(
  url: string,
  options: {
    readonly lastEventId?: string
    readonly until: (frames: readonly SseFrame[]) => boolean
    readonly budgetMs?: number
  },
): Promise<readonly SseFrame[]> {
  const controller = new AbortController()
  const response = await fetch(url, {
    signal: controller.signal,
    headers: options.lastEventId === undefined ? {} : { 'Last-Event-ID': options.lastEventId },
  })
  if (response.body === null) throw new TypeError('the stream carried no body')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const frames: SseFrame[] = []
  let raw = ''
  const deadline = Date.now() + (options.budgetMs ?? 20_000)
  try {
    while (!options.until(frames) && Date.now() < deadline) {
      const chunk = await reader.read()
      if (chunk.done) break
      raw += decoder.decode(chunk.value, { stream: true })
      const parts = raw.split('\n\n')
      raw = parts.pop() ?? ''
      for (const part of parts) {
        if (part.trim() === '' || part.startsWith(':')) continue
        const lines = part.split('\n')
        frames.push({
          id: lines.find((line) => line.startsWith('id: '))?.slice(4),
          event: lines.find((line) => line.startsWith('event: '))?.slice(7),
          data: lines.find((line) => line.startsWith('data: '))?.slice(6) ?? '',
        })
      }
    }
  } finally {
    controller.abort()
  }
  return frames
}

interface WireDrive {
  readonly origin: string
  readonly root: string
  readonly sessionId: string | undefined
  readonly httpStatuses: readonly number[]
  readonly turns: readonly ChatTurnBody[]
  readonly comparand: Comparand
}

/** Just enough of the served turn body for the anchors to thread a session and read a status. */
interface ChatTurnBody {
  readonly result?: {
    readonly sessionId?: string
    readonly turnId?: string
    readonly status?: string
  }
}

/**
 * Stand the SHIPPED dashboard up, type the given lines at it over a real socket, and read what the
 * CHILD wrote into its own runtime root.
 *
 * `during` runs with the server still listening, which is what lets the stream anchors do their
 * work before the observations are read and the child is stopped.
 *
 * THE FRESHNESS GUARD IS ASSERTED BEFORE ANYTHING IS SPAWNED, as each cell's own contract: an
 * anchor spawned against a stale build passes and reads as proof of today's source.
 */
async function driveWire(
  label: string,
  lines: readonly string[],
  during?: (live: { readonly origin: string; readonly sessionId: string | undefined }) => Promise<void>,
): Promise<WireDrive> {
  expect(buildFreshness(DASHBOARD_ANCHORED_BUILDS), REBUILD_INSTRUCTION)
    .toEqual({ missing: [], stale: [] })

  const project = dashboardFixtureProject(label)
  const port = await reserveEphemeralPort()
  let dashboard: SpawnedDashboard & { ready: boolean }
  dashboard = await spawnDashboard(project.root, project.configPath, port)
  expect(
    dashboard.ready,
    `the built \`agent-qa dashboard\` command never reported that it was listening for the ${label} `
    + `anchor. its stdout: ${JSON.stringify(dashboard.stdout().slice(-1200))}; its stderr: `
    + `${JSON.stringify(dashboard.stderr().slice(-1200))}`,
  ).toBe(true)

  const httpStatuses: number[] = []
  const turns: ChatTurnBody[] = []
  let sessionId: string | undefined
  try {
    for (const line of lines) {
      const response = await fetch(`${dashboard.origin}/api/chat/turn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          sessionId === undefined ? { message: line } : { message: line, sessionId },
        ),
      })
      httpStatuses.push(response.status)
      const body = await response.json() as ChatTurnBody
      turns.push(body)
      if (typeof body.result?.sessionId === 'string') sessionId = body.result.sessionId
    }
    if (during !== undefined) await during({ origin: dashboard.origin, sessionId })
  } finally {
    await dashboard.stop()
  }

  return {
    origin: dashboard.origin,
    root: project.root,
    sessionId,
    httpStatuses,
    turns,
    comparand: comparandOf(readRuntimeObservations(join(project.root, '.agent-qa'))),
  }
}

/**
 * The in-process half: the shipped composer and the shipped router, in THIS process.
 *
 * It is handed a project built from the SAME recipe the spawned half gets, in its own temp root.
 * See `driveDashboardLines`'s `fixture` parameter for why that is load-bearing rather than tidy.
 */
async function driveSeam(
  lines: readonly string[],
): Promise<ReturnType<typeof readRuntimeObservations>> {
  const project = dashboardFixtureProject('seam')
  const observed = await driveDashboardLines(lines, undefined, { configPath: project.configPath })
  return {
    receipts: observed.receipts,
    results: observed.results,
    auditRows: observed.auditRows,
    unhandled: observed.unhandled,
  }
}

/** Every event the CHILD's own session log carries, in file order — the durable truth. */
function loggedEvents(root: string, sessionId: string): readonly Record<string, unknown>[] {
  return readFileSync(join(root, '.agent-qa', 'sessions', `${sessionId}.jsonl`), 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    // The first line is the session HEADER, which carries no `kind` and is not an event.
    .filter((record) => typeof record['kind'] === 'string')
}

// ---- The anchors --------------------------------------------------------------------------------

describe('the served wire is the in-process seam (400-09, D-09)', () => {
  it('carries a `/fn` turn to the same receipts, results and gate rows the seam records',
    async () => {
      const wire = await driveWire('turn', [ANCHOR_CLAUSE])
      const seam = comparandOf(
        // The in-process driver, unchanged — same shipped composer, same shipped router, same
        // reader, and now the SAME FIXTURE RECIPE in its own temp root, so a receipt's content
        // (`config.get` reports an entry count) cannot differ for a reason that is about the
        // project rather than about the door.
        await driveSeam([ANCHOR_CLAUSE]),
      )

      // NON-VACUITY FIRST. An anchor comparing two empty observations is green on a build where
      // neither side ran anything at all, which is the failure mode this whole file exists to
      // catch one layer up.
      expect(
        wire.comparand.receipts.length,
        'the spawned dashboard filed no receipt at all, so the comparison below would be between '
        + `two empty lists. its stdout: ${JSON.stringify(wire.turns)}`,
      ).toBeGreaterThan(0)
      expect(wire.httpStatuses, 'the door answered a dispatched turn with an HTTP error')
        .toEqual([200])

      expect(
        wire.comparand,
        'the SHIPPED dashboard binary and the in-process door disagree about what one `/fn` turn '
        + 'did. everything between them is the shipped command path: argument parsing, config '
        + 'resolution, the dynamic dashboard import, the database, and `startServer`\'s own routing',
      ).toEqual(seam)

      // And the wire really carried the op, rather than two doors agreeing on a refusal.
      expect(wire.comparand.receipts[0]?.status).toBe('executed')
      expect(wire.comparand.resultOps).toEqual([ANCHOR_OP])
    }, 300_000)

  it('streams the turn\'s events over a real socket and replays them across a real disconnect',
    async () => {
      let live: { frames: readonly SseFrame[]; resumed: readonly SseFrame[] } | undefined
      const wire = await driveWire('stream', [ANCHOR_CLAUSE], async ({ origin, sessionId }) => {
        expect(sessionId, 'the turn minted no session, so there is no stream to open').toBeDefined()
        const streamUrl = `${origin}/api/chat/sessions/${String(sessionId)}/events`

        const frames = await readFrames(streamUrl, {
          until: (seen) => seen.some((frame) => frame.event === 'turn_complete'),
        })
        // THE DISCONNECT IS REAL: `readFrames` aborted the socket in its own `finally`, which is
        // what a closing browser tab does. The reconnect below is therefore a second connection to
        // a server that has already lost the first one.
        const seenThrough = frames[0]?.id
        const resumed = seenThrough === undefined ? [] : await readFrames(streamUrl, {
          lastEventId: seenThrough,
          until: (seen) => seen.some((frame) => frame.event === 'turn_complete'),
        })
        live = { frames, resumed }
      })

      expect(live, 'the stream half never ran').toBeDefined()
      if (live === undefined) return
      expect(wire.sessionId).toBeDefined()

      // THE COMPARAND IS THE CHILD'S OWN LOG, not a list written here. A stream that dropped an
      // event, reordered two or invented one differs from the file the turn appended, and nothing
      // else can say so.
      const logged = loggedEvents(wire.root, String(wire.sessionId))
      expect(
        logged.length,
        'the spawned turn appended nothing, so this cell would be asserting about an empty stream',
      ).toBeGreaterThan(1)
      expect(live.frames.map((frame) => frame.event)).toEqual(logged.map((record) => record['kind']))
      expect(live.frames.map((frame) => JSON.parse(frame.data) as unknown)).toEqual(logged)

      // The ids are the replay currency: present, distinct, ascending.
      const ids = live.frames.map((frame) => Number(frame.id))
      expect(ids.every((id) => Number.isInteger(id))).toBe(true)
      expect(ids).toEqual([...ids].sort((left, right) => left - right))
      expect(new Set(ids).size).toBe(ids.length)

      // REPLAY CONTINUITY: nothing at or before the id the client acknowledged, and everything
      // after it, in the same order, byte for byte.
      const seenThrough = Number(live.frames[0]?.id)
      expect(
        live.resumed.map((frame) => Number(frame.id)).filter((id) => id <= seenThrough),
        'the replay re-sent an event the client had already acknowledged',
      ).toEqual([])
      expect(
        live.resumed,
        'the replay left a gap: the reconnect did not deliver every event after the acknowledged id',
      ).toEqual(live.frames.filter((frame) => Number(frame.id) > seenThrough))
    }, 300_000)

  it('refuses a pinned op over the wire exactly as the seam does, with a real gate row',
    async () => {
      const wire = await driveWire('refusal', [`/pin ${ANCHOR_PIN}`, ANCHOR_CLAUSE])
      const seam = comparandOf(
        await driveSeam([`/pin ${ANCHOR_PIN}`, ANCHOR_CLAUSE]),
      )

      // THE GATE'S OWN ROW, on the wire side, before any comparison. `evaluate()` is the single
      // audit author and it is reached from exactly one call site, so a capability that refused
      // without going through the gate lands NO row — and a cell that only compared receipts could
      // not tell that apart from a real refusal.
      const denials = wire.comparand.auditRows.filter((row) => row.outcome === SESSION_PIN_DENIED)
      expect(
        denials,
        'the spawned dashboard filed no `session-pin-denied` execution-audit row, so either the '
        + 'pin never reached the gate or the refusal came from somewhere the gate never saw',
      ).toHaveLength(1)
      expect(denials[0]?.action).toBe(ANCHOR_PIN)
      expect(denials[0]?.verdict).toBe('deny')

      // A 200 carrying a refusal, never an HTTP error: a door that answered 4xx here would give
      // every client two places to learn what happened, free to disagree.
      expect(wire.httpStatuses, 'a gate denial is a 200 carrying a receipt').toEqual([200, 200])
      expect(
        wire.comparand.receipts.map((receipt) => `${receipt.functionId}:${receipt.status}`),
        'the pinned op was not refused on the wire at all',
      ).toContain(`${ANCHOR_OP}:failed`)
      // The shipped bytes, named: a denial reads `failed`/`FunctionDeniedError`, NOT `refused`.
      // The two words are different facts and this door emits the first one.
      expect(
        wire.comparand.receipts.find((receipt) => receipt.functionId === ANCHOR_OP)?.outcome,
      ).toBe('FunctionDeniedError')
      expect(wire.comparand.resultOps, 'a refused clause produced a result').toEqual([])

      expect(
        wire.comparand,
        'the SHIPPED dashboard binary and the in-process door disagree about a REFUSAL, which is '
        + 'the direction a green suite is least likely to have measured',
      ).toEqual(seam)
    }, 300_000)
})

describe('what these anchors CANNOT see, measured rather than assumed (400-09)', () => {
  it('finds no execution context on any gate row — the posture axis is unmeasurable today',
    async () => {
      // A WINDOW'S BOUNDARY, DRIVEN (400-07's idiom). This is not an assertion that the absence is
      // correct; it is the absence RECORDED, so that the comparand's claim about posture is honest
      // and so that the day a row starts carrying a context is a day this cell reds and somebody
      // reads this paragraph. Until then, no conformance comparison anywhere in this repository can
      // see two doors resolve a different execution context — which is exactly what a mutation of
      // the shipped command's `resolveExecutionContext` proved by staying green.
      const wire = await driveWire('posture', [ANCHOR_CLAUSE])
      expect(
        wire.comparand.auditRows.length,
        'the drive landed no gate rows at all, so this cell would be reporting about nothing',
      ).toBeGreaterThan(0)
      expect(
        wire.comparand.auditRows.map((row) => row.executionContext),
        'a gate row now carries an execution context. THIS IS GOOD NEWS: the anchors\' comparand '
        + 'already projects the field, so it starts discriminating a posture divergence the moment '
        + 'this cell reds. Delete this cell, close WINDOWS #197, and re-run the '
        + '`resolveExecutionContext` mutation to confirm the anchors now see it.',
      ).toEqual(wire.comparand.auditRows.map(() => undefined))
    }, 300_000)
})

describe('what these anchors are allowed to read (400-09, source assertion)', () => {
  /** This file's EXECUTABLE text — comments stripped, on `parity.test.ts`'s idiom. */
  function executableSource(source: string): string {
    return source
      .replace(/\/\*[\s\S]*?\*\//gu, '')
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('//'))
      .join('\n')
  }

  /**
   * The sentinel this scan stops at, and why the scan needs one at all.
   *
   * A whole-file scan for the tokens a render scrape uses is guaranteed red, because THIS describe
   * block names every one of them — in its own prohibition list and in the planted control below.
   * That is not a technicality to route around quietly: a scan whose subject includes its own text
   * measures its own text. So the boundary is explicit and named — the scan reads the ANCHORS, and
   * stops where the cell that scans them begins — and the slice is asserted non-empty and
   * recognisable before anything is concluded from it, so a sentinel that stopped matching cannot
   * quietly turn this into a scan of nothing.
   */
  const SCAN_SENTINEL = "describe('what these anchors are allowed to read"

  /**
   * The vocabulary a render scrape would have to use — declared BELOW the sentinel on purpose, so
   * naming a token here can never be what makes the scan above fire.
   */
  const RENDER_SCRAPE_TOKENS = ['textContent', 'innerHTML', 'querySelector', '.locator('] as const

  function anchorSource(): string {
    const whole = readFileSync(join(CONFORMANCE_DIR, 'dashboard-anchors.test.ts'), 'utf8')
    const boundary = whole.indexOf(SCAN_SENTINEL)
    expect(
      boundary,
      `the scan sentinel ${JSON.stringify(SCAN_SENTINEL)} is no longer in this file, so the slice `
      + 'below would be the whole file (guaranteed red) or nothing (guaranteed green)',
    ).toBeGreaterThan(0)
    return executableSource(whole.slice(0, boundary))
  }

  it('reads the session log and the execution audit, and scrapes no render', () => {
    const source = anchorSource()

    // THE SLICE IS REAL, asserted before anything is concluded from its absences. A slice that had
    // silently become empty would satisfy every `not.toContain` below and report a green.
    expect(
      source.length,
      'the anchor slice is empty, so every prohibition below is vacuously satisfied',
    ).toBeGreaterThan(2_000)
    expect(source, 'the anchor slice does not contain the anchors').toContain('driveWire(')

    // ONE READER, SHARED. The comparand comes from the same function the in-process driver uses,
    // which is what makes an anchor's subject the two doors rather than two reading recipes.
    expect(
      source,
      'the anchors stopped reading their comparand through the shared session-log/audit reader',
    ).toContain('readRuntimeObservations(')

    // AND NO RENDER SCRAPE. 395's lesson is that a cell asserting on the wrong surface can be green
    // while the shipped channel leaks; the mirror-image failure is an anchor that reads a rendered
    // line and calls it a record. These anchors are about the RECORD; the render is plan 09's DOM
    // file, in a real browser, which is a different question asked in a different medium.
    for (const scrape of RENDER_SCRAPE_TOKENS) {
      expect(source, `an anchor reads a render through \`${scrape}\``).not.toContain(scrape)
    }
  })

  it('would SEE a scrape if one were added (planted-violation control)', () => {
    // TWO WAYS THIS SCAN COULD BE DECORATION, both driven. (1) The stripper is strong enough to
    // swallow a comment, so it could be strong enough to swallow the executable line it was meant
    // to leave — 400-08's measured false positive, in mirror image. (2) The token list could stop
    // matching the thing it names. So a violation is planted in each of the shapes a real one
    // would take, and the scan is required to see every one of them.
    for (const token of RENDER_SCRAPE_TOKENS) {
      const planted = executableSource(
        `// a comment that mentions ${token} and must not fire\n`
        + '/* a block comment mentioning it too */\n'
        + `const scraped = page${token.startsWith('.') ? token : `.${token}`}('[data-x]')\n`,
      )
      expect(planted, 'the stripper swallowed executable code').toContain(token)
      expect(planted, 'the stripper left a line comment behind').not.toContain('must not fire')
      expect(planted, 'the stripper left a block comment behind').not.toContain('block comment')
    }
  })
})
