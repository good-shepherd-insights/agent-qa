import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { connect } from 'node:net'
import type { AddressInfo } from 'node:net'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { DashboardDatabase } from '../db/database.js'
import { startServer } from '../server/server.js'

/**
 * THE ARTIFACT-SERVING TRAVERSAL GUARD, DRIVEN AT THE RAW WIRE (402-05, D-16 — T-402-17).
 *
 * ---- WHY A SOCKET AND NOT `fetch` ------------------------------------------------------------
 *
 * Every HTTP client in Node builds its request target through the WHATWG URL parser, and that
 * parser REMOVES double-dot path segments before a byte leaves the process. `fetch` cannot send
 * `GET /api/screenshots/run-1/../../canary.txt` — it sends `GET /canary.txt`. A cell that used
 * `fetch` for the literal form would therefore be measuring its own client, and would report a
 * refusal the server never made. These cells write the request line onto a `net.Socket` directly,
 * so the bytes on the wire are the bytes the cell chose.
 *
 * ---- WHERE NORMALIZATION ACTUALLY HAPPENS, MEASURED ------------------------------------------
 *
 * With the raw socket in hand the server's own layers become observable, and the measured facts
 * are worth writing down because they decide which payload class reaches which guard:
 *
 *  - A LITERAL `../` reaches this process and is then collapsed by `tryParseRequestUrl`'s
 *    `new URL(...)` — the request lands on a different route entirely, never on the artifact
 *    guard. The `documents where normalization happens` cell below measures exactly this.
 *  - A WHOLE-SEGMENT `%2e%2e` is ALSO collapsed there: the URL spec counts `%2e%2e` as a
 *    double-dot path segment, so it is removed exactly as `..` is. That class cannot reach the
 *    guard from any client, and a cell claiming to have driven it would be claiming a payload the
 *    process never sees.
 *  - `..%2f`, `..%5c` and `%2f`-prefixed segments are NOT collapsed — the encoded separator keeps
 *    the dot-dot inside one segment, so it survives the parse intact and arrives at the route.
 *    THOSE are the payloads below, and they are the ones the guard is the only thing refusing.
 *
 * ---- THE CANARY ------------------------------------------------------------------------------
 *
 * Every refusal cell targets a real file planted OUTSIDE the artifact root and asserts its bytes
 * never appear in any response. A 4xx alone would be satisfied by a route that refused for the
 * wrong reason; the canary is what makes "no file outside the root is ever opened" a measurement.
 */

const CANARY = 'agent-qa-traversal-canary-8f3a1c'

let tempDir: string
let artifactsDir: string
let outsideCanaryPath: string
let port: number
let close: (() => void) | undefined
let db: DashboardDatabase | undefined

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'agent-qa-traversal-'))
  artifactsDir = join(tempDir, 'artifacts')
  mkdirSync(join(artifactsDir, 'screenshots', 'run-1'), { recursive: true })
  mkdirSync(join(artifactsDir, 'videos', 'run-1'), { recursive: true })
  // A legitimate artifact under each root — the control the unification must not break.
  writeFileSync(join(artifactsDir, 'screenshots', 'run-1', 'shot.png'), 'legit-screenshot-bytes')
  writeFileSync(join(artifactsDir, 'videos', 'run-1', 'recording.webm'), 'legit-video-bytes')
  // Canary 1: one level out of the screenshots root, still inside the artifacts dir.
  writeFileSync(join(artifactsDir, 'canary.txt'), CANARY)
  // Canary 2: a SIBLING DIRECTORY whose name has the root's name as a string prefix. This is the
  // file a `resolved.startsWith(root)` containment check serves and a path-relative one refuses.
  mkdirSync(join(artifactsDir, 'screenshots-evil'), { recursive: true })
  writeFileSync(join(artifactsDir, 'screenshots-evil', 'canary.txt'), CANARY)
  // Canary 3: reached only by smuggling an ABSOLUTE path in as the filename.
  outsideCanaryPath = join(tempDir, 'absolute-canary.txt')
  writeFileSync(outsideCanaryPath, CANARY)

  const configPath = join(tempDir, 'agent-qa.config.yaml')
  writeFileSync(configPath, 'testDir: tests\n')
  db = new DashboardDatabase({ dbPath: ':memory:' })
  const started = await startServer({ db, port: 0, artifactsDir, configPath })
  close = started.close
  port = (started.server.address() as AddressInfo).port
})

afterAll(() => {
  close?.()
  db?.close()
  rmSync(tempDir, { recursive: true, force: true })
})

interface RawResponse {
  readonly status: number
  readonly raw: string
}

/**
 * Write ONE request line onto a socket and read the whole response back.
 *
 * The target is used VERBATIM — no URL construction anywhere in this helper, which is the entire
 * point of it. `latin1` is used to stringify the response so a binary body is searchable for the
 * canary marker without a decoder rewriting bytes.
 */
async function rawRequest(target: string): Promise<RawResponse> {
  return new Promise<RawResponse>((ok, fail) => {
    const chunks: Buffer[] = []
    const socket = connect(port, '127.0.0.1', () => {
      socket.write(
        `GET ${target} HTTP/1.1\r\nHost: 127.0.0.1:${String(port)}\r\nConnection: close\r\n\r\n`,
      )
    })
    socket.on('data', (chunk: Buffer) => { chunks.push(chunk) })
    socket.on('error', fail)
    socket.on('close', () => {
      const raw = Buffer.concat(chunks).toString('latin1')
      const status = Number(/^HTTP\/1\.1 (\d{3})/.exec(raw)?.[1] ?? '0')
      ok({ status, raw })
    })
  })
}

/** The refusal reason the artifact guard published, or undefined when it was not the responder. */
function refusalReason(response: RawResponse): string | undefined {
  return /"reason":"([a-z_]+)"/.exec(response.raw)?.[1]
}

function expectNoCanary(response: RawResponse): void {
  expect(response.raw).not.toContain(CANARY)
}

describe('the artifact serving routes refuse encoded traversal at the raw wire (D-16)', () => {
  it('documents where normalization happens: a LITERAL ../ never reaches the artifact guard', async () => {
    // Sent as raw bytes — no client could produce this. The server's own `tryParseRequestUrl`
    // collapses it, so the request lands somewhere that is not the screenshots route at all. This
    // cell exists so the encoded payloads below are read as the ones that DO reach the guard.
    const response = await rawRequest('/api/screenshots/run-1/../../canary.txt')
    expect(refusalReason(response)).toBeUndefined()
    expectNoCanary(response)
  })

  it('refuses an encoded-separator dot-dot escape out of the screenshots root', async () => {
    const response = await rawRequest('/api/screenshots/run-1/..%2f..%2fcanary.txt')
    expect(response.status).toBe(400)
    expect(refusalReason(response)).toBe('outside_root')
    expectNoCanary(response)
  })

  it('refuses a BACKSLASH-separated escape (a separator on win32, a forbidden byte everywhere)', async () => {
    const response = await rawRequest('/api/screenshots/run-1/..%5c..%5ccanary.txt')
    expect(response.status).toBe(400)
    expect(refusalReason(response)).toBe('not_a_plain_segment')
    expectNoCanary(response)
  })

  it('refuses an ABSOLUTE path smuggled in as the filename', async () => {
    const response = await rawRequest(
      `/api/screenshots/run-1/${encodeURIComponent(outsideCanaryPath)}`,
    )
    expect(response.status).toBe(400)
    expect(refusalReason(response)).toBe('not_a_plain_segment')
    expectNoCanary(response)
  })

  it('refuses a SIBLING DIRECTORY whose name is a string prefix of the artifact root', async () => {
    // `<artifacts>/screenshots-evil/canary.txt` starts with `<artifacts>/screenshots` as a STRING
    // and is outside it as a PATH. A prefix-compare containment check serves this file.
    const response = await rawRequest(
      '/api/screenshots/run-1/..%2f..%2fscreenshots-evil%2fcanary.txt',
    )
    expect(response.status).toBe(400)
    expect(refusalReason(response)).toBe('outside_root')
    expectNoCanary(response)
  })

  it('refuses a malformed percent escape rather than passing the raw bytes through', async () => {
    const response = await rawRequest('/api/screenshots/run-1/%zz.png')
    expect(response.status).toBe(400)
    expect(refusalReason(response)).toBe('malformed_escape')
  })

  it('CONTROL: a legitimate screenshot under the root still serves 200', async () => {
    const response = await rawRequest('/api/screenshots/run-1/shot.png')
    expect(response.status).toBe(200)
    expect(response.raw).toContain('legit-screenshot-bytes')
  })

  it('applies the SAME guard to the videos root — one containment spelling, both routes', async () => {
    const escape = await rawRequest('/api/videos/run-1/..%2f..%2fcanary.txt')
    expect(escape.status).toBe(400)
    expect(refusalReason(escape)).toBe('outside_root')
    expectNoCanary(escape)

    const sibling = await rawRequest('/api/videos/run-1/..%2f..%2fscreenshots-evil%2fcanary.txt')
    expect(sibling.status).toBe(400)
    expect(refusalReason(sibling)).toBe('outside_root')
    expectNoCanary(sibling)

    const absolute = await rawRequest(`/api/videos/run-1/${encodeURIComponent(outsideCanaryPath)}`)
    expect(absolute.status).toBe(400)
    expect(refusalReason(absolute)).toBe('not_a_plain_segment')
    expectNoCanary(absolute)
  })

  it('CONTROL: a legitimate video under the root still serves 200', async () => {
    const response = await rawRequest('/api/videos/run-1/recording.webm')
    expect(response.status).toBe(200)
    expect(response.raw).toContain('legit-video-bytes')
  })

  it('serves a percent-encoded legitimate filename — the decode happens EXACTLY once', async () => {
    // `0 Step.png` on disk, `0%20Step.png` on the wire. Before the unification the route looked the
    // literal `0%20Step.png` up on disk and 404'd; a decode-twice implementation would resolve
    // `0%2520Step.png` too, which the second half of this cell refuses.
    writeFileSync(join(artifactsDir, 'screenshots', 'run-1', '0 Step.png'), 'spaced-name-bytes')
    const once = await rawRequest('/api/screenshots/run-1/0%20Step.png')
    expect(once.status).toBe(200)
    expect(once.raw).toContain('spaced-name-bytes')

    const twice = await rawRequest('/api/screenshots/run-1/0%2520Step.png')
    expect(twice.status).toBe(404)
  })
})
