// The write-once committed baseline-pointer writer (Phase 413 D-19/D-20, ROOT-11) — the
// report-committing recipe with ONE part, plus a pure refusal gate in front of it.
//
// Composition law:
//   - (0) REFUSE FIRST. `assertBaselineComparator` is eval core's ONE predicate (D-20); a report
//     judged under the same-family override is not a gate comparator, so it is refused before
//     any path is resolved and leaves no file.
//   - (1) The pointer bytes are written as given (441 D-15): no content check runs on them.
//   - (2) Write-once (371 D-17): preview then write. A byte-identical re-designation is
//     'unchanged'; a profile key already pointing at a different batch is a typed
//     'write-conflict', never an overwrite — MOVING a baseline is a reviewed git edit (D-19).
//   - The pointer body is serialized by eval core's `committedFileText` (the ONE serializer) and
//     carries no wall-clock field, so re-designation byte-compares rather than churning.

import { assertBaselineComparator, committedFileText } from '@vostride/agent-qa-eval'
import type {
  BaselineComparatorRefusal,
  BaselinePointer,
  EvalBatchReport,
} from '@vostride/agent-qa-eval'

import { FsCommittedRootStore, committedBaselinePointerPath } from './committed-root-store.js'

export interface WriteBaselinePointerInput {
  /** The report being designated — its judge provenance decides comparator eligibility. */
  report: EvalBatchReport
  /** The v2 pointer, including fingerprint and corpusDigest; batchKey names the same report. */
  pointer: BaselinePointer
  /** Explicit absolute committed-root path — `<configDir>/agent-qa-eval` for the CLI. */
  committedRoot: string
}

export type WriteBaselinePointerOutcome =
  | { kind: 'written' | 'unchanged'; path: string }
  | { kind: 'refused'; refusal: BaselineComparatorRefusal }
  | { kind: 'write-conflict'; path: string }

/**
 * Designate a per-profile baseline: refuse-then-preview-then-write.
 *
 * A pointer whose batchKey does not name the designated report is a CALLER bug, not data — the
 * outcome union stays closed for the three honest answers and a mismatch raises instead.
 */
export function writeBaselinePointer(
  input: WriteBaselinePointerInput,
): WriteBaselinePointerOutcome {
  // (0) The ONE predicate, before any path resolution (D-20).
  const verdict = assertBaselineComparator(input.report)
  if (!verdict.ok) return { kind: 'refused', refusal: verdict.refusal }

  if (input.pointer.batchKey !== input.report.batchKey) {
    throw new TypeError(
      `baseline pointer batchKey ${input.pointer.batchKey} does not name the designated report ${input.report.batchKey}`,
    )
  }

  const relPath = committedBaselinePointerPath(input.pointer.profileKey)
  const text = committedFileText(input.pointer)

  // (1) Preview before writing: a key already pointing elsewhere refuses without touching it.
  const store = new FsCommittedRootStore({ committedRoot: input.committedRoot })
  if (store.previewText(relPath, text) === 'conflict') {
    return { kind: 'write-conflict', path: relPath }
  }

  // (2) Write-once; a conflict cannot occur after the preview but is mapped defensively.
  const outcome = store.writeText(relPath, text)
  if (outcome.kind === 'write-conflict') return { kind: 'write-conflict', path: outcome.path }
  return { kind: outcome.kind, path: relPath }
}
