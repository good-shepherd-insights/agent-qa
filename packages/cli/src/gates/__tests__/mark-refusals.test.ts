// 2026-10-03 (quick 261003-lgd, Phase 432 review WR-04 and IN-11): the mark host's refusals say
// what a retry can and cannot do, and who holds the writer lease.
//
// These cells live in their own file because the 432 mutation driver counts the cells of
// feedback-host.test.ts exactly.

import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'

import type { ApplyKnowledgeChangeInput } from '@vostride/agent-qa-agent-local'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createFeedbackPortForHost,
  KnowledgeWriterLeaseBusyError,
  MarkFixNotAppliedError,
  MarkWriterLeaseBusyError,
} from '../feedback-host.js'
import { markFixture } from './feedback-fixture.js'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

describe('mark refusals name the way out (261003-lgd)', () => {
  // OBSERVED RED on agent-qa 481f0a153: "Mark fix was not applied (target-not-found); gold and
  // evidence landed, no mark receipt appended. Retry the mark." on both attempts.
  it('a fix whose recorded plan targets a vanished record never says "Retry the mark" and names the intent file', async () => {
    const f = markFixture(); roots.push(f.root)
    const applyKnowledgeChange = vi.fn(async (input: ApplyKnowledgeChangeInput) => ({
      outcome: 'target-not-found' as const, verb: 'mark' as const,
      changeId: `prop_${input.operationId}`, target: { grain: 'record' as const, recordId: 'rec-gone' } }))
    const intentPath = join(f.runDir, 'mark-intent.json')
    for (const attempt of [1, 2]) {
      const refusal = await createFeedbackPortForHost({ ...f.deps, applyKnowledgeChange })
        .mark({ runId: f.handoff.runId, kind: 'false-fail' })
        .then(() => undefined, (error: unknown) => error as Error)
      expect(refusal, `attempt ${attempt}`).toMatchObject({ name: 'MarkFixNotAppliedError', reason: 'target-not-found' })
      expect(refusal?.message).not.toContain('Retry the mark')
      expect(refusal?.message).toContain(intentPath)
      expect(refusal?.message).toContain('no longer in the knowledge store')
    }
    expect(existsSync(intentPath), 'the intent is left for the person to remove').toBe(true)
  })

  it('a test-edit refusal a retry can clear still says to retry', () => {
    expect(new MarkFixNotAppliedError('write-failed').message).toContain('Retry the mark.')
    expect(new MarkFixNotAppliedError('target-changed', '/x/mark-intent.json').message).toContain('Retry the mark.')
  })

  // OBSERVED RED on agent-qa 481f0a153: both messages read "Another agent-qa process (pid <this pid>)".
  it('a lease held by this very process is not called another process', () => {
    const own = new MarkWriterLeaseBusyError(process.pid, 10_000).message
    expect(own).not.toContain('Another agent-qa process')
    expect(own).toContain(`This agent-qa process (pid ${process.pid}) is already writing to this knowledge store`)
    expect(own).toContain('Retry the mark when it finishes')
    const ownChange = new KnowledgeWriterLeaseBusyError(process.pid).message
    expect(ownChange).not.toContain('Another agent-qa process')
    expect(ownChange).toContain(`This agent-qa process (pid ${process.pid}) is already writing`)
    expect(ownChange).toContain('Retry the change when it finishes')
    const other = process.pid + 1
    expect(new MarkWriterLeaseBusyError(other, 10_000).message).toContain(`Another agent-qa process (pid ${other})`)
    expect(new KnowledgeWriterLeaseBusyError(other).message).toContain(`Another agent-qa process (pid ${other})`)
  })
})
