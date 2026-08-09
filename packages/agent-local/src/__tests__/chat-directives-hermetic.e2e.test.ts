// The four directives, measured through the REAL composition (Phase 392 plan 08, D-04/D-21/D-23).
//
// WHAT THIS FILE EXISTS TO CATCH is a directive that is handled and reaches nothing. Every one of
// them is a mechanism whose failure mode is a confirmation line and no effect: a `/pin` recorded
// against a name nothing answers to (391-05's measured silent no-op), a `/model` that changes what
// the prompt SAYS and not who answers, a `/quit` the loop never sees. So each assertion below is
// paired with the observable it would have to move — a refused invocation, a resolved model, a
// state flag — and every one of them is read off `composeLocalAgent()` rather than off a hand-built
// engine, because a differential assembled from parts can pass while the composition wires them
// wrong or not at all (the produced-not-literal law).
//
// THE PIN CLAIM IS A TWO-SIDED DIFFERENTIAL and it has to be: a one-sided "the op was refused"
// passes on a host where the op was never allowed in the first place. Same host, same op, same
// caller — before the pin and after it (D-21's "pin-active vs pin-absent on the same op is the
// pair").
//
// THE PIN TARGET IS A READ, deliberately. `proposals.list` is allow-tier, so its unpinned arm can
// only be an allow — a mutating target's unpinned arm would go through the ask ladder and could
// deny for reasons that have nothing to do with pinning, which would make the differential's
// GREEN side unreliable and the whole pair meaningless.

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
import type {
  ChatConfirmBindings,
  LocalAgentHost,
} from '../composition/compose-local-agent.js'

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
  modelId: 'fixture:directive-model',
  generate: () => Promise.resolve({ text: 'unused' }),
}

const MINT_IDENTITY = (filePath: string): string => filePath

/** A model object that answers nothing: every assertion here is about WHICH model, never what it said. */
function namedModel(modelId: string): ChatLanguageModel {
  const unreachable = (): never => {
    throw new Error('no directive scenario consults the planner')
  }
  return {
    specificationVersion: 'v3',
    provider: 'fixture',
    modelId,
    supportedUrls: {},
    doGenerate: unreachable,
    doStream: unreachable,
  } as unknown as ChatLanguageModel
}

describe('the composed session directives reach something (D-04 / D-21 / RESEARCH Open Q2)', () => {
  let root: string
  let agentQaRoot: string
  const hosts: LocalAgentHost[] = []

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'chat-directives-'))
    agentQaRoot = join(root, '.agent-qa')
    mkdirSync(agentQaRoot, { recursive: true })
  })

  afterEach(() => {
    for (const composed of hosts.splice(0)) void composed.close()
    rmSync(root, { recursive: true, force: true })
  })

  function compose(
    options: {
      chatModel?: ChatLanguageModel
      chatModelFor?: (name: string) => ChatLanguageModel | Promise<ChatLanguageModel>
      chatConfirm?: (bindings: ChatConfirmBindings) => undefined
    } = {},
  ): LocalAgentHost {
    const composed = composeLocalAgent({
      mintQuarantineIdentityPath: MINT_IDENTITY,
      agentQaRoot,
      config: { getMasked: () => Promise.resolve(MASKED_CONFIG) },
      knowledgeRoot: () => join(root, 'agent-qa-knowledge'),
      model: () => JOB_MODEL,
      ...options,
    })
    hosts.push(composed)
    return composed
  }

  async function ask(
    host: LocalAgentHost,
    message: string,
    sessionId?: string,
  ): Promise<AgentAskResult> {
    return (await invokeFunction(
      host.registry,
      AGENT_ASK_FUNCTION_ID,
      sessionId === undefined ? { message } : { message, sessionId },
      HUMAN,
    )) as AgentAskResult
  }

  function sessionEvents(sessionId: string): ChatSessionEvent[] {
    const path = join(agentQaRoot, CHAT_SESSIONS_SUBDIR, `${sessionId}.jsonl`)
    return readFileSync(path, 'utf8')
      .split('\n')
      .filter((line) => line !== '')
      .slice(1)
      .map((line) => JSON.parse(line) as ChatSessionEvent)
  }

  describe('/pin reaches the gate — the two-sided differential (D-21 / T-392-28)', () => {
    it('ALLOWS the op before the pin and REFUSES the same op after it, in the pinning session',
      async () => {
        const host = compose()
        const opened = await ask(host, 'proposals')
        // THE CALLER IS IN THE CONVERSATION (392 plan 13, W-03). The overlay is asked whose pin,
        // so the differential's two arms are the same caller before and after — a session-less
        // caller either side would be measuring a different question. This case used to ask with
        // one, and its red arm passing was the leak: a `/pin` typed in a conversation denied the
        // class for every caller on the host, which is what the last assertion now forbids.
        const inSession: FunctionCaller = { ...HUMAN, sessionId: opened.sessionId }

        // The GREEN side. Without it the red side proves nothing: an op refused on a host where it
        // was never reachable is a fact about the host, not about the pin.
        await expect(
          invokeFunction(host.registry, PROPOSALS_LIST_FUNCTION_ID, {}, inSession),
        ).resolves.toBeDefined()

        const pinned = await ask(host, `/pin ${PROPOSALS_LIST_FUNCTION_ID}`, opened.sessionId)
        expect(pinned.status).toBe('completed')

        await expect(
          invokeFunction(host.registry, PROPOSALS_LIST_FUNCTION_ID, {}, inSession),
        ).rejects.toThrow(/session-pin-denied/)

        // The scope control the pin needs as much as the deny: a caller in NO conversation — every
        // typed CLI verb, MCP call and background job on this host — is untouched by it.
        await expect(
          invokeFunction(host.registry, PROPOSALS_LIST_FUNCTION_ID, {}, HUMAN),
        ).resolves.toBeDefined()
      })

    it('logs the NORMALISED class, as a verb-sourced approval decision (392-05)', async () => {
      const host = compose()
      // Typed BARE. What denies is `fn:proposals.list`, and a log carrying the typed form would be
      // a record of the request rather than of the effect — the shape 391-05's trap reappears in.
      const result = await ask(host, `/pin ${PROPOSALS_LIST_FUNCTION_ID}`)

      const decisions = sessionEvents(result.sessionId).filter(
        (event) => event.kind === 'approval_decision',
      )
      expect(decisions).toEqual([
        expect.objectContaining({
          actionClass: `fn:${PROPOSALS_LIST_FUNCTION_ID}`,
          decision: 'deny',
          source: 'verb',
        }),
      ])
      expect(result.answer).toContain(`fn:${PROPOSALS_LIST_FUNCTION_ID}`)
    })

    it('executes NOTHING on a directive turn, and publishes the pin to live state', async () => {
      const host = compose()
      const result = await ask(host, `/pin ${PROPOSALS_LIST_FUNCTION_ID}`)

      // A directive names no capability: zero receipts is the shape, not an accident of the fixture.
      expect(result.receipts).toEqual([])
      expect(host.chat.stateFor(result.sessionId)?.pinnedActionClasses).toEqual([
        `fn:${PROPOSALS_LIST_FUNCTION_ID}`,
      ])
    })

    it('refuses BY NAME when the class names nothing this host declares', async () => {
      const host = compose()
      // The shipped refusal (392-05, property 2). It travels the engine's ONE refusal path, so it
      // leaves the same countable `mark_unhandled` row every other refused clause does.
      const result = await ask(host, '/pin config-write')

      expect(result.status).toBe('fail_closed')
      expect(result.unhandled?.reason).toContain('fn:config-write')
      const unhandled = sessionEvents(result.sessionId).filter(
        (event) => event.kind === 'mark_unhandled',
      )
      expect(unhandled).toHaveLength(1)
    })
  })

  describe('/model reaches the model resolution (D-04 / CHAT-06)', () => {
    it('emits ONE model_change with source verb, through diffChatConfig', async () => {
      const host = compose({ chatModel: namedModel('fixture:opening-model') })
      const result = await ask(host, '/model fixture:second-model')

      const changes = sessionEvents(result.sessionId).filter(
        (event) => event.kind === 'model_change',
      )
      expect(changes).toEqual([
        expect.objectContaining({
          from: 'fixture:opening-model',
          to: 'fixture:second-model',
          source: 'verb',
        }),
      ])
    })

    it('does NOT emit a model_change straight back on the next turn (392-07 trap)', async () => {
      // THE SHARPEST TRAP IN THIS PLAN, asserted rather than reasoned about. The per-turn config
      // re-read compares what the log last recorded against what the composition currently
      // answers; a `config` thunk that kept answering the COMPOSED model would produce a second
      // `model_change` back to it, silently undoing the verb one turn later.
      const host = compose({ chatModel: namedModel('fixture:opening-model') })
      const first = await ask(host, '/model fixture:second-model')
      await ask(host, '/help', first.sessionId)

      const changes = sessionEvents(first.sessionId).filter(
        (event) => event.kind === 'model_change',
      )
      expect(changes).toHaveLength(1)
      expect(host.chat.stateFor(first.sessionId)?.activeModel).toBe('fixture:second-model')
    })

    it('resolves the named model through the HOST, never by constructing one', async () => {
      // CHAT-06 as a behaviour rather than a lint: chat cannot build a model, so the only way a
      // `/model` can change who answers is a resolver the composition was HANDED. The spy is what
      // separates "the override reached the model resolution" from "the prompt says a new name".
      const asked: string[] = []
      const host = compose({
        chatModel: namedModel('fixture:opening-model'),
        chatModelFor: (name) => {
          asked.push(name)
          return namedModel(name)
        },
      })

      await ask(host, '/model fixture:second-model')

      expect(asked).toEqual(['fixture:second-model'])
    })

    it('refuses BY NAME when the host cannot resolve the named model', async () => {
      const host = compose({
        chatModel: namedModel('fixture:opening-model'),
        chatModelFor: (name) => {
          throw new Error(`no model named ${name} is configured`)
        },
      })

      const result = await ask(host, '/model fixture:nonsense')

      // A `/model` that silently kept the old model would be the worst answer available: every
      // later turn would report a model that never answered anything.
      expect(result.status).toBe('fail_closed')
      expect(result.unhandled?.reason).toContain('fixture:nonsense')
      expect(host.chat.stateFor(result.sessionId)?.activeModel).toBe('fixture:opening-model')
    })
  })

  describe('the chrome directives answer, and /quit reaches the loop', () => {
    it('/help names the reach lever, and executes nothing', async () => {
      const host = compose()
      const result = await ask(host, '/help')

      expect(result.status).toBe('completed')
      expect(result.receipts).toEqual([])
      // `/fn` is the fragment that matters: without it a person believes the thin canon is the
      // whole capability set, which is exactly what D-06 trades a thin table for.
      expect(result.answer).toContain('/fn')
    })

    it('/quit sets the live state a REPL reads, rather than being matched by the surface', async () => {
      const host = compose()
      // An ordinary turn FIRST, so the before-state is read off the same session the `/quit` turn
      // will move (392 plan 13: the state is per session, and an unopened session has none).
      const opened = await ask(host, 'proposals')
      expect(host.chat.stateFor(opened.sessionId)?.closing).toBe(false)

      const result = await ask(host, '/quit', opened.sessionId)

      expect(result.status).toBe('completed')
      // ONE vocabulary for what a person can type. A REPL matching `/quit` itself would be a
      // second list of the canon, free to disagree with the table that routes everything else.
      expect(host.chat.stateFor(opened.sessionId)?.closing).toBe(true)
      // And it moved THAT conversation only: a second session on the same host is not closing
      // because somebody else typed `/quit`.
      const other = await ask(host, 'proposals')
      expect(host.chat.stateFor(other.sessionId)?.closing).toBe(false)
    })
  })

  describe('the live turn state (RESEARCH Open Q2)', () => {
    it('carries the conversation forward across turns, and names no turn between them', async () => {
      const host = compose()
      const first = await ask(host, 'proposals')

      // Between turns there is nothing in flight, which is what makes an abort a no-op rather
      // than a row on a turn that already completed.
      expect(host.chat.stateFor(first.sessionId)?.activeTurnId).toBeUndefined()
      expect(host.chat.stateFor(first.sessionId)?.lastTurn?.turnId).toBe(first.turnId)

      await ask(host, 'status', first.sessionId)
      const conversation = host.chat.stateFor(first.sessionId)?.conversation ?? []
      // The repaired replay, projected once. The first turn's utterance and its receipt line are
      // both in it by the second turn, oldest first.
      expect(conversation.length).toBeGreaterThan(0)
      expect(JSON.stringify(conversation)).toContain('proposals')
    })

    it('abortActiveTurn is a no-op between turns', async () => {
      const host = compose()
      const result = await ask(host, 'proposals')

      await host.chat.abortActiveTurn()

      expect(sessionEvents(result.sessionId).filter((e) => e.kind === 'aborted')).toEqual([])
    })

    it('writes an explicit aborted row for a turn caught in flight (D-19 graceful arm)', async () => {
      // DRIVEN FROM INSIDE A TURN, and deterministically rather than by racing one. `chatModelFor`
      // is called by the `/model` handler in the middle of `runTurn`, which is exactly the window a
      // SIGINT handler fires in — so the state it observes is the state that handler would see, and
      // there is no sleep or microtask ordering holding the assertion up.
      let observedTurnId: string | undefined
      // The session the observation reads through, learned from an ordinary opening turn — the
      // state is per session now (392 plan 13), so naming one is how a handler asks about one.
      let sessionId: string | undefined
      const host: LocalAgentHost = compose({
        chatModel: namedModel('fixture:opening-model'),
        chatModelFor: async (name) => {
          observedTurnId =
            sessionId === undefined ? undefined : host.chat.stateFor(sessionId)?.activeTurnId
          await host.chat.abortActiveTurn()
          return namedModel(name)
        },
      })

      const opened = await ask(host, 'proposals')
      sessionId = opened.sessionId
      const result = await ask(host, '/model fixture:second-model', sessionId)

      // The id was published at the TOP of the turn, before anything could fail. That ordering is
      // the whole reason the state sink exists: an interrupted turn never produces a result, so a
      // handler waiting for one could never name what it was interrupting.
      expect(observedTurnId).toBe(result.turnId)
      const aborted = sessionEvents(result.sessionId).filter((e) => e.kind === 'aborted')
      expect(aborted).toEqual([
        expect.objectContaining({ source: 'explicit', turnId: result.turnId }),
      ])
    })
  })

  describe('the chat confirm seam (D-03)', () => {
    it('is handed a mint and a decision sink, and its absence leaves the port absent', async () => {
      let bindings: ChatConfirmBindings | undefined
      const host = compose({
        chatConfirm: (given) => {
          bindings = given
          // `undefined` is the non-TTY answer, and the arm that matters: it leaves `confirm`
          // absent so `evaluate()`'s own deny-by-default is what answers (D-03, unchanged).
          return undefined
        },
      })

      const result = await ask(host, 'proposals')

      expect(bindings).toBeDefined()
      expect(typeof bindings?.recordStandingApproval).toBe('function')
      expect(typeof bindings?.onDecision).toBe('function')
      // The sink writes onto the SAME session log the engine writes, stamped with the turn in
      // flight — so a decision row can be placed by a reader folding the log linearly.
      await bindings?.onDecision({ actionClass: 'fn:x', decision: 'accept' })
      expect(sessionEvents(result.sessionId).filter((e) => e.kind === 'approval_decision'))
        .toEqual([])
    })
  })
})
