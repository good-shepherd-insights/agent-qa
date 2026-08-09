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

import {
  AGENT_ASK_FUNCTION_ID,
  PROPOSALS_LIST_FUNCTION_ID,
  invokeFunction,
} from '@vostride/agent-qa-agent'
import type { ChatLanguageModel, JobModelCapability } from '@vostride/agent-qa-agent'
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
    // left dangling by the overlap. Each conversation is read through ITS OWN session (plan 13's
    // per-session state), so the two reads can no longer be one container answering twice.
    const thirdA = await ask(host, UTTERANCE_A, firstA.sessionId)
    const thirdB = await ask(host, UTTERANCE_B, firstB.sessionId)
    const conversationA = JSON.stringify(host.chat.stateFor(firstA.sessionId)?.conversation ?? [])
    const conversationB = JSON.stringify(host.chat.stateFor(firstB.sessionId)?.conversation ?? [])

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

// ---------------------------------------------------------------------------------------
// THE STATE HALF OF THE SAME DEFECT (Phase 392 plan 13, CR-02 / W-03).
//
// Plan 12 keyed the LOG by session. What stayed keyed by COMPOSITION is everything the engine
// publishes beside it: `chat-state.ts`'s `activeTurnId` / `conversation` / `activeModel` are one
// closure per host, and `chatPins` is one holder per host with its deny predicate bound
// unconditionally into the registry. Two facts follow, and both are measured below rather than
// argued: a `/pin` typed in one conversation denies that action class for EVERY later caller until
// the process restarts (W-03), and an interleaved turn puts one session's conversation into
// another session's outbound provider request (CR-02).
//
// BOTH CASES ARE WRITTEN AGAINST PUBLIC SEAMS ONLY — `composeLocalAgent`'s `chatModel` option,
// `invokeFunction`, and the recorded provider call — so each file is byte-identical either side of
// the fix and its failure is a true differential rather than a restatement of it.
// ---------------------------------------------------------------------------------------

/** The class a person pins, in the NORMALISED spelling the holder records and the gate compares. */
const PINNED_CLASS = `fn:${PROPOSALS_LIST_FUNCTION_ID}`

describe('a pin belongs to the conversation that typed it (W-03)', () => {
  let root: string
  let agentQaRoot: string
  const hosts: LocalAgentHost[] = []

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'chat-pin-session-'))
    agentQaRoot = join(root, '.agent-qa')
    mkdirSync(agentQaRoot, { recursive: true })
  })

  afterEach(() => {
    for (const composed of hosts.splice(0)) void composed.close()
    rmSync(root, { recursive: true, force: true })
  })

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

  /**
   * NO OVERLAP IS NEEDED, and that is the sharpest thing about this case: the leak is not a race.
   * The pin holder is one object for the whole composition, so a pin typed in session A is in force
   * for session B on a turn that starts minutes later — and, on a daemon, for every conversation
   * that host ever serves again. `proposals` is the canon alias whose op answers honestly in a bare
   * temp project (392-07's adjudication), and it is the same class `pin-composed-differential`
   * proves the single-session direction on, so this case extends that proof rather than starting a
   * second one.
   */
  it('denies the session that pinned it and NOT a second session on the same host', async () => {
    const host = compose()
    const a = await ask(host, 'proposals')
    const b = await ask(host, 'proposals')
    expect(a.sessionId).not.toBe(b.sessionId)
    // Both sessions could run the op before the pin, so a refusal below is the pin and nothing else.
    expect(a.receipts[0]?.status).toBe('executed')
    expect(b.receipts[0]?.status).toBe('executed')

    const pinned = await ask(host, `/pin ${PROPOSALS_LIST_FUNCTION_ID}`, a.sessionId)
    expect(pinned.answer ?? '').toContain(PINNED_CLASS)

    // The companion direction, asserted FIRST so a fix that simply stopped pinning anything cannot
    // pass this case: the pin still bites the conversation that typed it.
    const afterA = await ask(host, 'proposals', a.sessionId)
    expect(afterA.receipts[0]?.status).toBe('failed')
    expect(afterA.receipts[0]?.outcome).toContain('FunctionDenied')

    // The claim. Session B never pinned anything, and nothing it asks for should be refused because
    // somebody else's conversation did.
    const afterB = await ask(host, 'proposals', b.sessionId)
    expect(afterB.receipts.map((receipt) => receipt.status)).toEqual(['executed'])
  })

  it('does not deny a caller carrying no session at all', async () => {
    // Every non-chat invocation in the system — a typed CLI verb, an MCP call, a background job —
    // reaches the same registry through the same gate with a caller that names no chat session. A
    // chat pin that could refuse those would be a conversation reconfiguring the host.
    const host = compose()
    const opened = await ask(host, 'proposals')
    await ask(host, `/pin ${PROPOSALS_LIST_FUNCTION_ID}`, opened.sessionId)

    await expect(
      invokeFunction(host.registry, PROPOSALS_LIST_FUNCTION_ID, {}, HUMAN),
    ).resolves.toBeDefined()
  })
})

/** What one provider call was handed, flattened — the outbound request as the SDK delivered it. */
interface RecordedCall {
  readonly body: string
}

interface RecordingModel {
  readonly model: ChatLanguageModel
  readonly calls: readonly RecordedCall[]
  /** Hold the next `n` calls at the provider boundary until all `n` have arrived. */
  armRendezvous(n: number): void
}

/**
 * A model that RECORDS what it was asked and answers nothing (the tripwire idiom, inverted).
 *
 * The tripwire elsewhere in this package proves a model was never reached; this one proves WHAT
 * reached it. It returns no tool calls, so every turn it plans ends `fail_closed` through the
 * ordinary reconciliation path — which is irrelevant to the claim, because the claim is about the
 * request that crossed the boundary and not about what came back.
 *
 * The rendezvous is the test's own barrier and uses no timer: two calls arriving is the release
 * condition, so "the two turns were genuinely in flight together at plan time" is asserted by
 * construction rather than hoped for.
 */
function recordingModel(): RecordingModel {
  const calls: RecordedCall[] = []
  let gate: { pending: number; release: () => void; wait: Promise<void> } | undefined

  const model = {
    specificationVersion: 'v3',
    provider: 'fixture',
    modelId: 'fixture:recording-model',
    supportedUrls: {},
    async doGenerate(options: unknown): Promise<unknown> {
      calls.push({ body: JSON.stringify(options) })
      if (gate !== undefined) {
        gate.pending -= 1
        if (gate.pending === 0) gate.release()
        await gate.wait
      }
      return {
        content: [],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: {
          inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 0, text: 0, reasoning: 0 },
        },
        warnings: [],
      }
    },
    doStream(): never {
      throw new Error('the planner stage never streams')
    },
  } as unknown as ChatLanguageModel

  return {
    model,
    calls,
    armRendezvous(n: number): void {
      let release!: () => void
      const wait = new Promise<void>((resolve) => {
        release = resolve
      })
      gate = { pending: n, release, wait }
    },
  }
}

describe('the planner reads the conversation of the session it is planning FOR (CR-02)', () => {
  let root: string
  let agentQaRoot: string
  const hosts: LocalAgentHost[] = []

  /** Distinctive enough that no tool description, op id or prompt tier can supply them. */
  const MARKER_A = 'zqmarkeralphaseven'
  const MARKER_B = 'zqmarkerbetathree'
  const QUESTION_A = 'zqaskalpha'
  const QUESTION_B = 'zqaskbeta'

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'chat-conversation-bleed-'))
    agentQaRoot = join(root, '.agent-qa')
    mkdirSync(agentQaRoot, { recursive: true })
  })

  afterEach(() => {
    for (const composed of hosts.splice(0)) void composed.close()
    rmSync(root, { recursive: true, force: true })
  })

  function compose(chatModel: ChatLanguageModel): LocalAgentHost {
    const composed = composeLocalAgent({
      mintQuarantineIdentityPath: MINT_IDENTITY,
      agentQaRoot,
      config: { getMasked: () => Promise.resolve(MASKED_CONFIG) },
      knowledgeRoot: () => join(root, 'agent-qa-knowledge'),
      model: () => JOB_MODEL,
      chatModel,
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

  it('never puts one session history into another session outbound request', async () => {
    const recorder = recordingModel()
    const host = compose(recorder.model)

    // Two histories, seeded SEQUENTIALLY so the state the measurement starts from is two conversations
    // that differ by exactly one word. The marker rides the user message, which `replaySession`
    // replays verbatim and `buildChatPrompt` renders in its "Conversation so far" block.
    const a = await ask(host, MARKER_A)
    const b = await ask(host, MARKER_B)
    expect(a.sessionId).not.toBe(b.sessionId)

    // The overlap, on this file's own idiom: both promises exist before either is awaited, so the
    // two turns' await points interleave exactly as the daemon's concurrent `handleInvoke` delivers
    // them. The rendezvous holds both at the provider boundary until both have arrived, so the
    // overlap is a fact of the run rather than of its timing.
    recorder.armRendezvous(2)
    const pendingA = ask(host, QUESTION_A, a.sessionId)
    const pendingB = ask(host, QUESTION_B, b.sessionId)
    await Promise.all([pendingA, pendingB])

    const overlappedA = recorder.calls.find((call) => call.body.includes(QUESTION_A))
    const overlappedB = recorder.calls.find((call) => call.body.includes(QUESTION_B))
    expect(overlappedA).toBeDefined()
    expect(overlappedB).toBeDefined()

    // THE CLAIM, both directions. A request that carries the other session's history has published
    // one person's conversation to a provider under another person's turn.
    expect(overlappedA?.body.includes(MARKER_B)).toBe(false)
    expect(overlappedA?.body.includes(MARKER_A)).toBe(true)
    expect(overlappedB?.body.includes(MARKER_A)).toBe(false)
    expect(overlappedB?.body.includes(MARKER_B)).toBe(true)
  })
})
