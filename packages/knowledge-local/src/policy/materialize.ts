import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { slugBranch, type GuardrailPolicy } from '@vostride/agent-qa-schema'
import {
  assertCommittedEgressSafe, CommittedEgressBlockedError, defaultGuardrailPolicyInput,
  loadGuardrailPolicy, type AuditSink,
} from '@vostride/agent-qa-safety'
import { JsonlAuditSink } from '@vostride/agent-qa-safety-local'

export const POLICY_MATERIALIZE_EGRESS_CHANNEL = 'policy-materialize'

export class PolicyTextRefusedError extends Error {
  constructor() {
    super('Policy text must not contain HTML comment delimiters or invalid marker identity')
    this.name = 'PolicyTextRefusedError'
  }
}

export function policySectionMarkers(recordId: string): { open: string; close: string } {
  if (!/^[A-Za-z0-9_.:-]+$/.test(recordId)) throw new PolicyTextRefusedError()
  return { open: `<!-- agent-qa:policy ${recordId} -->`, close: `<!-- /agent-qa:policy ${recordId} -->` }
}

export function policyShelfPath(knowledgeRoot: string, scope: string): string {
  return join(knowledgeRoot, 'policies', `${slugBranch(scope)}.md`)
}

export interface MaterializePolicyInput {
  knowledgeRoot: string
  recordId: string
  scope: string
  ruleText: string
  title?: string
  policy?: GuardrailPolicy
  auditSink?: AuditSink
  auditBaseDir: string
}

export type MaterializeOutcome =
  | { kind: 'written' | 'unchanged'; relPath: string; sectionBytes: number }
  | { kind: 'egress-blocked'; detections: { label: string; detector: string }[] }

/**
 * The authored shelf is append-only under the caller's writer lease. An existing section ID
 * always wins, including when its human-edited body differs. Never rewrite that body.
 * commitArtifacts governs binary bundle artifacts, not policy text or git commits.
 */
export function materializePolicy(input: MaterializePolicyInput): MaterializeOutcome {
  if ([input.ruleText, input.title ?? '', input.scope].some(text => /<!--|-->/.test(text))) {
    throw new PolicyTextRefusedError()
  }
  const { open, close } = policySectionMarkers(input.recordId)
  const path = policyShelfPath(input.knowledgeRoot, input.scope)
  const relPath = relative(input.knowledgeRoot, path)
  const section = `\n${open}\n${input.title ? `### ${input.title}\n` : ''}${input.ruleText.trim()}\n${close}\n`
  const sectionBytes = Buffer.byteLength(section)
  const exists = existsSync(path)
  if (exists && readFileSync(path, 'utf8').includes(open)) return { kind: 'unchanged', relPath, sectionBytes }
  const text = `${exists ? '' : `# Policies — ${input.scope}\n`}${section}`
  try {
    assertCommittedEgressSafe([{ label: `policy:${input.recordId}`, text, origin: 'user' }], {
      policy: input.policy ?? loadGuardrailPolicy(defaultGuardrailPolicyInput),
      channel: POLICY_MATERIALIZE_EGRESS_CHANNEL,
      auditSink: input.auditSink ?? new JsonlAuditSink(input.auditBaseDir),
    })
  } catch (error) {
    if (!(error instanceof CommittedEgressBlockedError)) throw error
    return { kind: 'egress-blocked', detections: error.blocked.map(({ label, detector }) => ({ label, detector })) }
  }
  mkdirSync(dirname(path), { recursive: true })
  // 419-POLICY-WRITER: materialize
  appendFileSync(path, text, 'utf8')
  return { kind: 'written', relPath, sectionBytes }
}
