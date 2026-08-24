// THE SERVICE DOOR'S REJECTION CELLS (Phase 402 plan 06, D-05 / D-06 · INVK-03).
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
import {
  RunServiceErrorBodySchema,
  STANDING_APPROVAL_SCOPE,
} from '@vostride/agent-qa-schema'
import type { TrustScope } from '@vostride/agent-qa-schema'
import { generateTestId } from '@vostride/agent-qa-ids'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  RunServiceTokenEnvVarUnsetError,
  runServiceTokenSecretStore,
} from '../composition/run-service-token-resolution.js'
import {
  composeDashboardDoor,
  composeRunServicePorts,
  createDashboardRunDoor,
} from '../commands/dashboard.js'

/**
 * The credential this suite declares, presents and then hunts for in every captured channel.
 *
 * THE VARIABLE NAME CARRIES NO SUFFIX `sensitiveEnvSlice` RECOGNISES, deliberately. That selector
 * masks `…_TOKEN`, `…_KEY`, `…_SECRET` and kin BY NAME; a probe called `PROBE_API_TOKEN` would be
 * masked by machinery that has nothing to do with this door, and both the leak cells and the
 * masking cells would pass for the wrong reason. `…_CRED` matches nothing in that list, which is
 * exactly the case `runServiceTokenSecretStore` exists for.
 */
const TOKEN = 'zz-402-06-planted-run-credential-4b91ce'
const TOKEN_VAR = 'AGENT_QA_402_06_RUN_CRED'
/** A declared variable this suite never sets — the startup-refusal arm. */
const UNSET_VAR = 'AGENT_QA_402_06_NEVER_SET_CRED'

/** The scope a token declares by default: real-looking, and NOT the one the gate can satisfy. */
const PROJECT_SCOPE: TrustScope = { project: 'acme' }

interface WorkspaceInput {
  /** `undefined` writes NO declaration, which classifies the run's target as shared. */
  readonly environment?: 'local'
  readonly trustScope?: TrustScope
  /**
   * Mask this text through each started run's OWN masking context (402-06, #224).
   *
   * The observer is CHAINED onto the door's real bridge rather than replacing it: the spread keeps
   * the door's `onSession` routing, its ingest subscribers and — the point of the cell — its
   * `maskingSecrets` resolver, which is the same closure over the same box `composeRunServicePorts`
   * binds into. What is added is one reader, so the value a reporter would print is observable.
   */
  readonly observeMasking?: { readonly text: string; readonly seen: string[] }
}

/** The 402-01 fixture project, with the target's environment and the token's scope as knobs. */
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
            // THE ONE AXIS THE DENIAL CELLS TURN. A target declared `local` folds to
            // `mutating-local`, which allows in every execution context. An UNDECLARED environment
            // folds to `mutating-shared`, whose tier is `ask` — and the remote door composes no
            // confirm channel, so its context is `local-headless` and `requiresFailClosed` denies
            // unless a trust source satisfies the ask.
            ...(input.environment === undefined ? {} : { environment: input.environment }),
          },
        },
      },
      services: {
        dashboard: {
          runServiceTokens: [
            {
              name: 'ci',
              tokenEnvVar: TOKEN_VAR,
              trustScope: input.trustScope ?? PROJECT_SCOPE,
            },
          ],
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
  const observe = input.observeMasking
  const { agentHost, host, enterRunTriggerScope } = composeDashboardDoor({
    agentQaRoot: join(configDir, '.agent-qa'),
    configPath,
    boundOrigin: () => boundOrigin,
    runBridge: observe === undefined
      ? runDoor.runBridge
      : {
          ...runDoor.runBridge,
          subscribers: (attach) => {
            observe.seen.push(attach.maskingContext.mask(observe.text))
            return runDoor.runBridge.subscribers?.(attach)
          },
        },
  })
  runDoor.bindHost(host)
  runDoor.bindTriggerScope(enterRunTriggerScope)

  const runService = composeRunServicePorts({
    entries: [{
      name: 'ci',
      tokenEnvVar: TOKEN_VAR,
      trustScope: input.trustScope ?? PROJECT_SCOPE,
    }],
    env: { [TOKEN_VAR]: TOKEN },
    door: runDoor,
  })

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

/** The three ways a caller can fail to present a declared credential. */
const FAILURE_CLASSES = [
  { id: 'absent header', headers: {} as Record<string, string>, reason: 'missing_authorization' },
  {
    id: 'malformed scheme',
    headers: { Authorization: `Basic ${TOKEN}` },
    reason: 'malformed_authorization',
  },
  {
    id: 'well-formed unknown token',
    headers: { Authorization: `Bearer ${TOKEN}-not-the-declared-value` },
    reason: 'invalid_token',
  },
] as const

/** A row's template turned into a concrete request target. */
function probeTargetsFor(row: (typeof RUN_SERVICE_ROUTE_TABLE)[number]): readonly string[] {
  if (row.pattern === undefined) return [row.path]
  const concrete = row.path.replace(/:([A-Za-z0-9_]+)/g, 'r_census-probe')
  // THE TEMPLATED ROW IS DRIVEN THREE WAYS, and the third one is load-bearing. 402-04 added a
  // `?handle=` parameter with two refusals of its own, both answered before any stream header —
  // which puts them in the same region of the dispatch as the verdict. A WELL-FORMED handle does
  // not discriminate the ordering at all (a mutation that validated the handle above the verdict
  // survived a census that drove only `?handle=1`, measured). The MALFORMED one does: it is the
  // input the early check would refuse 400 on, so a census that drives it proves the verdict still
  // stands first — and therefore that a handle refusal cannot be used as a run-existence oracle by
  // a caller with no credential.
  return [concrete, `${concrete}?handle=1`, `${concrete}?handle=not-a-number`]
}

describe('the refusal census: every route on the table, every failure class (D-06)', () => {
  it('refuses all of them 401 with a body that is shape-identical beyond the reason', async () => {
    const service = await openRunService({ environment: 'local' })

    // NON-VACUITY, FIRST. A census over an empty or shrunken table would pass by driving nothing.
    expect(RUN_SERVICE_ROUTE_TABLE.length).toBeGreaterThanOrEqual(3)

    const observed: { probe: string; status: number; keys: readonly string[]; error: string }[] = []
    for (const row of RUN_SERVICE_ROUTE_TABLE) {
      for (const target of probeTargetsFor(row)) {
        for (const failure of FAILURE_CLASSES) {
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
          expect(response.status, observed.at(-1)!.probe).toBe(401)
          expect(body.error, observed.at(-1)!.probe).toBe(failure.reason)
          // No cross-origin grant on a refusal, on any route.
          expect(response.headers.get('access-control-allow-origin')).toBeNull()
          expect(response.headers.get('content-type')).toContain('application/json')
        }
      }
    }

    // THE DENOMINATOR IS THE TABLE'S, not a number written here: every row, every probe target,
    // every failure class, and the arithmetic is stated so a silently-skipped row cannot pass.
    const expectedProbes = RUN_SERVICE_ROUTE_TABLE
      .reduce((total, row) => total + probeTargetsFor(row).length, 0) * FAILURE_CLASSES.length
    expect(observed.length).toBe(expectedProbes)

    // SHAPE-IDENTICAL BEYOND THE REASON. One key, the same key, on every route and every class —
    // so a refused caller cannot fingerprint the route map, a run's existence, or how many
    // credentials are declared by diffing bodies.
    const shapes = new Set(observed.map((row) => JSON.stringify(row.keys)))
    expect([...shapes]).toEqual(['["error"]'])
    const statuses = new Set(observed.map((row) => row.status))
    expect([...statuses]).toEqual([401])
    // And the WORD varies only with the class, never with the route.
    for (const failure of FAILURE_CLASSES) {
      const words = new Set(
        observed.filter((row) => row.probe.endsWith(failure.id)).map((row) => row.error),
      )
      expect([...words], failure.id).toEqual([failure.reason])
    }
  }, 60_000)

  it('refuses a path NO row matches identically, so the table itself does not leak', async () => {
    const service = await openRunService({ environment: 'local' })
    for (const failure of FAILURE_CLASSES) {
      const response = await fetch(`${service.origin}/run/not-a-route/at-all`, {
        headers: failure.headers,
      })
      expect(response.status).toBe(401)
      expect(await response.json()).toEqual({ error: failure.reason })
    }
  }, 30_000)
})

// ---- (2) THE GATE DENIAL, RENDERED ON THE WIRE ------------------------------------------------
//
// THE MEASUREMENT WINDOWS #227 ASKED FOR. 402-01 recorded that the remote door composes no
// execution context, so its runs decide under the fail-closed `local-headless` default — and that
// "the declared TrustScope reaches `FunctionCaller.credential` and `evaluate()` reads it, but
// nothing issues a scoped standing approval for it to satisfy". Both cells below are the same run
// with ONE field different: the token's declared scope. That difference is the whole of what the
// credential arm can do today, and it turns out to be reachable — `resolveAsk` consults
// `scopeMatches(credential.scope, actionScope)` BEFORE it consults the standing-approval reader,
// and `actionScope` is the pinned `STANDING_APPROVAL_SCOPE` constant.

describe('a credential whose scope does not satisfy the gate is DENIED over the wire', () => {
  it('answers 403 with the typed denial, and no run is recorded', async () => {
    const service = await openRunService({ trustScope: PROJECT_SCOPE })
    const response = await fetch(`${service.origin}/run`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ patterns: ['tests/probe.test.yaml'] }),
    })

    // NOT 401 — the credential was accepted. NOT 500 — a policy denial is a decision, not a crash.
    // NOT 2xx — and that is the elevation-of-privilege claim (T-402-22): a wrong credential never
    // degrades to a weaker success.
    expect(response.status).toBe(403)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(response.headers.get('access-control-allow-origin')).toBeNull()

    const body = (await response.json()) as Record<string, unknown>
    expect(body.error).toBe('run_denied')
    expect(typeof body.neutralReason).toBe('string')
    expect((body.neutralReason as string).length).toBeGreaterThan(0)
    expect(Array.isArray(body.remedies)).toBe(true)

    // THE 399 DEFECT, ASSERTED CLOSED. `--trust-session` is declared on exactly one CLI command;
    // the gate's CANONICAL reason names it verbatim on this arm. A door that echoed that sentence
    // would be handing a remote HTTP client a flag it has no way to pass.
    expect(JSON.stringify(body)).not.toContain('--trust-session')
    expect(JSON.stringify(body)).not.toContain('re-run locally')

    // NO DURABLE RUN. A denied run never started, so nothing produced an event log.
    expect(runsThatProducedEvents(service.configDir)).toEqual([])
  }, 60_000)

  it('still 404s the stream for the run that was never started', async () => {
    const service = await openRunService({ trustScope: PROJECT_SCOPE })
    await fetch(`${service.origin}/run`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ patterns: ['tests/probe.test.yaml'] }),
    })
    const stream = await fetch(`${service.origin}/run/r_denied-never-started/events`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    })
    expect(stream.status).toBe(404)
    expect(stream.headers.get('content-type')).toContain('application/json')
    expect(stream.headers.get('content-type')).not.toContain('text/event-stream')
    expect(await stream.json()).toEqual({ error: 'unknown_run' })
  }, 60_000)

  it('WINDOWS #227 — the declared scope makes NO difference: the gate never sees it', async () => {
    // THE MEASUREMENT 402-01 ASKED FOR, and it corrects that plan's account of the gap.
    //
    // `STANDING_APPROVAL_SCOPE` is not an arbitrary second value. It is the EXACT constant
    // `run-invocation-core.ts` passes as `actionScope` to its one `evaluate()` call, and
    // `resolveAsk` allows an ask-tier action when `scopeMatches(credential.scope, actionScope)` —
    // a check it makes BEFORE consulting the standing-approval reader. So if the declared scope
    // reached the gate at all, THIS token would lift THIS run, and the two cells would differ.
    //
    // They do not. The credential reaches `FunctionCaller.credential` and stops there:
    // `RunExecutionPort.execute(request, gate?)` carries `{ reader }` and nothing else, and the
    // CLI's composed implementation passes `trust: { trustMode }` with no `credential` key. 402-01
    // recorded the gap as "nothing issues a scoped standing approval for it to satisfy"; the
    // measured cause is one layer earlier and stronger — no scope could satisfy it, because
    // `evaluate()` is never handed one from this door.
    const service = await openRunService({ trustScope: STANDING_APPROVAL_SCOPE })
    const response = await fetch(`${service.origin}/run`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ patterns: ['tests/probe.test.yaml'] }),
    })
    expect(response.status).toBe(403)
    const body = (await response.json()) as Record<string, unknown>
    expect(body.error).toBe('run_denied')
    // The gate's own words for what happened: fail-closed in this context, at this tier. Not
    // "wrong scope" — the scope was never weighed.
    expect(body.neutralReason).toContain('fail-closed')
    expect(body.neutralReason).toContain('mutating-shared')
    expect(runsThatProducedEvents(service.configDir)).toEqual([])
  }, 60_000)

  it('THE TIER CONTROL — the same request against a LOCAL target is acked and recorded', async () => {
    // ONE FIELD DIFFERENT from the denial cell: the target's declared environment. This is what
    // makes "denied, and nothing ran" a fact about the policy decision rather than about a fixture
    // that cannot run anything.
    const service = await openRunService({ environment: 'local' })
    const response = await fetch(`${service.origin}/run`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ patterns: ['tests/probe.test.yaml'] }),
    })
    expect(response.status).toBe(202)
    const ack = (await response.json()) as { runId?: string }
    expect(typeof ack.runId).toBe('string')
    expect(runsThatProducedEvents(service.configDir).length).toBeGreaterThan(0)
  }, 180_000)
})

// ---- (3) THE COMPARE DISCIPLINE, SOURCE HALF --------------------------------------------------

const TOKEN_MODULE = fileURLToPath(
  new URL('../composition/run-service-token-resolution.ts', import.meta.url),
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
    // The criterion 402-01 was handed reads `grep -c "timingSafeEqual"` returns 1. It returns 2 on
    // the shipped file and always will, because `import { createHash, timingSafeEqual } from
    // 'node:crypto'` is the spelling D-05 mandates cloning verbatim. This is the same claim,
    // measured on something a mutation cannot satisfy by accident.
    expect(callsTo(code, 'timingSafeEqual')).toBe(1)
    // The raw grep, recorded here so the discrepancy is a fact in the suite rather than a surprise.
    const raw = (readFileSync(TOKEN_MODULE, 'utf8').match(/timingSafeEqual/g) ?? []).length
    expect(raw).toBeGreaterThan(1)
  })

  it('routes every credential comparison through the ONE named compare function', () => {
    // One CALL to `secretEquals`, plus its declaration. An inlined `===` reads 0 here — which is
    // the mutation a `timingSafeEqual` count alone cannot see, because the primitive stays in the
    // file inside a function nobody calls any more.
    expect(callsTo(code, 'secretEquals')).toBe(1)
    expect(/function\s+secretEquals\s*\(/.test(code)).toBe(true)
    // BOTH SIDES HASHED — two `sha256(` calls, one per operand.
    expect(callsTo(code, 'sha256')).toBe(2)
  })

  it('compares a credential value NOWHERE ELSE — no bare equality against an entry', () => {
    // The inlined-comparison mutation in its other spellings: `presented === token.value`,
    // `token.value === presented`, `.includes(presented)`, `indexOf`. What this refuses is any
    // operator or method applied to the resolved value outside the one compare function.
    expect(/\.value\s*(===|!==|==|!=)/.test(code)).toBe(false)
    expect(/(===|!==|==|!=)\s*[A-Za-z0-9_.]*\.value\b/.test(code)).toBe(false)
    expect(/\bpresented\s*(===|!==|==|!=)/.test(code)).toBe(false)
    expect(/(===|!==|==|!=)\s*presented\b/.test(code)).toBe(false)
    expect(code.includes('.indexOf(presented')).toBe(false)
    expect(code.includes('.includes(presented')).toBe(false)
  })

  it('scans the WHOLE entry list — the loop carries no early exit', () => {
    // `break` and `continue` are absent from the module's code entirely, and the scan loop's only
    // statement is the assignment. A short circuit is what makes the comparison count depend on
    // WHICH entry matched, which is the timing channel T-402-20 names.
    expect(code.includes('break')).toBe(false)
    expect(/for\s*\(const token of tokens\)\s*\{?\s*if\s*\(secretEquals\(/.test(code)).toBe(true)
  })

  it('carries NO permissive arm and no query-parameter carriage', () => {
    expect(code.includes('anonymous')).toBe(false)
    // A token carried in a URL is a token written to access logs, proxy logs and browser history.
    expect(/req\.url|URLSearchParams|searchParams/.test(code)).toBe(false)
  })
})

// ---- (4) THE MASKING SWEEP --------------------------------------------------------------------

/**
 * A door stub carrying only what `composeRunServicePorts` reads from one, plus a recorder.
 *
 * `bindMaskingSecrets` is REQUIRED by the composer's own parameter type, which is the point: a
 * composition that forgot to seed the run masker would not compile. This stub records what it was
 * handed so a cell can read it back.
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

/** The stub for the cells that only need the composer to accept a door. */
const inertDoor = stubDoor().door

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
  it('the STARTUP refusal names the variable and never a value, and carries no cause', () => {
    let thrown: unknown
    try {
      composeRunServicePorts({
        entries: [
          { name: 'ci', tokenEnvVar: TOKEN_VAR, trustScope: PROJECT_SCOPE },
          { name: 'missing', tokenEnvVar: UNSET_VAR, trustScope: PROJECT_SCOPE },
        ],
        // The FIRST entry resolves — so a real credential value is in this process's hands at the
        // moment the second entry refuses. That is what makes the sweep below non-vacuous: there
        // is a value available to leak.
        env: { [TOKEN_VAR]: TOKEN },
        door: inertDoor,
      })
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(RunServiceTokenEnvVarUnsetError)
    // NO `cause`. 395-16 measured that Node's default uncaught printer walks the cause chain with
    // `util.inspect`, which is how a config file's contents once reached a person's terminal.
    expect((thrown as { cause?: unknown }).cause).toBeUndefined()

    for (const channel of channelsOf(thrown)) {
      expect(channel).not.toContain(TOKEN)
    }
    // And the variable NAME is present, because a refusal an operator cannot act on is not a
    // refusal — it is a crash.
    expect((thrown as Error).message).toContain(UNSET_VAR)
  })

  it('an EMPTY or whitespace-only value refuses startup identically to an unset one', () => {
    const refusals = ['', '   ', '\t\n'].map((value) => {
      try {
        composeRunServicePorts({
          entries: [{ name: 'ci', tokenEnvVar: UNSET_VAR, trustScope: PROJECT_SCOPE }],
          env: { [UNSET_VAR]: value },
          door: inertDoor,
        })
        return undefined
      } catch (error) {
        return error
      }
    })
    let unsetRefusal: unknown
    try {
      composeRunServicePorts({
        entries: [{ name: 'ci', tokenEnvVar: UNSET_VAR, trustScope: PROJECT_SCOPE }],
        env: {},
        door: inertDoor,
      })
    } catch (error) {
      unsetRefusal = error
    }

    // `FOO=` in a shell is what an operator writes when a substitution came back empty. Treating
    // it as a present credential would mint a token matching `Authorization: Bearer `, which is
    // the one value an attacker does not have to guess.
    for (const refusal of refusals) {
      expect(refusal).toBeInstanceOf(RunServiceTokenEnvVarUnsetError)
      expect((refusal as Error).message).toBe((unsetRefusal as Error).message)
    }
    expect(unsetRefusal).toBeInstanceOf(RunServiceTokenEnvVarUnsetError)
  })

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
      for (const failure of FAILURE_CLASSES) {
        const response = await fetch(`${service.origin}/run`, {
          method: 'POST',
          headers: { ...failure.headers, 'Content-Type': 'application/json' },
          body: '{}',
        })
        bodies.push(await response.text())
        bodies.push(JSON.stringify([...response.headers.entries()]))
      }
      // A NEAR MISS, deliberately: a presented value one character off the declared one. A door
      // that echoed "the entry that nearly matched" would put a host-held string on the wire.
      const near = await fetch(`${service.origin}/run`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${TOKEN.slice(0, -1)}`, 'Content-Type': 'application/json' },
        body: '{}',
      })
      bodies.push(await near.text())
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
    expect(bodies.length).toBe(FAILURE_CLASSES.length * 2 + 1)
    expect(bodies.filter((body) => body.includes('"error"')).length)
      .toBe(FAILURE_CLASSES.length + 1)
  }, 60_000)
})

// ---- (5) THE SECRET STORE IS CONSUMED (WINDOWS #224, T-402-04) --------------------------------
//
// 402-01 shipped `runServiceTokenSecretStore` and published it from `composeRunServicePorts`, and
// nothing read it. That half-wiring is what these cells close, and the claim has TWO sides, so it
// is pinned on both: the composer BINDS the store into the door's bridge, and the run seam WALKS
// what the bridge hands it. Either half alone is a mechanism that reports success while the value
// still reaches a person in the clear.

describe('the door’s credentials reach every run’s masker (#224)', () => {
  it('BIND HALF — composing the ports seeds the door with the resolved values', () => {
    const recorder = stubDoor()
    const composition = composeRunServicePorts({
      entries: [
        { name: 'ci', tokenEnvVar: TOKEN_VAR, trustScope: PROJECT_SCOPE },
        { name: 'teammate', tokenEnvVar: `${TOKEN_VAR}_2`, trustScope: PROJECT_SCOPE },
      ],
      env: { [TOKEN_VAR]: TOKEN, [`${TOKEN_VAR}_2`]: `${TOKEN}-second` },
      door: recorder.door,
    })
    try {
      const seeded: [string, string][] = []
      recorder.bound()?.forEachSecret((name, value) => { seeded.push([name, value]) })
      // EVERY declared entry, keyed by the variable NAME the operator chose — which is the whole
      // reason the store exists rather than the masker's own name-suffix selector being enough.
      expect(seeded).toEqual([
        [TOKEN_VAR, TOKEN],
        [`${TOKEN_VAR}_2`, `${TOKEN}-second`],
      ])
      // The published store and the bound one are the SAME object, not two builds of it.
      expect(recorder.bound()).toBe(composition.secretStore)
    } finally {
      composition.dispose()
    }
  })

  it('BIND HALF — the real door has nothing bound until the composer runs', async () => {
    const configPath = fixtureWorkspace({ environment: 'local' })
    const configDir = dirname(resolve(configPath))
    const { DashboardDatabase } = await import('@vostride/agent-qa-dashboard')
    const db = new DashboardDatabase({ dbPath: join(configDir, 'bind.db') })
    const runDoor = await createDashboardRunDoor({ db })
    try {
      // A dashboard with no run service declared holds no credential, so there is nothing extra to
      // mask and the resolver honestly answers nothing.
      expect(runDoor.runBridge.maskingSecrets?.()).toBeUndefined()

      const composition = composeRunServicePorts({
        entries: [{ name: 'ci', tokenEnvVar: TOKEN_VAR, trustScope: PROJECT_SCOPE }],
        env: { [TOKEN_VAR]: TOKEN },
        door: runDoor,
      })
      const seeded: string[] = []
      // READ THROUGH THE BRIDGE the host actually runs runs through — not through the composition's
      // own field. The bridge is the only channel that reaches `runInProcessCliRun`.
      runDoor.runBridge.maskingSecrets?.()?.forEachSecret((_name, value) => { seeded.push(value) })
      expect(seeded).toEqual([TOKEN])
      composition.dispose()
    } finally {
      db.close()
      rmSync(configDir, { recursive: true, force: true })
    }
  })

  it('CONSUME HALF — a real run masks the credential, and does NOT without the wiring', async () => {
    const configPath = fixtureWorkspace({ environment: 'local' })
    const configDir = dirname(resolve(configPath))
    const { runInProcessCliRun } = await import('../composition/in-process-run-execution.js')

    // THE VALUE IS GENUINELY IN THIS PROCESS'S ENVIRONMENT for the duration, because that is the
    // production situation: the runs execute in the same process that holds the credential, so a
    // hook or a shell step that echoes the variable prints it. The control below is what shows
    // `sensitiveEnvSlice` does not save us — it selects by NAME SUFFIX, and `…_CRED` matches none.
    const previous = process.env[TOKEN_VAR]
    process.env[TOKEN_VAR] = TOKEN
    try {
      const line = `the run printed ${TOKEN} on its way past`
      const capture = async (
        maskingSecrets?: () => { forEachSecret(cb: (n: string, v: string) => void): void },
      ): Promise<string> => {
        // MASKED INSIDE THE SUBSCRIBER, not afterwards. The drive disposes the context in its
        // `finally`, which clears every registration — so a closure called after the run returns
        // measures an EMPTY masker and reports a leak on both arms. This is the surface a reporter
        // actually masks through: inside the run, holding the run's own context.
        let mask: string | undefined
        // THE RUN FAILS, AND THAT IS FINE — this fixture declares no model, so the member surfaces
        // a framework error the drive re-raises to preserve `agent-qa run`'s exit-2 contract (the
        // remote door converts it; a direct call does not). The masking context is built and bound
        // BEFORE the members execute, and the subscriber that captures it is attached inside the
        // core's `onSession`, so it is in hand either way. What this cell measures is the SEED, not
        // a passing run.
        await runInProcessCliRun(
          {
            configPath,
            agentQaRoot: join(configDir, '.agent-qa'),
            executionContext: 'local-headless',
            subscribers: ({ maskingContext }) => {
              mask = maskingContext.mask(line)
              return undefined
            },
            ...(maskingSecrets === undefined ? {} : { maskingSecrets }),
          },
          { patterns: ['tests/probe.test.yaml'] },
        ).catch(() => undefined)
        if (mask === undefined) throw new Error('the run never reached its subscribers')
        return mask
      }

      const withoutWiring = await capture()
      const withWiring = await capture(
        () => runServiceTokenSecretStore([
          { name: 'ci', tokenEnvVar: TOKEN_VAR, value: TOKEN, trustScope: PROJECT_SCOPE },
        ]),
      )

      // THE GAP, MEASURED rather than asserted: the shipped seed pipeline does not know this value.
      expect(withoutWiring).toContain(TOKEN)
      // And the wiring closes it — the value is replaced by a placeholder, not merely absent.
      expect(withWiring).not.toContain(TOKEN)
      expect(withWiring).toContain('SECRET')
      // The rest of the line survives, so the mask is a substitution and not a redaction of
      // everything the run said.
      expect(withWiring).toContain('the run printed')
    } finally {
      if (previous === undefined) delete process.env[TOKEN_VAR]
      else process.env[TOKEN_VAR] = previous
      rmSync(configDir, { recursive: true, force: true })
    }
  }, 180_000)
})

describe('END TO END — a run started over the wire masks the door’s credential (#224)', () => {
  it('the value the token holder presented is masked in that run’s own context', async () => {
    // THE MIDDLE LINK, DRIVEN. The bind half and the consume half above each pin one end; this
    // cell is the whole chain on the shipped composition — `composeRunServicePorts` binds the
    // store into the door, `composeCliLocalAgent` passes the bridge's resolver through to
    // `runInProcessCliRun`, and the run's masker walks it. Nothing here is assembled beside the
    // product: the observer is chained onto the real bridge and the run is started by a real
    // `POST /run` over TCP.
    const seen: string[] = []
    const text = `a reporter printed ${TOKEN} while the run was in flight`
    const service = await openRunService({
      environment: 'local',
      observeMasking: { text, seen },
    })
    const response = await fetch(`${service.origin}/run`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ patterns: ['tests/probe.test.yaml'] }),
    })
    expect(response.status).toBe(202)

    expect(seen.length).toBeGreaterThan(0)
    for (const masked of seen) {
      expect(masked).not.toContain(TOKEN)
      expect(masked).toContain('SECRET')
      expect(masked).toContain('a reporter printed')
    }
  }, 180_000)
})
