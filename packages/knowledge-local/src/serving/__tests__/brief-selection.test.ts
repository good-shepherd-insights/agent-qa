import {
  asRecordId,
  type Anchor,
  type IndexEntry,
} from '@vostride/agent-qa-schema'
import { describe, expect, it } from 'vitest'

import { selectServingRecords } from '../brief-selection.js'

const scope = { tier: 'test', key: 'checkout add item' } as const

function candidate(
  id: string,
  overrides: Partial<IndexEntry> = {},
): IndexEntry {
  return {
    id: asRecordId(id),
    kind: 'fact',
    title: id,
    summary: 'fact',
    trust: 1,
    anchors: [{ t: 'el', role: 'button', name: id }],
    status: 'active',
    servedAsCanary: false,
    scope,
    validity: 'current',
    ...overrides,
  }
}

function names(entries: readonly IndexEntry[]): string[] {
  return entries.map(({ id }) => id)
}

describe('Channel-1 serving selection', () => {
  it('is input-order independent and breaks equal scores by record id', () => {
    const entries = [candidate('r_c'), candidate('r_a'), candidate('r_b')]
    const input = { scope, channelBudget: 8, recordCap: 8 }

    expect(names(selectServingRecords({ ...input, candidates: entries }))).toEqual([
      'r_a',
      'r_b',
      'r_c',
    ])
    expect(
      names(selectServingRecords({ ...input, candidates: [...entries].reverse() })),
    ).toEqual(['r_a', 'r_b', 'r_c'])
  })

  it('admits an exactly-half cluster and skips the record that would exceed it', () => {
    const shared = (ordinal: number): Anchor => ({
      t: 'el',
      role: 'button',
      name: 'Add item',
      ordinal,
    })
    const entries = [
      candidate('r_a_half', {
        summary: 'a'.repeat(20),
        anchors: [shared(1)],
      }),
      candidate('r_b_over', {
        summary: 'b'.repeat(4),
        anchors: [shared(2)],
      }),
      candidate('r_c_other', {
        summary: 'c'.repeat(20),
        anchors: [{ t: 'el', role: 'button', name: 'Remove item' }],
      }),
    ]

    expect(names(selectServingRecords({
      candidates: entries,
      scope,
      channelBudget: 10,
      recordCap: 10,
    }))).toEqual(['r_a_half', 'r_c_other'])
  })

  it('excludes a policy candidate before scoring even at overwhelming trust', () => {
    const entries = [
      candidate('r_policy', { kind: 'policy', trust: Number.MAX_SAFE_INTEGER }),
      candidate('r_fact'),
    ]

    expect(names(selectServingRecords({
      candidates: entries,
      scope,
      channelBudget: 8,
      recordCap: 8,
    }))).toEqual(['r_fact'])
  })

  it('preserves the caution then procedure then fact precedence floor', () => {
    const entries = [
      candidate('r_fact', { kind: 'fact', trust: 100 }),
      candidate('r_procedure', { kind: 'procedure', trust: 0.2 }),
      candidate('r_caution', { kind: 'caution', trust: 0.1 }),
    ]

    expect(names(selectServingRecords({
      candidates: entries,
      scope,
      channelBudget: 2,
      recordCap: 3,
    }))).toEqual(['r_caution', 'r_procedure'])
  })

  it('never returns more distinct records than the supplied cap', () => {
    const entries = [candidate('r_a'), candidate('r_b'), candidate('r_c')]

    const selected = selectServingRecords({
      candidates: entries,
      scope,
      channelBudget: 8,
      recordCap: 2,
    })

    expect(selected).toHaveLength(2)
    expect(new Set(names(selected))).toHaveLength(2)
  })
})
