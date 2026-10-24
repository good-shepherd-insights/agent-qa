import type { Ref } from '../primitives/ref'

export interface RefTargeted {
  ref: Ref
}

/**
 * The optional post-condition a `click`/`tap` intends to leave a toggleable control in
 * (Phase 359 D-13; Phase 360 research Open Question 1). Schema now owns this planner-reachable
 * field so `ActionsFor<P>` is the single truth — the adapters read it, there is NO default
 * (359 D-13 law). Enum replicated byte-for-byte from the 359 runner-side field.
 */
export type DesiredState = 'checked' | 'unchecked' | 'selected' | 'unselected'

export interface NoPlatform {
  readonly platform?: never
}

export type RequireAtLeastOne<T> = {
  [K in keyof T]-?: Required<Pick<T, K>> & Partial<Omit<T, K>>
}[keyof T]

export type TabSelector = RequireAtLeastOne<{
  index: number
  title: string
  url: string
}>
