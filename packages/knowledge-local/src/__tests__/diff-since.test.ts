import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  BundleOutcomeEventSchema,
  guardRecordChange,
} from '@vostride/agent-qa-schema'
import type {
  BundleOutcomeEvent,
  RecordChange,
  RecordId,
} from '@vostride/agent-qa-schema'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { publishBundle } from '../bundle-publish.test-helper.js'
import type { BundleStoreConfig } from '../bundle-publish.test-helper.js'
import * as knowledgeLocal from '../index.js'
import {
  makeBundleDraftFixture,
  makeScreenStateFixture,
} from './fixtures/bundle-fixture.js'

type DiffApi = {
  diffSince?: (options: {
    knowledgeRoot: string
    sinceOrdinal: number
  }) => RecordChange[]
}

function diffSince(knowledgeRoot: string, sinceOrdinal: number): RecordChange[] {
  const diff = (knowledgeLocal as DiffApi).diffSince
  expect(diff, 'diffSince export').toBeDefined()
  return diff!({ knowledgeRoot, sinceOrdinal })
}

function event(
  value: Parameters<typeof BundleOutcomeEventSchema.parse>[0],
): BundleOutcomeEvent {
  return BundleOutcomeEventSchema.parse(value)
}

describe('diffSince deterministic maintenance history', () => {
  let root: string
  let knowledgeRoot: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'knowledge-diff-'))
    knowledgeRoot = join(root, 'agent-qa-knowledge')
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  function config(): BundleStoreConfig {
    return {
      knowledgeRoot,
      productKey: 'shop',
      auditBaseDir: join(root, '.agent-qa'),
      commitArtifacts: 'none',
    }
  }

  function publishFact(
    name: string,
    scope: string,
    createdAtOrdinal: number,
    initialEvents: readonly BundleOutcomeEvent[],
  ): RecordId {
    const outcome = publishBundle(config(), {
      draft: makeBundleDraftFixture({
        anchors: [{ t: 'el', role: 'Button', name }],
        scope: { tier: 'product', key: scope },
        summary: `${name} fact`,
      }),
      discriminant: {
        kind: 'fact',
        subtype: 'selector',
        elementRef: { role: 'Button', name },
      },
      originClass: 'agent-verified',
      createdAtOrdinal,
      screenStates: [makeScreenStateFixture()],
      initialEvents: [...initialEvents],
      relations: [],
      provenance: {
        mode: 'run-linked',
        runId: `diff-${scope}`,
        testId: 'diff-since',
        stepIndex: 0,
      },
      artifacts: [],
    })

    expect(outcome.kind).toBe('published')
    if (outcome.kind !== 'published') throw new Error('fixture bundle did not publish')
    return outcome.id
  }

  function seedStore(): {
    confirmedId: string
    supersededId: string
    addedId: string
    retractedId: string
  } {
    const confirmedId = publishFact('Confirmed', 'confirmed', 5, [
      event({
        type: 'confirmed',
        evidenceToken: 'confirmed-at-11',
        curationJobId: 'confirmation-job',
        buildOrdinal: 11,
        origin: 'agent-verified',
      }),
    ])
    const supersededId = publishFact('Superseded', 'superseded', 5, [
      event({
        type: 'superseded',
        evidenceToken: 'superseded-at-12',
        curationJobId: 'supersession-job',
        buildOrdinal: 12,
        byRecordId: confirmedId,
      }),
    ])
    const addedId = publishFact('Added', 'added', 13, [
      event({
        type: 'confirmed',
        evidenceToken: 'added-confirmation',
        curationJobId: 'added-job',
        buildOrdinal: 13,
        origin: 'agent-verified',
      }),
    ])
    const retractedId = publishFact('Retracted', 'retracted', 5, [
      event({
        type: 'confirmed',
        evidenceToken: 'retracted-confirmation',
        curationJobId: 'retracted-target-job',
        buildOrdinal: 11,
        origin: 'agent-verified',
      }),
      event({
        type: 'retracted',
        evidenceToken: 'rollback-at-12',
        curationJobId: 'rollback-job',
        buildOrdinal: 12,
        retractsEvidenceToken: 'retracted-confirmation',
        retractsCurationJobId: 'retracted-target-job',
        rollbackReceiptId: 'rollback-receipt-1',
      }),
    ])

    return { confirmedId, supersededId, addedId, retractedId }
  }

  it('maps surviving post-reference events and classifies newly added records', () => {
    const { confirmedId, supersededId, addedId, retractedId } = seedStore()

    const changes = diffSince(knowledgeRoot, 10)

    expect(changes.map(guardRecordChange)).toEqual(changes)
    expect(changes).toContainEqual({
      schemaVersion: 1,
      recordId: confirmedId,
      change: 'confirmed',
      atOrdinal: 11,
      evidenceToken: 'confirmed-at-11',
    })
    expect(changes).toContainEqual({
      schemaVersion: 1,
      recordId: supersededId,
      change: 'superseded',
      atOrdinal: 12,
      evidenceToken: 'superseded-at-12',
      byRecordId: confirmedId,
    })
    expect(changes).toContainEqual({
      schemaVersion: 1,
      recordId: addedId,
      change: 'added',
      atOrdinal: 13,
    })
    expect(changes.some((change) => change.recordId === retractedId)).toBe(false)
    expect(diffSince(knowledgeRoot, 11).some((change) => (
      change.recordId === confirmedId && change.change === 'confirmed'
    ))).toBe(false)
  })

  it('preserves later lifecycle transitions for records added after the reference', () => {
    const addedId = publishFact('Added then deprecated', 'added-transition', 11, [
      event({
        type: 'confirmed',
        evidenceToken: 'creation-confirmation',
        curationJobId: 'creation-job',
        buildOrdinal: 11,
        origin: 'agent-verified',
      }),
      event({
        type: 'deprecated',
        evidenceToken: 'deprecated-at-14',
        curationJobId: 'deprecation-job',
        buildOrdinal: 14,
        reason: 'superseded operating guidance',
      }),
    ])

    const first = diffSince(knowledgeRoot, 10).map(guardRecordChange)
    const second = diffSince(knowledgeRoot, 10).map(guardRecordChange)

    expect(first.filter((change) => change.recordId === addedId)).toEqual([
      {
        schemaVersion: 1,
        recordId: addedId,
        change: 'added',
        atOrdinal: 11,
      },
      {
        schemaVersion: 1,
        recordId: addedId,
        change: 'deprecated',
        atOrdinal: 14,
        evidenceToken: 'deprecated-at-14',
      },
    ])
    expect(JSON.stringify(second)).toBe(JSON.stringify(first))
  })

  it('observes a real purge after the immediately prior product ordinal', () => {
    const purgedId = publishFact('Purged after peer change', 'purged-after-peer', 12, [
      event({
        type: 'confirmed',
        evidenceToken: 'purged-target-at-12',
        curationJobId: 'purged-target-job',
        buildOrdinal: 12,
        origin: 'agent-verified',
      }),
    ])
    publishFact('Product chronology peer', 'product-peer', 5, [
      event({
        type: 'promoted',
        evidenceToken: 'product-peer-at-20',
        curationJobId: 'product-peer-job',
        buildOrdinal: 20,
      }),
    ])

    const purged = knowledgeLocal.purgeRecord({
      knowledgeRoot,
      recordId: purgedId,
      initiator: 'test-operator',
      auditBaseDir: join(root, '.agent-qa'),
      purgedAtOrdinal: 21,
    })

    expect(purged.kind).toBe('purged')
    if (purged.kind !== 'purged') throw new Error('expected purge to complete')
    expect(purged.receipt.purgedAtOrdinal).toBe(21)
    expect(diffSince(knowledgeRoot, 20)).toEqual([
      {
        schemaVersion: 1,
        recordId: purgedId,
        change: 'purged',
        atOrdinal: 21,
      },
    ])
  })

  it('observes a later cross-record purge after the earlier high-ordinal bundle is gone', () => {
    const recordA = publishFact('Cross-record purge A', 'cross-record-a', 100, [
      event({
        type: 'confirmed',
        evidenceToken: 'cross-record-a-at-100',
        curationJobId: 'cross-record-a-job',
        buildOrdinal: 100,
        origin: 'agent-verified',
      }),
    ])
    const recordB = publishFact('Cross-record purge B', 'cross-record-b', 20, [
      event({
        type: 'confirmed',
        evidenceToken: 'cross-record-b-at-20',
        curationJobId: 'cross-record-b-job',
        buildOrdinal: 20,
        origin: 'agent-verified',
      }),
    ])

    const firstPurge = knowledgeLocal.purgeRecord({
      knowledgeRoot,
      recordId: recordA,
      initiator: 'test-operator',
      auditBaseDir: join(root, '.agent-qa'),
      purgedAtOrdinal: 101,
    })
    expect(firstPurge.kind).toBe('purged')
    if (firstPurge.kind !== 'purged') throw new Error('expected record A purge to complete')
    expect(firstPurge.receipt.purgedAtOrdinal).toBe(101)

    const secondPurge = knowledgeLocal.purgeRecord({
      knowledgeRoot,
      recordId: recordB,
      initiator: 'test-operator',
      auditBaseDir: join(root, '.agent-qa'),
      purgedAtOrdinal: 102,
    })
    expect(secondPurge.kind).toBe('purged')
    if (secondPurge.kind !== 'purged') throw new Error('expected record B purge to complete')
    expect(secondPurge.receipt.purgedAtOrdinal).toBeGreaterThan(101)

    const firstDiff = diffSince(knowledgeRoot, 101).map(guardRecordChange)
    const secondDiff = diffSince(knowledgeRoot, 101).map(guardRecordChange)
    expect(firstDiff).toEqual([
      {
        schemaVersion: 1,
        recordId: recordB,
        change: 'purged',
        atOrdinal: secondPurge.receipt.purgedAtOrdinal,
      },
    ])
    expect(firstDiff.some((change) => change.recordId === recordA)).toBe(false)
    expect(JSON.stringify(secondDiff)).toBe(JSON.stringify(firstDiff))
  })

  it('includes canonical purge receipts after the reference ordinal', () => {
    seedStore()
    const receiptsDir = join(knowledgeRoot, 'memory', 'receipts')
    mkdirSync(receiptsDir, { recursive: true })
    writeFileSync(
      join(receiptsDir, 'purge-purged-record.json'),
      `${JSON.stringify({
        schemaVersion: 1,
        purgedRecordId: 'purged-record',
        purgedAtOrdinal: 14,
        initiator: 'test-operator',
        affectedPaths: ['memory/shop/bundles/purged-record'],
        firstCommittedOrdinal: 2,
      })}\n`,
      'utf8',
    )

    expect(diffSince(knowledgeRoot, 10)).toContainEqual({
      schemaVersion: 1,
      recordId: 'purged-record',
      change: 'purged',
      atOrdinal: 14,
    })
    expect(diffSince(knowledgeRoot, 14).some((change) => change.change === 'purged'))
      .toBe(false)
  })

  it('rejects copied, malformed, and non-canonical purge receipt truth', () => {
    const receiptsDir = join(knowledgeRoot, 'memory', 'receipts')
    mkdirSync(receiptsDir, { recursive: true })
    const receipt = {
      schemaVersion: 1,
      purgedRecordId: 'record-a',
      purgedAtOrdinal: 14,
      initiator: 'test-operator',
      affectedPaths: ['memory/shop/bundles/record-a'],
      firstCommittedOrdinal: 2,
    }
    writeFileSync(
      join(receiptsDir, 'purge-record-b.json'),
      `${JSON.stringify(receipt)}\n`,
      'utf8',
    )
    expect(() => diffSince(knowledgeRoot, 10)).toThrowError(
      knowledgeLocal.KnowledgeMaintenanceScanError,
    )

    rmSync(join(receiptsDir, 'purge-record-b.json'))
    writeFileSync(join(receiptsDir, 'purge-record-a.01.json'), '{}\n', 'utf8')
    expect(() => diffSince(knowledgeRoot, 10)).toThrow(/canonical receipt filename/i)

    rmSync(join(receiptsDir, 'purge-record-a.01.json'))
    writeFileSync(join(receiptsDir, 'purge-record-a.json'), 'not-json\n', 'utf8')
    expect(() => diffSince(knowledgeRoot, 10)).toThrowError(
      knowledgeLocal.KnowledgeMaintenanceScanError,
    )
  })

  it('fails closed when receipt history cannot be enumerated', () => {
    const receiptsPath = join(knowledgeRoot, 'memory', 'receipts')
    mkdirSync(join(knowledgeRoot, 'memory'), { recursive: true })
    writeFileSync(receiptsPath, 'not a directory', 'utf8')

    expect(() => diffSince(knowledgeRoot, 0)).toThrowError(
      knowledgeLocal.KnowledgeMaintenanceScanError,
    )
    expect(() => diffSince(knowledgeRoot, 0)).toThrow(/scan incomplete/i)
  })

  it('is stable in record-id, ordinal, and change-kind order', () => {
    seedStore()

    const first = diffSince(knowledgeRoot, 10)
    const second = diffSince(knowledgeRoot, 10)
    const sorted = [...first].sort((left, right) => (
      left.recordId.localeCompare(right.recordId)
      || left.atOrdinal - right.atOrdinal
      || left.change.localeCompare(right.change)
    ))

    expect(second).toEqual(first)
    expect(first).toEqual(sorted)
  })
})
