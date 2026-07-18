import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { asRecordId, type CanaryOutcome } from '@vostride/agent-qa-schema'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { enqueueCanaryOutcome } from '../canary-queue.js'
import { canaryOutcomeContentAddress, canaryOutcomePayloadSchema } from '../canary-payload.js'
import { queuedRoot } from '../queue-layout.js'

function outcome(): CanaryOutcome {
  return {
    candidateId: asRecordId('fact-checkout-button-0123456789abcdef'),
    runOutcome: 'positive',
    runId: 'run-canary-transport',
    testId: 'checkout::happy-path',
    testIndex: 1,
    buildOrdinal: 42,
    stepIndex: 3,
    briefDigest: 'brief-digest-42',
    attribution: 'The served checkout hypothesis was exercised by the passing step.',
    exercisedAnchor: { t: 'el', role: 'button', name: 'Checkout' },
  }
}

describe('enqueueCanaryOutcome', () => {
  let knowledgeRoot: string

  beforeEach(() => {
    knowledgeRoot = mkdtempSync(join(tmpdir(), 'knowledge-canary-queue-'))
  })

  afterEach(() => {
    rmSync(knowledgeRoot, { recursive: true, force: true })
  })

  it('atomically coalesces repeated drops at one content-addressed queue entry', () => {
    const first = enqueueCanaryOutcome(knowledgeRoot, outcome())
    const second = enqueueCanaryOutcome(knowledgeRoot, outcome())
    const entries = readdirSync(queuedRoot(knowledgeRoot))

    expect(first.kind).toBe('enqueued')
    expect(second).toEqual({ kind: 'coalesced', entryId: first.entryId })
    expect(entries).toEqual([first.entryId])

    const raw = JSON.parse(
      readFileSync(join(queuedRoot(knowledgeRoot), first.entryId, 'payload.json'), 'utf8'),
    )
    const payload = canaryOutcomePayloadSchema.parse(raw)
    expect(payload).toMatchObject({
      candidateId: outcome().candidateId,
      testId: outcome().testId,
      testIndex: outcome().testIndex,
      outcome: outcome().runOutcome,
      jobKind: 'canary-outcome',
    })
    expect(first.entryId).toBe(canaryOutcomeContentAddress(payload))
  })
})
