import type { Ref } from '../primitives/ref'
import type { NoPlatform, RefTargeted } from './shared'

export type CrossPlatformAction = NoPlatform & (
  | { type: 'assert'; condition: string; expected?: string; visual?: boolean }
  | { type: 'waitFor'; condition: string; timeout?: number }
  | { type: 'delay'; ms: number }
  | { type: 'scroll'; scrollType: 'vertical' | 'horizontal'; value: number; ref?: Ref; duration?: number }
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
)
