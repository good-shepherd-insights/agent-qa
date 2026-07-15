import {
  buildCurationCandidateAddressFields,
  type BuildCurationCandidateAddressFieldsInput,
  type CurationCandidateProjection,
} from '../../queue/queue-payload.js'
import type { EnqueueCurationCandidateProjectionOutcome } from '../../queue/curation-queue.js'

export type ArtifactFreeCandidateProjectionInput = Omit<
  CurationCandidateProjection,
  'artifactDescriptors' | 'captureEvidence' | 'stepInteractions'
>

export interface EnqueueArtifactFreeCandidateProjectionOptions {
  knowledgeRoot: string
  projectionInput: ArtifactFreeCandidateProjectionInput
}

export function candidateAddressFixture(
  input: BuildCurationCandidateAddressFieldsInput,
): BuildCurationCandidateAddressFieldsInput {
  return buildCurationCandidateAddressFields(input)
}

export function candidateProjectionFixture(
  input: CurationCandidateProjection,
): CurationCandidateProjection {
  void input
  throw new Error('candidateProjectionFixture is not implemented')
}

export function enqueueArtifactFreeCandidateProjection(
  input: EnqueueArtifactFreeCandidateProjectionOptions,
): EnqueueCurationCandidateProjectionOutcome {
  void input
  throw new Error('enqueueArtifactFreeCandidateProjection is not implemented')
}
