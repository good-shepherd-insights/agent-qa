import { expectTypeOf } from 'vitest'
import type { z } from 'zod'
import type { Job } from '../job/job'
import { jobSchema } from '../job/job'

expectTypeOf<z.infer<typeof jobSchema>>().toEqualTypeOf<Job>()

const ok: Job = {
  id: 'job_1' as Job['id'],
  kind: 'analyze-run',
  status: 'queued',
  summary: 'Analyze failed checkout run',
}

const invalidKind: Job = {
  id: 'job_2' as Job['id'],
  // @ts-expect-error Job kind must be one of the v2 QA Agent job types.
  kind: 'review-run',
  status: 'queued',
  summary: 'Invalid job kind',
}

void ok
void invalidKind
