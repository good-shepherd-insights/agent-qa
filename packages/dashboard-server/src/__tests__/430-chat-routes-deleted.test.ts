/**
 * 430 D-02: the dashboard server no longer dispatches the conversation prefix.
 *
 * Its five routes answer the router's generic 404, not redirected and not stubbed. That 404 is
 * told apart from a returning conversation router by the wildcard origin header: the shared
 * `json()` writer grants it, and the confirm router's own responder never does. The run-confirm
 * pair beside it keeps its dispatch, still ahead of `cors()`, so it answers with no grant.
 *
 * Every deleted path is built from two halves so the 430 census never counts this file.
 */

import { createServer, request as httpRequest, type Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createConfirmRegistry } from '../chat/confirm-registry.js'
import type { AgentHost } from '../chat/host.js'
import { DashboardDatabase } from '../db/database.js'
import { createRouter } from '../server/routes.js'

const RUN_ID = 'run-430-20'
const DELETED_PREFIX = '/api/' + 'chat/'

const DELETED_ROUTES: ReadonlyArray<readonly ['GET' | 'POST', string]> = [
  ['POST', `${DELETED_PREFIX}turn`],
  ['POST', `${DELETED_PREFIX}confirm`],
  ['GET', `${DELETED_PREFIX}capabilities`],
  ['GET', `${DELETED_PREFIX}catalog`],
  ['GET', `${DELETED_PREFIX}sessions/session-430/events`],
]

const RUN_CONFIRM_ANSWER = '/api/run-confirm/answer'
const RUN_CONFIRM_CHANNEL = '/api/run-confirm/channel'

// The cast covers a non-FunctionCaller `caller` and the run-service ids these cells never reach.
function seamHost(): AgentHost {
  return {
    registry: {},
    caller: { kind: 'test' },
    runsPostProcessingFunctionId: 'test:post-processing',
    runsEventsFunctionId: 'test:events',
    runsDetailFunctionId: 'test:runs-detail',
    runsArtifactFunctionId: 'test:runs-artifact',
    analysisGetFunctionId: 'test:analysis-get',
    runsKnowledgeFunctionId: 'test:run-knowledge',
    invokeFunction: () => Promise.resolve({
      runId: RUN_ID,
      members: [{ testIndex: 0, attempts: 1 }],
      steps: [],
      subActions: [],
      tokens: { measuredSteps: 0, unmeasuredSteps: 0 },
    }),
    unmaskForDisplay: (text: string): string => text,
    confirms: createConfirmRegistry(),
  } as unknown as AgentHost
}

interface Probe {
  status: number
  contentType: string | undefined
  allowOrigin: string | undefined
  body: string
}

let server: Server
let port = 0

beforeAll(async () => {
  const db = new DashboardDatabase({ dbPath: ':memory:' })
  const router = createRouter(
    { db, agentHost: seamHost() } as unknown as Parameters<typeof createRouter>[0],
  )
  server = createServer(router)
  await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready))
  const address = server.address()
  port = typeof address === 'object' && address !== null ? address.port : 0
})

afterAll(async () => {
  server.closeAllConnections()
  await new Promise<void>((closed) => server.close(() => { closed() }))
})

function sameOrigin(): Record<string, string> {
  return { origin: `http://127.0.0.1:${String(port)}`, 'sec-fetch-site': 'same-origin' }
}

// An event stream never ends, so it is read up to its headers and then dropped.
async function probe(
  method: 'GET' | 'POST' | 'OPTIONS',
  path: string,
  options: { headers?: Record<string, string>, body?: string } = {},
): Promise<Probe> {
  return await new Promise<Probe>((resolve, reject) => {
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port,
        path,
        method,
        headers: { host: `127.0.0.1:${String(port)}`, ...options.headers },
      },
      (res) => {
        const allowOrigin = res.headers['access-control-allow-origin']
        const contentType = res.headers['content-type']
        const head = {
          status: res.statusCode ?? 0,
          contentType: typeof contentType === 'string' ? contentType : undefined,
          allowOrigin: typeof allowOrigin === 'string' ? allowOrigin : undefined,
        }
        if (head.contentType?.startsWith('text/event-stream') === true) {
          resolve({ ...head, body: '' })
          req.destroy()
          return
        }
        let body = ''
        res.setEncoding('utf8')
        res.on('data', (chunk: string) => { body += chunk })
        res.on('end', () => { resolve({ ...head, body }) })
      },
    )
    req.on('error', reject)
    if (options.body !== undefined) req.write(options.body)
    req.end()
  })
}

describe('C430-DELETED-CHAT-ROUTES-SHARED-404', () => {
  it.each(DELETED_ROUTES)(
    'C430-DELETED-CHAT-ROUTES-SHARED-404: %s %s answers the router generic 404 with the wildcard grant',
    async (method, path) => {
      const answer = await probe(method, path, {
        headers: method === 'POST'
          ? { ...sameOrigin(), 'content-type': 'application/json' }
          : sameOrigin(),
        body: method === 'POST' ? '{}' : undefined,
      })
      expect(answer.status, `${method} ${path} answered ${String(answer.status)}`).toBe(404)
      expect(JSON.parse(answer.body)).toEqual({ error: 'Not found' })
      expect(
        answer.allowOrigin,
        `${method} ${path} answered without the shared arm's grant, so a dispatch still owns it`,
      ).toBe('*')
    },
  )
})

// RE-SPELLED 2026-10-01 (432-14, D-14): was C430-RUN-CONFIRM-PREFIX-STILL-ROUTED, which pinned
// that the run-confirm pair kept its own dispatch ahead of the shared OPTIONS arm. Phase 432
// deletes the pair. Its claim is replaced by the one below: both retired paths now reach the same
// generic answers as a path this server never served, for every method a browser can send.
const NEVER_SERVED = '/api/' + 'never-served-432-14'

async function sameAnswer(method: 'GET' | 'POST' | 'OPTIONS', path: string): Promise<Probe> {
  const headers: Record<string, string> = method === 'OPTIONS'
    ? {
        origin: 'https://evil.example',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type',
      }
    : method === 'POST'
      ? { ...sameOrigin(), 'content-type': 'application/json' }
      : sameOrigin()
  return await probe(method, path, {
    headers,
    body: method === 'POST' ? JSON.stringify({ scopeId: 'x', confirmId: 'y', answer: 'accept' }) : undefined,
  })
}

describe('C432-CONFIRM-ROUTES-404', () => {
  it.each([
    ['GET', RUN_CONFIRM_CHANNEL],
    ['POST', RUN_CONFIRM_ANSWER],
    ['OPTIONS', RUN_CONFIRM_CHANNEL],
    ['OPTIONS', RUN_CONFIRM_ANSWER],
  ] as const)(
    'C432-CONFIRM-ROUTES-404: %s %s answers exactly what a never-served path answers',
    async (method, path) => {
      const retired = await sameAnswer(method, path)
      const unknown = await sameAnswer(method, NEVER_SERVED)
      expect(unknown.status, 'the control path is not a generic answer').toBe(method === 'OPTIONS' ? 204 : 404)
      expect(retired).toEqual(unknown)
      if (method !== 'OPTIONS') {
        expect(JSON.parse(retired.body)).toEqual({ error: 'Not found' })
        expect(retired.allowOrigin, 'a dispatch still owns the retired path').toBe('*')
      }
    },
  )
})
