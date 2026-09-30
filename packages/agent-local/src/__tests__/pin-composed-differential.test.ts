// THE COMPOSED `/pin` DIFFERENTIAL (Phase 392 plan 10, D-21), RE-SPELLED AS ITS ABSENCE (432-13).
//
// 392-05/392-10 proved that typing `/pin <class>` made the very next turn asking for that capability
// come back refused through `invokeFunction`, with a `session-pin-denied` row in the execution audit.
// 432-13 (D-14/D-15) removed the op gate the pin overlay tightened and `/pin` from chat resolution,
// so the same three arms now prove the retired verb reaches nothing: the op executes before AND
// after a typed `/pin`, the scope control is unchanged, no row is written at the file the
// composition writes, and no `approval_decision` lands in the session.
//
// THE PLANNER IS BOUND AND COUNTS. Every canonical utterance still goes untouched by it; the `/pin`
// clause is now unrouted text, so it is the ONE utterance that reaches the planner, which throws —
// and the turn fails closed by name.

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

describe('D-21 retired: a typed /pin reaches nothing through the composed stack (432-13)', () => {
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

  // RE-SPELLED 2026-09-30 (432-13) from 'all three arms: execute, then deny-with-audit-row, then the
  // scope control'.
  it('C432-CHAT-DIRECT: all three arms execute, before and after a typed /pin, with no audit row', async () => {
    // ---- ARM 1: no pin. The op executes; no gate records a decision.
    const before = await ask('/fn proposals.list')
    expect(before.status).toBe('completed')
    expect(before.receipts.map((receipt) => receipt.functionId)).toEqual([
      PROPOSALS_LIST_FUNCTION_ID,
    ])
    expect(before.receipts[0]?.status).toBe('executed')

    // ---- The retired verb, typed into the SAME session: an unroutable clause, refused by name.
    const pinned = await ask(`/pin ${PROPOSALS_LIST_FUNCTION_ID}`, before.sessionId)
    expect(pinned.status).toBe('fail_closed')
    expect(pinned.receipts).toEqual([])
    expect(pinned.answer ?? '').not.toContain(PINNED_CLASS)
    expect(
      sessionEvents(before.sessionId).filter((event) => event.kind === 'approval_decision'),
    ).toEqual([])

    // ---- ARM 2: the SAME utterance, same session, same composition. Still executes.
    const after = await ask('/fn proposals.list', before.sessionId)
    expect(after.status).toBe('completed')
    expect(after.receipts[0]?.status).toBe('executed')

    // ---- ARM 3: the scope control, unchanged.
    const other = await ask('status', before.sessionId)
    expect(other.status).toBe('completed')
    expect(other.receipts.map((receipt) => receipt.functionId)).toEqual([RUNS_LIST_FUNCTION_ID])
    expect(other.receipts[0]?.status).toBe('executed')

    // No decision row of any kind at the file the composition writes.
    expect(auditRows()).toEqual([])
    // Only the unroutable `/pin` clause reached the planner.
    expect(tripwire.calls()).toBe(1)
  })

  // RE-SPELLED 2026-09-30 (432-13) from 'the pin is a LIVE view: a second class pinned mid-session
  // denies from the next turn'. There is no pin set to be live.
  it('C432-CHAT-DIRECT: a /pin typed mid-session denies nothing on the next turn', async () => {
    const opened = await ask('status')
    expect(opened.receipts[0]?.status).toBe('executed')

    await ask(`/pin ${RUNS_LIST_FUNCTION_ID}`, opened.sessionId)
    const after = await ask('status', opened.sessionId)

    expect(after.receipts[0]?.status).toBe('executed')
    expect(auditRows().some((row) => row.action === UNPINNED_CLASS
      && row.outcome === 'session-pin-denied')).toBe(false)
  })

  it('a /pin against a class this host does not declare is refused by name, like any unrouted clause', async () => {
    const refused = await ask('/pin nonsense.notacapability')

    expect(refused.status).toBe('fail_closed')
    expect(refused.unhandled?.clause).toBe('/pin nonsense.notacapability')
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
