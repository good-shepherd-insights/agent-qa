import {
  buildCurationCandidateAddressFields,
  curationCandidateProjectionSchema,
  type BuildCurationCandidateAddressFieldsInput,
  type CurationCandidateProjection,
} from '../../queue/queue-payload.js'
import {
  enqueueCurationCandidateProjection,
  type EnqueueCurationCandidateProjectionOutcome,
} from '../../queue/curation-queue.js'

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
  return curationCandidateProjectionSchema.parse(input)
}

export function enqueueArtifactFreeCandidateProjection(
  input: EnqueueArtifactFreeCandidateProjectionOptions,
): EnqueueCurationCandidateProjectionOutcome {
  return enqueueCurationCandidateProjection({
    knowledgeRoot: input.knowledgeRoot,
    projection: candidateProjectionFixture({
      ...input.projectionInput,
      artifactDescriptors: [],
      captureEvidence: { elements: [] },
      stepInteractions: [],
    }),
    artifactSources: [],
  })
}
