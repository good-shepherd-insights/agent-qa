// The single committed-text checkpoint for the Phase 374 bundle store (D-11/KDIR-02).
// Callers submit every text part in one unit before any bytes reach the knowledge tree.
// A detector refusal is returned as data and audited under the caller-owned runtime dir.

import type { GuardrailPolicy } from '@vostride/agent-qa-schema'
import {
  CommittedEgressBlockedError,
  assertCommittedEgressSafe,
  defaultGuardrailPolicyInput,
  loadGuardrailPolicy,
} from '@vostride/agent-qa-safety'
import { JsonlAuditSink } from '@vostride/agent-qa-safety-local'

export const KNOWLEDGE_BUNDLE_EGRESS_CHANNEL = 'knowledge-bundle'

export interface BundleEgressOptions {
  policy?: GuardrailPolicy
  /** Explicit audit location; nothing silently resolves into a working directory. */
  auditBaseDir: string
}

export type BundleEgressOutcome =
  | { kind: 'ok' }
  | { kind: 'egress-blocked'; detections: readonly { label: string; detector: string }[] }

/** Check every committed text part as one fail-closed unit before a store write begins. */
export function checkpointCommittedParts(
  parts: readonly { label: string; text: string }[],
  opts: BundleEgressOptions,
): BundleEgressOutcome {
  const checkpointOpts = {
    policy: opts.policy ?? loadGuardrailPolicy(defaultGuardrailPolicyInput),
    channel: KNOWLEDGE_BUNDLE_EGRESS_CHANNEL,
    auditSink: new JsonlAuditSink(opts.auditBaseDir),
  }

  try {
    assertCommittedEgressSafe(parts, checkpointOpts)
  } catch (error) {
    if (error instanceof CommittedEgressBlockedError) {
      return {
        kind: 'egress-blocked',
        detections: error.blocked.map(({ label, detector }) => ({ label, detector })),
      }
    }
    throw error
  }

  return { kind: 'ok' }
}
