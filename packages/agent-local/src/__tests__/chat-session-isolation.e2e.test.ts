// Two conversations at once, through one composition (Phase 392 plan 12, CHAT-05 / CR-01).
//
// "A SESSION IS RECONSTRUCTABLE AND CANNOT WEDGE" is a claim about a session, and every scenario
// this phase shipped runs ONE turn at a time — which is precisely the shape that cannot see the
// defect 392-VERIFICATION measured: `createJsonlSessionLogOn` held one mutable `fd` for the whole
// adapter, so a second `open()` repointed it and every later `append` of the FIRST turn landed in
// the SECOND session's file. The measured result was receipts in the wrong conversation, a session
// left dangling without its closing event, and that dangling turn — the user's own message
// included — pruned out of the replay forever on the next open.
//
// THE SEAM IS PUBLIC AND THE FILES ARE READ FROM DISK, which is what makes this file's RED a true
// differential rather than a restatement of the fix. Nothing here imports an adapter internal, no
// handle is constructed by hand, and no session state is inspected through a back door: the test
// says `invokeFunction(agent.ask)` twice without awaiting between them and then reads the two
// `.jsonl` files the composition wrote. It is byte-identical before and after the refactor, so its
// failure against the shipped tree and its pass afterwards measure the same thing.
//
// THE OVERLAP IS REAL, NOT NOMINAL. Both promises are created before either is awaited, so the two
// turns' `await` points interleave on the microtask queue exactly as the daemon's concurrent
// `handleInvoke` delivers them (`cli/src/daemon/server.ts` accepts ANY functionId, concurrently,
// and `chatTurn` is bound on both hosts). No sleep, no fake timers, no injected scheduler: the
// interleaving is the runtime's own.
//
// REACHABILITY, NOT HYPOTHESIS. Beside the daemon there is the nested path — `projectPlannerTools`
// walks the registry unfiltered, so `agent.ask` is itself offered to the planner, and this phase's
// own note records a live model planning it twice out of two runs.

import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { AGENT_ASK_FUNCTION_ID, invokeFunction } from '@vostride/agent-qa-agent'
import type { JobModelCapability } from '@vostride/agent-qa-agent'
import {
  FunctionScopeSchema,
  MASKED_RESOLVED_CONFIG_SCHEMA_VERSION,
} from '@vostride/agent-qa-schema'
import type {
  AgentAskResult,
  ChatSessionEvent,
  FunctionCaller,
  MaskedResolvedConfig,
} from '@vostride/agent-qa-schema'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { CHAT_SESSIONS_SUBDIR } from '../session/jsonl-session-log.js'
import { composeLocalAgent } from '../composition/compose-local-agent.js'
import type { LocalAgentHost } from '../composition/compose-local-agent.js'

const MASKED_CONFIG: MaskedResolvedConfig = {
  schemaVersion: MASKED_RESOLVED_CONFIG_SCHEMA_VERSION,
  configPath: '/fixture/agent-qa.config.yaml',
  entries: [],
}

/** A person holding every scope, so a refusal below can only ever be the axis under test. */
const HUMAN: FunctionCaller = {
  surface: 'test',
  grantedScopes: [...FunctionScopeSchema.options],
  safeMode: false,
  origin: 'human',
}

const JOB_MODEL: JobModelCapability = {
  modelId: 'fixture:isolation-model',
  generate: () => Promise.resolve({ text: 'unused' }),
}

const MINT_IDENTITY = (filePath: string): string => filePath

/**
 * The 392-07 canon pair, and the choice is on the record for the same reason it was there.
 *
 * `proposals` and `status` are the two aliases whose ops answer honestly in a BARE temp project —
 * an empty inbox and an empty run list, rather than a refusal — so both turns of the overlapping
 * pair COMPLETE and the assertion below is about where their events landed rather than about
 * whether they ran. Two different ops rather than one alias twice, so a receipt that crossed files
 * is legible as the wrong op in the wrong conversation.
 */
const UTTERANCE_A = 'proposals'
const UTTERANCE_B = 'status'

describe('two sessions, overlapping turns, two intact files (CHAT-05 / CR-01)', () => {
  let root: string
  let agentQaRoot: string
  const hosts: LocalAgentHost[] = []

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'chat-session-isolation-'))
    agentQaRoot = join(root, '.agent-qa')
    mkdirSync(agentQaRoot, { recursive: true })
  })

  afterEach(() => {
    for (const composed of hosts.splice(0)) void composed.close()
    rmSync(root, { recursive: true, force: true })
  })

  /** ONE composition, which is the whole point: the defect is adapter state shared across sessions. */
  function compose(): LocalAgentHost {
    const composed = composeLocalAgent({
      mintQuarantineIdentityPath: MINT_IDENTITY,
      agentQaRoot,
      config: { getMasked: () => Promise.resolve(MASKED_CONFIG) },
      knowledgeRoot: () => join(root, 'agent-qa-knowledge'),
      model: () => JOB_MODEL,
    })
    hosts.push(composed)
    return composed
  }

  function ask(host: LocalAgentHost, message: string, sessionId?: string): Promise<AgentAskResult> {
    return invokeFunction(
      host.registry,
      AGENT_ASK_FUNCTION_ID,
      sessionId === undefined ? { message } : { message, sessionId },
      HUMAN,
    ) as Promise<AgentAskResult>
  }

  /** The file as written, header line dropped. Read from DISK, never from an adapter's memory. */
  function sessionEvents(sessionId: string): ChatSessionEvent[] {
    const path = join(agentQaRoot, CHAT_SESSIONS_SUBDIR, `${sessionId}.jsonl`)
    return readFileSync(path, 'utf8')
      .split('\n')
      .filter((line) => line !== '')
      .slice(1)
      .map((line) => JSON.parse(line) as ChatSessionEvent)
  }

  function turnIdsIn(events: readonly ChatSessionEvent[]): string[] {
    return [...new Set(events.map((event) => event.turnId))]
  }

  /**
   * Two sessions, then one overlapping turn each — the arrangement, run once per assertion.
   *
   * The two setup turns are SEQUENTIAL and complete before the overlap begins, so the state the
   * measurement starts from is two healthy files. The overlap itself creates both promises before
   * awaiting either, which is the only way the two turns' awaits interleave.
   */
  async function overlappingPair(): Promise<{
    host: LocalAgentHost
    first: readonly [AgentAskResult, AgentAskResult]
    overlapped: readonly [AgentAskResult, AgentAskResult]
  }> {
    const host = compose()
    const firstA = await ask(host, UTTERANCE_A)
    const firstB = await ask(host, UTTERANCE_B)
    expect(firstA.sessionId).not.toBe(firstB.sessionId)

    const pendingA = ask(host, UTTERANCE_A, firstA.sessionId)
    const pendingB = ask(host, UTTERANCE_B, firstB.sessionId)
    const [secondA, secondB] = await Promise.all([pendingA, pendingB])

    return { host, first: [firstA, firstB], overlapped: [secondA, secondB] }
  }

  it('keeps every event of a turn in the file of the session that turn belongs to', async () => {
    const { first, overlapped } = await overlappingPair()
    const [firstA, firstB] = first
    const [secondA, secondB] = overlapped

    // Each result reports its OWN session, which the shipped build already did — and which is
    // exactly why the defect is invisible from the result alone.
    expect(secondA.sessionId).toBe(firstA.sessionId)
    expect(secondB.sessionId).toBe(firstB.sessionId)

    const eventsA = sessionEvents(firstA.sessionId)
    const eventsB = sessionEvents(firstB.sessionId)

    // The centre of the claim: a session's file carries its own turns and NOBODY else's.
    expect(turnIdsIn(eventsA)).toEqual([firstA.turnId, secondA.turnId])
    expect(turnIdsIn(eventsB)).toEqual([firstB.turnId, secondB.turnId])
  })

  it('leaves no turn id in two files at once', async () => {
    const { first } = await overlappingPair()
    const [firstA, firstB] = first

    const inA = new Set(turnIdsIn(sessionEvents(firstA.sessionId)))
    const inB = turnIdsIn(sessionEvents(firstB.sessionId))

    expect(inB.filter((turnId) => inA.has(turnId))).toEqual([])
  })

  it('closes both sessions: each file ENDS with the turn_complete of its own last turn', async () => {
    const { first, overlapped } = await overlappingPair()
    const [firstA, firstB] = first
    const [secondA, secondB] = overlapped

    // The dangling half of the defect. A file whose last event is a `stage_outcome` is a session
    // with an interrupted turn, and the next open synthesizes an `aborted` and prunes it.
    for (const [sessionId, turnId] of [
      [firstA.sessionId, secondA.turnId],
      [firstB.sessionId, secondB.turnId],
    ] as const) {
      const events = sessionEvents(sessionId)
      const last = events.at(-1)
      expect(last?.kind).toBe('turn_complete')
      expect(last?.turnId).toBe(turnId)
    }
  })

  it('reports completed for both overlapping turns, each with its own receipt', async () => {
    const { overlapped } = await overlappingPair()
    const [secondA, secondB] = overlapped

    expect(secondA.status).toBe('completed')
    expect(secondB.status).toBe('completed')
    expect(secondA.receipts.map((receipt) => receipt.clause)).toEqual([UTTERANCE_A])
    expect(secondB.receipts.map((receipt) => receipt.clause)).toEqual([UTTERANCE_B])
  })

  it('prunes NOTHING on the next open: no synthesized abort, both earlier turns still replayed', async () => {
    const { host, first, overlapped } = await overlappingPair()
    const [firstA, firstB] = first
    const [secondA, secondB] = overlapped

    // A third turn each, sequential — the moment the repair would fire if either session had been
    // left dangling by the overlap. The conversation is read straight after its own turn, because
    // the live state container is per-composition (CR-02, plan 13's) and names one conversation.
    const thirdA = await ask(host, UTTERANCE_A, firstA.sessionId)
    const conversationA = JSON.stringify(host.chat.state.read().conversation)
    const thirdB = await ask(host, UTTERANCE_B, firstB.sessionId)
    const conversationB = JSON.stringify(host.chat.state.read().conversation)

    expect(thirdA.status).toBe('completed')
    expect(thirdB.status).toBe('completed')

    // No `aborted` row anywhere: repair had nothing to close, which is the on-disk statement that
    // no turn was left dangling by the overlap.
    for (const sessionId of [firstA.sessionId, firstB.sessionId]) {
      expect(sessionEvents(sessionId).filter((event) => event.kind === 'aborted')).toEqual([])
    }

    // And the REPLAY the third turn was handed still contains the two turns that came before it.
    // `replaySession` prunes aborted turn ids, so a pruned turn is one that vanishes from here —
    // the user's own message included, which is the loss the verifier measured.
    for (const turnId of [firstA.turnId, secondA.turnId]) {
      expect(
        sessionEvents(firstA.sessionId).some(
          (event) => event.kind === 'user_message' && event.turnId === turnId,
        ),
      ).toBe(true)
    }
    expect(conversationA).toContain(UTTERANCE_A)
    expect(conversationB).toContain(UTTERANCE_B)
  })
})
