// A damaged grant ledger authorizes NOTHING, proven through the composed host
// (Phase 391 plan 08, closing 391-VERIFICATION gap 2).
//
// The verifier measured the defect with a throwaway probe: a git conflict marker fused onto the
// REVOKE line leaves `refusedLines` non-empty, the fold still hands back the grant, and a headless
// invocation the withdrawn approval used to satisfy goes on being satisfied by it — with no human
// present and no report anywhere. That probe is a committed differential here, asserting the
// opposite, over the REAL composition: real grant verbs, real committed ledger, real reader, real
// gate, real audit sink.
//
// THREE CASES IN ONE FIXTURE, because the new guard has a precondition and a corpus drawn only from
// inside a precondition measures the precondition:
//
//   case 1  intact ledger, grant in force   -> headless invocation ALLOWED, audit row names the
//                                              standing approval as what satisfied the ask
//   case 2  intact ledger, grant revoked    -> the same invocation is fail-closed-denied
//   case 3  the same events, revoke line damaged -> fail-closed-denied, and grantsFor is empty
//
// Case 1 is what stops case 3 being satisfied by a host that denies everything; case 2 is what
// stops it being satisfied by a fixture that never recorded an approval. Only with both does the
// third case say something about the DAMAGE.
//
// THE GATED SUBJECT is `knowledge.proposal.apply`, whose action class is read off the registry's
// own descriptor rather than typed here — a hand-spelled class is the silent miss the ledger's
// module head names, and it would turn every negative below into a pass for the wrong reason. The
// gate runs and writes its audit row BEFORE the op body, so the id the apply is handed does not
// have to resolve for the authorization question to be answered.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  FunctionDeniedError,
  createFunctionRegistry,
  invokeFunction,
} from '@vostride/agent-qa-agent'
import type { FunctionRegistry } from '@vostride/agent-qa-agent'
import {
  ProposalNotFoundError,
  createGrantOperations,
  createStandingApprovalReader,
  grantsLedgerPath,
} from '@vostride/agent-qa-knowledge-local'
import {
  FunctionScopeSchema,
  MASKED_RESOLVED_CONFIG_SCHEMA_VERSION,
  STANDING_APPROVAL_SCOPE,
} from '@vostride/agent-qa-schema'
import type {
  ExecutionContext,
  FunctionCaller,
  GrantsListOutput,
  MaskedResolvedConfig,
  RiskActionDescriptor,
} from '@vostride/agent-qa-schema'
import type { AuditSink, ExecutionAuditRow, GuardrailAuditRow } from '@vostride/agent-qa-safety'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  createKnowledgeReader,
  createKnowledgeReview,
  createRunsReader,
} from '../composition/compose-local-agent.js'

const APPLY_ID = 'knowledge.proposal.apply'
const GRANTS_LIST_ID = 'grants.list'
const NOW_ISO = '2026-08-08T12:00:00.000Z'

/** What a merge leaves behind when two branches both appended: a marker fused onto a real line. */
const CONFLICT_MARKER = '<<<<<<< HEAD'

/**
 * A well-formed proposal id that nothing was ever minted under.
 *
 * It has to satisfy the input contract, because a contract refusal is raised before the gate and
 * would answer the authorization question by never asking it. It does NOT have to resolve: the
 * verdict and its audit row are written before the op body runs, so what the apply then reports
 * about a proposal it cannot find is beside the point here.
 */
const PROBE_PROPOSAL_ID = 'prop_probe-target'

const MASKED_CONFIG: MaskedResolvedConfig = {
  schemaVersion: MASKED_RESOLVED_CONFIG_SCHEMA_VERSION,
  configPath: '/fixture/agent-qa.config.yaml',
  entries: [],
}

/** A person holding every scope, so a refusal below can only ever be policy's. */
const HUMAN: FunctionCaller = {
  surface: 'test',
  grantedScopes: [...FunctionScopeSchema.options],
  safeMode: false,
  origin: 'human',
}

function capturingSink(): AuditSink & { rows: ExecutionAuditRow[] } {
  const rows: ExecutionAuditRow[] = []
  return {
    rows,
    appendExecutionAudit(row: ExecutionAuditRow) {
      rows.push(row)
    },
    appendGuardrailAudit(_row: GuardrailAuditRow) {},
  }
}

describe('a grant ledger the build cannot fully read authorizes nothing', () => {
  let root: string
  let knowledgeRoot: string
  let agentQaRoot: string
  let sink: ReturnType<typeof capturingSink>

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'grant-damage-'))
    knowledgeRoot = join(root, 'agent-qa-knowledge')
    agentQaRoot = join(root, '.agent-qa')
    mkdirSync(agentQaRoot, { recursive: true })
    mkdirSync(knowledgeRoot, { recursive: true })
    sink = capturingSink()
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  function grantVerbs() {
    return createGrantOperations({
      resolveKnowledgeRoot: () => knowledgeRoot,
      auditBaseDir: agentQaRoot,
      now: () => NOW_ISO,
    })
  }

  /** The composition under test: REAL grant verbs, REAL committed ledger, REAL reader, REAL gate. */
  function host(context: ExecutionContext): FunctionRegistry {
    return createFunctionRegistry({
      deps: {
        runs: createRunsReader(agentQaRoot),
        knowledge: createKnowledgeReader(() => knowledgeRoot),
        config: { getMasked: () => Promise.resolve(MASKED_CONFIG) },
        entities: {
          resolve: () => Promise.resolve({ kind: 'none' as const, reason: 'no-match' as const }),
          get: () => Promise.resolve(undefined),
        },
        knowledgeReview: createKnowledgeReview({
          agentQaRoot,
          resolveKnowledgeRoot: () => knowledgeRoot,
        }),
        standingGrants: grantVerbs(),
      },
      auditSink: sink,
      standingApprovalReader: () => createStandingApprovalReader({ knowledgeRoot }),
      resolveExecutionContext: () => context,
      // No confirm arm at all: in a headless context there is nothing to prompt, so the only thing
      // that can produce an allow below is the committed ledger.
    })
  }

  /**
   * The class the gate compares against, read off the apply op's OWN declaration.
   *
   * Never spelled as a literal here: a rename of the op moves the fixture with it instead of
   * turning this whole file into a set of misses that still passes its negative cases.
   */
  function applyClass(registry: FunctionRegistry): string {
    const name = registry.list(HUMAN).find((entry) => entry.id === APPLY_ID)?.risk.name
    if (name === undefined) throw new Error(`${APPLY_ID} is not registered`)
    return name
  }

  function action(name: string): RiskActionDescriptor {
    return { name, recognized: true }
  }

  /**
   * The authorization question, asked the way a headless run asks it.
   *
   * The proposal id need not resolve: the gate evaluates and audits before the op body runs, so an
   * allow here is a statement about the ledger and nothing else.
   */
  async function headlessApply(registry: FunctionRegistry): Promise<'allowed' | 'denied'> {
    try {
      await invokeFunction(registry, APPLY_ID, { proposalId: PROBE_PROPOSAL_ID }, HUMAN)
      return 'allowed'
    } catch (error) {
      if (error instanceof FunctionDeniedError) return 'denied'
      // The op body ran, which is only reachable once the gate has ALLOWED — so this is the
      // affirmative answer to the authorization question, arriving as the apply's own complaint
      // about a target that was never minted.
      if (error instanceof ProposalNotFoundError) return 'allowed'
      // Anything ELSE is rethrown rather than folded into an answer. A refusal raised before the
      // gate — an input the contract rejects, an unbound port — would otherwise read as a denial
      // and turn every negative case here into a pass for a reason that has nothing to do with
      // the ledger.
      throw error
    }
  }

  /** Record a standing approval for the apply class, through the real mint. */
  async function recordApplyGrant(registry: FunctionRegistry): Promise<string> {
    const outcome = await grantVerbs().record({
      actionClass: applyClass(registry),
      scope: STANDING_APPROVAL_SCOPE,
    })
    if (outcome.kind !== 'recorded') throw new Error(`fixture mint failed: ${outcome.kind}`)
    return outcome.grant.grantId
  }

  /**
   * Fuse a conflict marker onto the LAST committed line, in place.
   *
   * Rewritten rather than appended: a whole extra garbage line would leave the revoke perfectly
   * readable, and the refusal under test would then be about a line nothing depends on.
   */
  /**
   * The write verbs' damage refusal, matched BY NAME and never by "something threw".
   *
   * A lease refusal, an egress refusal or a fixture bug is rethrown rather than folded into a pass.
   */
  async function damageRefusal(call: () => Promise<unknown>): Promise<Error> {
    let answered: unknown
    try {
      answered = await call()
    } catch (error) {
      if (error instanceof Error && error.name === 'GrantLedgerDamagedError') return error
      throw error
    }
    throw new Error(
      `expected the verb to refuse a damaged ledger, it answered ${JSON.stringify(answered)}`,
    )
  }

  function damageLastLine(): void {
    const path = grantsLedgerPath(knowledgeRoot)
    const lines = readFileSync(path, 'utf8').split('\n')
    let last = lines.length - 1
    while (last >= 0 && (lines[last] ?? '').trim().length === 0) last -= 1
    if (last < 0) throw new Error('the fixture ledger has no line to damage')
    lines[last] = `${CONFLICT_MARKER}${lines[last] ?? ''}`
    writeFileSync(path, lines.join('\n'), 'utf8')
  }

  it('CASE 1 — intact ledger, grant in force: the headless invocation is ALLOWED', async () => {
    const headless = host('local-headless')
    await recordApplyGrant(headless)

    expect(await headlessApply(headless)).toBe('allowed')

    const row = sink.rows.at(-1)
    expect(row?.action).toBe(applyClass(headless))
    expect(row?.verdict).toBe('allow')
    // The phase in one field: a decision a person recorded is what satisfied a headless ask.
    expect(row?.trustSource).toBe('standing-approval')
  })

  it('CASE 2 — intact ledger, the grant revoked: the same invocation is fail-closed-denied', async () => {
    const headless = host('local-headless')
    const grantId = await recordApplyGrant(headless)
    const revoked = await grantVerbs().revoke({ grantId })
    expect(revoked.outcome).toBe('revoked')

    expect(await headlessApply(headless)).toBe('denied')
    expect(sink.rows.at(-1)?.outcome).toBe('fail-closed-denied')
    expect(sink.rows.at(-1)?.trustSource).toBeUndefined()
  })

  describe('CASE 3 — the revoke line damaged in place', () => {
    let grantId: string
    let headless: FunctionRegistry

    beforeEach(async () => {
      headless = host('local-headless')
      grantId = await recordApplyGrant(headless)
      const revoked = await grantVerbs().revoke({ grantId })
      if (revoked.outcome !== 'revoked') throw new Error('fixture revoke failed')
      damageLastLine()
    })

    it('is a valid fixture: the grant line still folds while the revoke line is refused', () => {
      const lines = readFileSync(grantsLedgerPath(knowledgeRoot), 'utf8')
        .split('\n')
        .filter((line) => line.trim().length > 0)

      expect(lines).toHaveLength(2)
      // Line 1 is byte-perfect committed truth; line 2 is what a merge left behind.
      expect(JSON.parse(lines[0] ?? '')).toMatchObject({ kind: 'grant', grantId })
      expect(lines[1]?.startsWith(CONFLICT_MARKER)).toBe(true)
    })

    it('grants NOTHING at the authorization site: grantsFor is empty for the intact grant\'s class', () => {
      const reader = createStandingApprovalReader({ knowledgeRoot })

      expect(reader.grantsFor(action(applyClass(headless)), STANDING_APPROVAL_SCOPE)).toEqual([])
    })

    it('and the headless invocation is fail-closed-denied, with no trust source on the row', async () => {
      expect(await headlessApply(headless)).toBe('denied')

      expect(sink.rows.at(-1)?.outcome).toBe('fail-closed-denied')
      expect(sink.rows.at(-1)?.trustSource).toBeUndefined()
    })

    it('and `grants.list` carries the explanation the denial does not', async () => {
      // The operator staring at the denial above checks the surface that lists their approvals.
      // A listing that showed the grant with no word about the damage would send them looking
      // for a revoke that never took, on a file whose problem is a line nobody named.
      const listed = (await invokeFunction(
        headless,
        GRANTS_LIST_ID,
        {},
        HUMAN,
      )) as GrantsListOutput

      expect(listed.grants.map((grant) => grant.grantId)).toEqual([grantId])
      expect(listed.refusedLines.map((line) => line.lineNumber)).toEqual([2])
      expect(listed.refusedLines[0]?.reason).toMatch(/unparseable line/)
    })

    it('and BOTH write verbs refuse to DECIDE over the same damaged root, by name', async () => {
      // The sibling-input corpus law: `readGrantLedger` has four consumers and this one fixture now
      // fault-injects all four. The reader refuses to authorize, `list` reports — and these two
      // refuse to decide, so no person is told RECORDED for an approval the reader refuses.
      const verbs = grantVerbs()

      const refusedRecord = await damageRefusal(() =>
        verbs.record({ actionClass: applyClass(headless), scope: STANDING_APPROVAL_SCOPE }),
      )
      expect(refusedRecord.name).toBe('GrantLedgerDamagedError')
      expect(refusedRecord.message).toContain('line 2')

      const refusedRevoke = await damageRefusal(() => verbs.revoke({ grantId }))
      expect(refusedRevoke.name).toBe('GrantLedgerDamagedError')
    })
  })
})
