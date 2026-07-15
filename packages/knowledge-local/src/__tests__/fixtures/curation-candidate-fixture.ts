import {
  buildCurationCandidateAddressFields,
  type BuildCurationCandidateAddressFieldsInput,
} from '../../queue/queue-payload.js'

export function candidateAddressFixture(
  input: BuildCurationCandidateAddressFieldsInput,
): BuildCurationCandidateAddressFieldsInput {
  return buildCurationCandidateAddressFields(input)
}
