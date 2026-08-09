// The chat-open banner: one read, one line, and nothing that keeps running (Phase 392 plan 08, D-23).
//
// WHAT IS BEING MEASURED is the READ DISCIPLINE, not the wording. 388 D-14's one-read law and D-23
// together say a banner is a thing that happens once when a person opens a conversation — so the
// spy counts here are the assertions, and the rendered text is the cheap part. A banner that
// polled would pass every wording assertion in this file and fail the whole point of the feature.
//
// AND IT MAY NEVER BLOCK CHAT OPEN. Each read degrades to silence on refusal, which is why the
// refused-read case is here beside the happy one: a project whose proposals inbox cannot be read
// still gets a REPL, and the read it could not do is not the person's problem at the moment they
// typed `agent-qa chat`.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  PROPOSALS_LIST_FUNCTION_ID,
  RUNS_DIGEST_FUNCTION_ID,
  RUNS_LIST_FUNCTION_ID,
} from '../../index.js'
import type { FunctionCaller } from '@vostride/agent-qa-schema'
import { describe, expect, it } from 'vitest'

import { composeBanner } from '../banner.js'
import type { ChatInvokeBinding } from '../ports.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

const CALLER: FunctionCaller = {
  surface: 'chat',
  grantedScopes: ['read'],
  safeMode: false,
  origin: 'human',
}

const RUN_SUMMARY = {
  runId: 'RUN-1',
  scope: 'default',
  buildOrdinal: 7,
  executionContext: 'local-interactive',
  aggregateVerdict: 'failed',
  startedAt: 1,
  endedAt: 2,
  testCount: 3,
}

interface Recorded {
  readonly calls: string[]
  readonly line: string | undefined
}

/** Drive the banner over a scripted registry, recording exactly which ops it reached. */
async function run(
  answers: Partial<Record<string, () => unknown>>,
): Promise<Recorded> {
  const calls: string[] = []
  const invoke: ChatInvokeBinding = async (functionId) => {
    calls.push(functionId)
    const answer = answers[functionId]
    if (answer === undefined) throw new Error(`FunctionNotBoundError: ${functionId}`)
    return answer()
  }
  const line = await composeBanner(invoke, CALLER)
  return { calls, line }
}

describe('the chat banner reads once and says at most one thing', () => {
  it('names the pending proposals when there are some', async () => {
    const { line } = await run({
      [PROPOSALS_LIST_FUNCTION_ID]: () => ({ entries: [{}, {}, {}] }),
      [RUNS_LIST_FUNCTION_ID]: () => [],
    })

    expect(line).toContain('3 proposals pending')
    // The route back, named the way the resolver table spells it — a banner that reported a count
    // without the verb that acts on it would be a notification with no door.
    expect(line).toContain('proposals')
  })

  it('says nothing at all when the project is idle', async () => {
    const { line } = await run({
      [PROPOSALS_LIST_FUNCTION_ID]: () => ({ entries: [] }),
      [RUNS_LIST_FUNCTION_ID]: () => [],
    })

    // NOT an empty string and not "nothing pending": a REPL that printed a line on every open
    // would train a person to skip the line, which is the failure mode a banner has (388 D-14).
    expect(line).toBeUndefined()
  })

  it('is ONE line even when both reads have something to say', async () => {
    const { line } = await run({
      [PROPOSALS_LIST_FUNCTION_ID]: () => ({ entries: [{}] }),
      [RUNS_LIST_FUNCTION_ID]: () => [RUN_SUMMARY],
      [RUNS_DIGEST_FUNCTION_ID]: () => ({ lines: ['RUN-1: 2 failed, 1 passed'], runId: 'RUN-1' }),
    })

    expect(line).toBeDefined()
    expect(line).not.toContain('\n')
    expect(line).toContain('1 proposal pending')
    // The digest's OWN rendered line, carried across rather than re-derived. One renderer law:
    // the banner and `agent-qa digest` must not be two spellings of the same sentence.
    expect(line).toContain('RUN-1: 2 failed, 1 passed')
  })

  it('reads each composed op AT MOST ONCE per chat open', async () => {
    const { calls } = await run({
      [PROPOSALS_LIST_FUNCTION_ID]: () => ({ entries: [{}] }),
      [RUNS_LIST_FUNCTION_ID]: () => [RUN_SUMMARY],
      [RUNS_DIGEST_FUNCTION_ID]: () => ({ lines: ['RUN-1: green'], runId: 'RUN-1' }),
    })

    // The load-bearing assertion of this file. D-23 and 388 D-14 both say ONE read; a duplicate
    // here is the first step of the walk that becomes a poll.
    for (const id of new Set(calls)) {
      expect(calls.filter((call) => call === id), id).toHaveLength(1)
    }
    expect(calls).toEqual([
      PROPOSALS_LIST_FUNCTION_ID,
      RUNS_LIST_FUNCTION_ID,
      RUNS_DIGEST_FUNCTION_ID,
    ])
  })

  it('degrades to no banner when a read is refused, rather than failing chat open', async () => {
    const { line } = await run({ [RUNS_LIST_FUNCTION_ID]: () => [] })

    expect(line).toBeUndefined()
  })

  it('still names the proposals when only the digest half is refused', async () => {
    // The halves degrade INDEPENDENTLY. A banner that dropped everything because one of two reads
    // refused would make a routine unbound op hide the pending decisions a person needs to see.
    const { line } = await run({
      [PROPOSALS_LIST_FUNCTION_ID]: () => ({ entries: [{}, {}] }),
      [RUNS_LIST_FUNCTION_ID]: () => [RUN_SUMMARY],
    })

    expect(line).toContain('2 proposals pending')
  })

  it('holds no timer of any kind — a source pin, because a poll passes every case above', () => {
    // The behavioural assertions cannot see this. A banner that scheduled a re-read for 30s later
    // would return the right line NOW and keep the project's stores warm forever after, and every
    // spy count in this file would still be 1. So the absence of a scheduler is pinned as text.
    const source = readFileSync(join(__dirname, '..', 'banner.ts'), 'utf8')
    for (const scheduler of ['setInterval', 'setTimeout', 'setImmediate', 'watch(']) {
      expect({ scheduler, present: source.includes(scheduler) })
        .toEqual({ scheduler, present: false })
    }
  })

  it('skips the digest entirely when there is no run to digest', async () => {
    const { calls } = await run({
      [PROPOSALS_LIST_FUNCTION_ID]: () => ({ entries: [] }),
      [RUNS_LIST_FUNCTION_ID]: () => [],
    })

    // `runs.digest` is per-RUN, so a project with no runs has nothing to ask it about. Calling it
    // with an invented id would be a read whose refusal this file would then have to explain away.
    expect(calls).not.toContain(RUNS_DIGEST_FUNCTION_ID)
  })
})
