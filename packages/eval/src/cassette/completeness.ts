/** Unified completeness vocabulary extended only when a new missing-evidence kind appears (D-11). */
export type CompletenessStatus = 'complete' | 'evidence-incomplete' | 'anchor-unresolved'

/** Closed set of typed missing-evidence kinds; new kinds extend the enum, not the shape (D-11/D-14). */
export type MissingCassetteEvidenceKind = 'decision-screenshot-ref'

/** One coordinate-bearing missing-evidence fact keyed to a recorded decision (D-11/D-14). */
export interface MissingCassetteEvidence {
  /** Which required evidence role is absent (D-11). */
  kind: MissingCassetteEvidenceKind
  /** Recorded zero-based step position the missing evidence belongs to (D-11). */
  stepIndex: number
  /** Recorded zero-based decision position within the step (D-11). */
  decisionOrdinal: number
}

/** Structured facts explaining whether a cassette can replay and score completely (D-11). */
export interface CassetteCompleteness {
  /**
   * Aggregate status. When blobs are missing and an anchor is unresolved,
   * `evidence-incomplete` wins while both detail fields stay populated (D-11).
   */
  status: CompletenessStatus
  /** Referenced content digests whose bytes were unavailable at extraction (D-11). */
  missingBlobShas?: readonly string[]
  /** Evidence-only ref that could not resolve against the recorded observation (D-11). */
  unresolvedAnchorRef?: string
  /** Nonempty coordinate-bearing missing-evidence facts when any exist (D-11/D-14). */
  missingEvidence?: readonly MissingCassetteEvidence[]
}
