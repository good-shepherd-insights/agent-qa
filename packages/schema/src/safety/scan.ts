export type ScanAction = 'pass' | 'redact' | 'block'

export interface ScanResult {
  action: ScanAction
  detector?: string
  redactedFingerprint?: string
}
