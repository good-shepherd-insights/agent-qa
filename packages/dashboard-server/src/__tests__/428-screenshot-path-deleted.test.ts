// THE EDITOR'S SECOND IMAGE PIPELINE IS GONE (428 SC1 · D-07 · PXH-LIVE-01).
//
// The editor page watches its session through the frame hub and the shared embed, so the control
// socket no longer carries base64 screenshots. These cells red the server half's return: the
// request and reply message members, their handler case and LiveSession's screenshot getter. The
// hub's snapshot producer captures through the adapter itself (liveStreamFor), not through the
// session. A stale page that still sends the retired request gets the handler's unknown-type
// error, never a picture.
//
// THE NEEDLES ARE CONCATENATED so this file cannot match itself.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it, vi } from 'vitest'

import type { LiveSession } from '../live-editor/live-session.js'
import type { SessionState } from '../live-editor/types.js'
import { createSessionHandler } from '../live-editor/ws-handler.js'

const LIVE_EDITOR = join(dirname(fileURLToPath(import.meta.url)), '..', 'live-editor')

const RETIRED_REQUEST = 'get-' + 'screenshot'
const RETIRED_REPLY = 'screen' + 'shot'
const RETIRED_GETTER = 'get' + 'Screenshot'

function source(file: string): string {
  return readFileSync(join(LIVE_EDITOR, file), 'utf8')
}

class StaleClientSocket {
  readyState = 1
  OPEN = 1
  sent: Array<Record<string, unknown>> = []
  private handlers = new Map<string, (...args: unknown[]) => void>()

  send(data: string): void {
    this.sent.push(JSON.parse(data))
  }

  close(): void {}

  on(event: string, handler: (...args: unknown[]) => void): void {
    this.handlers.set(event, handler)
  }

  message(msg: object): void {
    this.handlers.get('message')?.(Buffer.from(JSON.stringify(msg)))
  }
}

function sessionThatCouldStillCapture() {
  const state: SessionState = {
    sessionId: 'stale-client-session',
    platform: 'web',
    status: 'idle',
    currentStep: null,
    currentUrl: null,
    stepsExecuted: 0,
    createdAt: Date.now(),
    interactive: true,
    terminalError: null,
  }
  let generation = 0
  const capture = vi.fn().mockResolvedValue(Buffer.from('a picture'))
  const session = {
    sessionId: state.sessionId,
    status: 'idle',
    getState: vi.fn().mockReturnValue(state),
    [RETIRED_GETTER]: capture,
    cleanup: vi.fn().mockResolvedValue(undefined),
    startIdleTimer: vi.fn(),
    clearIdleTimer: vi.fn(),
    attachMessageSink: vi.fn(),
    beginAttachment: vi.fn(() => ++generation),
    isCurrentAttachment: vi.fn((candidate: number) => candidate === generation),
  } as unknown as LiveSession
  return { session, capture }
}

describe('428 the editor screenshot path is deleted', () => {
  it('SERVER-HAS-NO-SCREENSHOT-MESSAGE: the control socket declares and handles neither message', () => {
    for (const file of ['ws-handler.ts', 'types.ts']) {
      const text = source(file)
      expect(text, `${file} names the retired request`).not.toContain(`'${RETIRED_REQUEST}'`)
      expect(text, `${file} names the retired reply`).not.toContain(`'${RETIRED_REPLY}'`)
    }
  })

  it('SERVER-HAS-NO-SCREENSHOT-MESSAGE: LiveSession declares no screenshot getter', () => {
    const text = source('live-session.ts')
    expect(text).not.toMatch(new RegExp(`\\b${RETIRED_GETTER}\\s*\\(`))
    expect(source('ws-handler.ts')).not.toContain(RETIRED_GETTER)
  })

  it('STALE-CLIENT-GETS-UNKNOWN-TYPE: the retired request answers the unknown-type error and no picture', async () => {
    const { session, capture } = sessionThatCouldStillCapture()
    const ws = new StaleClientSocket()
    createSessionHandler(session, vi.fn())(ws as never)
    const greeting = ws.sent.length

    ws.message({ type: RETIRED_REQUEST })
    await vi.waitFor(() => expect(ws.sent.length).toBe(greeting + 1))

    expect(ws.sent[greeting]).toEqual({
      type: 'error',
      message: `Unknown message type: ${RETIRED_REQUEST}`,
    })
    expect(ws.sent.filter((msg) => msg.type === RETIRED_REPLY)).toEqual([])
    expect(capture).not.toHaveBeenCalled()
  })
})
