// THE SERVICE DOOR'S REJECTION CELLS (Phase 402 plan 06, D-05 / D-06 · INVK-03).
//
// 2026-10-01 (432-21, D-12/D-13): TOKENLESS. The run-service tokens, their resolver, the door's
// `verifyBearer` port and the trust scope a token carried are deleted. Every cell below that
// measured a bearer refusal is RE-SPELLED in place to the request the door still refuses — a
// cross-site one, refused by the dashboard's shared same-site guard above the route table — or to
// the tokenless success that replaced it. The production refusal, the never-forwarded run id and
// the live-view signature's compare discipline are unchanged claims; 441-58 (D-01, D-12) deleted the
// cells that had a run mask a door's or the environment's values.
//
// THE FRAME, STATED: every wire cell below drives the PRODUCTION COMPOSITION over real TCP —
// `startServer` with `runService` from `composeRunServicePorts`, over a host from
// `composeDashboardDoor` and a run door from `createDashboardRunDoor`. Same boot as 402-01's
// `run-service-door.e2e.test.ts`, parameterised on the two axes this file turns: the declared
// target's ENVIRONMENT (which decides the run's risk tier) and the credential's TRUST SCOPE
// (which decides whether the gate's credential arm can satisfy the ask).
//
// 402-01 proved DELIVERY: a valid credential starts a run and its envelopes arrive. This file
// proves the other half — that every guard the door ships is exercised on inputs it REFUSES, and
// that a refusal says the same thing whatever it refused.
//
// WHAT THIS FILE DOES NOT CARRY. The behavioural half of the compare-discipline pin lives in
// `run-service-compare-discipline.test.ts`, which replaces `node:crypto` for its whole module
// graph — a thing this file may not do, because it boots a database, a dashboard host and a TCP
// server, all of which hash. What is here is that claim's SOURCE half: the shape of the scan and
// the number of compare SITES, read off the file with comments and string literals removed so that
// neither an import line nor a JSDoc mention can satisfy or break it (the failure this phase has
// already paid for twice — 402-01's `timingSafeEqual` grep answered 2, 402-03's
// `resolveEffectiveWorkers` grep passed a mutation that deleted the expression entirely).

import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import type { Server } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inspect } from 'node:util'

import {
  RUN_SERVICE_ROUTE_TABLE,
} from '@vostride/agent-qa-dashboard'
import { RunServiceErrorBodySchema } from '@vostride/agent-qa-schema'
import { generateTestId } from '@vostride/agent-qa-ids'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  composeDashboardDoor,
  composeRunServicePorts,
  createDashboardRunDoor,
} from '../commands/dashboard.js'

/**
 * A bearer value a pre-432 client might still present, hunted for in every captured channel.
 *
 * THE VARIABLE NAME CARRIES NO SUFFIX `sensitiveEnvSlice` RECOGNISES, deliberately: a probe called
 * `PROBE_API_TOKEN` would be masked by machinery that has nothing to do with this door.
 */
const TOKEN = 'zz-402-06-planted-run-credential-4b91ce'
const TOKEN_VAR = 'AGENT_QA_402_06_RUN_CRED'

/** 432-21: what the door refuses before its route table — the shared same-site guard's rungs. */
const CROSS_SITE_CLASSES = [
  { id: 'foreign Origin', headers: { Origin: 'https://evil.example' } as Record<string, string> },
  { id: 'null Origin', headers: { Origin: 'null' } as Record<string, string> },
  { id: 'cross-site fetch metadata', headers: { 'Sec-Fetch-Site': 'cross-site' } as Record<string, string> },
] as const

/** 432-21: legacy Authorization shapes a pre-432 client may send. None is read, none is refused. */
const LEGACY_HEADER_CLASSES = [
  { id: 'absent header', headers: {} as Record<string, string> },
  { id: 'malformed scheme', headers: { Authorization: `Basic ${TOKEN}` } as Record<string, string> },
  { id: 'well-formed legacy bearer', headers: { Authorization: `Bearer ${TOKEN}` } as Record<string, string> },
] as const

interface WorkspaceInput {
  /** `undefined` writes NO declaration, which classifies the run's target as shared. */
  readonly environment?: 'local' | 'production'
}

/** The 402-01 fixture project, with the target's environment as the knob (432-21: no token block). */
function fixtureWorkspace(input: WorkspaceInput = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'agent-qa-402-06-'))
  const configPath = join(root, 'agent-qa.config.yaml')
  writeFileSync(
    configPath,
    `${JSON.stringify({
      workspace: {
        testMatch: ['tests/**/*.test.yaml'],
        suiteMatch: ['suites/**/*.suite.yaml'],
        hooksFile: 'hooks.yaml',
        envFile: '.env',
        secretsFile: '.env.secrets.local',
      },
      use: { mobile: { appState: 'reset' } },
      registry: {
        targets: {
          conformance: {
            platform: 'web',
            url: 'https://conformance.invalid',
            // THE ONE AXIS THE DENIAL CELLS TURN. Since 432 (D-18) the only run the core refuses is
            // a `production` target without the config opt-in; `local` and undeclared targets run.
            ...(input.environment === undefined ? {} : { environment: input.environment }),
          },
        },
      },
    })}\n`,
    'utf8',
  )
  writeFileSync(join(root, '.env'), '', 'utf8')
  writeFileSync(join(root, '.env.secrets.local'), '', 'utf8')
  writeFileSync(join(root, 'hooks.yaml'), 'hooks: []\n', 'utf8')
  mkdirSync(join(root, 'tests'), { recursive: true })
  writeFileSync(
    join(root, 'tests', 'probe.test.yaml'),
    'name: The run service hardening probe\n'
    + `test-id: ${generateTestId()}\n`
    + 'target: conformance\n'
    + 'steps:\n'
    + '  - Do nothing this run will ever reach\n',
    'utf8',
  )
  return configPath
}

interface ServiceFixture {
  readonly origin: string
  readonly configDir: string
  readonly close: () => Promise<void>
}

const openFixtures: ServiceFixture[] = []

/** The composition `agent-qa dashboard` performs, on an ephemeral port over a temp project. */
async function openRunService(input: WorkspaceInput = {}): Promise<ServiceFixture> {
  const configPath = fixtureWorkspace(input)
  const configDir = dirname(resolve(configPath))
  const { DashboardDatabase, startServer } = await import('@vostride/agent-qa-dashboard')
  const db = new DashboardDatabase({ dbPath: join(configDir, 'dashboard.db') })
  const runDoor = await createDashboardRunDoor({ db })
  let boundOrigin: string | undefined
  const { agentHost, host } = composeDashboardDoor({
    agentQaRoot: join(configDir, '.agent-qa'),
    configPath,
    boundOrigin: () => boundOrigin,
    runBridge: runDoor.runBridge,
  })
  runDoor.bindHost(host)

  const runService = composeRunServicePorts({ door: runDoor })

  const started = await startServer({
    db,
    port: 0,
    configPath,
    agentHost,
    executionBackend: runDoor.backend,
    runService: runService.ports,
    runServiceReadiness: runService.readiness,
  })
  const server = started.server as Server
  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new TypeError('the run service bound no port')
  }
  boundOrigin = `http://127.0.0.1:${String(address.port)}`

  const fixture: ServiceFixture = {
    origin: boundOrigin,
    configDir,
    close: async () => {
      started.close()
      runService.dispose()
      await host.close()
      rmSync(configDir, { recursive: true, force: true })
    },
  }
  openFixtures.push(fixture)
  return fixture
}

afterEach(async () => {
  while (openFixtures.length > 0) {
    await openFixtures.pop()?.close().catch(() => undefined)
  }
})

/** Every run directory under this project that produced an event log — i.e. a run that RAN. */
function runsThatProducedEvents(configDir: string): readonly string[] {
  const runsRoot = join(configDir, '.agent-qa', 'runs')
  let dirs: string[]
  try {
    dirs = readdirSync(runsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch {
    return []
  }
  return dirs.filter((dir) => {
    try {
      readFileSync(join(runsRoot, dir, 'events.jsonl'))
      return true
    } catch {
      return false
    }
  })
}

// ---- (1) THE REFUSAL CENSUS -------------------------------------------------------------------
//
// EVERY ROW OF THE MODULE'S OWN ROUTE TABLE, TIMES EVERY FAILURE CLASS. The denominator is read off
// `RUN_SERVICE_ROUTE_TABLE`, so a fourth route added tomorrow joins this corpus without anybody
// editing the cell — which is the whole reason 402-01 published the table as data.

/** A row's template turned into a concrete request target. */
function probeTargetsFor(row: (typeof RUN_SERVICE_ROUTE_TABLE)[number]): readonly string[] {
  if (row.pattern === undefined) return [row.path]
  const concrete = row.path.replace(/:([A-Za-z0-9_]+)/g, 'r_census-probe')
  // THE TEMPLATED ROW IS DRIVEN THREE WAYS, and the third one is load-bearing. 402-04 added a
  // `?handle=` parameter with two refusals of its own, both answered before any stream header —
  // which puts them in the same region of the dispatch as the guard. A WELL-FORMED handle does not
  // discriminate the ordering at all (a mutation that validated the handle above the guard survived
  // a census that drove only `?handle=1`, measured). The MALFORMED one does: it is the input the
  // early check would refuse 400 on, so a census that drives it proves the guard still stands first
  // — and therefore that a handle refusal cannot be used as a run-existence oracle by a page on
  // another origin.
  return [concrete, `${concrete}?handle=1`, `${concrete}?handle=not-a-number`]
}

// RE-SPELLED 2026-10-01 (432-21, D-12/D-13). The census's classes were the three ways to fail to
// present a declared credential, answered 401; they are now the three rungs of the same-site guard,
// answered 403 `cross_site_refused`. The denominator, the shape law and the no-grant law are the
// census's own and unchanged.
describe('the refusal census: every route on the table, every failure class (D-06)', () => {
  it('refuses all of them 403 with a body that is shape-identical beyond the reason', async () => {
    const service = await openRunService({ environment: 'local' })

    // NON-VACUITY, FIRST. A census over an empty or shrunken table would pass by driving nothing.
    expect(RUN_SERVICE_ROUTE_TABLE.length).toBeGreaterThanOrEqual(3)

    const observed: { probe: string; status: number; keys: readonly string[]; error: string }[] = []
    for (const row of RUN_SERVICE_ROUTE_TABLE) {
      for (const target of probeTargetsFor(row)) {
        for (const failure of CROSS_SITE_CLASSES) {
          const response = await fetch(`${service.origin}${target}`, {
            method: row.method,
            headers: failure.headers,
            ...(row.method === 'POST' ? { body: '{}' } : {}),
          })
          const body = RunServiceErrorBodySchema.parse(await response.json())
          observed.push({
            probe: `${row.method} ${target} / ${failure.id}`,
            status: response.status,
            keys: Object.keys(body),
            error: body.error,
          })
          expect(response.status, observed.at(-1)!.probe).toBe(403)
          expect(body.error, observed.at(-1)!.probe).toBe('cross_site_refused')
          // No cross-origin grant on a refusal, on any route.
          expect(response.headers.get('access-control-allow-origin')).toBeNull()
          expect(response.headers.get('content-type')).toContain('application/json')
        }
      }
    }

    // THE DENOMINATOR IS THE TABLE'S, not a number written here: every row, every probe target,
    // every failure class, and the arithmetic is stated so a silently-skipped row cannot pass.
    const expectedProbes = RUN_SERVICE_ROUTE_TABLE
      .reduce((total, row) => total + probeTargetsFor(row).length, 0) * CROSS_SITE_CLASSES.length
    expect(observed.length).toBe(expectedProbes)

    // SHAPE-IDENTICAL. One key, the same key, on every route and every class — so a refused caller
    // cannot fingerprint the route map or a run's existence by diffing bodies.
    const shapes = new Set(observed.map((row) => JSON.stringify(row.keys)))
    expect([...shapes]).toEqual(['["error"]'])
    const statuses = new Set(observed.map((row) => row.status))
    expect([...statuses]).toEqual([403])
    // And the WORD is one word, whatever the route or the rung.
    expect([...new Set(observed.map((row) => row.error))]).toEqual(['cross_site_refused'])
  }, 60_000)

  it('C432-TOKENLESS-RUN-SERVICE: a legacy Authorization header is neither needed nor read', async () => {
    const service = await openRunService({ environment: 'local' })
    const answers: string[] = []
    for (const legacy of LEGACY_HEADER_CLASSES) {
      const response = await fetch(`${service.origin}/ok`, { headers: legacy.headers })
      expect(response.status, legacy.id).toBe(200)
      answers.push(await response.text())
    }
    // Byte-identical answers: nothing about the header reached the door's decision or its body.
    expect(new Set(answers).size).toBe(1)
    expect(JSON.parse(answers[0]!)).toMatchObject({ service: 'up' })
    expect(Object.keys(JSON.parse(answers[0]!)).sort()).toEqual(['contractVersion', 'hostComposed', 'service'])
    expect(answers.join('\n')).not.toContain(TOKEN)
  }, 30_000)

  it('refuses a path NO row matches identically, so the table itself does not leak', async () => {
    const service = await openRunService({ environment: 'local' })
    for (const failure of CROSS_SITE_CLASSES) {
      const response = await fetch(`${service.origin}/run/not-a-route/at-all`, {
        headers: failure.headers,
      })
      expect(response.status).toBe(403)
      expect(await response.json()).toEqual({ error: 'cross_site_refused' })
    }
  }, 30_000)
})

// ---- (2) THE GATE DENIAL, RENDERED ON THE WIRE ------------------------------------------------
//
// THE MEASUREMENT WINDOWS #227 ASKED FOR, history kept: 402-01 recorded that a declared token's
// TrustScope reached `FunctionCaller.credential` and `evaluate()` read it. Both are deleted (432-13
// for the gate, 432-21 for the token and the credential).

// RE-SPELLED 2026-09-30 (432-13, D-14/D-18). No gate weighs the run over this door any more: an
// undeclared target starts under either declared scope, and the one refusal left is an un-opted-in
// production target, which answers the same typed 403 this describe always measured.
describe('a credential whose scope does not satisfy the gate is DENIED over the wire', () => {
  it('answers 403 with the typed denial, and no run is recorded', async () => {
    const service = await openRunService({ environment: 'production' })
    const response = await fetch(`${service.origin}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ patterns: ['tests/probe.test.yaml'] }),
    })

    // NOT 500 — a policy denial is a decision, not a crash. NOT 2xx — production without the config
    // opt-in never starts (D-18), whoever asks.
    expect(response.status).toBe(403)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(response.headers.get('access-control-allow-origin')).toBeNull()

    const body = (await response.json()) as Record<string, unknown>
    expect(body.error).toBe('run_denied')
    expect(typeof body.neutralReason).toBe('string')
    expect((body.neutralReason as string).length).toBeGreaterThan(0)
    // 432-19 (D-15): the body is the code and the plain reason, and no remedy list rides it.
    expect(Object.keys(body).sort()).toEqual(['error', 'neutralReason'])

    // THE 399 DEFECT, ASSERTED CLOSED. `--trust-session` is declared on exactly one CLI command;
    // the gate's CANONICAL reason names it verbatim on this arm. A door that echoed that sentence
    // would be handing a remote HTTP client a flag it has no way to pass.
    expect(JSON.stringify(body)).not.toContain('--trust-session')
    expect(JSON.stringify(body)).not.toContain('re-run locally')

    // NO DURABLE RUN. A denied run never started, so nothing produced an event log.
    expect(runsThatProducedEvents(service.configDir)).toEqual([])
  }, 60_000)

  it('still 404s the stream for the run that was never started', async () => {
    const service = await openRunService({ environment: 'production' })
    await fetch(`${service.origin}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ patterns: ['tests/probe.test.yaml'] }),
    })
    const stream = await fetch(`${service.origin}/run/r_denied-never-started/events`)
    expect(stream.status).toBe(404)
    expect(stream.headers.get('content-type')).toContain('application/json')
    expect(stream.headers.get('content-type')).not.toContain('text/event-stream')
    expect(await stream.json()).toEqual({ error: 'unknown_run' })
  }, 60_000)

  // RE-SPELLED 2026-10-01 (432-21, D-12) from 'WINDOWS #227 — the declared scope makes NO difference:
  // an undeclared target starts under either'. No scope can be declared; the same undeclared run
  // starts with no header and with a legacy bearer header alike.
  it('WINDOWS #227 — no credential makes a difference: an undeclared target starts with or without a legacy bearer', async () => {
    for (const legacy of [LEGACY_HEADER_CLASSES[0], LEGACY_HEADER_CLASSES[2]]) {
      const service = await openRunService({})
      const response = await fetch(`${service.origin}/run`, {
        method: 'POST',
        headers: { ...legacy.headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ patterns: ['tests/probe.test.yaml'] }),
      })
      expect(response.status, legacy.id).toBe(202)
      const ack = (await response.json()) as { runId?: string }
      expect(typeof ack.runId).toBe('string')
    }
  }, 180_000)

  it('THE TIER CONTROL — the same request against a LOCAL target is acked and recorded', async () => {
    // ONE FIELD DIFFERENT from the denial cell: the target's declared environment. This is what
    // makes "denied, and nothing ran" a fact about the policy decision rather than about a fixture
    // that cannot run anything.
    const service = await openRunService({ environment: 'local' })
    const response = await fetch(`${service.origin}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ patterns: ['tests/probe.test.yaml'] }),
    })
    expect(response.status).toBe(202)
    const ack = (await response.json()) as { runId?: string }
    expect(typeof ack.runId).toBe('string')
    expect(runsThatProducedEvents(service.configDir).length).toBeGreaterThan(0)
  }, 180_000)

  // 432-21 (D-12, EDGE-17): two concurrent tokenless starts are two runs, each under the id the core
  // minted for it — no request can choose an id, and no request shares another's.
  it('C432-TOKENLESS-RUN-SERVICE: two concurrent tokenless starts get two distinct core-minted run ids', async () => {
    const service = await openRunService({ environment: 'local' })
    const start = () => fetch(`${service.origin}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ patterns: ['tests/probe.test.yaml'] }),
    })
    const responses = await Promise.all([start(), start()])
    expect(responses.map((response) => response.status)).toEqual([202, 202])
    const ids = await Promise.all(responses.map(async (response) => ((await response.json()) as { runId: string }).runId))
    expect(ids.every((id) => typeof id === 'string' && id.length > 0)).toBe(true)
    expect(new Set(ids).size).toBe(2)
  }, 180_000)
})

// ---- (3) THE COMPARE DISCIPLINE, SOURCE HALF --------------------------------------------------
//
// 2026-10-01 (432-21, D-12/D-13): the bearer compare module is deleted. The secret compare the run
// service still depends on is the live-view link signature (`live-url-signer.ts`), which D-13
// keeps; the source half is measured there, and a census pins that no other CLI module grew a
// second constant-time compare of a credential.

const TOKEN_MODULE = fileURLToPath(
  new URL('../composition/live-url-signer.ts', import.meta.url),
)

/**
 * The module's CODE, with comments and string/template literals removed.
 *
 * WHY THE STRIPPING IS THE POINT. Every source pin this phase has written and then watched survive
 * a mutation failed for one of two reasons: an import line counted as a use, or a JSDoc mention
 * counted as a use. Both live in text this function deletes. What is left is a stream in which
 * `name(` is an actual call expression, and a count over it means what it says.
 */
function codeOf(source: string): string {
  let out = ''
  let i = 0
  while (i < source.length) {
    const two = source.slice(i, i + 2)
    if (two === '//') {
      const end = source.indexOf('\n', i)
      i = end === -1 ? source.length : end
      continue
    }
    if (two === '/*') {
      const end = source.indexOf('*/', i + 2)
      i = end === -1 ? source.length : end + 2
      out += ' '
      continue
    }
    const ch = source[i]!
    if (ch === '\'' || ch === '"' || ch === '`') {
      i += 1
      while (i < source.length && source[i] !== ch) {
        if (source[i] === '\\') i += 1
        i += 1
      }
      i += 1
      out += '""'
      continue
    }
    out += ch
    i += 1
  }
  return out
}

/** Count CALL expressions of a name — `name(`, not `name` and not `import { name }`. */
function callsTo(code: string, name: string): number {
  const declaration = new RegExp(`function\\s+${name}\\s*\\(`, 'g')
  const withoutDeclarations = code.replace(declaration, 'function DECLARATION_OF(')
  return (withoutDeclarations.match(new RegExp(`\\b${name}\\s*\\(`, 'g')) ?? []).length
}

describe('the compare discipline is source-pinned, on stripped CODE (T-402-20)', () => {
  const code = codeOf(readFileSync(TOKEN_MODULE, 'utf8'))

  it('has EXACTLY ONE timingSafeEqual call site — and the import line is not one of them', () => {
    expect(callsTo(code, 'timingSafeEqual')).toBe(1)
    // The raw grep, recorded here so the discrepancy is a fact in the suite rather than a surprise.
    const raw = (readFileSync(TOKEN_MODULE, 'utf8').match(/timingSafeEqual/g) ?? []).length
    expect(raw).toBeGreaterThan(1)
  })

  // RE-SPELLED from 'routes every credential comparison through the ONE named compare function':
  // the signer's `equals` is the one compare, and its width guard precedes the primitive.
  it('routes every credential comparison through the ONE named compare function', () => {
    expect((code.match(/\bequals\s*\(/g) ?? []).length).toBe(1)
    const guard = code.indexOf('left.length !== right.length')
    const primitive = code.indexOf('timingSafeEqual(left, right)')
    expect(guard).toBeGreaterThan(-1)
    expect(primitive).toBeGreaterThan(guard)
  })

  it('compares a credential value NOWHERE ELSE — no bare equality against an entry', () => {
    expect(/sign\([^)]*\)\s*(===|!==|==|!=)/.test(code)).toBe(false)
    expect(/(===|!==|==|!=)\s*sign\(/.test(code)).toBe(false)
    expect(/\b(left|right)\s*(===|!==)\s*(left|right)\b/.test(code)).toBe(false)
  })

  // RE-SPELLED from 'scans the WHOLE entry list — the loop carries no early exit': there is no
  // declared-credential list left to scan. The census instead pins that the CLI's only
  // constant-time compares are the live-view signature and the display unmask's digest check.
  it('scans the WHOLE entry list — the loop carries no early exit', () => {
    const SRC = fileURLToPath(new URL('..', import.meta.url))
    const callers: string[] = []
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name)
        if (entry.isDirectory()) { if (entry.name !== '__tests__') walk(path) }
        else if (entry.name.endsWith('.ts') && callsTo(codeOf(readFileSync(path, 'utf8')), 'timingSafeEqual') > 0) {
          callers.push(path.slice(SRC.length))
        }
      }
    }
    walk(SRC)
    expect(callers.sort()).toEqual(['composition/display-unmask.ts', 'composition/live-url-signer.ts'])
  })

  it('carries NO permissive arm and no query-parameter carriage', () => {
    expect(code.includes('anonymous')).toBe(false)
    expect(/req\.url|URLSearchParams|searchParams/.test(code)).toBe(false)
  })
})

// ---- (4) THE MASKING SWEEP --------------------------------------------------------------------

/**
 * A door stub carrying what `composeRunServicePorts` reads from one, plus a recorder for a store
 * bound to it. 432-21: the composer binds nothing, and the recorder is how a cell sees that.
 */
function stubDoor(): {
  door: {
    resolveHost: () => undefined
    observeSessions: () => () => void
    bindMaskingSecrets: (store: { forEachSecret(cb: (n: string, v: string) => void): void }) => void
  }
  bound: () => { forEachSecret(cb: (n: string, v: string) => void): void } | undefined
} {
  let bound: { forEachSecret(cb: (n: string, v: string) => void): void } | undefined
  return {
    door: {
      resolveHost: () => undefined,
      observeSessions: () => () => { /* nothing observes this composition */ },
      bindMaskingSecrets: (store) => { bound = store },
    },
    bound: () => bound,
  }
}

/** Every channel a thrown value can reach a person through, as strings. */
function channelsOf(error: unknown): readonly string[] {
  const channels: string[] = [
    String(error),
    inspect(error, { depth: null }),
    inspect(error, { depth: null, showHidden: true }),
    JSON.stringify(error, Object.getOwnPropertyNames(error as object)),
  ]
  if (error instanceof Error) {
    channels.push(error.message, error.stack ?? '', error.name)
  }
  return channels
}

describe('the token value reaches no channel (T-402-21)', () => {
  // RE-SPELLED 2026-10-01 (432-21, D-12) from 'the STARTUP refusal names the variable and never a
  // value, and carries no cause' and 'an EMPTY or whitespace-only value refuses startup identically
  // to an unset one'. The composer reads no declaration and no environment, so there is no startup
  // refusal to leak through: it composes whatever the environment holds, and nothing it returns or
  // throws carries the value.
  it('the composer reads no declaration and no environment, and refuses nothing', () => {
    const previous = process.env[TOKEN_VAR]
    process.env[TOKEN_VAR] = TOKEN
    try {
      for (const value of [TOKEN, '', '   ']) {
        process.env[TOKEN_VAR] = value
        let thrown: unknown
        let composition: ReturnType<typeof composeRunServicePorts> | undefined
        try {
          composition = composeRunServicePorts({ door: stubDoor().door })
        } catch (error) {
          thrown = error
        }
        expect(thrown).toBeUndefined()
        expect(inspect(composition, { depth: 4 })).not.toContain(TOKEN)
        composition?.dispose()
      }
    } finally {
      if (previous === undefined) delete process.env[TOKEN_VAR]
      else process.env[TOKEN_VAR] = previous
    }
  })

  // RE-SPELLED 2026-10-01 (432-21, D-12) from 'a WRONG-token refusal leaks the declared value on no
  // channel a person can read'. A presented bearer is not read; this sweep presents one alongside
  // each cross-site rung and asserts the value reaches no body, header or log line.
  it('a WRONG-token refusal leaks the declared value on no channel a person can read', async () => {
    const service = await openRunService({ environment: 'local' })
    const out: string[] = []
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown) => {
      out.push(String(chunk))
      return true
    }) as never)
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: unknown) => {
      out.push(String(chunk))
      return true
    }) as never)
    let bodies: string[] = []
    try {
      for (const failure of CROSS_SITE_CLASSES) {
        const response = await fetch(`${service.origin}/run`, {
          method: 'POST',
          headers: { ...failure.headers, Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
          body: '{}',
        })
        bodies.push(await response.text())
        bodies.push(JSON.stringify([...response.headers.entries()]))
      }
      // An ADMITTED request carrying the legacy bearer: the readiness answer, which is served.
      const admitted = await fetch(`${service.origin}/ok`, { headers: { Authorization: `Bearer ${TOKEN}` } })
      bodies.push(await admitted.text())
    } finally {
      stdout.mockRestore()
      stderr.mockRestore()
    }

    for (const channel of [...bodies, ...out]) {
      expect(channel).not.toContain(TOKEN)
      // Not even a prefix long enough to shorten a search.
      expect(channel).not.toContain(TOKEN.slice(0, 12))
    }
    // NON-VACUITY: the sweep looked at something. Four responses, each with a body and a header
    // dump, and the bodies are the typed refusals rather than empty strings.
    expect(bodies.length).toBe(CROSS_SITE_CLASSES.length * 2 + 1)
    expect(bodies.filter((body) => body.includes('"cross_site_refused"')).length)
      .toBe(CROSS_SITE_CLASSES.length)
  }, 60_000)
})

// ---- (5) THE SECRET STORE IS CONSUMED (WINDOWS #224, T-402-04) --------------------------------
//
// 402-06 bound the run-service token store into the door's bridge. 432-21 deleted the store, and
// 441-58 (D-01) stopped a door's stores reaching a run's mask, so only the BIND half remains.

describe('the door’s credentials reach every run’s masker (#224)', () => {
  it('BIND HALF — composing the ports seeds the door with the resolved values', () => {
    // RE-SPELLED 2026-10-01 (432-21, D-12): there are no resolved values; the composer binds nothing.
    const recorder = stubDoor()
    const composition = composeRunServicePorts({ door: recorder.door })
    try {
      expect(recorder.bound()).toBeUndefined()
      expect('secretStore' in composition).toBe(false)
    } finally {
      composition.dispose()
    }
  })

  it('BIND HALF — the real door has nothing bound until the composer runs', async () => {
    // RE-SPELLED 2026-10-01 (432-21, D-12): and nothing bound after it runs either.
    const configPath = fixtureWorkspace({ environment: 'local' })
    const configDir = dirname(resolve(configPath))
    const { DashboardDatabase } = await import('@vostride/agent-qa-dashboard')
    const db = new DashboardDatabase({ dbPath: join(configDir, 'bind.db') })
    const runDoor = await createDashboardRunDoor({ db })
    try {
      expect(runDoor.runBridge.maskingSecrets?.()).toBeUndefined()
      const composition = composeRunServicePorts({ door: runDoor })
      expect(runDoor.runBridge.maskingSecrets?.()).toBeUndefined()
      composition.dispose()
    } finally {
      db.close()
      rmSync(configDir, { recursive: true, force: true })
    }
  })
})

// ---- (6) THE SECOND REFUSAL OF `runId` (WINDOWS #231) -----------------------------------------

describe('the door never forwards a caller’s run id, even with its own check bypassed (#231)', () => {
  it('the composition builds the request from patterns ALONE — an injected id is not honoured', async () => {
    // WINDOWS #231 ASKS WHETHER `runId` HAS A SECOND REFUSAL. `RUN_SERVICE_REFUSED_REQUEST_FIELDS`
    // rejects the key at the HTTP door, and the core's `REFUSED_RUN_REQUEST_FIELDS` covers `scope`
    // and `executionContext` a layer down but NOT `runId` — deliberately, because the local
    // dashboard door legitimately supplies one (its queue minted the row). A core-level refusal
    // would break that door, so defence in depth for this field cannot live there.
    //
    // It lives HERE instead, and this cell is what makes that a fact rather than a reading:
    // `composeRunServicePorts` builds its `RunsStartInput` from `patterns` and nothing else, so a
    // value reaching past the HTTP check is dropped by construction. Called directly, which is the
    // only way to bypass that check.
    const configPath = fixtureWorkspace({ environment: 'local' })
    const configDir = dirname(resolve(configPath))
    const { DashboardDatabase } = await import('@vostride/agent-qa-dashboard')
    const db = new DashboardDatabase({ dbPath: join(configDir, 'refusal.db') })
    const runDoor = await createDashboardRunDoor({ db })
    const { host } = composeDashboardDoor({
      agentQaRoot: join(configDir, '.agent-qa'),
      configPath,
      boundOrigin: () => 'http://127.0.0.1:1',
      runBridge: runDoor.runBridge,
    })
    runDoor.bindHost(host)
    const composition = composeRunServicePorts({ door: runDoor })
    try {
      const smuggled = 'r_the-caller-chose-this-id'
      const ack = await composition.ports.invokeRunStart({
        patterns: ['tests/probe.test.yaml'],
        // Past the door's own key check, by construction — this is the input the HTTP layer would
        // have refused, arriving at the composition anyway.
        runId: smuggled,
      } as never)
      expect(ack.runId).not.toBe(smuggled)
      expect(ack.runId).toBeTruthy()
      // The run that actually happened is under the MINTED id, so the smuggled one names nothing.
      expect(runsThatProducedEvents(configDir)).not.toContain(smuggled)
      expect(runsThatProducedEvents(configDir).length).toBeGreaterThan(0)
    } finally {
      composition.dispose()
      await host.close()
      db.close()
      rmSync(configDir, { recursive: true, force: true })
    }
  }, 180_000)
})
