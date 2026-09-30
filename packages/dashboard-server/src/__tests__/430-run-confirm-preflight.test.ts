// THE PREFLIGHT POSTURE OF THE RETIRED RUN-CONFIRM PAIR, AND THE SAME-SITE REFUSAL THAT SURVIVES IT.
//
// 2026-10-01 (432-14, D-13/D-14): the run-confirm pair was answered ahead of the shared OPTIONS arm
// so its preflight carried no grant. The pair is deleted, so its paths now take the shared arm like
// any path this server does not serve. What does NOT move is the same-site refusal on the mutating
// routes that survive it: the mark door, the config writes, the live editor and the credential
// doors refuse a page on another origin before they read a body or reach the host.

import { createServer, request as httpRequest, type Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { AgentHost } from '../chat/host.js'
import { DashboardDatabase } from '../db/database.js'
import { createRouter } from '../server/routes.js'

const invocations: string[] = []

function seamHost(): AgentHost {
  return {
    registry: {},
    caller: { kind: 'test' },
    runsMarkFunctionId: 'test:runs-mark',
    invokeFunction: (_registry: unknown, functionId: string) => {
      invocations.push(functionId)
      return Promise.resolve({ kind: 'run-not-found', runId: 'run-432-14' })
    },
    unmaskForDisplay: (text: string): string => text,
  } as unknown as AgentHost
}

interface Answer {
  status: number
  headers: Record<string, string | string[] | undefined>
  body: string
}

let server: Server
let port = 0

beforeAll(async () => {
  const db = new DashboardDatabase({ dbPath: ':memory:' })
  const router = createRouter({ db, agentHost: seamHost() } as unknown as Parameters<typeof createRouter>[0])
  server = createServer(router)
  await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready))
  const address = server.address()
  port = typeof address === 'object' && address !== null ? address.port : 0
})

afterAll(async () => {
  server.closeAllConnections()
  await new Promise<void>((closed) => server.close(() => { closed() }))
})

async function send(
  method: string,
  path: string,
  headers: Record<string, string>,
  body?: string,
): Promise<Answer> {
  return await new Promise<Answer>((resolve, reject) => {
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port,
        path,
        method,
        headers: { host: `127.0.0.1:${String(port)}`, ...headers },
      },
      (res) => {
        let text = ''
        res.setEncoding('utf8')
        res.on('data', (chunk: string) => { text += chunk })
        res.on('end', () => { resolve({ status: res.statusCode ?? 0, headers: res.headers, body: text }) })
      },
    )
    req.on('error', reject)
    if (body !== undefined) req.write(body)
    req.end()
  })
}

async function preflight(path: string): Promise<Answer> {
  return await send('OPTIONS', path, {
    origin: 'https://evil.example',
    'access-control-request-method': 'POST',
    'access-control-request-headers': 'content-type',
  })
}

describe('430 run-confirm preflight is answered ahead of the shared OPTIONS arm', () => {
  // RE-SPELLED 2026-10-01 (432-14): was RUN-CONFIRM-PREFLIGHT-NO-GRANT, the pair's own grant-less
  // preflight. The pair and its preflight arm are deleted, so both paths now get the shared arm's
  // answer, byte for byte the answer every other path gets.
  it.each(['/api/run-confirm/answer', '/api/run-confirm/channel'])(
    'C432-CONFIRM-ROUTES-404: the retired preflight of %s is the shared arm, like any path',
    async (path) => {
      const retired = await preflight(path)
      const control = await preflight('/api/runs')
      expect(retired.status).toBe(204)
      expect(retired.headers['access-control-allow-origin']).toBe(control.headers['access-control-allow-origin'])
      expect(retired.headers['access-control-allow-methods']).toBe(control.headers['access-control-allow-methods'])
      expect(retired.body).toBe(control.body)
    },
  )

  it('SHARED-ARM-PREFLIGHT-GRANTS-WILDCARD (contrast)', async () => {
    const answer = await preflight('/api/runs')
    expect(answer.status).toBe(204)
    expect(answer.headers['access-control-allow-origin']).toBe('*')
    expect(answer.headers['access-control-allow-methods']).toBe('GET, POST, PUT, DELETE, OPTIONS')
  })
})

// The surviving same-site mutating doors, each driven once from another origin. Every one of them
// refuses before it reads a body, so the credential and editor doors are safe to drive here: the
// refusal is the only branch a cross-site request reaches.
const RETAINED_SAME_SITE_MUTATIONS: ReadonlyArray<readonly [string, string]> = [
  ['POST', '/api/runs/run-432-14/mark'],
  ['POST', '/api/config/undo'],
  ['POST', '/api/live-editor/sessions'],
  ['POST', '/api/auth/credential'],
  ['POST', '/api/auth/credential/move'],
  ['POST', '/api/llm/test'],
  ['DELETE', '/api/auth/cross-site-probe-432-14'],
]

describe('C432-DASHBOARD-CROSS-SITE', () => {
  it.each(RETAINED_SAME_SITE_MUTATIONS)(
    'C432-DASHBOARD-CROSS-SITE: %s %s refuses a page on another origin with no grant and no dispatch',
    async (method, path) => {
      invocations.length = 0
      const hostile: Array<Record<string, string>> = [
        { origin: 'https://evil.example', 'content-type': 'text/plain;charset=UTF-8' },
        { origin: 'https://evil.example', 'content-type': 'application/json' },
        { origin: 'null', 'content-type': 'application/json' },
        {
          origin: `http://127.0.0.1:${String(port)}`,
          'sec-fetch-site': 'cross-site',
          'content-type': 'application/json',
        },
      ]
      for (const headers of hostile) {
        const body = method === 'DELETE' ? undefined : JSON.stringify({ kind: 'false-fail' })
        const answer = await send(method, path, headers, body)
        expect(answer.status, `${JSON.stringify(headers)} answered ${String(answer.status)}`).toBe(403)
        expect(JSON.parse(answer.body)).toEqual({ error: 'cross_site_refused' })
        expect(answer.headers['access-control-allow-origin']).toBeUndefined()
      }
      expect(invocations, 'a refused request reached the host').toEqual([])
    },
  )

  it('C432-DASHBOARD-CROSS-SITE: the same mark door still dispatches once for its own page and a local client', async () => {
    invocations.length = 0
    const admitted: Array<Record<string, string>> = [
      { origin: `http://127.0.0.1:${String(port)}`, 'content-type': 'application/json' },
      { 'content-type': 'application/json' },
    ]
    for (const headers of admitted) {
      const answer = await send('POST', '/api/runs/run-432-14/mark', headers, JSON.stringify({ kind: 'false-fail' }))
      expect(answer.status).toBe(200)
      expect(JSON.parse(answer.body)).toEqual({ kind: 'run-not-found', runId: 'run-432-14' })
    }
    expect(invocations).toEqual(['test:runs-mark', 'test:runs-mark'])
  })
})
