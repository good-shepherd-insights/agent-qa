// 2026-09-30, 432-09 (D-03/D-04/D-15/D-22/D-25): the runtime key sets beside the types they pin.
//
// First created by 432-09, which narrows the mark, marks-history, preview, digest and run-knowledge
// outputs to applied changes and the mark refusal to a plain reason. Later owners (432-18/19/22/39/42)
// extend this file with their own removed members only. Every expected set is spelled by hand, so no
// expectation is derived from the production value it checks.
import { existsSync } from 'node:fs'
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
// protected-class set and the chat pin overlay leave the schema. Two members stay on purpose, each
// until its last consumer leaves: `StandingApprovalGrant` (type only, `standing-approval.ts`) for the
// safety ports 432-19 deletes, and `TrustScopeSchema` (`grant-ops.ts`) for the run-service DTO 432-22
// deletes. `STANDING_APPROVAL_SCOPE` is the scope the MCP bearer credential still carries
// (`cli/src/composition/mcp-token-resolution.ts`), so it moves beside `TrustScope` and stays until the
// token owner removes that credential. No later absence is asserted here early.
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
] as const

const RETIRED_GRANT_MODULES = [
  'safety/grant-ledger.ts',
  'safety/protected-classes.ts',
  'chat/pin-overlay.ts',
] as const

describe('C432-NO-GRANT-CONTRACTS: the grant ledger, grant op, protected-class and pin contracts are gone', () => {
  it('C432-NO-GRANT-CONTRACTS: neither the root nor the safety barrel exports a retired grant or pin member', () => {
    const root = new Set(Object.keys(schema))
    const safetyBarrel = new Set(Object.keys(safety))
    expect(RETIRED_GRANT_RUNTIME_EXPORTS.filter(name => root.has(name)), 'root barrel').toEqual([])
    expect(RETIRED_GRANT_RUNTIME_EXPORTS.filter(name => safetyBarrel.has(name)), 'safety barrel').toEqual([])
  })

  it('C432-NO-GRANT-CONTRACTS: the ledger, protected-class and pin modules are deleted', () => {
    expect(RETIRED_GRANT_MODULES.filter(path => existsSync(join(SRC, path)))).toEqual([])
  })

  it('C432-NO-GRANT-CONTRACTS: the interim members stay until their own owners remove them', () => {
    // Not vacuous: the census above would pass over an empty barrel, so the retained members are
    // named and found.
    expect(exported('TrustScopeSchema'), 'TrustScopeSchema stays for config/run-service.ts until 432-22')
      .toBeDefined()
    expect(exported('STANDING_APPROVAL_SCOPE'), 'the MCP bearer credential scope stays with its consumer')
      .toEqual({ project: 'local-workspace' })
    expect(exported('TRUST_SCOPE_KEYS')).toEqual(['project', 'org'])
    expect(existsSync(join(SRC, 'safety/standing-approval.ts')), 'StandingApprovalGrant stays until 432-19')
      .toBe(true)
  })

  it('C432-NO-GRANT-CONTRACTS: grant-ops.ts holds only the trust-scope projection', async () => {
    const module = await import('../safety/grant-ops') as Record<string, unknown>
    expect(Object.keys(module).sort()).toEqual(['TrustScopeSchema'])
  })
})
