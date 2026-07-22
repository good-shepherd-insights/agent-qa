import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  BundleOutcomeEventSchema,
  canonicalJson,
  guardInspectRecordView,
  normalizeAnchor,
} from '@vostride/agent-qa-schema'
import type {
  Anchor,
  BundleDiscriminant,
  BundleDraft,
  BundleOutcomeEvent,
  InspectFilter,
  InspectRecordView,
} from '@vostride/agent-qa-schema'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { publishBundle } from '../bundle-publish.js'
import type { BundleStoreConfig } from '../bundle-publish.js'
import * as knowledgeLocal from '../index.js'
import {
  makeBundleDraftFixture,
  makeScreenStateFixture,
} from './fixtures/bundle-fixture.js'

type InspectApi = {
  inspectRecords?: (options: {
    knowledgeRoot: string
    filter: InspectFilter
  }) => InspectRecordView[]
}

function inspectRecords(
  knowledgeRoot: string,
  filter: InspectFilter = {},
): InspectRecordView[] {
  const inspect = (knowledgeLocal as InspectApi).inspectRecords
  expect(inspect, 'inspectRecords export').toBeDefined()
  return inspect!({ knowledgeRoot, filter })
}

function event(
  value: Parameters<typeof BundleOutcomeEventSchema.parse>[0],
): BundleOutcomeEvent {
  return BundleOutcomeEventSchema.parse(value)
}

describe('inspectRecords canonical maintenance view', () => {
  let root: string
  let knowledgeRoot: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'knowledge-inspect-'))
    knowledgeRoot = join(root, 'agent-qa-knowledge')
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  function config(productKey: string): BundleStoreConfig {
    return {
      knowledgeRoot,
      productKey,
      auditBaseDir: join(root, '.agent-qa'),
      commitArtifacts: 'none',
    }
  }

  function publish(input: {
    product: string
    kind: BundleDraft['kind']
    scope: string
    anchor: Anchor
    discriminant: BundleDiscriminant
    createdAtOrdinal: number
    initialEvents?: readonly BundleOutcomeEvent[]
    evidenceMarkdown?: string
  }): string {
    const outcome = publishBundle(config(input.product), {
      draft: makeBundleDraftFixture({
        kind: input.kind,
        anchors: [input.anchor],
        scope: { tier: 'product', key: input.scope },
        summary: `${input.kind} record for ${input.scope}`,
      }),
      discriminant: input.discriminant,
      originClass: 'agent-verified',
      createdAtOrdinal: input.createdAtOrdinal,
      screenStates: [makeScreenStateFixture()],
      initialEvents: [...(input.initialEvents ?? [])],
      relations: [],
      provenance: {
        mode: 'run-linked',
        runId: `inspect-${input.scope}`,
        testId: 'inspect-records',
        stepIndex: 0,
      },
      artifacts: [],
      ...(input.evidenceMarkdown === undefined
        ? {}
        : { evidenceMarkdown: input.evidenceMarkdown }),
    })

    expect(outcome.kind).toBe('published')
    if (outcome.kind !== 'published') throw new Error('fixture bundle did not publish')
    return outcome.id
  }

  function seedStore(): {
    activeId: string
    retiredId: string
    unresolvedId: string
    unresolvedAnchor: Anchor
  } {
    const activeId = publish({
      product: 'shop',
      kind: 'fact',
      scope: 'checkout',
      anchor: { t: 'el', role: 'Button', name: 'Checkout Now' },
      discriminant: {
        kind: 'fact',
        subtype: 'selector',
        elementRef: { role: 'Button', name: 'Checkout Now' },
      },
      createdAtOrdinal: 5,
      initialEvents: [
        event({
          type: 'promoted',
          evidenceToken: 'active-promoted',
          curationJobId: 'active-promotion-job',
          buildOrdinal: 6,
        }),
        event({
          type: 'confirmed',
          evidenceToken: 'active-confirmed',
          curationJobId: 'active-confirmation-job',
          buildOrdinal: 7,
          origin: 'agent-verified',
        }),
      ],
      evidenceMarkdown: 'Evidence for the active checkout record.\n',
    })

    const retiredId = publish({
      product: 'shop',
      kind: 'fact',
      scope: 'legacy-checkout',
      anchor: { t: 'el', role: 'Button', name: 'Legacy Checkout' },
      discriminant: {
        kind: 'fact',
        subtype: 'selector',
        elementRef: { role: 'Button', name: 'Legacy Checkout' },
      },
      createdAtOrdinal: 5,
      initialEvents: [
        event({
          type: 'superseded',
          evidenceToken: 'legacy-superseded',
          curationJobId: 'legacy-supersession-job',
          buildOrdinal: 20,
          byRecordId: activeId,
        }),
        event({
          type: 'window-close',
          evidenceToken: 'legacy-window-close',
          curationJobId: 'legacy-window-close-job',
          buildOrdinal: 20,
          closedAtOrdinal: 20,
        }),
      ],
    })

    const unresolvedAnchor: Anchor = {
      t: 'error',
      message: '  Payment FAILED for order 42  ',
    }
    const unresolvedId = publish({
      product: 'support',
      kind: 'unknown',
      scope: 'payment-triage',
      anchor: unresolvedAnchor,
      discriminant: {
        kind: 'unknown',
        conflictRecordIds: ['payment-record-b', 'payment-record-a'],
      },
      createdAtOrdinal: 9,
    })

    return { activeId, retiredId, unresolvedId, unresolvedAnchor }
  }

  it('returns only current live records by default in stable record-id order', () => {
    const { activeId, unresolvedId } = seedStore()

    const records = inspectRecords(knowledgeRoot)

    expect(records.map((record) => record.recordId)).toEqual(
      [activeId, unresolvedId].sort(),
    )
    expect(records.map(guardInspectRecordView)).toEqual(records)
    expect(records.find((record) => record.recordId === activeId)).toMatchObject({
      product: 'shop',
      scope: 'checkout',
      kind: 'fact',
      status: 'active',
      confirmations: 1,
      contradictions: 0,
      evidenceTokens: ['active-confirmed', 'active-promoted'],
      lastEventOrdinal: 7,
      openedAtOrdinal: 5,
      trustNarrative: 'Evidence for the active checkout record.\n',
    })
  })

  it('applies every filter against normalized canonical record state', () => {
    const { retiredId, unresolvedId, unresolvedAnchor } = seedStore()
    const normalizedAnchor = canonicalJson(normalizeAnchor(unresolvedAnchor))

    expect(inspectRecords(knowledgeRoot, { product: 'support' }).map((r) => r.recordId))
      .toEqual([unresolvedId])
    expect(inspectRecords(knowledgeRoot, { scope: 'payment-triage' }).map((r) => r.recordId))
      .toEqual([unresolvedId])
    expect(inspectRecords(knowledgeRoot, { kind: 'unknown' }).map((r) => r.recordId))
      .toEqual([unresolvedId])
    expect(inspectRecords(knowledgeRoot, { unresolvedOnly: true }).map((r) => r.recordId))
      .toEqual([unresolvedId])
    expect(inspectRecords(knowledgeRoot, { anchor: normalizedAnchor }).map((r) => r.recordId))
      .toEqual([unresolvedId])
    expect(inspectRecords(knowledgeRoot, { recordId: retiredId, status: 'superseded' }))
      .toHaveLength(1)
    expect(inspectRecords(knowledgeRoot, { recordId: retiredId, asOfBuild: 15 }))
      .toHaveLength(1)
    expect(inspectRecords(knowledgeRoot, { recordId: retiredId, asOfBuild: 20 }))
      .toEqual([])
  })

  it('is byte-identical across repeated reads without wall-clock dependence', () => {
    seedStore()

    const first = JSON.stringify(inspectRecords(knowledgeRoot, { status: 'active' }))
    const second = JSON.stringify(inspectRecords(knowledgeRoot, { status: 'active' }))

    expect(second).toBe(first)
  })
})
