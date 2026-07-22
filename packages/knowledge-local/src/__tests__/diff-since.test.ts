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
} from '@vostride/agent-qa-schema'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { publishBundle } from '../bundle-publish.js'
import type { BundleStoreConfig } from '../bundle-publish.js'
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
  ): string {
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
