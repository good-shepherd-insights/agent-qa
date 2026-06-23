import { describe, expect, it } from 'vitest'
import { jobSchema } from '../job/job'

describe('jobSchema', () => {
  it('accepts a valid queued analyze-run job', () => {
    const result = jobSchema.safeParse({
      id: 'job_1',
      kind: 'analyze-run',
      status: 'queued',
      summary: 'Analyze failed checkout run',
    })

    expect(result.success).toBe(true)
  })

  it('rejects unknown top-level keys', () => {
    const result = jobSchema.safeParse({
      id: 'job_1',
      kind: 'analyze-run',
      status: 'queued',
      summary: 'Analyze failed checkout run',
      checkpoint: 'cp_1',
    })

    expect(result.success).toBe(false)
  })

  it('rejects an invalid job kind', () => {
    const result = jobSchema.safeParse({
      id: 'job_1',
      kind: 'review-run',
      status: 'queued',
      summary: 'Analyze failed checkout run',
    })

    expect(result.success).toBe(false)
  })
})
