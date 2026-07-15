import type { ContentOrigin, GuardrailPolicy } from '@vostride/agent-qa-schema'

import type { AuditSink, GuardrailAuditRow } from '../ports/audit-sink'
import { scan } from './scan'

export interface CommittedEgressPart {
  label?: string
  text: string
  origin?: ContentOrigin
}

export interface BlockedDetection {
  label: string
  detector: string
  action: 'block' | 'redact'
  redactedFingerprint: string
}

export interface CommittedEgressOptions {
  policy: GuardrailPolicy
  auditSink?: AuditSink
  channel?: string
}

export class CommittedEgressBlockedError extends Error {
  constructor(readonly blocked: readonly BlockedDetection[]) {
    const first = blocked[0]
    super(
      `Committed egress blocked in part "${first?.label ?? 'unlabeled'}": ${
        first?.detector ?? 'unknown'
      }`,
    )
    this.name = 'CommittedEgressBlockedError'
  }

  get detector(): string {
    return this.blocked[0]?.detector ?? 'unknown'
  }

  get label(): string {
    return this.blocked[0]?.label ?? 'unlabeled'
  }
}

export function assertCommittedEgressSafe(
  input: string,
  opts: CommittedEgressOptions,
): string
export function assertCommittedEgressSafe(
  input: readonly CommittedEgressPart[],
  opts: CommittedEgressOptions,
): string[]
export function assertCommittedEgressSafe(
  input: string | readonly CommittedEgressPart[],
  opts: CommittedEgressOptions,
): string | string[] {
  const parts = typeof input === 'string' ? [{ text: input }] : [...input]
  const baseChannel = opts.channel ?? 'committed-egress'
  const rows: GuardrailAuditRow[] = []
  const blocked: BlockedDetection[] = []

  for (const part of parts) {
    const label = part.label ?? 'unlabeled'
    const output = scan(part.text, opts.policy)
    const isUser = part.origin === 'user'
    const blocksByRedactRule = output.result.action === 'redact' && !isUser
    const partBlocks = output.result.action === 'block' || blocksByRedactRule

    for (const fired of output.fired) {
      const overridden = fired.action === 'redact' && isUser && output.result.action !== 'block'
      const row: GuardrailAuditRow = {
        channel: `${baseChannel}:${label}`,
        action: fired.action,
        detector: fired.detector,
        redactedFingerprint: fired.redactedFingerprint,
      }

      if (overridden) {
        row.overridden = true
        row.origin = part.origin
        row.reason = 'user-authored override'
      } else if (part.origin !== undefined) {
        row.origin = part.origin
      }

      rows.push(row)

      if (
        partBlocks &&
        (fired.action === 'block' || (fired.action === 'redact' && blocksByRedactRule))
      ) {
        blocked.push({
          label,
          detector: fired.detector,
          action: fired.action,
          redactedFingerprint: fired.redactedFingerprint,
        })
      }
    }
  }

  for (const row of rows) {
    opts.auditSink?.appendGuardrailAudit(row)
  }

  if (blocked.length > 0) {
    throw new CommittedEgressBlockedError(blocked)
  }

  return typeof input === 'string' ? input : parts.map((part) => part.text)
}
