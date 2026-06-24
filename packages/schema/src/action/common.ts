import type { Scroll, WaitFor } from './params'
import type { NoPlatform, RefTargeted } from './shared'

export type CommonAction = NoPlatform & (
  | { type: 'assert'; condition: string; expected?: string; visual?: boolean }
  | ({ type: 'waitFor' } & WaitFor)
  | { type: 'delay'; ms: number }
  | ({ type: 'scroll' } & Scroll)
  | ({ type: 'clearText' } & RefTargeted)
  | {
      type: 'openLink'
      url: string
      appId?: string
      bundleId?: string
      appPackage?: string
      waitForLaunch?: boolean
    }
  | { type: 'executeScript'; command: string; args?: unknown }
  | { type: 'setVariable'; name: string; value: string }
  | { type: 'keypress'; keys: string[]; convertPlatformKeys?: boolean }
)
