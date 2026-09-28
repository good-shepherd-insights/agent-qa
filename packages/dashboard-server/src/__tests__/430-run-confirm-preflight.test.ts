import { createServer, request as httpRequest, type Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createConfirmRegistry } from '../chat/confirm-registry.js'
import type { AgentHost } from '../chat/host.js'
import { DashboardDatabase } from '../db/database.js'
import { createRouter } from '../server/routes.js'

function seamHost(): AgentHost {
  return {
    registry: {},
    caller: { kind: 'test' },
    invokeFunction: () => Promise.resolve({}),
    unmaskForDisplay: (text: string): string => text,
    confirms: createConfirmRegistry(),
  } as unknown as AgentHost
}

interface Preflight {
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

async function preflight(path: string): Promise<Preflight> {
  return await new Promise<Preflight>((resolve, reject) => {
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port,
        path,
        method: 'OPTIONS',
        headers: {
          host: `127.0.0.1:${String(port)}`,
          origin: 'https://evil.example',
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'content-type',
        },
      },
      (res) => {
        let body = ''
        res.setEncoding('utf8')
        res.on('data', (chunk: string) => { body += chunk })
        res.on('end', () => { resolve({ status: res.statusCode ?? 0, headers: res.headers, body }) })
      },
    )
    req.on('error', reject)
    req.end()
  })
}

describe('430 run-confirm preflight is answered ahead of the shared OPTIONS arm', () => {
  it.each(['/api/run-confirm/answer', '/api/run-confirm/channel'])(
    'RUN-CONFIRM-PREFLIGHT-NO-GRANT %s',
    async (path) => {
      const answer = await preflight(path)
      expect(answer.status).toBe(204)
      expect(answer.headers['access-control-allow-origin']).toBeUndefined()
      expect(answer.headers['access-control-allow-methods']).toBeUndefined()
      expect(answer.headers['access-control-allow-headers']).toBeUndefined()
      expect(answer.headers['content-length']).toBe('0')
      expect(answer.body).toBe('')
    },
  )

  it('SHARED-ARM-PREFLIGHT-GRANTS-WILDCARD (contrast)', async () => {
    const answer = await preflight('/api/runs')
    expect(answer.status).toBe(204)
    expect(answer.headers['access-control-allow-origin']).toBe('*')
    expect(answer.headers['access-control-allow-methods']).toBe('GET, POST, PUT, DELETE, OPTIONS')
  })
})
