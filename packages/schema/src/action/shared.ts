import type { Ref } from '../primitives/ref'

export interface RefTargeted {
  ref: Ref
}

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
