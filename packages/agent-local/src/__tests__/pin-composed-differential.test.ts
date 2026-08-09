// THE COMPOSED `/pin` DIFFERENTIAL (Phase 392 plan 10, D-21).
//
// 392-05 proved the pin at the GATE: an overlay handed to `evaluate()` denies. This file proves the
// COMPOSED claim, which is a different one and the one a person actually experiences — that typing
// `/pin <class>` into a conversation makes the very next turn asking for that capability come back
// refused, through `invokeFunction`, with a row in the execution audit. Between those two claims sit
// three things a gate-level test cannot see: the directive handler, the overlay's live view of the
// session's pin set, and the conditional threading at `invoke.ts`'s single `evaluate()` call-site.
//
// THREE ARMS, ONE COMPOSITION, ONE SESSION, and the sameness is the whole design. A differential
// whose arms are different hosts is comparing two assemblies; these arms are the SAME assembly at
// three moments of one conversation, so the only thing that changed between them is the pin.
//
//   1. no pin        — `proposals` executes.
//   2. after the pin — the SAME utterance is REFUSED through `invokeFunction`, the receipt carries
//                      the named refusal, and a `session-pin-denied` row lands in the audit file.
//   3. scope control — a DIFFERENT capability's class is still executable under the same pin. A
//                      pin that denied everything would pass arms 1 and 2 and be a catastrophe.
//
// THE MINT-REFUSAL ARM IS N/A BY DESIGN, stated here rather than left as an unexplained absence.
// Two-sided differentials for a policy surface normally pair "the tightening was recorded" against
// "the loosening was refused". `/pin` has no loosening side to refuse: the holder publishes `pin`,
// `list` and `asGateDeny` and no unpin, the DTO carries a deny list and no allow list, and the gate
// hook's only true branch writes a deny. So the pair here is pin-active against pin-absent on the
// same op, which is what D-21 names, plus the scope control that keeps "denies" from meaning
// "denies everything".
//
// THE AUDIT ROW IS ASSERTED AT THE FILE THE COMPOSITION WRITES. `composeLocalAgent` binds
// `JsonlAuditSink(agentQaRoot)`, so `execution_audit.jsonl` under the runtime root IS the seam —
// not a spy standing in for it. A refusal that returned the right message and recorded nothing
// would be exactly the repudiation gap the gate's row placement exists to close.
//
// THE PLANNER IS BOUND AND MUST GO UNTOUCHED. Every utterance here is table-canonical, so a model
// was bound that counts and throws: a host with no model could not call one however wrong its
// routing was, and an absence cannot prove a skip. It also rules out a reading in which the refusal
// came from somewhere other than the gate.

import { mkdirSync, mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  AGENT_ASK_FUNCTION_ID,
  PROPOSALS_LIST_FUNCTION_ID,
  RUNS_LIST_FUNCTION_ID,
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

/** The class the person pins. The NORMALISED spelling the holder records and the gate compares. */
const PINNED_CLASS = `fn:${PROPOSALS_LIST_FUNCTION_ID}`

/** The class the pin must NOT reach — the scope control's subject. */
const UNPINNED_CLASS = `fn:${RUNS_LIST_FUNCTION_ID}`

const MASKED_CONFIG: MaskedResolvedConfig = {
  schemaVersion: MASKED_RESOLVED_CONFIG_SCHEMA_VERSION,
  configPath: '/fixture/agent-qa.config.yaml',
  entries: [],
}

/** A person holding every scope, so a refusal below can only ever be the pin. */
const HUMAN: FunctionCaller = {
  surface: 'test',
  grantedScopes: [...FunctionScopeSchema.options],
  safeMode: false,
  origin: 'human',
}

const JOB_MODEL: JobModelCapability = {
  modelId: 'fixture:pin-differential',
  generate: () => Promise.resolve({ text: 'unused' }),
}

const MINT_IDENTITY = (filePath: string): string => filePath

/** A model that FAILS the turn if it is ever reached, and counts the attempt either way. */
function plannerTripwire(): { model: ChatLanguageModel; calls: () => number } {
  let calls = 0
  const reached = (): never => {
    calls += 1
    throw new Error('a canonical utterance consulted the planner')
  }
  return {
    model: {
      specificationVersion: 'v3',
      provider: 'fixture',
      modelId: 'fixture:never-called',
      supportedUrls: {},
      doGenerate: reached,
      doStream: reached,
    } as unknown as ChatLanguageModel,
    calls: () => calls,
  }
}

interface AuditRow {
  readonly action: string
  readonly verdict: string
  readonly outcome: string
  readonly reason: string
}

describe('D-21: the session pin, proved through the composed stack', () => {
  let root: string
  let agentQaRoot: string
  let host: LocalAgentHost
  let tripwire: ReturnType<typeof plannerTripwire>

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'pin-composed-'))
    agentQaRoot = join(root, '.agent-qa')
    mkdirSync(agentQaRoot, { recursive: true })
    tripwire = plannerTripwire()
    host = composeLocalAgent({
      mintQuarantineIdentityPath: MINT_IDENTITY,
      agentQaRoot,
      config: { getMasked: () => Promise.resolve(MASKED_CONFIG) },
      knowledgeRoot: () => join(root, 'agent-qa-knowledge'),
      model: () => JOB_MODEL,
      chatModel: tripwire.model,
    })
  })

  afterEach(() => {
    void host.close()
    rmSync(root, { recursive: true, force: true })
  })

  /** One turn through the registered op, on the session the previous turn opened. */
  async function ask(message: string, sessionId?: string): Promise<AgentAskResult> {
    return (await invokeFunction(
      host.registry,
      AGENT_ASK_FUNCTION_ID,
      { message, ...(sessionId === undefined ? {} : { sessionId }) },
      HUMAN,
    )) as AgentAskResult
  }

  function sessionEvents(sessionId: string): readonly ChatSessionEvent[] {
    return readFileSync(join(agentQaRoot, CHAT_SESSIONS_SUBDIR, `${sessionId}.jsonl`), 'utf8')
      .split('\n')
      .filter((line) => line !== '')
      .slice(1)
      .map((line) => JSON.parse(line) as ChatSessionEvent)
  }

  /** The audit trail as the COMPOSITION writes it — the real file, not a spy. */
  function auditRows(): readonly AuditRow[] {
    const path = join(agentQaRoot, 'execution_audit.jsonl')
    if (!existsSync(path)) return []
    return readFileSync(path, 'utf8')
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => JSON.parse(line) as AuditRow)
  }

  it('all three arms: execute, then deny-with-audit-row, then the scope control', async () => {
    // ---- ARM 1: no pin. The op executes, and the audit records an ordinary allow.
    const before = await ask('proposals')
    expect(before.status).toBe('completed')
    expect(before.receipts.map((receipt) => receipt.functionId)).toEqual([
      PROPOSALS_LIST_FUNCTION_ID,
    ])
    expect(before.receipts[0]?.status).toBe('executed')
    const allowRow = auditRows().find((row) => row.action === PINNED_CLASS)
    expect(allowRow?.verdict).toBe('allow')

    // ---- The pin itself, typed into the SAME session.
    const pinned = await ask(`/pin ${PROPOSALS_LIST_FUNCTION_ID}`, before.sessionId)
    expect(pinned.status).toBe('completed')
    // A directive names no capability, so it invokes nothing — and it is the NORMALISED class the
    // answer and the log both carry (392-05's law): the person typed a bare op id and what denies
    // is the `fn:`-prefixed risk name. Recording the request rather than the effect is how the
    // silent-no-op trap reappears in a record several surfaces render.
    expect(pinned.receipts).toEqual([])
    expect(pinned.answer ?? '').toContain(PINNED_CLASS)
    const decision = sessionEvents(before.sessionId).find(
      (event) => event.kind === 'approval_decision',
    )
    expect(decision).toMatchObject({
      actionClass: PINNED_CLASS,
      decision: 'deny',
      source: 'verb',
    })

    // ---- ARM 2: the SAME utterance, same session, same composition. Now refused.
    const after = await ask('proposals', before.sessionId)
    expect(after.status).toBe('failed')
    // The clause was ROUTED — this is not a routing failure wearing a refusal's clothes. It reached
    // the capability's own gate and was turned away there.
    expect(after.receipts.map((receipt) => receipt.functionId)).toEqual([
      PROPOSALS_LIST_FUNCTION_ID,
    ])
    expect(after.receipts[0]?.status).toBe('failed')
    expect(after.receipts[0]?.outcome).toContain('FunctionDenied')

    // The audit row for the deny, at the file the composition writes. `session-pin-denied` is its
    // own outcome value rather than a generic block, so an operator reading the trail can tell a
    // conversation's own pin apart from a tier decision.
    const denyRow = auditRows().find((row) => row.outcome === 'session-pin-denied')
    expect(denyRow).toBeDefined()
    expect(denyRow?.action).toBe(PINNED_CLASS)
    expect(denyRow?.verdict).toBe('deny')

    // ---- ARM 3: the scope control. A DIFFERENT class is untouched by the pin.
    const other = await ask('status', before.sessionId)
    expect(other.status).toBe('completed')
    expect(other.receipts.map((receipt) => receipt.functionId)).toEqual([RUNS_LIST_FUNCTION_ID])
    expect(other.receipts[0]?.status).toBe('executed')
    expect(
      auditRows().filter(
        (row) => row.action === UNPINNED_CLASS && row.outcome === 'session-pin-denied',
      ),
    ).toEqual([])

    // Every utterance above is table-canonical, so the bound model must have gone untouched. A
    // deny that came from anywhere other than the gate would show up here.
    expect(tripwire.calls()).toBe(0)
  })

  it('the pin is a LIVE view: a second class pinned mid-session denies from the next turn', async () => {
    // Property 3 of the holder, composed: `asGateDeny()` reads the set at call time, and the
    // composition binds the hook ONCE for the session. A snapshot taken at bind time would be empty
    // forever — the silent no-op 391-05 measured, arriving by a different road.
    const opened = await ask('status')
    expect(opened.receipts[0]?.status).toBe('executed')

    await ask(`/pin ${RUNS_LIST_FUNCTION_ID}`, opened.sessionId)
    const after = await ask('status', opened.sessionId)

    expect(after.receipts[0]?.status).toBe('failed')
    expect(auditRows().some((row) => row.action === UNPINNED_CLASS
      && row.outcome === 'session-pin-denied')).toBe(true)
  })

  it('a pin against a class this host does not declare is REFUSED, not accepted', async () => {
    // The other half of the silent-no-op law: a pin recorded against a name nothing answers to
    // would be accepted and then deny nothing for the rest of the conversation, which is worse
    // than an error because the person believes it worked.
    const refused = await ask('/pin nonsense.notacapability')

    expect(refused.status).toBe('fail_closed')
    expect(refused.unhandled?.reason ?? '').toContain('nonsense.notacapability')
    // And it left a countable row, like every other refusal (D-15).
    expect(
      sessionEvents(refused.sessionId).filter((event) => event.kind === 'mark_unhandled'),
    ).toHaveLength(1)
  })
})

describe('the pin differential drives the composed stack, not the gate directly', () => {
  it('reaches the gate only through invokeFunction — SPECIFIERS, never vocabulary', () => {
    const source = readFileSync(fileURLToPath(import.meta.url), 'utf8')
    // Structure, not words: this file's header discusses the gate and `evaluate()` repeatedly and
    // must stay free to. What is pinned is which modules it is built out of.
    const specifiers = [...source.matchAll(/^import[^'\n]*'([^']+)'/gm)].map((match) => match[1]!)
    expect(specifiers.length).toBeGreaterThan(4)
    expect(specifiers.filter((specifier) => specifier.includes('agent-qa-safety'))).toEqual([])
    expect(specifiers.filter((specifier) => specifier.includes('pin-overlay'))).toEqual([])
    // POSITIVE CONTROL: without it, "no such import" and "the walker found nothing" are one green.
    expect(specifiers).toContain('../composition/compose-local-agent.js')
  })
})
