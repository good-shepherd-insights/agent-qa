import type { BoundingBox } from '../primitives/bounding-box'
import type { Point } from '../primitives/point'
import type { Ref } from '../primitives/ref'

export interface ElementState {
  enabled: boolean
  focused: boolean
  visible: boolean
  selected?: boolean
  checked?: boolean
  editable?: boolean
  clickable?: boolean
}

export interface ElementLabels {
  testId?: string
  ariaLabel?: string
  placeholder?: string
  title?: string
}

export interface ElementHierarchy {
  parentRef?: Ref
  childRefs?: Ref[]
}

export interface ElementInfo {
  /**
   * Evidence and execution detail only. Never use ref as the identity key:
   * identity is role + nameNormalized plus a same-screen ordinal derived from
   * elements[] order at match time, never stored or reused across runs.
   */
  ref: Ref
  role: string
  /**
   * App-observed DATA. origin: app-observed stamping and injection defenses are
   * deferred to the M2 knowledge-store layer.
   */
  name: string
  /**
   * App-observed DATA normalized from name. origin: app-observed stamping and
   * injection defenses are deferred to the M2 knowledge-store layer.
   */
  nameNormalized: string
  value?: string
  bounds?: BoundingBox
  center?: Point
  state: ElementState
  labels: ElementLabels
  hierarchy?: ElementHierarchy
  attributes: Record<string, string>
  /**
   * App-observed DATA: static text folded into this element from children that are not elements
   * (438 D-02, the row text a planner states). Never part of identity hashing or serialization.
   */
  text?: string
}
