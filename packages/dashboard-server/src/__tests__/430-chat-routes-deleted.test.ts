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
  method: 'GET' | 'POST',
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

describe('C430-RUN-CONFIRM-PREFIX-STILL-ROUTED', () => {
  it('C430-RUN-CONFIRM-PREFIX-STILL-ROUTED: a malformed run-confirm answer gets the confirm router refusal, with no grant', async () => {
    const answer = await probe('POST', RUN_CONFIRM_ANSWER, {
      headers: { ...sameOrigin(), 'content-type': 'application/json' },
      body: JSON.stringify({ malformed: true }),
    })
    expect(answer.status).toBe(400)
    expect(answer.contentType).toBe('application/json')
    expect(JSON.parse(answer.body)).toEqual({ error: 'Invalid request body' })
    expect(answer.allowOrigin).toBeUndefined()
  })

  it('C430-RUN-CONFIRM-PREFIX-STILL-ROUTED: the run-confirm channel opens its stream, with no grant', async () => {
    const answer = await probe('GET', RUN_CONFIRM_CHANNEL, { headers: sameOrigin() })
    expect(answer.status).toBe(200)
    expect(answer.contentType).toBe('text/event-stream')
    expect(answer.allowOrigin).toBeUndefined()
  })
})
