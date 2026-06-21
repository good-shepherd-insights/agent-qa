import type { Ref } from '../primitives/ref'

export interface RefTargeted {
  ref: Ref
}

export interface TabSelector {
  index?: number
  title?: string
  url?: string
}
