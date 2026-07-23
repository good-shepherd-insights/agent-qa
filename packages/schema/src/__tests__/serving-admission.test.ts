import { describe, expect, it } from 'vitest'
import {
  createServingAdmissionState,
  inspectServingRecord,
} from '../reader/serving-admission'
import { asRecordId } from '../ids/record-id'

function record(input: {
  id: string
  sourceId: string
  clusterKey: string
  renderedCost: number
}) {
  return {
    ...input,
    id: asRecordId(input.id),
  }
}

describe('serving admission dominance adjacency', () => {
  it('admits exactly half of the budget and rejects one unit above for one source', () => {
    const atHalf = inspectServingRecord(
      {
        budget: 10,
        recordCap: 2,
        record: record({
          id: 'rec_source_half',
          sourceId: 'shared-source',
          clusterKey: 'cluster-b',
          renderedCost: 3,
        }),
      },
      createServingAdmissionState([
        record({
          id: 'rec_source_seed_half',
          sourceId: 'shared-source',
          clusterKey: 'cluster-a',
          renderedCost: 2,
        }),
      ]),
    )
    const aboveHalf = inspectServingRecord(
      {
        budget: 10,
        recordCap: 2,
        record: record({
          id: 'rec_source_above',
          sourceId: 'shared-source',
          clusterKey: 'cluster-b',
          renderedCost: 3,
        }),
      },
      createServingAdmissionState([
        record({
          id: 'rec_source_seed_above',
          sourceId: 'shared-source',
          clusterKey: 'cluster-a',
          renderedCost: 3,
        }),
      ]),
    )

    expect(atHalf).toEqual({ admitted: true })
    expect(aboveHalf).toEqual({ admitted: false, reason: 'source-dominance' })
  })

  it('admits exactly half of the budget and rejects one unit above for one cluster', () => {
    const atHalf = inspectServingRecord(
      {
        budget: 10,
        recordCap: 2,
        record: record({
          id: 'rec_cluster_half',
          sourceId: 'source-b',
          clusterKey: 'shared-cluster',
          renderedCost: 3,
        }),
      },
      createServingAdmissionState([
        record({
          id: 'rec_cluster_seed_half',
          sourceId: 'source-a',
          clusterKey: 'shared-cluster',
          renderedCost: 2,
        }),
      ]),
    )
    const aboveHalf = inspectServingRecord(
      {
        budget: 10,
        recordCap: 2,
        record: record({
          id: 'rec_cluster_above',
          sourceId: 'source-b',
          clusterKey: 'shared-cluster',
          renderedCost: 3,
        }),
      },
      createServingAdmissionState([
        record({
          id: 'rec_cluster_seed_above',
          sourceId: 'source-a',
          clusterKey: 'shared-cluster',
          renderedCost: 3,
        }),
      ]),
    )

    expect(atHalf).toEqual({ admitted: true })
    expect(aboveHalf).toEqual({ admitted: false, reason: 'cluster-dominance' })
  })
})
