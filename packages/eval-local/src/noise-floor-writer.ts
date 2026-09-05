import type { FloorRefusal, NoiseFloorArtefact } from '@vostride/agent-qa-eval'
import type { GuardrailPolicy } from '@vostride/agent-qa-schema'

export interface WriteNoiseFloorArtefactInput {
  artefact: NoiseFloorArtefact
  committedRoot: string
  reportOutputBaseDir: string
  policy?: GuardrailPolicy
}

export type WriteNoiseFloorArtefactOutcome =
  | { kind: 'written' | 'unchanged'; path: string }
  | { kind: 'refused'; refusal: FloorRefusal }
  | { kind: 'egress-blocked'; detections: readonly { label: string; detector: string }[] }
  | { kind: 'write-conflict'; path: string }

export function writeNoiseFloorArtefact(
  _input: WriteNoiseFloorArtefactInput,
): WriteNoiseFloorArtefactOutcome {
  throw new Error('floor write contract not implemented')
}
