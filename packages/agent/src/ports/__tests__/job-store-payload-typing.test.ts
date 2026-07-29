import { describe, expect, it } from 'vitest'

import type { JobId } from '@vostride/agent-qa-schema'

import type {
  JobCheckpointRecord,
  JobStoreFence,
  JobStorePort,
} from '../job-store.js'

const JOB_ID = 'job_checkpoint_payload_typing' as JobId
const FENCE: JobStoreFence = { epoch: 7 }

type CheckpointStore = Pick<JobStorePort, 'publishCheckpoint' | 'readCheckpoint'>

function createCheckpointStore(): CheckpointStore {
  let recorded: JobCheckpointRecord | undefined

  return {
    async publishCheckpoint(_jobId, _checkpointId, payload) {
      recorded = payload
    },
    async readCheckpoint() {
      return recorded === undefined
        ? { found: false }
        : { found: true, payload: recorded }
    },
  }
}

describe('JobStorePort checkpoint payload typing', () => {
  it('accepts and round-trips a complete checkpoint record', async () => {
    const store = createCheckpointStore()
    const record: JobCheckpointRecord = {
      checkpointId: 'verdicts-authored',
      jobId: JOB_ID,
      attempt: 2,
      recordedAt: '2026-07-30T00:00:00.000Z',
      value: { verdicts: ['recorded'] },
    }

    await store.publishCheckpoint(JOB_ID, record.checkpointId, record, FENCE)

    await expect(store.readCheckpoint(JOB_ID, record.checkpointId)).resolves.toEqual({
      found: true,
      payload: record,
    })
  })

  it('keeps a raw foreign payload outside the compilable port contract', () => {
    const store = createCheckpointStore()

    const publishForeignPayload = (): Promise<void> =>
      store.publishCheckpoint(
        JOB_ID,
        'verdicts-authored',
        // @ts-expect-error a checkpoint writer must supply the complete durable envelope.
        { value: { verdicts: ['foreign'] } },
        FENCE,
      )

    expect(publishForeignPayload).toBeTypeOf('function')
  })
})
