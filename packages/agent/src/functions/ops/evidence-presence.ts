// Read-time presence for artifact refs — the ONE rule both durable reads call (Phase 406, D-17).
//
// `runs.detail` and `analysis.get` each hand a page a list of artifact refs, and neither could say
// whether the bytes behind them still exist. A ref recorded at write time survives a GC, a pruned
// run directory and a hand-deleted blob; a link drawn from it 404s on click, which reads to an
// operator as a broken product rather than as collected evidence. So presence is asked at READ
// time, in one place, and both ops annotate through this function.
//
// BOTH ABSENCES ARE `false`, AND THAT IS NOT A COLLAPSE OF THE D-15 SPLIT. `blob_absent` and
// `unknown_run` stay two words at the port, because `runs.artifact` refuses differently for each.
// Here the question is narrower — are the bytes there — and the answer is no either way. A page
// rendering "evidence incomplete" has the same thing to say about a pruned run and a pruned blob.
//
// A PORT WITHOUT `has` LEAVES THE KEY ABSENT, WHICH IS THE WHOLE POINT (D-17). Presence unknown is
// not an absence, and reporting `present: false` for refs this host never looked at would render
// honest, intact evidence as incomplete. The refs come back untouched — copies, so a caller cannot
// mutate the port's rows — and the page's `present === false` predicate stays false.
//
// STATS ARE DEDUPED BY SHA WITHIN ONE CALL. A 40-failure run cites the same decision screenshot
// from every member, and a run-detail page's sub-actions repeat refs across steps; one syscall per
// distinct content address is the difference between a stat and a stat storm (T-406-12).

import type { EvidenceBlobPresence, RunId } from '@vostride/agent-qa-schema'

import type { EvidenceBlobReaderPort } from '../spec.js'

export async function annotatePresence<T extends { sha: string }>(
  port: EvidenceBlobReaderPort | undefined,
  runId: RunId,
  refs: readonly T[],
): Promise<(T & { present?: boolean })[]> {
  const has = port?.has
  if (has === undefined) return refs.map((ref) => ({ ...ref }))

  const distinct = [...new Set(refs.map((ref) => ref.sha))]
  const answers = new Map<string, EvidenceBlobPresence>(
    await Promise.all(distinct.map(async (sha): Promise<[string, EvidenceBlobPresence]> =>
      [sha, await has.call(port, runId, sha)])),
  )

  return refs.map((ref) => ({ ...ref, present: answers.get(ref.sha) === 'found' }))
}
