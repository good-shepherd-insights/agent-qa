import type { Point } from '../primitives/point'
import type { Ref } from '../primitives/ref'
import type { Fill } from './params'
import type { DesiredState, NoPlatform, RefTargeted, TabSelector } from './shared'

type WebRefTargeted = RefTargeted & { ref: Ref }

export type WebAction = NoPlatform & (
  | { type: 'navigate'; to: 'url'; url: string }
  | { type: 'navigate'; to: 'back' }
  | { type: 'navigate'; to: 'forward' }
  | { type: 'navigate'; to: 'reload' }
  | { type: 'waitForUrl'; pattern: string }
  | ({ type: 'click'; clickDelay?: number; desiredState?: DesiredState } & WebRefTargeted)
  | ({ type: 'doubleClick'; relativePosition?: Point; clickDelay?: number } & WebRefTargeted)
  | ({ type: 'rightClick'; relativePosition?: Point; clickDelay?: number } & WebRefTargeted)
  | ({ type: 'fill' } & Fill)
  | ({ type: 'select'; value: string } & WebRefTargeted)
  | ({ type: 'hover' } & WebRefTargeted)
  | ({ type: 'paste'; value: string } & WebRefTargeted)
  | ({ type: 'copy' } & WebRefTargeted)
  | ({ type: 'fileUpload'; files: string[] } & WebRefTargeted)
  | { type: 'tab'; action: 'new'; url: string }
  | ({ type: 'tab'; action: 'switch' } & TabSelector)
  | { type: 'inspect'; what: 'console'; level?: 'log' | 'info' | 'warn' | 'error'; tab?: TabSelector }
  | { type: 'inspect'; what: 'network'; urlPattern?: string; tab?: TabSelector }
  | { type: 'inspect'; what: 'cookies'; name?: string }
  | { type: 'inspect'; what: 'localStorage'; key?: string }
  | {
      type: 'route'
      urlPattern: string
      headers?: Record<string, string>
      body?: string
      contentType?: string
    }
  | { type: 'unroute'; urlPattern?: string }
  | { type: 'networkState'; mode: 'offline' }
  | {
      type: 'networkState'
      mode: 'throttle'
      latencyMs: number
      downloadKbps: number
      uploadKbps: number
    }
  | { type: 'storageState'; op: 'save'; name: string }
  | { type: 'storageState'; op: 'restore'; name: string }
  | { type: 'handleDialog'; accept: boolean; promptText?: string }
  | { type: 'uniqueValue'; prefix: string }
  | ({ type: 'focus' } & WebRefTargeted)
  | {
      type: 'setCookies'
      cookies: Array<{
        name: string
        value: string
        domain?: string
        path?: string
        httpOnly?: boolean
        secure?: boolean
        sameSite?: 'Strict' | 'Lax' | 'None'
        expires?: number
      }>
    }
  | { type: 'setLocalStorage'; entries: Array<{ key: string; value: string }> }
)
