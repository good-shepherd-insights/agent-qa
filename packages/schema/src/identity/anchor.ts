import type { Platform } from '../action/index'

export type Anchor =
  | { t: 'page'; route: string }
  | { t: 'flow'; name: string }
  | { t: 'el'; role: string; name: string; ordinal?: number }
  | { t: 'platform'; platform: Platform }
  | { t: 'selector'; literal: string }
  | { t: 'error'; message: string }
