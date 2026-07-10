/** Unified completeness vocabulary extended only when a new missing-evidence kind appears (D-11). */
export type CompletenessStatus = 'complete' | 'evidence-incomplete' | 'anchor-unresolved'

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
}
