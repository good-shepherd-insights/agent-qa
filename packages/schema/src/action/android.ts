import type { NoPlatform } from './shared'

type AndroidIntentExtra = {
  key: string
  type: 'string' | 'int' | 'long' | 'float' | 'bool'
  value: string
}

export type AndroidAction = NoPlatform & (
  | { type: 'pressBack' }
  | { type: 'pressHome' }
  | { type: 'pressRecent' }
  | { type: 'openNotifications' }
  | { type: 'openQuickSettings' }
  | {
    type: 'intent'
    action: string
    data?: string
    packageName?: string
    extras?: AndroidIntentExtra[]
  }
  | { type: 'keyevent'; keycode: string }
)
