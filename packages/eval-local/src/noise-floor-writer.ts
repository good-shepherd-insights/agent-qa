// 415 D-04/D-12: per-profile committed floor, using the baseline pointer's
// refuse → checkpoint → preview → write-once order and existing report channel.
import { assertFloorArtefactCommittable, committedFileText } from '@vostride/agent-qa-eval'
import type { FloorRefusal, NoiseFloorArtefact } from '@vostride/agent-qa-eval'
import {
  CommittedEgressBlockedError,
  assertCommittedEgressSafe,
  defaultGuardrailPolicyInput,
  loadGuardrailPolicy,
} from '@vostride/agent-qa-safety'
import { JsonlAuditSink } from '@vostride/agent-qa-safety-local'
import type { GuardrailPolicy } from '@vostride/agent-qa-schema'

import { FsCommittedRootStore, committedNoiseFloorPath } from './committed-root-store.js'
import { REPORT_EGRESS_CHANNEL } from './report-committing.js'

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
  input: WriteNoiseFloorArtefactInput,
): WriteNoiseFloorArtefactOutcome {
  // Refusal is a measurement fact, not an egress event: no audit sink exists yet.
  const verdict = assertFloorArtefactCommittable(input.artefact)
  if (!verdict.ok) return { kind: 'refused', refusal: verdict.refusal }

  const relPath = committedNoiseFloorPath(input.artefact.profileKey)
  const text = committedFileText(input.artefact)
  const label = 'noise-floor:' + input.artefact.profileKey
  try {
    assertCommittedEgressSafe([{ label, text }], {
      policy: input.policy ?? loadGuardrailPolicy(defaultGuardrailPolicyInput),
      channel: REPORT_EGRESS_CHANNEL,
      auditSink: new JsonlAuditSink(input.reportOutputBaseDir),
    })
  } catch (err) {
    if (err instanceof CommittedEgressBlockedError) {
      return {
        kind: 'egress-blocked',
        detections: err.blocked.map(({ label: blockedLabel, detector }) => ({
          label: blockedLabel,
          detector,
        })),
      }
    }
    throw err
  }

  const store = new FsCommittedRootStore({ committedRoot: input.committedRoot })
  if (store.previewText(relPath, text) === 'conflict') {
    return { kind: 'write-conflict', path: relPath }
  }
  const outcome = store.writeText(relPath, text)
  if (outcome.kind === 'write-conflict') return { kind: 'write-conflict', path: outcome.path }
  return { kind: outcome.kind, path: relPath }
}
