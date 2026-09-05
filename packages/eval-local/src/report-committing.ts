// The ONE egress-checked committed-report writer (Phase 372 D-13, BASE-02) — sibling of
// seedCommittedCorpus, same recipe. It places the aggregated EvalBatchReport JSON DTO plus its
// rendered markdown projection, plus optional decisions.json pairing evidence (415 D-16),
// under reports/<slug(batchKey)>/ inside the committed root.
//
// Composition law (ROOT-02 discipline extended):
//   - Every committed byte passes `assertCommittedEgressSafe` (fail-closed) on the 'eval-report'
//     channel with a JsonlAuditSink BEFORE any write; a detection refuses the WHOLE report as a
//     typed outcome — every supplied part is ONE checkpoint unit, never half-committed.
//   - Write-once (D-17): all relPaths are PREVIEWED before any write; a conflict on ANY part
//     refuses the whole report writing nothing. A byte-identical regen reports 'unchanged'
//     everywhere; a changed corpus produces a different batchKey and therefore a fresh dir —
//     the committed baseline can never be silently rewritten (T-372-07).
//   - report.json is serialized by eval core's committedFileText (the ONE serializer); the
//     markdown's byte-determinism is the renderer's contract — this helper only byte-compares.
//   - The helper makes ZERO model calls and opens no safety scope: the audit sink is passed
//     directly in checkpoint opts, same as seeding.

import { join } from 'node:path'

import { committedFileText } from '@vostride/agent-qa-eval'
import type { DecisionVectorsDocument, EvalBatchReport } from '@vostride/agent-qa-eval'
import {
  CommittedEgressBlockedError,
  assertCommittedEgressSafe,
  defaultGuardrailPolicyInput,
  loadGuardrailPolicy,
} from '@vostride/agent-qa-safety'
import { JsonlAuditSink } from '@vostride/agent-qa-safety-local'
import type { GuardrailPolicy } from '@vostride/agent-qa-schema'
import { slugBranch } from '@vostride/agent-qa-schema'

import {
  COMMITTED_REPORTS_DIR,
  FsCommittedRootStore,
  committedReportPath,
} from './committed-root-store.js'

/** The D-13 checkpoint channel: audit rows land as `eval-report:<part label>`. */
export const REPORT_EGRESS_CHANNEL = 'eval-report'

export const COMMITTED_REPORT_JSON_FILE = 'report.json'
export const COMMITTED_REPORT_MARKDOWN_FILE = 'report.md'
export const COMMITTED_REPORT_DECISIONS_FILE = 'decisions.json'

export interface CommitEvalReportInput {
  /** The pure eval-core report DTO — batchKey names the committed dir. */
  report: EvalBatchReport
  /** Optional pairing evidence for this same batch and matcher, never a separate channel. */
  decisions?: DecisionVectorsDocument
  /** The rendered markdown projection; byte-determinism is the renderer's contract. */
  markdown: string
  /** Explicit absolute committed-root path — `<configDir>/agent-qa-eval` for the 372 CLI. */
  committedRoot: string
  /** Report-scoped audit-sink base dir (the JsonlAuditSink lands guardrail rows here). */
  reportOutputBaseDir: string
  /** Guardrail policy; defaults to the shipped default input, injectable for tests. */
  policy?: GuardrailPolicy
}

export type CommitEvalReportOutcome =
  | {
      kind: 'committed'
      json: 'written' | 'unchanged'
      markdown: 'written' | 'unchanged'
      decisions?: 'written' | 'unchanged'
      reportDir: string
    }
  | { kind: 'egress-blocked'; detections: readonly { label: string; detector: string }[] }
  | { kind: 'write-conflict'; path: string }

/**
 * Commit the baseline report beside the corpus/contracts that produced it: ONE checkpoint call
 * over every supplied part, then preview ALL paths, then write — checkpoint-then-preview-then-write,
 * one atomic unit (D-13/D-17).
 */
export function commitEvalReport(input: CommitEvalReportInput): CommitEvalReportOutcome {
  // Same-report identity is a caller contract, like the baseline-pointer writer's contract.
  // Check before constructing an audit sink or touching any committed output.
  if (input.decisions !== undefined) {
    for (const field of ['batchKey', 'matcherVersion'] as const) {
      if (input.decisions[field] !== input.report[field]) {
        throw new TypeError(`decisions ${field} does not match the report ${field}`)
      }
    }
  }
  const store = new FsCommittedRootStore({ committedRoot: input.committedRoot })
  const checkpointOpts = {
    policy: input.policy ?? loadGuardrailPolicy(defaultGuardrailPolicyInput),
    channel: REPORT_EGRESS_CHANNEL,
    auditSink: new JsonlAuditSink(input.reportOutputBaseDir),
  }

  const batchKey = input.report.batchKey
  const parts: { relPath: string; label: string; text: string }[] = [
    {
      relPath: committedReportPath(batchKey, COMMITTED_REPORT_JSON_FILE),
      label: `report-json:${batchKey}`,
      text: committedFileText(input.report),
    },
    {
      relPath: committedReportPath(batchKey, COMMITTED_REPORT_MARKDOWN_FILE),
      label: `report-markdown:${batchKey}`,
      text: input.markdown,
    },
  ]
  if (input.decisions !== undefined) {
    parts.push({
      relPath: committedReportPath(batchKey, COMMITTED_REPORT_DECISIONS_FILE),
      label: 'report-decisions:' + batchKey,
      text: committedFileText(input.decisions),
    })
  }

  // (1) ONE checkpoint call covering ALL parts — a block refuses the whole report with the
  // detector labels, nothing half-commits.
  try {
    assertCommittedEgressSafe(
      parts.map(({ label, text }) => ({ label, text })),
      checkpointOpts,
    )
  } catch (err) {
    if (err instanceof CommittedEgressBlockedError) {
      return {
        kind: 'egress-blocked',
        detections: err.blocked.map(({ label, detector }) => ({ label, detector })),
      }
    }
    throw err
  }

  // (2) Preview ALL paths before writing ANY — a conflict on one part leaves even the
  // non-conflicting part unwritten (D-17 atomicity).
  const conflicting = parts.find(
    (part) => store.previewText(part.relPath, part.text) === 'conflict',
  )
  if (conflicting !== undefined) {
    return { kind: 'write-conflict', path: conflicting.relPath }
  }

  // (3) Write all; after preview a conflict cannot occur here, but map it defensively.
  const outcomes = parts.map((part) => store.writeText(part.relPath, part.text))
  for (const outcome of outcomes) {
    if (outcome.kind === 'write-conflict') return { kind: 'write-conflict', path: outcome.path }
  }

  return {
    kind: 'committed',
    json: outcomes[0]!.kind === 'written' ? 'written' : 'unchanged',
    markdown: outcomes[1]!.kind === 'written' ? 'written' : 'unchanged',
    ...(outcomes[2] === undefined ? {} : {
      decisions: outcomes[2].kind === 'written' ? 'written' as const : 'unchanged' as const,
    }),
    reportDir: join(input.committedRoot, COMMITTED_REPORTS_DIR, slugBranch(batchKey)),
  }
}
