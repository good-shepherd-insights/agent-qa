import type { ActionAnnotation } from './annotation'

export interface ActionResult {
  success: boolean
  error?: string
  screenshot?: Uint8Array
  data?: unknown
  metadata?: Record<string, unknown>
  annotation?: ActionAnnotation
}

export type RecordedActionResult = Omit<ActionResult, 'screenshot'> & {
  readonly screenshot?: never
}

export function toRecordedActionResult(result: ActionResult): RecordedActionResult {
  const { screenshot: _screenshot, ...recorded } = result
  void _screenshot

  return recorded as RecordedActionResult
}
