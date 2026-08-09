// The chat-open banner (Phase 392 plan 08, D-23 / 388 D-14).
//
// ONE READ, ONCE, WHEN A PERSON OPENS A CONVERSATION. There is no timer in this file, no watcher,
// and no second pass — 388 D-14's one-read law is the whole design, and the reason is that the
// alternative is not "a fresher banner" but a background process that keeps a project's stores
// warm for a person who may have walked away. Live push is M5's, where a transport earns it.
//
// AT MOST ONE LINE, AND USUALLY NONE. A REPL that greeted every open with a status report trains a
// person to skip the greeting, and then the one open that had something to say goes unread. So the
// idle case is SILENCE rather than a reassuring sentence.
//
// EVERY READ DEGRADES TO SILENCE. A banner may never block chat open, and it may never turn an
// unbound or refused op into a failure the person has to deal with before they can type. The
// halves degrade independently, so a project whose digest cannot be produced still hears about the
// decisions waiting for it.
//
// IT COMPOSES REGISTERED OPS AND NOTHING ELSE. Every fact here is read through the same
// `invokeFunction` binding a turn dispatches through, with the session's own caller — the read is
// user-initiated, so it is gated exactly as the person typing `proposals` would be. This file
// reaches no store, holds no reader, and widens no DTO: `RunDigest.lines` is carried across
// verbatim, which is the one-renderer law applied to a greeting.

import type { FunctionCaller } from '@vostride/agent-qa-schema'

import { PROPOSALS_LIST_FUNCTION_ID } from '../functions/ops/proposals-list.js'
import { RUNS_DIGEST_FUNCTION_ID } from '../functions/ops/runs-digest.js'
import { RUNS_LIST_FUNCTION_ID } from '../functions/ops/runs-list.js'
import type { ChatInvokeBinding } from './ports.js'

/** The separator that keeps two facts on ONE line. A newline here would be a second banner. */
const BANNER_JOIN = ' · '

/**
 * One read, or nothing.
 *
 * Swallowed HERE and nowhere else, and the swallow is narrow by construction: it wraps exactly one
 * invocation, so a failure inside the banner's own composition cannot be mistaken for a refused op.
 */
async function readOrNothing(
  invoke: ChatInvokeBinding,
  functionId: string,
  input: unknown,
  caller: FunctionCaller,
): Promise<unknown> {
  try {
    return await invoke(functionId, input, caller)
  } catch {
    return undefined
  }
}

/** The pending-decision half: a count and the alias that acts on it. */
function proposalsFragment(answer: unknown): string | undefined {
  const entries = (answer as { entries?: readonly unknown[] } | undefined)?.entries
  if (entries === undefined || entries.length === 0) return undefined
  const plural = entries.length === 1 ? 'proposal' : 'proposals'
  // The route back is the canon alias, spelled as a person types it — a count with no door is a
  // notification rather than a banner (391 D-16's inbox, reached the way chat reaches it).
  return `${entries.length} ${plural} pending — type \`proposals\` to review`
}

/**
 * The latest run this project produced, or nothing.
 *
 * `runs.list` answers summaries in whatever order the reader walked, so the latest is CHOSEN here
 * by the run's own ordering fact rather than by trusting a position. `buildOrdinal` is the
 * monotonic one; `endedAt` breaks a tie between two runs of the same build.
 */
function latestRunId(answer: unknown): string | undefined {
  if (!Array.isArray(answer) || answer.length === 0) return undefined
  const summaries = answer as readonly {
    runId?: string
    buildOrdinal?: number
    endedAt?: number
  }[]
  let latest = summaries[0]
  for (const summary of summaries) {
    const newer =
      (summary.buildOrdinal ?? 0) > (latest?.buildOrdinal ?? 0)
      || ((summary.buildOrdinal ?? 0) === (latest?.buildOrdinal ?? 0)
        && (summary.endedAt ?? 0) > (latest?.endedAt ?? 0))
    if (newer) latest = summary
  }
  return latest?.runId
}

/**
 * The digest half: the digest's OWN first rendered line.
 *
 * Carried across rather than composed here. `RunDigest.lines` is what `agent-qa digest` prints and
 * what the post-run tail emits, so re-deriving a headline would put a second sentence about one
 * run in front of a person — the failure the one-renderer law names.
 */
function digestFragment(answer: unknown): string | undefined {
  const lines = (answer as { lines?: readonly string[] } | undefined)?.lines
  const headline = lines?.[0]
  return headline === undefined || headline.trim() === '' ? undefined : headline
}

/**
 * Compose the banner for one chat open.
 *
 * Sequential rather than concurrent, deliberately: the digest read is CONDITIONAL on the run list
 * having produced a run, and a project with no runs must not issue a `runs.digest` call against an
 * id it invented. Three reads at open is already the ceiling; a fourth would need a decision.
 */
export async function composeBanner(
  invoke: ChatInvokeBinding,
  caller: FunctionCaller,
): Promise<string | undefined> {
  const proposals = proposalsFragment(
    await readOrNothing(invoke, PROPOSALS_LIST_FUNCTION_ID, { status: 'pending' }, caller),
  )

  const runId = latestRunId(await readOrNothing(invoke, RUNS_LIST_FUNCTION_ID, {}, caller))
  const digest =
    runId === undefined
      ? undefined
      : digestFragment(await readOrNothing(invoke, RUNS_DIGEST_FUNCTION_ID, { runId }, caller))

  const fragments = [proposals, digest].filter(
    (fragment): fragment is string => fragment !== undefined,
  )
  return fragments.length === 0 ? undefined : fragments.join(BANNER_JOIN)
}
