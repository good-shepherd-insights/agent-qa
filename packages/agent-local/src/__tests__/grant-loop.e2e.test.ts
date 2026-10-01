// THE grant loop, end to end over one composition and one committed ledger (Phase 391, PROP-01).
//
// 2026-09-30 (432-13, D-14/D-15): THE LOOP HAS NO CONSUMER. `invokeFunction` reads no standing
// approval, asks no confirm port and writes no decision row.
//
// RE-SPELLED 2026-10-01 (432-17, D-05/D-22): THE LOOP HAS NO MINT EITHER. The only door that wrote a
// grant was `proposals.accept`'s always form, and it is deleted with the inbox, together with
// `knowledge.proposal.apply` (the apply a grant was minted for), `proposals.list` and the store. So
// the cells that minted on the always form, applied headless with and without a grant, and drove
// the accept's origin refusal lost their subject; C432-NO-PROPOSAL-OPS pins that the doors are gone.
// What survives until 432-18 deletes the grant ops and the ledger is the revoke half over a line
// appended through the real append API: a revoke appends rather than rewrites, both events survive,
// an agent-origin revoke is refused before dispatch, and a headless revoke runs with no
// confirmation and writes no decision row.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  FunctionOriginError,
  UnknownFunctionError,
  createFunctionRegistry,
  invokeFunction,
} from '@vostride/agent-qa-agent'
import type { FunctionRegistry } from '@vostride/agent-qa-agent'
import {
  appendGrantLedgerEvents,
  createGrantOperations,
  grantsLedgerPath,
  publishBundleForTest,
} from '@vostride/agent-qa-knowledge-local'
import type { BundleStoreConfig } from '@vostride/agent-qa-knowledge-local'
import {
  CURRENT_GRANT_LEDGER_SCHEMA_VERSION,
  FunctionScopeSchema,
  MASKED_RESOLVED_CONFIG_SCHEMA_VERSION,
  STANDING_APPROVAL_SCOPE,
} from '@vostride/agent-qa-schema'
import type {
  Anchor,
  ExecutionContext,
  FunctionCaller,
  GrantLedgerEvent,
  GrantsListOutput,
  GrantsRevokeOutput,
  MaskedResolvedConfig,
} from '@vostride/agent-qa-schema'
import type { AuditSink, ExecutionAuditRow, GuardrailAuditRow } from '@vostride/agent-qa-safety'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  createKnowledgeReader,
  createKnowledgeReview,
  createRunsReader,
} from '../composition/compose-local-agent.js'

const GRANTS_LIST_ID = 'grants.list'
const GRANTS_REVOKE_ID = 'grants.revoke'
/** The deleted mint door and the apply its grants covered, spelled as a caller spells them. */
const RETIRED_DOORS = ['proposals.accept', 'knowledge.proposal.apply', 'proposals.list'] as const

const NOW_ISO = '2026-08-07T12:00:00.000Z'

const ANCHOR: Anchor = { t: 'el', role: 'Button', name: 'Checkout' }

const MASKED_CONFIG: MaskedResolvedConfig = {
  schemaVersion: MASKED_RESOLVED_CONFIG_SCHEMA_VERSION,
  configPath: '/fixture/agent-qa.config.yaml',
  entries: [],
}

/** A person holding every scope, so a refusal below can only ever be origin's. */
const HUMAN: FunctionCaller = {
  surface: 'test',
  grantedScopes: [...FunctionScopeSchema.options],
  safeMode: false,
  origin: 'human',
}

/** The same permissions, on behalf of the agent. ONLY `origin` differs. */
const AGENT: FunctionCaller = { ...HUMAN, origin: 'agent' }

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

describe('the grant loop: a person accepts with always, and a later headless apply commits', () => {
  let root: string
  let knowledgeRoot: string
  let agentQaRoot: string
  let sink: ReturnType<typeof capturingSink>

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'grant-loop-'))
    knowledgeRoot = join(root, 'agent-qa-knowledge')
    agentQaRoot = join(root, '.agent-qa')
    mkdirSync(agentQaRoot, { recursive: true })
    sink = capturingSink()
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  function storeConfig(): BundleStoreConfig {
    return {
      knowledgeRoot,
      productKey: 'Grant Loop Product',
      auditBaseDir: agentQaRoot,
      commitArtifacts: 'none',
    }
  }

  /** A real published record, so each proposal below has something real to be about. */
  function publish(seed: string): string {
    const outcome = publishBundleForTest(storeConfig(), {
      draft: {
        kind: 'fact',
        subtype: 'selector',
        anchors: [ANCHOR],
        scope: { tier: 'product', key: `grant-loop-${seed}` },
        summary: `checkout button ${seed}`,
        body: `Selecting Checkout advances to the payment page (${seed}).`,
        distilledEvidenceRef: { id: `grant-loop-${seed}`, sha: 'a'.repeat(64) },
        originStage: 'run-curation',
      },
      discriminant: {
        kind: 'fact',
        subtype: 'selector',
        elementRef: { role: 'Button', name: `Checkout ${seed}` },
      },
      originClass: 'agent-verified',
      createdAtOrdinal: 9,
      screenStates: [],
      initialEvents: [],
      relations: [],
      provenance: { mode: 'run-linked', runId: 'grant-loop', testId: 't', stepIndex: 0 },
      artifacts: [],
    })
    if (outcome.kind !== 'published') throw new Error(`fixture publish failed: ${outcome.kind}`)
    return outcome.id
  }

  /**
   * The composition under test: REAL grant verbs, REAL committed ledger, REAL reader.
   *
   * Nothing about the policy answer is stubbed — every leg below changes the gate's behaviour by
   * changing a file, through a verb a person invoked.
   */
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
        standingGrants: createGrantOperations({
          resolveKnowledgeRoot: () => knowledgeRoot,
          auditBaseDir: agentQaRoot,
          now: () => NOW_ISO,
        }),
      },
      auditSink: sink,
      // 432-13: no standing-approval reader and no confirm port — `invokeFunction` asks nobody.
      resolveExecutionContext: () => context,
    })
  }

  function committedEvents(): GrantLedgerEvent[] {
    if (!existsSync(grantsLedgerPath(knowledgeRoot))) return []
    return readFileSync(grantsLedgerPath(knowledgeRoot), 'utf8')
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as GrantLedgerEvent)
  }

  /** One committed grant line, appended through the real append API (the 391-01 tracer's hand). */
  function appendGrant(grantId: string): void {
    const outcome = appendGrantLedgerEvents(
      knowledgeRoot,
      [{
        schemaVersion: CURRENT_GRANT_LEDGER_SCHEMA_VERSION,
        kind: 'grant',
        at: NOW_ISO,
        grantId,
        actionClass: 'fn:knowledge.forget',
        scope: STANDING_APPROVAL_SCOPE,
      }],
      { auditBaseDir: agentQaRoot },
    )
    if (outcome.kind !== 'appended') throw new Error(`grant append refused: ${outcome.kind}`)
  }

  it('C432-NO-PROPOSAL-OPS: the mint door and the apply it covered are not capabilities of this host', async () => {
    const interactive = host('local-interactive')
    publish('retired')
    const ids = interactive.list(HUMAN).map((entry) => entry.id)
    expect(RETIRED_DOORS.filter((id) => ids.includes(id))).toEqual([])
    for (const id of RETIRED_DOORS) {
      await expect(invokeFunction(interactive, id, {}, HUMAN), id).rejects.toBeInstanceOf(UnknownFunctionError)
    }
    expect(existsSync(grantsLedgerPath(knowledgeRoot))).toBe(false)
  })

  // RE-SPELLED 2026-10-01 (432-17) from 'mints on the always form only, and a headless apply commits
  // whatever the ledger holds': the always form is deleted, so the grant is appended by hand and the
  // revoke half — the one that survives — is what is measured.
  it('revokes by appending: both events survive, in order', async () => {
    const interactive = host('local-interactive')
    appendGrant('grant_loop_revoke')
    expect(committedEvents().map((event) => event.kind)).toEqual(['grant'])

    const listed = (await invokeFunction(interactive, GRANTS_LIST_ID, {}, HUMAN)) as GrantsListOutput
    expect(listed.grants.map((grant) => grant.grantId)).toEqual(['grant_loop_revoke'])

    const revoked = (await invokeFunction(
      interactive,
      GRANTS_REVOKE_ID,
      { grantId: 'grant_loop_revoke' },
      HUMAN,
    )) as GrantsRevokeOutput
    expect(revoked.outcome).toBe('revoked')
    // BOTH events survive, in order. A revoke that rewrote or removed the grant line would leave a
    // ledger with no record that the approval ever existed.
    expect(committedEvents().map((event) => event.kind)).toEqual(['grant', 'revoke'])
  }, 120_000)

  // RE-SPELLED 2026-10-01 (432-17) from 'refuses an agent-origin accept and revoke, leaving the
  // committed ledger untouched': the accept is deleted; the revoke half and its human control stay.
  it('refuses an agent-origin revoke, leaving the committed ledger untouched', async () => {
    const interactive = host('local-interactive')
    appendGrant('grant_loop_origin')
    const before = readFileSync(grantsLedgerPath(knowledgeRoot), 'utf8')

    await expect(
      invokeFunction(interactive, GRANTS_REVOKE_ID, { grantId: 'grant_loop_origin' }, AGENT),
    ).rejects.toBeInstanceOf(FunctionOriginError)
    expect(readFileSync(grantsLedgerPath(knowledgeRoot), 'utf8')).toBe(before)

    // And the control: the same permissions, human origin, dispatches.
    const revoked = (await invokeFunction(
      interactive,
      GRANTS_REVOKE_ID,
      { grantId: 'grant_loop_origin' },
      HUMAN,
    )) as GrantsRevokeOutput
    expect(revoked.outcome).toBe('revoked')
  }, 120_000)

  // RE-SPELLED 2026-10-01 (432-17): the accept half of this cell is deleted with the op. A headless
  // revoke runs with no confirmation, answers by the ledger's own content, and writes no decision row.
  it('C432-INVOKE-DIRECT: both decision verbs run in a headless context with no confirmation', async () => {
    const headless = host('local-headless')
    const revoked = (await invokeFunction(
      headless,
      GRANTS_REVOKE_ID,
      { grantId: 'grant_anything' },
      HUMAN,
    )) as GrantsRevokeOutput
    expect(revoked.outcome).not.toBe('revoked')
    expect(existsSync(grantsLedgerPath(knowledgeRoot))).toBe(false)
    expect(sink.rows).toEqual([])

    const grants = (await invokeFunction(headless, GRANTS_LIST_ID, {}, HUMAN)) as GrantsListOutput
    expect(grants.grants).toEqual([])
  }, 120_000)
})
