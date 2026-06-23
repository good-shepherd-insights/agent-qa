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
