import type { ArtifactRef } from '../ids/artifact-ref'
import type { RecordId } from '../ids/record-id'
import type { Anchor } from '../identity/anchor'
import type { MemoryOnPathEntry, MisdirectionEvidence } from './misdirection-evidence'

export interface VerdictEvidence {
  citedSteps: number[]
  citedAnchors: Anchor[]
  citedArtifacts: ArtifactRef[]
  rationale: string
}

interface VerdictBase {
  /**
   * Which pipeline minted this verdict (D-03). M2 mints only
   * 'deterministic-classifier'; M4's analyze-run supersedes it via ordinary
   * supersession. Failure-side trust-keying switches on this field — it is a
   * different axis from VerdictSource (verb-evidence.ts), never reuse that union.
   */
  producer: 'deterministic-classifier' | 'analyze-run'
  confidence: number
  evidence: VerdictEvidence
  attribution?: {
    records: RecordId[]
    anchors: Anchor[]
  }
  memoryMisdirectionRuledOut: boolean
  /**
   * 422 D-17: the low-trust records the author says the run put on this verdict's failing
   * path. A DECLARATION, never the source of truth — `validateAnalysisAgainstHandoff`
   * recomputes the set from the run's own served briefs and rejects a declaration that
   * disagrees. Additive optional: absent on every verdict written before 422, and an absent
   * array exonerates nothing, because the gate keys on the recomputed set either way.
   */
  memoryOnPath?: MemoryOnPathEntry[]
  /**
   * 422 D-19/D-20: the complete per-record cross-check backing
   * {@link VerdictBase.memoryMisdirectionRuledOut}, or the `declared-only` absence marker a
   * run with no evaluation root carries instead. Additive optional BESIDE the frozen boolean,
   * which keeps its shape and meaning — historical bytes carrying the boolean alone stay
   * readable, while a current gated producer must ship this ledger.
   */
  misdirectionRuledOut?: MisdirectionEvidence
  perTest: number
}

/**
 * The closed verdict-class vocabulary, spelled once as data (388 C13). Minted here beside the
 * union it enumerates so consumers that must validate a stored class — the 390 quarantine ledger
 * guard keys entries on one — check membership against the same list the type declares, rather
 * than a fourth private copy. The three copies that predated it — the handoff guard, the
 * analysis-artifact guard and the analysis validator — were rewired to this export in 390 plan
 * 02, so the closed set is spelled exactly once (388 C13).
 *
 * Type agreement with `Verdict['class']` is pinned in `__tests__/quarantine-ledger.test.ts`.
 */
export const VERDICT_CLASSES = [
  'test_bug',
  'app_bug',
  'environment',
  'flake',
  'config_error',
  'llm_error',
  'unknown',
  'timeout',
] as const

export type VerdictClass = (typeof VERDICT_CLASSES)[number]

const VERDICT_CLASS_SET: ReadonlySet<string> = new Set(VERDICT_CLASSES)

/** True for exactly the eight closed classes — the membership check stored bytes must pass. */
export function isVerdictClass(value: unknown): value is VerdictClass {
  return typeof value === 'string' && VERDICT_CLASS_SET.has(value)
}

export type Verdict =
  | (VerdictBase & {
      class: 'test_bug'
      subtype?: 'stale_selector' | 'outdated_flow' | 'bad_assertion' | 'wrong_expected_value'
    })
  | (VerdictBase & { class: 'app_bug' })
  | (VerdictBase & { class: 'environment' })
  | (VerdictBase & { class: 'flake' })
  | (VerdictBase & { class: 'config_error' })
  | (VerdictBase & { class: 'llm_error' })
  /** LLM-judge abstention / unclassifiable — noop for learning; never files an issue (§A9 routing). */
  | (VerdictBase & { class: 'unknown' })
  /** Routes with environment/flake (flake management); never the issue path (§A9 routing). */
  | (VerdictBase & { class: 'timeout' })
