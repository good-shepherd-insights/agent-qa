// 2026-09-30, 432-09 (D-03/D-04/D-15/D-22/D-25): the runtime key sets beside the types they pin.
//
// First created by 432-09, which narrows the mark, marks-history, preview, digest and run-knowledge
// outputs to applied changes and the mark refusal to a plain reason. Later owners (432-18/19/22/39/42)
// extend this file with their own removed members only. Every expected set is spelled by hand, so no
// expectation is derived from the production value it checks.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import * as schema from '../index'
import * as safety from '../safety/index'

type Shaped = { shape: Record<string, { value?: unknown }> }
type Options = { options: readonly Shaped[] }

const keysOf = (value: unknown): string[] => Object.keys((value as Shaped).shape).sort()
const armOf = (union: unknown, key: string, literal: string): Shaped | undefined =>
  (union as Options).options.find(option => option.shape[key]?.value === literal)
const sorted = (values: readonly string[]) => [...values].sort()
const exported = (name: string) => (schema as Record<string, unknown>)[name]

describe('432-09 applied output key sets', () => {
  it('C432-RUNTIME-SETS: marks, history, preview, digest and run knowledge carry applied changes and no inbox member', () => {
    expect(exported('MARK_DISPOSITIONS'), 'the written dispositions')
      .toEqual(['quarantined', 'applied', 'no-draftable-fix', 'confirmed-bug'])
    expect(exported('MARK_HISTORICAL_DISPOSITIONS'), 'read, never written').toEqual(['drafted'])
    expect(exported('MARK_APPLIED_CHANGE_KINDS')).toEqual(['knowledge', 'test-file'])

    const dispositions = exported('MarkDispositionSchema')
    expect(armOf(dispositions, 'kind', 'applied'), 'the applied arm').toBeDefined()
    expect((dispositions as Options).options.map(option => option.shape.kind!.value))
      .toEqual(['quarantined', 'applied', 'no-draftable-fix', 'confirmed-bug', 'drafted'])
    expect(keysOf(armOf(dispositions, 'kind', 'applied')), 'an applied fix names its change, never a proposal')
      .toEqual(sorted(['kind', 'fix', 'change']))

    const changes = exported('MarkAppliedChangeSchema')
    expect(keysOf(armOf(changes, 'kind', 'knowledge'))).toEqual(sorted(['kind', 'changeId', 'recordIds']))
    expect(keysOf(armOf(changes, 'kind', 'test-file'))).toEqual(sorted(['kind', 'filePath', 'contentDigest']))

    expect(keysOf(exported('MarkHistoryEntrySchema')), 'history projects the applied change, not an inbox state')
      .toEqual(sorted([
        'markId', 'runId', 'testIndex', 'testId', 'stepIndex', 'kind', 'origin', 'ordinal', 'markedAt',
        'rootCause', 'isRerun', 'disposition', 'gold', 'evidence', 'supersedes', 'note', 'corrected',
        'active', 'supersededBy', 'changedRecords',
      ]))

    const preview = exported('RunsMarkPreviewResultSchema')
    expect(keysOf(armOf(preview, 'kind', 'consequences')), 'a later mark withdraws nothing')
      .toEqual(sorted([
        'kind', 'runId', 'prospective', 'markKind', 'member', 'resolvedStep', 'latest', 'basis',
        'markedDecisionCount', 'groundTruth', 'labels', 'knowledge', 'draft',
      ]))

    expect(keysOf(exported('RunDigestSchema')), 'the digest reads applied mark changes, never the inbox')
      .toEqual(sorted([
        'runId', 'verdictClusters', 'chain', 'markChanges', 'candidates', 'quarantine', 'lines',
      ]))
    expect(keysOf(exported('RunDigestMarkChangeSchema'))).toEqual(sorted(['markId', 'ordinal', 'fix', 'change']))

    expect(keysOf(armOf(exported('RunKnowledgeProjectionSchema'), 'kind', 'ready')), 'no pending inbox count')
      .toEqual(sorted([
        'kind', 'runId', 'buildOrdinal', 'knowledgeStore', 'retrievalRung', 'steps', 'curation', 'learned',
      ]))

    for (const name of [
      'MARK_PROPOSAL_STATES', 'MarkProposalCurrentSchema', 'MarkPreviewWithdrawalSchema',
      'RunDigestProposalRowSchema',
    ]) expect(exported(name), `${name} is gone from the schema barrel`).toBeUndefined()
  })

  it('C432-PLAIN-REFUSAL: a refused mark answers a plain reason and nothing a caller must act on', () => {
    const refusal = exported('MarkRefusalSchema')
    expect(refusal, 'the plain mark refusal is a shared contract').toBeDefined()
    expect(keysOf(refusal)).toEqual(sorted(['error', 'reason']))
    const parse = (value: unknown) => (refusal as { safeParse(value: unknown): { success: boolean } }).safeParse(value)
    expect(parse({ error: 'mark_denied', reason: 'The mark could not be recorded.' }).success).toBe(true)
    expect(parse({ error: 'mark_denied', reason: 'x', remedies: [] }).success, 'no remedy list rides a refusal').toBe(false)
  })
})

// 2026-10-01, 432-18 (D-03/D-14/D-15/D-22): the standing-grant ledger, the grant op contracts, the
// protected-class set and the chat pin overlay leave the schema. Two members stayed on purpose, each
// until its last consumer leaves: `StandingApprovalGrant` (type only, `standing-approval.ts`) for the
// safety ports, and `TrustScopeSchema` (`grant-ops.ts`) for the run-service DTO 432-22 deletes.
// 2026-10-01, 432-19 (D-03/D-15): the safety gate, its standing-approval reader and its scope check
// are deleted, so `StandingApprovalGrant` and `standing-approval.ts` leave with them and the census
// below now asserts their absence. TrustScopeSchema stays until 432-22. `STANDING_APPROVAL_SCOPE` was the scope the MCP bearer credential carried
// (`cli/src/composition/mcp-token-resolution.ts`), so it moved beside `TrustScope` and stayed until the
// token owner removed that credential. 2026-10-01, 432-21 (D-12): the resolver and the bearer credential
// are deleted, so the constant joins the absence set below. 2026-10-01, 432-22 (D-03/D-12): the
// run-service token DTO, `TrustScopeSchema`'s last consumer, is deleted with its config key, so the
// projection, its module and its barrel exports join the absence set too. The `TrustScope` and
// `TrustCredential` caller types stay until 432-39. No later absence is asserted here early.
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..')

const RETIRED_GRANT_RUNTIME_EXPORTS = [
  'CURRENT_GRANT_LEDGER_SCHEMA_VERSION',
  'GRANT_LEDGER_EVENT_KINDS',
  'GRANT_LEDGER_MIGRATIONS',
  'GrantLedgerVersionError',
  'guardGrantLedgerEvent',
  'hasGrantEventShape',
  'isGrantLedgerEventKind',
  'PROTECTED_ACTION_CLASSES',
  'isProtectedActionClass',
  'GrantRecordInputSchema',
  'GrantRecordOutcomeSchema',
  'GrantsListInputSchema',
  'GrantsListOutputSchema',
  'GrantsRevokeInputSchema',
  'GrantsRevokeOutputSchema',
  'StandingGrantSchema',
  'pinDenies',
  // 432-21: the scope the MCP bearer credential carried, deleted with that credential.
  'STANDING_APPROVAL_SCOPE',
  // 432-22: the trust-scope wire projection, deleted with the run-service token DTO.
  'TrustScopeSchema',
] as const

const RETIRED_GRANT_MODULES = [
  'safety/grant-ledger.ts',
  'safety/protected-classes.ts',
  'chat/pin-overlay.ts',
  // 432-19: the last grant-shaped contract, with the safety ports that read it.
  'safety/standing-approval.ts',
  // 432-22: the projection module, with its last consumer.
  'safety/grant-ops.ts',
] as const

describe('C432-NO-GRANT-CONTRACTS: the grant ledger, grant op, protected-class and pin contracts are gone', () => {
  it('C432-NO-GRANT-CONTRACTS: neither the root nor the safety barrel exports a retired grant or pin member', () => {
    const root = new Set(Object.keys(schema))
    const safetyBarrel = new Set(Object.keys(safety))
    expect(RETIRED_GRANT_RUNTIME_EXPORTS.filter(name => root.has(name)), 'root barrel').toEqual([])
    expect(RETIRED_GRANT_RUNTIME_EXPORTS.filter(name => safetyBarrel.has(name)), 'safety barrel').toEqual([])
  })

  it('C432-NO-GRANT-CONTRACTS: the ledger, protected-class, pin and standing-approval modules are deleted', () => {
    expect(RETIRED_GRANT_MODULES.filter(path => existsSync(join(SRC, path)))).toEqual([])
  })

  it('C432-NO-GRANT-CONTRACTS: no schema source names the standing-approval grant any more', () => {
    // A source census rather than a barrel read, because the member was TYPE-only: a runtime key set
    // can never see it, and a type re-export from any module would bring it back.
    const sources: string[] = []
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name)
        if (entry.isDirectory()) {
          if (entry.name !== '__tests__') walk(path)
        } else if (entry.name.endsWith('.ts')) {
          sources.push(readFileSync(path, 'utf8'))
        }
      }
    }
    walk(SRC)
    expect(sources.length).toBeGreaterThan(50)
    expect(sources.filter(text => text.includes('StandingApproval' + 'Grant'))).toEqual([])
    expect(sources.filter(text => text.includes("from './standing-" + "approval'"))).toEqual([])
  })

  it('C432-NO-GRANT-CONTRACTS: the interim members stay until their own owners remove them', () => {
    // Not vacuous: the census above would pass over an empty barrel, so the retained member is
    // named and found. 432-22 removed `TrustScopeSchema`; the key set stays with the caller types.
    expect(exported('TRUST_SCOPE_KEYS')).toEqual(['project', 'org'])
    expect((safety as Record<string, unknown>).TRUST_SCOPE_KEYS).toEqual(['project', 'org'])
  })

  it('C432-NO-GRANT-CONTRACTS: no schema source imports the deleted projection module', () => {
    // Replaces "grant-ops.ts holds only the trust-scope projection" (432-18): the module is gone.
    const offenders: string[] = []
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name)
        if (entry.isDirectory()) walk(path)
        else if (entry.name.endsWith('.ts') && /from '(\.\.?\/)+(safety\/)?grant-ops'/.test(readFileSync(path, 'utf8'))) {
          offenders.push(path)
        }
      }
    }
    walk(SRC)
    expect(offenders).toEqual([])
  })
})

// 2026-10-01, 432-22 (D-03/D-12/D-22): the token declaration DTOs leave with their config keys, and
// with them the trust-scope projection. Spelled by hand; no member is derived from a production value.
const RETIRED_TOKEN_CONFIG_EXPORTS = [
  'McpTokenEntrySchema',
  'McpStdioGrantSchema',
  'RunServiceTokenEntrySchema',
  'TrustScopeSchema',
] as const

describe('C432-NO-TRUST-CONTRACT: token declarations and the trust-scope projection are gone', () => {
  it('C432-NO-TRUST-CONTRACT: neither barrel exports a token DTO or the projection, and the modules are deleted', () => {
    const root = new Set(Object.keys(schema))
    const safetyBarrel = new Set(Object.keys(safety))
    expect(RETIRED_TOKEN_CONFIG_EXPORTS.filter(name => root.has(name)), 'root barrel').toEqual([])
    expect(RETIRED_TOKEN_CONFIG_EXPORTS.filter(name => safetyBarrel.has(name)), 'safety barrel').toEqual([])
    expect(['config/mcp.ts', 'config/run-service.ts', 'safety/grant-ops.ts'].filter(path => existsSync(join(SRC, path))))
      .toEqual([])
  })

  it('C432-NO-TRUST-CONTRACT: the run-service readiness answer carries no credential fact', () => {
    const readiness = exported('RunServiceReadinessSchema')
    expect(keysOf(readiness)).toEqual(sorted(['service', 'hostComposed', 'contractVersion']))
    const parse = (value: unknown) => (readiness as { safeParse(value: unknown): { success: boolean } }).safeParse(value)
    expect(parse({ service: 'up', hostComposed: true, contractVersion: 1 }).success).toBe(true)
    expect(parse({ service: 'up', hostComposed: true, authConfigured: false, contractVersion: 1 }).success,
      'the retired member is refused by the strict wire contract').toBe(false)
  })

  it('C432-NO-TRUST-CONTRACT: the config write door names no token list and no safety root', () => {
    expect(exported('CONFIG_NAMED_ARRAYS')).toEqual(['registry.llms'])
    expect(exported('CONFIG_WRITE_DENIED_ROOTS')).toEqual(['plugins'])
  })
})

// 2026-10-01, 432-22 (D-14/D-15/D-22): an ask turn answers no approval or trust refusal. The only
// target policy sentence is the plain production refusal; an old session's recorded approval
// decision stays readable and nothing writes a new one.
describe('C432-ASK-PLAIN-REFUSAL: the ask contract carries no approval or trust refusal', () => {
  it('C432-ASK-PLAIN-REFUSAL: a turn result has no denial, remedy or approval member', () => {
    expect(keysOf(exported('AgentAskResultSchema'))).toEqual(sorted([
      'sessionId', 'turnId', 'status', 'answer', 'receipts', 'results', 'unhandled', 'refusedLineCount',
    ]))
    expect(keysOf(exported('AgentAskInputSchema'))).toEqual(sorted(['message', 'sessionId']))
    const turn = exported('AgentAskResultSchema') as { safeParse(value: unknown): { success: boolean; data?: unknown } }
    const failClosed = {
      sessionId: 's', turnId: 't', status: 'fail_closed', receipts: [], results: [],
      unhandled: { clause: 'delete the run', reason: 'no capability matched' },
    }
    const parsed = turn.safeParse({ ...failClosed, denials: [{ remedies: [] }] })
    expect(parsed.success).toBe(true)
    expect(Object.keys(parsed.data as object)).not.toContain('denials')
  })

  it('C432-ASK-PLAIN-REFUSAL: the production refusal is one plain sentence naming the target and the opt-in line', () => {
    const build = exported('buildProductionRefusal') as (names: readonly string[]) => string
    const optIn = exported('ALLOW_PRODUCTION_OPT_IN') as string
    const message = build(['shop'])
    expect(message).toContain('shop')
    expect(message).toContain(optIn)
    expect(message).not.toMatch(/approv|confirm|grant|trust|--yes|\[y\/N\]|remed/i)
  })

  it('C432-ASK-PLAIN-REFUSAL: an old recorded approval_decision event stays readable by the session reader', () => {
    expect(exported('CHAT_SESSION_EVENT_KINDS') as readonly string[]).toContain('approval_decision')
    const guard = exported('guardChatSessionEvent') as (value: unknown, version: number) => { kind: string }
    const version = exported('CURRENT_CHAT_SESSION_SCHEMA_VERSION') as number
    const recorded = {
      kind: 'approval_decision', turnId: 't-1', at: '2026-09-01T00:00:00.000Z',
      actionClass: 'fn:knowledge.accept', decision: 'approved', source: 'gate',
    }
    expect(guard(recorded, version).kind).toBe('approval_decision')
  })
})

// C432-NO-GRANT-CONTRACTS, type level: each line fails `pnpm typecheck` the moment the type returns.
// @ts-expect-error the grant ledger event is deleted
export type RetiredGrantLedgerEvent = import('../index').GrantLedgerEvent
// @ts-expect-error the folded standing grant is deleted
export type RetiredActiveStandingGrant = import('../index').ActiveStandingGrant
// @ts-expect-error the standing-grants port is deleted
export type RetiredStandingGrantsPort = import('../index').StandingGrantsPort
// @ts-expect-error the grant list output is deleted
export type RetiredGrantsListOutput = import('../index').GrantsListOutput
// @ts-expect-error the grant revoke output is deleted
export type RetiredGrantsRevokeOutput = import('../index').GrantsRevokeOutput
// @ts-expect-error the grant mint outcome is deleted
export type RetiredGrantRecordOutcome = import('../index').GrantRecordOutcome
// @ts-expect-error the protected class is deleted
export type RetiredProtectedActionClass = import('../index').ProtectedActionClass
// @ts-expect-error the chat pin overlay is deleted
export type RetiredChatPinOverlay = import('../index').ChatPinOverlay
// @ts-expect-error 432-19: the standing-approval grant is deleted with the safety ports that read it
export type RetiredStandingApprovalGrant = import('../index').StandingApprovalGrant
// @ts-expect-error 432-19: and it is gone from the safety barrel too
export type RetiredSafetyStandingApprovalGrant = import('../safety/index').StandingApprovalGrant
// The caller types stay until 432-39 removes the optional caller fields.
export type RetainedTrustScope = import('../index').TrustScope
export type RetainedTrustCredential = import('../index').TrustCredential
// C432-NO-TRUST-CONTRACT, type level (432-22).
// @ts-expect-error the MCP token entry is deleted with services.mcp.tokens
export type RetiredMcpTokenEntry = import('../index').McpTokenEntry
// @ts-expect-error the stdio grant is deleted with services.mcp.stdio.grantConfigWrite
export type RetiredMcpStdioGrant = import('../index').McpStdioGrant
// @ts-expect-error the run-service token entry is deleted with services.dashboard.runServiceTokens
export type RetiredRunServiceTokenEntry = import('../index').RunServiceTokenEntry
// @ts-expect-error the readiness answer has no credential fact
export type RetiredAuthConfigured = import('../index').RunServiceReadiness['authConfigured']
