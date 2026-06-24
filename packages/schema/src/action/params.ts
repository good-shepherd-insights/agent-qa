import type { Point } from '../primitives/point'
import type { Ref } from '../primitives/ref'

// Defaults are modeled as required here because these types represent post-parse output.
export type Fill = {
  ref: Ref
  text: string
  clearMode: 'replace' | 'append'
  submit: boolean
}

export type Scroll =
  | {
      mode: 'direction'
      direction: 'up' | 'down' | 'left' | 'right'
      ref?: Ref
      amount: 'page' | 'halfPage' | 'toEnd'
      retryOpposite: boolean
    }
  | {
      mode: 'untilVisible'
      target: string
      ref?: Ref
      direction: 'up' | 'down' | 'left' | 'right'
      maxSwipes: number
      retryOpposite: boolean
    }

export type WaitFor =
  | { on: 'text'; text: string; timeoutMs: number }
  | { on: 'selector'; selector: string; timeoutMs: number }
  | { on: 'gone'; text: string; timeoutMs: number }

type SwipeBase = {
  type: 'swipe'
  direction: 'up' | 'down' | 'left' | 'right'
  ref?: Ref
  duration?: number
}

export type SwipeByDirection = SwipeBase & { start?: never; end?: never }
export type SwipeByPath = SwipeBase & { start: Point; end: Point }
