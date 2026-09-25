// THE GUARDED LIVE-EDITOR SURFACE (428-11 · D-07/D-08 · RESEARCH P5/P6 · WINDOWS #275).
//
// Every cell drives the production `startServer({ db, port: 0, … })`: the routes, the upgrade arm
// and the session manager are the ones `agent-qa dashboard` runs. Requests go through `node:http`
// so the cells choose the exact `Origin` and `Sec-Fetch-Site` a browser would send; the `Host` is
// the one Node writes for the loopback address the server listens on.

import { request as httpRequest } from 'node:http'
import type { IncomingHttpHeaders } from 'node:http'
import type { AddressInfo } from 'node:net'

import type { EditorLiveUrlResult, LiveUrlVerdict } from '@vostride/agent-qa-schema'
import WebSocket from 'ws'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DashboardDatabase } from '../db/database.js'
import { LIVE_EDITOR_UNKNOWN_SESSION_CLOSE_CODE } from '../live-editor/types.js'
import { startServer } from '../server/server.js'

const FOREIGN_ORIGIN = 'http://evil.example'

interface Served {
  readonly port: number
  readonly selfOrigin: string
  close(): void
}

const opened: Served[] = []

afterEach(() => {
  while (opened.length > 0) opened.pop()?.close()
})

type EditorMint = (sessionId: string) => Promise<EditorLiveUrlResult>

async function serve(input: { mintEditorLiveUrl?: EditorMint; liveView?: false } = {}): Promise<Served> {
  const db = new DashboardDatabase({ dbPath: ':memory:' })
  const refuseEverything = (): LiveUrlVerdict =>
    ({ kind: 'refused', reason: 'malformed' }) as unknown as LiveUrlVerdict
  const started = await startServer({
    db,
    port: 0,
    ...(input.liveView === false
      ? {}
      : {
          liveView: {
            validate: refuseEverything,
            mintLiveUrl: async () => { throw new Error('this fixture mints no run view') },
            ...(input.mintEditorLiveUrl === undefined ? {} : { mintEditorLiveUrl: input.mintEditorLiveUrl }),
          },
        }),
  })
  const port = (started.server.address() as AddressInfo).port
  const served: Served = {
    port,
    selfOrigin: `http://127.0.0.1:${String(port)}`,
    close: () => { started.close() },
  }
  opened.push(served)
  return served
}

interface Answer {
  readonly status: number
  readonly headers: IncomingHttpHeaders
  readonly body: string
  json(): unknown
}

function call(
  served: Served,
  method: string,
  path: string,
  headers: Record<string, string> = {},
  body?: string,
): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      host: '127.0.0.1',
      port: served.port,
      method,
      path,
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...headers,
      },
    }, (res) => {
      let text = ''
      res.setEncoding('utf8')
      res.on('data', (chunk: string) => { text += chunk })
      res.on('end', () => {
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers,
          body: text,
          json: () => JSON.parse(text) as unknown,
        })
      })
    })
    req.on('error', reject)
    if (body !== undefined) req.write(body)
    req.end()
  })
}

interface UpgradeOutcome {
  /** True only when the server answered `101 Switching Protocols`. */
  readonly switched: boolean
  readonly closeCode: number | undefined
  readonly closeReason: string
}

function upgradeControlSocket(
  served: Served,
  sessionId: string,
  origin?: string,
): Promise<UpgradeOutcome> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(
      `ws://127.0.0.1:${String(served.port)}/api/live-editor/ws?sessionId=${encodeURIComponent(sessionId)}`,
      origin === undefined ? {} : { origin },
    )
    let switched = false
    const budget = setTimeout(() => {
      socket.terminate()
      reject(new Error('the upgrade neither closed nor failed within 5000 ms'))
    }, 5_000)
    socket.on('upgrade', () => { switched = true })
    socket.on('error', () => { /* a destroyed upgrade reports here and then closes */ })
    socket.on('close', (code: number, reason: Buffer) => {
      clearTimeout(budget)
      resolve({ switched, closeCode: switched ? code : undefined, closeReason: reason.toString('utf8') })
    })
  })
}

const MINTED: EditorLiveUrlResult = {
  liveUrl: 'http://127.0.0.1:3470/live/session-1#t=v1.token',
  expiresAt: 1_900_000_000_000,
  stream: { kind: 'cdp-screencast' },
}

function namedError(name: string): Error {
  const error = new Error(`a ${name}`)
  error.name = name
  return error
}

describe('EDITOR-MINT-ROUTE: GET /api/live-editor/sessions/:id/live-url', () => {
  it('EDITOR-MINT-ROUTE answers the mint result verbatim, with no wildcard grant', async () => {
    const mint = vi.fn<EditorMint>(async () => MINTED)
    const served = await serve({ mintEditorLiveUrl: mint })

    const answer = await call(served, 'GET', '/api/live-editor/sessions/session-1/live-url')

    expect(answer.status).toBe(200)
    expect(answer.json()).toEqual(MINTED)
    expect(answer.headers['access-control-allow-origin']).toBeUndefined()
    expect(mint).toHaveBeenCalledWith('session-1')
  })

  it('EDITOR-MINT-ROUTE maps UnknownLiveEditorSessionError to 404 unknown_session', async () => {
    const served = await serve({
      mintEditorLiveUrl: async () => { throw namedError('UnknownLiveEditorSessionError') },
    })

    const answer = await call(served, 'GET', '/api/live-editor/sessions/gone/live-url')

    expect(answer.status).toBe(404)
    expect(answer.json()).toEqual({ error: 'unknown_session' })
    expect(answer.headers['access-control-allow-origin']).toBeUndefined()
  })

  it('EDITOR-MINT-ROUTE maps LiveViewUnavailableError to 503 live_view_unavailable', async () => {
    const served = await serve({
      mintEditorLiveUrl: async () => { throw namedError('LiveViewUnavailableError') },
    })

    const answer = await call(served, 'GET', '/api/live-editor/sessions/session-1/live-url')

    expect(answer.status).toBe(503)
    expect(answer.json()).toEqual({ error: 'live_view_unavailable' })
  })

  it('EDITOR-MINT-ROUTE maps any other failure to 500 live_url_mint_failed', async () => {
    const served = await serve({ mintEditorLiveUrl: async () => { throw new Error('boom') } })

    const answer = await call(served, 'GET', '/api/live-editor/sessions/session-1/live-url')

    expect(answer.status).toBe(500)
    expect(answer.json()).toEqual({ error: 'live_url_mint_failed' })
  })

  it('EDITOR-MINT-ROUTE answers 503 live_view_unavailable when no editor mint is bound', async () => {
    const withoutMint = await serve()
    const withoutLiveView = await serve({ liveView: false })

    for (const served of [withoutMint, withoutLiveView]) {
      const answer = await call(served, 'GET', '/api/live-editor/sessions/session-1/live-url')
      expect(answer.status).toBe(503)
      expect(answer.json()).toEqual({ error: 'live_view_unavailable' })
      expect(answer.headers['access-control-allow-origin']).toBeUndefined()
    }
  })

  it('EDITOR-MINT-ROUTE refuses a cross-site caller before the mint is dispatched', async () => {
    const mint = vi.fn<EditorMint>(async () => MINTED)
    const served = await serve({ mintEditorLiveUrl: mint })

    const answer = await call(served, 'GET', '/api/live-editor/sessions/session-1/live-url', {
      origin: FOREIGN_ORIGIN,
    })

    expect(answer.status).toBe(403)
    expect(answer.json()).toEqual({ error: 'cross_site_refused' })
    expect(answer.headers['access-control-allow-origin']).toBeUndefined()
    expect(mint).not.toHaveBeenCalled()
  })

  it('EDITOR-MINT-ROUTE leaves DELETE /api/live-editor/sessions/:id to its own arm', async () => {
    const served = await serve({ mintEditorLiveUrl: async () => MINTED })

    const answer = await call(served, 'DELETE', '/api/live-editor/sessions/never-created')

    expect(answer.status).toBe(404)
    expect(answer.json()).toEqual({ error: 'Session not found' })
  })
})

describe('the control-socket upgrade: /api/live-editor/ws', () => {
  it('EDITOR-UPGRADE-CROSS-SITE-DESTROYED: a foreign Origin gets no 101', async () => {
    const served = await serve()

    const outcome = await upgradeControlSocket(served, 'any-session', FOREIGN_ORIGIN)

    expect(outcome.switched, 'a cross-site upgrade is destroyed bare').toBe(false)
  })

  it('EDITOR-UPGRADE-CROSS-SITE-DESTROYED: the literal null Origin gets no 101', async () => {
    const served = await serve()

    const outcome = await upgradeControlSocket(served, 'any-session', 'null')

    expect(outcome.switched, 'null is an origin that declined to name itself').toBe(false)
  })

  it('EDITOR-UPGRADE-ADMITS-SAME-ORIGIN: a same-host Origin is admitted and then named', async () => {
    const served = await serve()

    const outcome = await upgradeControlSocket(served, 'unknown-session', served.selfOrigin)

    expect(outcome.switched, 'the dashboard page driving its own socket is admitted').toBe(true)
    expect(outcome.closeCode).toBe(LIVE_EDITOR_UNKNOWN_SESSION_CLOSE_CODE)
  })

  it('EDITOR-UPGRADE-ADMITS-SAME-ORIGIN: an absent Origin is admitted and then named', async () => {
    const served = await serve()

    const outcome = await upgradeControlSocket(served, 'unknown-session')

    expect(outcome.switched, 'a non-browser client sends no Origin and is admitted').toBe(true)
    expect(outcome.closeCode).toBe(LIVE_EDITOR_UNKNOWN_SESSION_CLOSE_CODE)
  })

  it('EDITOR-UPGRADE-UNKNOWN-SESSION-4404: an unknown session closes 4404 unknown_session', async () => {
    const served = await serve()

    const outcome = await upgradeControlSocket(served, 'session-this-process-never-held')

    expect(LIVE_EDITOR_UNKNOWN_SESSION_CLOSE_CODE).toBe(4404)
    expect(outcome.switched).toBe(true)
    expect(outcome.closeCode).toBe(4404)
    expect(outcome.closeReason).toBe('unknown_session')
  })
})
