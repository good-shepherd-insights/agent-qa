import type { Point } from '../primitives/point'
import type { Ref } from '../primitives/ref'
import type { Fill } from './params'
import type { NoPlatform, RefTargeted, TabSelector } from './shared'

type WebRefTargeted = RefTargeted & { ref: Ref }

export type WebAction = NoPlatform & (
  | { type: 'navigate'; to: 'url'; url: string }
  | { type: 'navigate'; to: 'back' }
  | { type: 'navigate'; to: 'forward' }
  | { type: 'navigate'; to: 'reload' }
  | { type: 'waitForUrl'; pattern: string }
  | ({ type: 'click'; clickDelay?: number } & WebRefTargeted)
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
  | { type: 'web_inspect'; what: 'console'; level?: 'log' | 'info' | 'warn' | 'error'; tab?: TabSelector }
  | { type: 'web_inspect'; what: 'network'; urlPattern?: string; tab?: TabSelector }
  | { type: 'web_inspect'; what: 'cookies'; name?: string }
  | { type: 'web_inspect'; what: 'localStorage'; key?: string }
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
