// 415 D-04/D-12: per-profile committed floor, using the baseline pointer's
// refuse → preview → write-once order. The bytes are written as given (441 D-15).
import { assertFloorArtefactCommittable, committedFileText } from '@vostride/agent-qa-eval'
import type { FloorRefusal, NoiseFloorArtefact } from '@vostride/agent-qa-eval'

import { FsCommittedRootStore, committedNoiseFloorPath } from './committed-root-store.js'

export interface WriteNoiseFloorArtefactInput {
  artefact: NoiseFloorArtefact
  committedRoot: string
  // 441-23: unread since the egress check went; 441-32 deletes it.
  reportOutputBaseDir?: string
}

export type WriteNoiseFloorArtefactOutcome =
  | { kind: 'written' | 'unchanged'; path: string }
  | { kind: 'refused'; refusal: FloorRefusal }
  | { kind: 'write-conflict'; path: string }

export function writeNoiseFloorArtefact(
  input: WriteNoiseFloorArtefactInput,
): WriteNoiseFloorArtefactOutcome {
  const verdict = assertFloorArtefactCommittable(input.artefact)
  if (!verdict.ok) return { kind: 'refused', refusal: verdict.refusal }

  const relPath = committedNoiseFloorPath(input.artefact.profileKey)
  const text = committedFileText(input.artefact)
  const store = new FsCommittedRootStore({ committedRoot: input.committedRoot })
  if (store.previewText(relPath, text) === 'conflict') {
    return { kind: 'write-conflict', path: relPath }
  }
  const outcome = store.writeText(relPath, text)
  if (outcome.kind === 'write-conflict') return { kind: 'write-conflict', path: outcome.path }
  return { kind: outcome.kind, path: relPath }
}
