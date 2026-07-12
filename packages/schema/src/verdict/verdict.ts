import type { ArtifactRef } from '../ids/artifact-ref'
import type { RecordId } from '../ids/record-id'
import type { Anchor } from '../identity/anchor'

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
  perTest: number
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
