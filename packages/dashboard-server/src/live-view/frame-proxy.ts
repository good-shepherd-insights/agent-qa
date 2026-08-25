// The FRAME PROXY (403 D-04/D-06/D-16) — the server end of one viewer's socket.
//
// WHAT IT HOLDS AND WHAT IT DOES NOT. It holds a validator it was HANDED and a run lookup it was
// HANDED. It parses no token, mints nothing, and reads no token off a URL: the first text message
// is the only carriage, and `deps.validate` is the function layer's own `validateLiveUrlToken`
// bound to the same signer that minted (LIVE-02's third prohibition made structural).
//
// D-16: a detach NEVER touches the run. Closing a viewer's socket unsubscribes it from the frame
// hub and clears this socket's timers, and that is the whole of it — no cancel, no teardown, no
// effect a person watching would not expect from closing a window.

import type WebSocket from 'ws'

import type { LiveFrame, LiveFrameSubscription, LiveUrlVerdict, RunSession } from '@vostride/agent-qa-schema'

import {
  LIVE_VIEW_HELLO_MAX_BYTES,
  LIVE_VIEW_PING_MS,
  LIVE_VIEW_REFUSAL_CLOSE_CODE,
  LIVE_VIEW_SLOW_VIEWER_BYTES,
} from './protocol.js'
import type { LiveViewRefusalReason, LiveViewServerMessage } from './protocol.js'

export interface FrameProxyDeps {
  validate(token: string, expect: { runId: string; now: number }): LiveUrlVerdict
  attach(runId: string): RunSession | undefined
  now?: () => number
}

/** Guarded send — the `live-editor/ws-handler.ts` idiom, so a closed socket is never written to. */
function send(ws: WebSocket, message: LiveViewServerMessage): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message))
}

export function createFrameProxy(deps: FrameProxyDeps): (ws: WebSocket, runId: string) => void {
  const now = deps.now ?? ((): number => Date.now())

  return (ws: WebSocket, runId: string): void => {
    let subscription: LiveFrameSubscription | undefined
    let deadline: ReturnType<typeof setTimeout> | undefined
    let ping: ReturnType<typeof setInterval> | undefined
    let greeted = false

    const clearTimers = (): void => {
      if (deadline !== undefined) clearTimeout(deadline)
      if (ping !== undefined) clearInterval(ping)
      deadline = undefined
      ping = undefined
    }

    const refuse = (reason: LiveViewRefusalReason): void => {
      send(ws, { type: 'refused', reason })
      clearTimers()
      subscription?.unsubscribe()
      subscription = undefined
      ws.close(LIVE_VIEW_REFUSAL_CLOSE_CODE, reason)
    }

    /** Arm (or re-arm) the expiry deadline. An unrenewed socket is refused BY NAME, not dropped. */
    const armDeadline = (expiresAt: number): void => {
      if (deadline !== undefined) clearTimeout(deadline)
      const remaining = Math.max(0, expiresAt - now())
      deadline = setTimeout(() => { refuse('expired') }, remaining)
      deadline.unref?.()
    }

    const onFrame = (frame: LiveFrame): void => {
      if (ws.readyState !== ws.OPEN) return
      // SLOW VIEWER: drop the pixels, ack anyway. CDP will not produce frame N+1 until N is acked,
      // so a viewer that cannot keep up must cost itself frames and never cost the producer its
      // stream. A live view that falls behind should skip, not stall.
      if (ws.bufferedAmount > LIVE_VIEW_SLOW_VIEWER_BYTES) {
        subscription?.ack(frame.id)
        return
      }
      send(ws, {
        type: 'frame',
        id: frame.id,
        width: frame.metadata.width,
        height: frame.metadata.height,
      })
      ws.send(frame.bytes)
    }

    const greet = (token: string): void => {
      const verdict = deps.validate(token, { runId, now: now() })
      if (verdict.kind !== 'ok') {
        refuse(verdict.reason)
        return
      }
      const session = deps.attach(runId)
      if (session === undefined) {
        refuse('unknown_run')
        return
      }
      const handle = verdict.claims.handle
      const stream = session.streamCapabilityOf(handle)
      send(ws, { type: 'ready', runId, handle, stream, expiresAt: verdict.claims.exp })
      armDeadline(verdict.claims.exp)
      ping = setInterval(() => {
        if (ws.readyState === ws.OPEN) ws.ping()
      }, LIVE_VIEW_PING_MS)
      ping.unref?.()

      // `{ kind: 'none' }` is an HONEST answer, not a failure: the socket stays open so the page
      // can still receive `ended`, and no painter is ever started.
      if (stream.kind !== 'none') {
        subscription = session.subscribeFrames(handle, onFrame)
      }

      session.done.then(
        () => {
          send(ws, { type: 'ended', reason: 'runFinished' })
          clearTimers()
          ws.close(1000, 'runFinished')
        },
        () => {
          send(ws, { type: 'ended', reason: 'runFinished' })
          clearTimers()
          ws.close(1000, 'runFinished')
        },
      )
    }

    ws.on('message', (data: unknown, isBinary?: boolean) => {
      // A BINARY first message is malformed by definition — the hello is text.
      if (isBinary === true) {
        refuse('malformed')
        return
      }
      const raw = String(data)
      if (raw.length > LIVE_VIEW_HELLO_MAX_BYTES) {
        refuse('malformed')
        return
      }
      let parsed: unknown
      try {
        parsed = JSON.parse(raw)
      } catch {
        refuse('malformed')
        return
      }
      if (typeof parsed !== 'object' || parsed === null) {
        refuse('malformed')
        return
      }
      const message = parsed as { type?: unknown; token?: unknown; id?: unknown }

      if (!greeted) {
        if (message.type !== 'hello' || typeof message.token !== 'string') {
          refuse('malformed')
          return
        }
        greeted = true
        greet(message.token)
        return
      }

      if (message.type === 'ack' && typeof message.id === 'number') {
        subscription?.ack(message.id)
        return
      }
      if (message.type === 'renew' && typeof message.token === 'string') {
        // D-02's silent re-mint, INSIDE the socket: a fresh token extends this viewer's deadline
        // without re-opening anything. It is re-validated in full — a renew is not a lesser check.
        const verdict = deps.validate(message.token, { runId, now: now() })
        if (verdict.kind !== 'ok') {
          refuse(verdict.reason)
          return
        }
        armDeadline(verdict.claims.exp)
        send(ws, { type: 'renewed', expiresAt: verdict.claims.exp })
        return
      }
      refuse('malformed')
    })

    ws.on('close', () => {
      // D-16, AND NOTHING ELSE. Detach releases this viewer's hold and this socket's timers. The
      // run is not consulted, not cancelled, and not told.
      subscription?.unsubscribe()
      subscription = undefined
      clearTimers()
    })

    ws.on('error', () => {
      subscription?.unsubscribe()
      subscription = undefined
      clearTimers()
    })
  }
}
