import type { GuardrailPolicy } from '@vostride/agent-qa-schema'

import { mapPromptLeaves } from '../egress/map-prompt-leaves'
import type { ProviderRequestHook } from '../hooks/interfaces'
import type { AuditSink } from '../ports/audit-sink'
import { scan } from './scan'

export class GuardrailBlockError extends Error {
  constructor(readonly detector: string) {
    super(`Guardrail blocked outbound prompt leaf: ${detector}`)
    this.name = 'GuardrailBlockError'
  }
}

export function createGuardrailProviderRequestHook(
  policy: GuardrailPolicy,
  auditSink?: AuditSink,
  channel = 'request',
): ProviderRequestHook {
  const scanLeaf = (text: string): string => {
    const output = scan(text, policy)

    for (const fired of output.fired) {
      auditSink?.appendGuardrailAudit({
        channel,
        action: fired.action,
        detector: fired.detector,
        redactedFingerprint: fired.redactedFingerprint,
      })
    }

    if (output.result.action === 'block') {
      throw new GuardrailBlockError(output.result.detector ?? 'unknown')
    }

    if (output.result.action === 'redact') {
      return output.redactedText
    }

    return text
  }

  // scanLeaf may throw GuardrailBlockError; mapPromptLeaves never catches fn throws (including
  // on JSON-shaped leaves), so a block on a tool-call input / json / error-json leaf propagates
  // out of egress and is not swallowed.
  return (params) => mapPromptLeaves(params, scanLeaf)
}
