/**
 * THE DISPLAY SEAM CARRIES NO CROSS-ORIGIN READ GRANT (405 CR-01).
 *
 * WHAT CHANGED UNDER THE HEADER. 405-10 put `unmaskTreeForDisplay` on four read arms of the local
 * dashboard door. Before that seam those bodies carried `<SECRET_1>` placeholders; afterwards they
 * carry the RESTORED CLEARTEXT of a declared secret. The wildcard `Access-Control-Allow-Origin` on
 * `json()` did not change — the sensitivity of what sits behind it did. That is the whole defect:
 * a page on any origin the operator happens to have open could `fetch` the run list, read the ids
 * out of it, then `fetch` the artifact and read the secrets out of the config snapshot. The
 * loopback bind is no defence, because the attacker is the operator's own browser reaching another
 * ORIGIN rather than a remote host reaching this interface.
 *
 * TWO PREDICATES, AND NEITHER CAN SATISFY THE OTHER.
 *
 *   PREDICATE A — THE WIRE. Drives the SHIPPED router over a real socket with real Host, Origin
 *   and Sec-Fetch-Site headers, and reads the response headers a browser would read. It is blind
 *   to which source symbol wrote them, so a rename or a second private JSON writer cannot fool it.
 *   It carries a CONTROL — a legacy read that must still answer `*` — so the cell cannot pass by
 *   the header capture having quietly broken.
 *
 *   PREDICATE B — THE SOURCE COUPLING. Reads no wire at all. Counts the seam call sites in the
 *   router and the same-site guards beside them and requires them to match, so a FIFTH arm added
 *   to the seam later without a guard reds here rather than in review. It also states the
 *   run-detail door's no-grant posture, which CR-01 found was true only by accident of which JSON
 *   writer that file inherited.
 */

import { createServer, request as httpRequest, type Server } from 'node:http'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { DashboardDatabase } from '../db/database.js'
import { createRouter } from '../server/routes.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const SERVER_DIR = join(HERE, '..', 'server')
const RUN_SERVICE_DIR = join(HERE, '..', 'run-service')

const RUN_ID = 'run-405-cr01'

/**
 * THE FOUR ARMS 405-10 PUT THE SEAM ON. Named here as PATHS rather than as a source list, because
 * what a browser can read is a property of the wire and not of a symbol table.
 */
const SEAM_READ_PATHS: readonly string[] = [
  '/api/runs',
  `/api/runs/${RUN_ID}`,
  `/api/runs/${RUN_ID}/artifact`,
  `/api/runs/${RUN_ID}/execution-logs`,
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

interface Probe {
  status: number
  allowOrigin: string | undefined
  body: string
}

let server: Server
let port = 0

beforeAll(async () => {
  const db = seedDatabase()
  const router = createRouter({ db } as unknown as Parameters<typeof createRouter>[0])
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
    // Non-vacuous: an arm that 404'd would carry no grant either, and would prove nothing.
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
    // The Host check is what closes it.
    const answer = await probe(path, { host: 'evil.test' })
    expect(answer.status).toBe(403)
    expect(answer.body).not.toContain(RUN_ID)
  })
})

describe('PREDICATE B — the source coupling', () => {
  const routerSource = readFileSync(join(SERVER_DIR, 'routes.ts'), 'utf8')

  it('every seam call site in the router sits behind a same-site guard', () => {
    const seamCallSites = routerSource.split('unmaskTreeForDisplay(').length - 1
    const guards = routerSource.split('refuseCrossSiteDisplayRead(req, res)').length - 1
    expect(seamCallSites, 'the seam left the router entirely — this cell would be vacuous').toBeGreaterThan(0)
    expect(
      guards,
      'a read arm crossed the display seam without the guard beside it',
    ).toBe(seamCallSites)
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
