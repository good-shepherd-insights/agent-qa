// WHICH MEMBER THE LIVE PREVIEW WATCHES (G-428-3, owner decision 2026-09-26 (3)).
//
// Nobody picks a handle any more: the page derives it from the run stream it already reduces. A
// member is running when it has a member row and no outcome; a retry clears the outcome, so a
// retried member is running again.
//
// The rule, in order:
//  1. keep the watched member while it runs, so concurrent members cannot flip the preview;
//  2. otherwise watch the lowest-handle running member;
//  3. with nobody running, hold the member last watched, so the NEXT member's testStarted, not its
//     predecessor's testFinished, moves the preview, and a member that has not started is never
//     minted for (its bounded not-yet wait would be spent before it exists);
//  4. before any watched member has started, the first roster handle, or else 0.
//
// A handle held from before the roster arrived has no member row, so rule 3 does not keep it.

import type { MemberRow } from '@/lib/run-stream-reducer'

export interface LiveRunWatchInput {
  handles?: readonly number[] | undefined
  members: Readonly<Record<number, MemberRow>>
}

function runningHandles(members: Readonly<Record<number, MemberRow>>): number[] {
  return Object.values(members)
    .filter((member) => member.outcome === undefined)
    .map((member) => member.testIndex)
    .sort((a, b) => a - b)
}

export function watchedHandleOf(input: LiveRunWatchInput, previous: number | undefined): number {
  const running = runningHandles(input.members)
  if (previous !== undefined && running.includes(previous)) return previous
  const lowest = running[0]
  if (lowest !== undefined) return lowest
  if (previous !== undefined && input.members[previous] !== undefined) return previous
  return input.handles?.[0] ?? previous ?? 0
}
