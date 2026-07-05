import type { Ref } from '../primitives/ref'

/**
 * The schema-owned grounding vocabulary (GROUND-01, D-14). A `TargetDescriptor` is
 * what the planner emits to name a target element instead of a raw ref: the matcher
 * resolves it against a fresh observation at grounding time. One descriptor world is
 * shared by the tool surface, the matcher, and the cache's `GroundedLocator`
 * ({ role, nameNormalized, ordinal? } is structurally assignable here — every field
 * is optional so the cache value shape is unchanged).
 *
 * Pure type-only DTO: no runtime code, no zod, no host APIs (schema ownership contract).
 */
export interface TargetDescriptor {
  /**
   * Accessibility role of the target element (e.g. 'button', 'textbox').
   */
  role?: string
  /**
   * Accessible name of the target. Semantically REQUIRED by the matcher (D-13):
   * although optional at the type level for structural convergence with the cache's
   * `GroundedLocator`, a descriptor that reaches the matcher without a `name` is
   * rejected with a structured grounding error.
   */
  name?: string
  /**
   * RESERVED for bounds-proximity matching (D-06). Not exposed on the M1 tool
   * schemas and defensively rejected by the matcher until proximity matching ships —
   * present in the vocabulary only to reserve the field name.
   */
  near?: string
  /**
   * Same-screen intra-result-set tiebreak only (§A3): the position among elements
   * that share this role + name in the current observation order. Never a
   * cross-run identity — never stored or reused across runs.
   */
  ordinal?: number
}

/**
 * One rung of the ref -> tree-search -> visual grounding ladder (§A8, GROUND-02).
 * Exactly one entry is recorded per rung that runs; an unattempted visual rung
 * records outcome 'skipped'. `resolvedRef` is present only when outcome is 'resolved'.
 */
export interface GroundingAttempt {
  stage: 'ref' | 'tree-search' | 'visual'
  outcome: 'resolved' | 'no-match' | 'skipped'
  resolvedRef?: Ref
}

/**
 * The §A8 grounding evidence block (GROUND-02): the descriptor the grounder was
 * asked to resolve plus the ordered trail of ladder attempts. The descriptor is
 * recorded post-redaction (the loop's redact-before-record ordering, enforced in
 * Plan 07) so untrusted planner text never persists raw into evidence.
 */
export interface GroundingEvidence {
  descriptor: TargetDescriptor
  attempts: GroundingAttempt[]
}
