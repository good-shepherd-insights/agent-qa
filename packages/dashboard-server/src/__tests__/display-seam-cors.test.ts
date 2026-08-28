/**
 * THE DISPLAY SEAM CARRIES NO CROSS-ORIGIN READ GRANT AND NO REBINDABLE HOST (405 CR-01).
 *
 * WHAT CHANGED UNDER THE HEADER. 405-10 put `unmaskTreeForDisplay` on five read arms of the local
 * dashboard door. Before that seam those bodies carried `<SECRET_1>` placeholders; afterwards they
 * carry the RESTORED CLEARTEXT of a declared secret. Four of the five answered through `json()`,
 * whose wildcard `Access-Control-Allow-Origin` did not change — the sensitivity of what sat behind
 * it did. That is the whole defect: a page on any origin the operator happens to have open could
 * `fetch` the run list, read the ids out of it, then `fetch` the artifact and read the secrets out
 * of the config snapshot. The loopback bind is no defence, because the attacker is the operator's
 * own browser reaching another ORIGIN rather than a remote host reaching this interface.
 *
 * AND THE FIFTH ARM IS WHY THIS CELL'S SECOND PREDICATE WAS REWRITTEN. `GET /api/runs/:id/detail`
 * carries the richest restored body on the door and was never CORS-readable — its own private JSON
 * writer grants nothing. But its crossing lives in a DIFFERENT MODULE from the other four, and the
 * first version of the invariant below read one hard-coded router file. The fifth call site was
 * therefore missing from BOTH sides of its comparison: it compared 4 to 4, reported total coverage
 * of what was 4 of 5, and stayed green. An invariant that names the file it audits can only ever
 * be as wide as the last person's memory, so this one DISCOVERS its universe instead.
 *
 * TWO PREDICATES, AND NEITHER CAN SATISFY THE OTHER.
 *
 *   PREDICATE A — THE WIRE. Drives the SHIPPED router over a real socket with real Host, Origin
 *   and Sec-Fetch-Site headers, and reads the response headers a browser would read. It is blind
 *   to which source symbol wrote them, so a rename or a second private JSON writer cannot fool it.
 *   It carries a CONTROL — a legacy read that must still answer `*` — so the cell cannot pass by
 *   the header capture having quietly broken.
 *
 *   PREDICATE B — THE SOURCE COUPLING. Reads no wire at all, and reads no filename either: it
 *   WALKS the package for every module that calls the seam and requires each one to carry a guard.
 *   A sixth arm in a seventh module lands inside its universe by construction.
 */

import { createServer, request as httpRequest, type Server } from 'node:http'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { AgentHost } from '../chat/host.js'
import { DashboardDatabase } from '../db/database.js'
import { createRouter } from '../server/routes.js'

const HERE = dirname(fileURLToPath(import.meta.url))
/** `packages/dashboard-server/src/__tests__` -> this package's `src`. */
const PACKAGE_SRC = join(HERE, '..')
const RUN_SERVICE_DIR = join(PACKAGE_SRC, 'run-service')

const RUN_ID = 'run-405-cr01'

/**
 * THE FIVE ARMS 405-10 PUT THE SEAM ON. Named here as PATHS rather than as a source list, because
 * what a browser can read is a property of the wire and not of a symbol table.
 */
const SEAM_READ_PATHS: readonly string[] = [
  '/api/runs',
  `/api/runs/${RUN_ID}`,
  `/api/runs/${RUN_ID}/artifact`,
  `/api/runs/${RUN_ID}/execution-logs`,
  `/api/runs/${RUN_ID}/detail`,
]

/** A legacy read that is NOT behind the seam. Its wildcard is unchanged and this cell says so. */
const LEGACY_READ_PATH = '/api/stats'

function seedDatabase(): DashboardDatabase {
  const db = new DashboardDatabase({ dbPath: ':memory:' })
  db.insertRun({
    id: RUN_ID,
    name: 'Checkout',
    filePath: 'tests/checkout.yaml',
    status: 'failed',
    duration: 12,
    startedAt: '2026-08-01T00:00:00.000Z',
    endedAt: '2026-08-01T00:00:12.000Z',
  })
  db.insertRunArtifact({ runId: RUN_ID, kind: 'test' })
  db.insertExecutionLog({
    id: `${RUN_ID}-hook-0`,
    runId: RUN_ID,
    type: 'hook',
    name: 'setup',
    phase: 'setup',
    status: 'passed',
    duration: 1,
  })
  return db
}

/**
 * A host that BINDS the run-detail op and answers the seam.
 *
 * It is supplied deliberately rather than left absent: with no host every arm takes its
 * `agentHost === undefined` branch and never crosses the seam at all, so the header assertions
 * below would be statements about a code path the shipped door does not take. `/api/runs/:id/detail`
 * additionally 503s without one, and a 503 carries no grant either — which is exactly the shape of
 * vacuity this file's non-vacuity assertions exist to refuse.
 */
function seamHost(): AgentHost {
  return {
    registry: {},
    caller: { kind: 'test' },
    agentAskFunctionId: 'test:ask',
    runsPostProcessingFunctionId: 'test:post-processing',
    runsEventsFunctionId: 'test:events',
    runsDetailFunctionId: 'test:runs-detail',
    runsArtifactFunctionId: 'test:runs-artifact',
    analysisGetFunctionId: 'test:analysis-get',
    invokeFunction: () => Promise.resolve({
      runId: RUN_ID,
      members: [{ testIndex: 0, attempts: 1 }],
      steps: [],
      subActions: [],
      tokens: { measuredSteps: 0, unmeasuredSteps: 0 },
    }),
    foldFunctionResult: () => ({ verdict: { status: 'executed', outcome: 'planted' }, foldLines: [] }),
    listDeclarations: () => [],
    onSessionEvent: () => () => undefined,
    unmaskForDisplay: (text: string): string => text,
  } as unknown as AgentHost
}

interface Probe {
  status: number
  allowOrigin: string | undefined
  body: string
}

let server: Server
let port = 0

beforeAll(async () => {
  const db = seedDatabase()
  const router = createRouter(
    { db, agentHost: seamHost() } as unknown as Parameters<typeof createRouter>[0],
  )
  server = createServer(router)
  await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready))
  const address = server.address()
  port = typeof address === 'object' && address !== null ? address.port : 0
})

afterAll(async () => {
  await new Promise<void>((closed) => server.close(() => { closed() }))
})

/**
 * One real request, with the Host header under this cell's control.
 *
 * `fetch` refuses to set Host, and Host is exactly the header a DNS-rebinding attacker controls —
 * so the raw client is not a convenience here, it is the only way to pose the question.
 */
async function probe(
  path: string,
  headers: Record<string, string> = {},
): Promise<Probe> {
  return await new Promise<Probe>((resolve, reject) => {
    const req = httpRequest(
      { host: '127.0.0.1', port, path, method: 'GET', headers: { host: `127.0.0.1:${String(port)}`, ...headers } },
      (res) => {
        let body = ''
        res.setEncoding('utf8')
        res.on('data', (chunk: string) => { body += chunk })
        res.on('end', () => {
          const allowOrigin = res.headers['access-control-allow-origin']
          resolve({
            status: res.statusCode ?? 0,
            allowOrigin: typeof allowOrigin === 'string' ? allowOrigin : undefined,
            body,
          })
        })
      },
    )
    req.on('error', reject)
    req.end()
  })
}

describe('PREDICATE A — the wire', () => {
  it('the CONTROL still grants the wildcard, so an absent grant below is a fact and not a broken probe', async () => {
    const answer = await probe(LEGACY_READ_PATH)
    expect(answer.status).toBe(200)
    expect(answer.allowOrigin).toBe('*')
  })

  it.each(SEAM_READ_PATHS)('%s answers a same-origin reader and grants NO cross-origin read', async (path) => {
    const answer = await probe(path, {
      origin: `http://127.0.0.1:${String(port)}`,
      'sec-fetch-site': 'same-origin',
    })
    // Non-vacuous: an arm that 404'd or 503'd would carry no grant either, and would prove nothing.
    expect(answer.status).toBe(200)
    expect(answer.body).toContain(RUN_ID)
    expect(
      answer.allowOrigin,
      `${path} handed a cross-origin reader a grant over a body that can carry restored cleartext`,
    ).toBeUndefined()
  })

  it.each(SEAM_READ_PATHS)('%s admits the local non-browser drive that sends no Origin', async (path) => {
    // The CLI, `curl` and the conformance harness send no Origin. Refusing them would brick the
    // local drive these arms exist for, so this is a load-bearing admission and not an oversight.
    const answer = await probe(path)
    expect(answer.status).toBe(200)
    expect(answer.body).toContain(RUN_ID)
    expect(answer.allowOrigin).toBeUndefined()
  })

  it.each(SEAM_READ_PATHS)('%s refuses a page on another origin', async (path) => {
    const answer = await probe(path, { origin: 'http://evil.test', 'sec-fetch-site': 'cross-site' })
    expect(answer.status).toBe(403)
    expect(answer.allowOrigin).toBeUndefined()
    expect(answer.body).not.toContain(RUN_ID)
  })

  it.each(SEAM_READ_PATHS)('%s refuses a rebound name that resolves to this loopback port', async (path) => {
    // DNS rebinding is the attack the missing header alone does NOT stop: the attacker's own name
    // resolves here, so the browser considers the read same-origin and asks for no grant at all.
    // The Host check is what closes it — and on `/detail`, whose answer never carried a grant to
    // begin with, it is the ONLY rung standing between a rebound page and the run's cleartext.
    const answer = await probe(path, { host: 'evil.test' })
    expect(answer.status).toBe(403)
    expect(answer.body).not.toContain(RUN_ID)
  })
})

// ---------------------------------------------------------------------------------------------
// PREDICATE B — the source coupling
// ---------------------------------------------------------------------------------------------

/** Every `.ts` under this package's `src`, minus the cells — a door is never a test file. */
function walkSourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules') continue
      walkSourceFiles(full, found)
      continue
    }
    if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) found.push(full)
  }
  return found
}

const SEAM_CALL = 'unmaskTreeForDisplay('
/** The seam's own definition and its recursive self-calls are the IMPLEMENTATION, not a door. */
const SEAM_DEFINITION = `export function ${SEAM_CALL}`
/** A guard INVOCATION — the `(req` tail is what keeps an import line from counting as one. */
const GUARD_CALL = /\b(?:refuseCrossSiteDisplayRead|refuseCrossSiteRequest)\(\s*(?:req|request)\b/gu

interface SeamModule {
  readonly file: string
  readonly seamCalls: number
  readonly guardCalls: number
}

/** Every module that CROSSES the seam, discovered by walking — never by naming. */
function discoverSeamModules(): SeamModule[] {
  const modules: SeamModule[] = []
  for (const full of walkSourceFiles(PACKAGE_SRC)) {
    const source = readFileSync(full, 'utf8')
    if (source.includes(SEAM_DEFINITION)) continue
    const seamCalls = source.split(SEAM_CALL).length - 1
    if (seamCalls === 0) continue
    modules.push({
      file: relative(PACKAGE_SRC, full).split(sep).join('/'),
      seamCalls,
      guardCalls: source.match(GUARD_CALL)?.length ?? 0,
    })
  }
  return modules.sort((a, b) => a.file.localeCompare(b.file))
}

/**
 * THE REGISTER IS FROZEN, NOT GENERATED, on `suite-parent-debris-census.test.ts`'s law.
 *
 * A register recomputed from its own scan output can never fail. This one is hand-authored: it
 * names the modules whose seam crossings a PERSON has checked are actually covered by the guard
 * beside them — which is a stronger claim than "this file contains a guard token somewhere", and
 * not one a walk can make. A new module reds here even when it looks guarded, because looking
 * guarded is exactly what the first version of this invariant mistook for being guarded.
 */
const REVIEWED_SEAM_MODULES: readonly string[] = [
  // 406-01 (D-04, T-406-04): the failure view's adapter. Its ONE crossing sits behind
  // `refuseCrossSiteRequest(req)` in the same function, gated on `boundary === 'human'` exactly as
  // the detail adapter's is — the local arm opts in, the authed remote row passes nothing and
  // never reaches the crossing at all. Reviewed against the source, not against a token count.
  'run-service/run-analysis-routes.ts',
  'run-service/run-detail-routes.ts',
  'server/routes.ts',
]

describe('PREDICATE B — the source coupling', () => {
  it('discovers the seam modules by walking, and finds the ones review has cleared', () => {
    const modules = discoverSeamModules()
    // Non-vacuity FIRST: a walk that found nothing would satisfy every per-module rule below.
    expect(modules.length, 'the walk found no seam crossing at all — this predicate would be vacuous').toBeGreaterThan(0)
    expect(
      modules.map((module) => module.file),
      'a module crossed the display seam that this register has never been reviewed against — '
      + 'check that its crossing is actually behind a guard, then add it here',
    ).toEqual(REVIEWED_SEAM_MODULES)
  })

  it('every module that crosses the seam carries a guard for every crossing', () => {
    for (const module of discoverSeamModules()) {
      expect(
        module.guardCalls,
        `${module.file} crosses the display seam ${String(module.seamCalls)} time(s) but invokes `
        + `the cross-site guard ${String(module.guardCalls)} time(s)`,
      ).toBeGreaterThanOrEqual(module.seamCalls)
    }
  })

  it('the run-detail door writes no cross-origin grant, by decision rather than by inheritance', () => {
    // CR-01 found `/api/runs/:id/detail` safe only because it inherited a private JSON writer that
    // happens to omit the header. Reading that writer here is what turns the accident into a
    // contract: a refactor that converges the two files onto the wildcard writer reds.
    const detailSource = readFileSync(join(RUN_SERVICE_DIR, 'run-detail-routes.ts'), 'utf8')
    const opener = 'function respondJson('
    const start = detailSource.indexOf(opener)
    expect(start, 'the run-detail door renamed its JSON writer — this cell would be vacuous').toBeGreaterThan(-1)
    // The writer's OWN BODY, not the file: the docstring above it names the header it refuses to
    // write, and a whole-file search would be satisfied by that prose rather than by the code.
    const end = detailSource.indexOf('\n}\n', start)
    const writerBody = detailSource.slice(start, end)
    expect(writerBody).toContain("'Content-Type': 'application/json'")
    expect(writerBody).not.toContain('Access-Control-Allow-Origin')
  })
})
