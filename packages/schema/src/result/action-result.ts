import type { ActionAnnotation } from './annotation'

export interface ActionResult {
  success: boolean
  error?: string
  screenshot?: Uint8Array
  data?: unknown
  metadata?: Record<string, unknown>
  annotation?: ActionAnnotation
}
