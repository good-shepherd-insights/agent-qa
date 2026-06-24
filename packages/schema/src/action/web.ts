import type { Point } from '../primitives/point'
import type { Ref } from '../primitives/ref'
import type { Fill } from './params'
import type { NoPlatform, RefTargeted, TabSelector } from './shared'

type WebRefTargeted = RefTargeted & { ref: Ref }

export type WebAction = NoPlatform & (
  | { type: 'navigate'; url: string }
  | { type: 'refresh' }
  | { type: 'navigateHistory'; direction: 'back' | 'forward' }
  | { type: 'waitForUrl'; pattern: string }
  | ({ type: 'click'; clickDelay?: number } & WebRefTargeted)
  | ({ type: 'doubleClick'; relativePosition?: Point; clickDelay?: number } & WebRefTargeted)
  | ({ type: 'rightClick'; relativePosition?: Point; clickDelay?: number } & WebRefTargeted)
  | ({ type: 'fill' } & Fill)
  | ({ type: 'select'; value: string } & WebRefTargeted)
  | ({ type: 'hover' } & WebRefTargeted)
  | { type: 'keyDown'; key: string }
  | { type: 'keyUp'; key: string }
  | ({ type: 'paste'; value: string } & WebRefTargeted)
  | ({ type: 'copy' } & WebRefTargeted)
  | ({ type: 'fileUpload'; files: string[] } & WebRefTargeted)
  | { type: 'newTab'; url: string }
  | ({ type: 'switchTab' } & TabSelector)
  | { type: 'readConsoleLogs'; level?: 'log' | 'info' | 'warn' | 'error'; tab?: TabSelector }
  | { type: 'readNetworkLogs'; urlPattern?: string; tab?: TabSelector }
  | { type: 'readCookies'; name?: string }
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
  | { type: 'readLocalStorage'; key?: string }
  | { type: 'setLocalStorage'; entries: Array<{ key: string; value: string }> }
)
