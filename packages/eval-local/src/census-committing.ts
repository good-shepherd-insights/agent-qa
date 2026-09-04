// The ONE egress-checked committed-census writer (Phase 413 D-13/D-15/D-16, ROOT-05) — sibling
// of commitEvalReport, same recipe, keyed on the CORPUS DIGEST instead of a replay batchKey.
//
// Why a digest and not a batchKey: the census is a property of the committed corpus, not of a
// replay batch (D-13). Keying the dir on the digest of the committed entry set makes the two
// facts that matter free — re-running the census over an unchanged corpus writes byte-identical
// text and reports 'unchanged' (idempotent no-op, D-15), while a growth commit changes the digest
// and therefore lands in a fresh dir rather than colliding with the previous census under
// write-once.
//
// Composition law (the 372 D-13 recipe, unchanged):
//   - Every committed byte passes `assertCommittedEgressSafe` (fail-closed) on the SHIPPED
//     'eval-report' channel with a JsonlAuditSink BEFORE any write. D-15 says the census writes
//     through the eval-report channel — this file must never mint a channel of its own, because a
//     new channel is a new policy surface no reviewed policy covers.
//   - JSON and markdown are ONE checkpoint unit: a detection refuses the WHOLE census as a typed
//     outcome, nothing half-commits.
//   - Write-once (D-17): both relPaths are PREVIEWED before either write, so a conflict on one
//     part leaves even the non-conflicting part unwritten.
//   - census.json is serialized by eval core's committedFileText (the ONE serializer); the
//     markdown's byte-determinism is the renderer's contract — this helper only byte-compares.
//   - ZERO model calls, no safety scope opened: the audit sink is passed directly in checkpoint
//     opts, same as seeding and reporting.

import { join } from 'node:path'

import { committedFileText } from '@vostride/agent-qa-eval'
import type { CorpusCensus } from '@vostride/agent-qa-eval'
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
  COMMITTED_CENSUS_SUBDIR,
  COMMITTED_REPORTS_DIR,
  FsCommittedRootStore,
  committedCensusPath,
} from './committed-root-store.js'
import { REPORT_EGRESS_CHANNEL } from './report-committing.js'

export const COMMITTED_CENSUS_JSON_FILE = 'census.json'
export const COMMITTED_CENSUS_MARKDOWN_FILE = 'census.md'

export interface CommitCensusInput {
  /** The pure eval-core census DTO — its corpusDigest names the committed dir. */
  census: CorpusCensus
  /** The rendered markdown projection; byte-determinism is the renderer's contract. */
  markdown: string
  /** Explicit absolute committed-root path — `<configDir>/agent-qa-eval` for the CLI. */
  committedRoot: string
  /** Census-scoped audit-sink base dir (the JsonlAuditSink lands guardrail rows here). */
  censusOutputBaseDir: string
  /** Guardrail policy; defaults to the shipped default input, injectable for tests. */
  policy?: GuardrailPolicy
}

export type CommitCensusOutcome =
  | {
      kind: 'committed'
      json: 'written' | 'unchanged'
      markdown: 'written' | 'unchanged'
      censusDir: string
    }
  | { kind: 'egress-blocked'; detections: readonly { label: string; detector: string }[] }
  | { kind: 'write-conflict'; path: string }

/**
 * Commit the census beside the corpus it measures: ONE checkpoint call over both parts, then
 * preview BOTH paths, then write — checkpoint-then-preview-then-write, one atomic unit.
 */
export function commitCensus(input: CommitCensusInput): CommitCensusOutcome {
  const store = new FsCommittedRootStore({ committedRoot: input.committedRoot })
  const checkpointOpts = {
    policy: input.policy ?? loadGuardrailPolicy(defaultGuardrailPolicyInput),
    channel: REPORT_EGRESS_CHANNEL,
    auditSink: new JsonlAuditSink(input.censusOutputBaseDir),
  }

  const corpusDigest = input.census.corpusDigest
  const parts: { relPath: string; label: string; text: string }[] = [
    {
      relPath: committedCensusPath(corpusDigest, COMMITTED_CENSUS_JSON_FILE),
      label: `census-json:${corpusDigest}`,
      text: committedFileText(input.census),
    },
    {
      relPath: committedCensusPath(corpusDigest, COMMITTED_CENSUS_MARKDOWN_FILE),
      label: `census-markdown:${corpusDigest}`,
      text: input.markdown,
    },
  ]

  // (1) ONE checkpoint call covering BOTH parts — a block refuses the whole census with the
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

  // (2) Preview BOTH paths before writing EITHER — a conflict on one part leaves even the
  // non-conflicting part unwritten (D-17 atomicity).
  const conflicting = parts.find(
    (part) => store.previewText(part.relPath, part.text) === 'conflict',
  )
  if (conflicting !== undefined) {
    return { kind: 'write-conflict', path: conflicting.relPath }
  }

  // (3) Write both; after preview a conflict cannot occur here, but map it defensively.
  const outcomes = parts.map((part) => store.writeText(part.relPath, part.text))
  for (const outcome of outcomes) {
    if (outcome.kind === 'write-conflict') return { kind: 'write-conflict', path: outcome.path }
  }

  return {
    kind: 'committed',
    json: outcomes[0]!.kind === 'written' ? 'written' : 'unchanged',
    markdown: outcomes[1]!.kind === 'written' ? 'written' : 'unchanged',
    censusDir: join(
      input.committedRoot,
      COMMITTED_REPORTS_DIR,
      COMMITTED_CENSUS_SUBDIR,
      slugBranch(corpusDigest),
    ),
  }
}
