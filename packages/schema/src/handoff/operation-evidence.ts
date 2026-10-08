// Operation-specific evidence an action produced outside the page (436 D-19..D-23). Type-only
// DTOs plus their key sets. No downloaded byte, file path or text preview is ever part of them.

/** One download the action started, as the browser finished it (D-19). */
export interface DownloadEvidence {
  suggestedFilename: string
  /** The filename's extension including the dot, or '' when it has none. */
  extension: string
  /** Byte count of the completed file. */
  size?: number
  /** Lower-case hex sha-256 of the completed file's bytes. */
  sha256?: string
  /** Only 'completed' is evidence that the download happened; the rest never are. */
  state: 'completed' | 'failed' | 'canceled' | 'unfinished'
  /** The browser's failure text for 'failed' and 'canceled'. */
  failure?: string
  /** Started after the capture window of the action before it closed; no action is credited with starting it. */
  late?: true
}

/** One clipboard write the app made during the action (436-11). */
export interface ClipboardEvidence {
  source: 'writeText' | 'write' | 'copy-event'
  text: string
  truncated: boolean
  readBack: 'matched' | 'mismatched' | 'unavailable'
}

/** Evidence that rides the action that produced it (D-22). */
export interface OperationEvidence {
  downloads?: DownloadEvidence[]
  clipboard?: ClipboardEvidence[]
}

/** Whether the step's platform could capture each operation at all (D-23). */
export interface OperationCaptureAvailability {
  download: 'available' | 'unavailable'
  clipboard: 'available' | 'unavailable'
  reason?: string
}

export const DOWNLOAD_EVIDENCE_KEYS = [
  'suggestedFilename',
  'extension',
  'size',
  'sha256',
  'state',
  'failure',
  'late',
] as const satisfies readonly (keyof DownloadEvidence)[]

export const CLIPBOARD_EVIDENCE_KEYS = [
  'source',
  'text',
  'truncated',
  'readBack',
] as const satisfies readonly (keyof ClipboardEvidence)[]

export const OPERATION_CAPTURE_AVAILABILITY_KEYS = [
  'download',
  'clipboard',
  'reason',
] as const satisfies readonly (keyof OperationCaptureAvailability)[]
