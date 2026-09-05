/**
 * Optional sampling intent/effective values (D-08). An absent field means the provider
 * default and is never fabricated. `maxOutputTokens` is deliberately excluded (D-11):
 * the output ceiling is owned exclusively by `executeClampedCall`.
 */
export interface SamplingParams {
  temperature?: number
  topP?: number
  stop?: string[]
  seed?: number
}

/**
 * The verifier identity projection recorded beside its verdict (D-07).
 */
export interface ModelIdentity {
  provider: string
  modelId: string
}

/**
 * Root-declared decision-context intent (D-05), constructed once per role and threaded
 * to both the call site and recorder so declared, applied, and recorded values share one
 * source (D-09). `maxOutputTokens` is the declared ceiling that feeds the clamp's default
 * input, not a second writer. This evidence vocabulary is deliberately distinct from
 * `model-profile/model-profile.ts`'s `ModelProfile`, which describes model configuration.
 */
export interface DeclaredModelProfile {
  provider: string
  modelId: string
  vision: boolean
  maxOutputTokens?: number
  sampling?: SamplingParams
}

/**
 * Per-call observed reality for the final, decision-producing response of a planning
 * turn (D-05). Every enrichment is optional (D-08): providers may omit the resolved id
 * or fingerprint, and effective values are recorded only when known, never fabricated.
 */
export interface ModelCallRecord {
  resolvedModelId?: string
  fingerprint?: string
  effectiveMaxOutputTokens?: number
  effectiveSampling?: SamplingParams
  /**
   * Sorted, deduplicated feature names from typed unsupported provider warnings across the
   * planning turn. Absent when the provider warned about no unsupported feature.
   */
  unsupportedFeatures?: readonly string[]
}
