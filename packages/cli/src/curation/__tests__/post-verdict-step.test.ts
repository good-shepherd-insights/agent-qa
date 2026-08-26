// The D-09 decision table and the ONE lease acquisition, pinned (Phase 404 plan 01, D-10/D-11).
//
// TWO CLAIMS, AND THEY ARE DIFFERENT CLAIMS. `dispositionOf` is a pure mapping and is pinned TOTAL
// over the lease outcome's `kind` domain plus the two inputs that have no lease at all — because
// what it returns is written into a frozen bus field that 408's embed and every thin client parse,
// and a case nobody chose is a value nobody chose. `createPostVerdictStep` is pinned on the
// behaviour AROUND that mapping: exactly one acquisition per `run()`, a nudge on `held`, and a
// take-ONCE handoff box, which is the whole of RESEARCH Pitfall 3's mitigation.
//
// NO REAL KNOWLEDGE ROOT IS TOUCHED. Every cell stubs `operations`, so nothing here mints an epoch,
// writes a lease file or wakes a daemon — the acquisition under test is the CALL, not the file
// system underneath it, which `writer-lease`'s own suite owns.

import { describe, expect, it, vi } from 'vitest'

import {
  createPostVerdictStep,
  dispositionOf,
  releaseUntakenPostVerdictLease,
  type PostVerdictStepOperations,
  type WriterLeaseOutcome,
} from '../post-verdict-step.js'

const KNOWLEDGE_ROOT = '/tmp/agent-qa-404-fake-knowledge'
const AGENT_QA_ROOT = '/tmp/agent-qa-404-fake/.agent-qa'
const RUN_ID = 'r_fake-post-verdict-step-run'

const ACQUIRED: WriterLeaseOutcome = { kind: 'acquired', leaseId: 'lease-1', epoch: 7 }
const HELD: WriterLeaseOutcome = {
  kind: 'held',
  holder: { leaseId: 'other', pid: 4242, epoch: 6, heartbeatAtMs: 1 },
} as WriterLeaseOutcome

/** A `refused` arm built through the union rather than cast piecemeal, so its `reason` is real. */
function refused(): WriterLeaseOutcome {
  return {
    kind: 'refused',
    reason: 'corrupt-epoch-state',
    error: new Error('epoch bytes are not a number'),
  } as unknown as WriterLeaseOutcome
}

function stubOperations(
  overrides: Partial<PostVerdictStepOperations> = {},
): Partial<PostVerdictStepOperations> {
  return {
    acquireWriterLease: vi.fn(() => ACQUIRED) as unknown as PostVerdictStepOperations['acquireWriterLease'],
    releaseLease: vi.fn(() => ({ kind: 'released' })) as unknown as PostVerdictStepOperations['releaseLease'],
    nudgeDaemon: vi.fn(async () => undefined) as unknown as PostVerdictStepOperations['nudgeDaemon'],
    ...overrides,
  }
}

describe('dispositionOf — total over the lease outcome domain (404 D-09/D-11)', () => {
  it('held ⇒ handedOff, with nothing to warn about', () => {
    expect(
      dispositionOf({ lease: HELD, leaseSkipped: false }),
      'a current-epoch holder exists, so somebody else will pump',
    ).toEqual({ disposition: 'handedOff' })
  })

  it('acquired ⇒ drained, with nothing to warn about', () => {
    expect(
      dispositionOf({ lease: ACQUIRED, leaseSkipped: false }),
      'this process took the lease, so this process will pump',
    ).toEqual({ disposition: 'drained' })
  })

  it('refused ⇒ detached plus writer-lease-refused CARRYING THE REFUSAL\'S OWN REASON', () => {
    const outcome = dispositionOf({ lease: refused(), leaseSkipped: false })
    expect(outcome.disposition, 'a lease nobody can evaluate promises nothing').toBe('detached')
    expect(outcome.warning?.code).toBe('writer-lease-refused')
    expect(
      outcome.warning?.message,
      'the reason travels to the reader rather than being flattened to "refused"',
    ).toContain('corrupt-epoch-state')
  })

  it('leaseSkipped ⇒ detached with NO warning — a deliberate skip is not a fault', () => {
    expect(dispositionOf({ leaseSkipped: true })).toEqual({ disposition: 'detached' })
    expect(
      dispositionOf({ lease: ACQUIRED, leaseSkipped: true }),
      'the skip wins: a lease that was never meant to be consulted cannot promise a drain',
    ).toEqual({ disposition: 'detached' })
  })

  it('no lease at all and not skipped ⇒ detached plus post-processing-unbound', () => {
    const outcome = dispositionOf({ leaseSkipped: false })
    expect(outcome.disposition).toBe('detached')
    expect(
      outcome.warning?.code,
      'a host with no lease capability says so by name rather than looking like a refusal',
    ).toBe('post-processing-unbound')
  })
})

describe('createPostVerdictStep — one acquisition, one hand-off (404 D-10, Pitfall 3)', () => {
  it('an acquired lease reads drained and leaves through takeAcquiredLease() exactly ONCE', async () => {
    const operations = stubOperations()
    const step = createPostVerdictStep({
      runId: RUN_ID,
      agentQaRoot: AGENT_QA_ROOT,
      knowledgeRoot: KNOWLEDGE_ROOT,
      log: { warn: vi.fn() },
      operations,
    })

    const outcome = await step.port.run({ runId: RUN_ID as never, verdict: 'passed' as never })
    expect(outcome, 'nobody held it, so this process will pump').toEqual({ disposition: 'drained' })
    expect(
      operations.acquireWriterLease,
      'THE one acquisition: a second consult would answer `held` by this very process',
    ).toHaveBeenCalledTimes(1)
    expect(operations.acquireWriterLease).toHaveBeenCalledWith(KNOWLEDGE_ROOT)

    expect(
      step.handoff.takeAcquiredLease(),
      'the pump receives the authority the step acquired, epoch included',
    ).toEqual({ leaseId: 'lease-1', epoch: 7 })
    expect(
      step.handoff.takeAcquiredLease(),
      'take-ONCE: two callers each believing they hold the lease is the defect this box prevents',
    ).toBeUndefined()
    expect(step.handoff.outcome).toEqual({ disposition: 'drained' })
  })

  it('a held lease reads handedOff, nudges the holder once, and hands NOTHING to the pump', async () => {
    const operations = stubOperations({
      acquireWriterLease: vi.fn(() => HELD) as unknown as PostVerdictStepOperations['acquireWriterLease'],
    })
    const step = createPostVerdictStep({
      runId: RUN_ID,
      agentQaRoot: AGENT_QA_ROOT,
      knowledgeRoot: KNOWLEDGE_ROOT,
      log: { warn: vi.fn() },
      operations,
    })

    const outcome = await step.port.run({ runId: RUN_ID as never, verdict: 'failed' as never })
    expect(outcome).toEqual({ disposition: 'handedOff' })
    expect(operations.acquireWriterLease, 'still exactly one consult').toHaveBeenCalledTimes(1)
    expect(operations.nudgeDaemon, 'the holder is woken exactly once').toHaveBeenCalledTimes(1)
    expect(operations.nudgeDaemon).toHaveBeenCalledWith(AGENT_QA_ROOT, {
      knowledgeRoot: KNOWLEDGE_ROOT,
    })
    expect(
      step.handoff.takeAcquiredLease(),
      'this process acquired nothing, so it hands the pump nothing',
    ).toBeUndefined()
  })

  it('a refused lease is a WARNING, never a throw — the shell\'s own degrade path stays reserved for real faults', async () => {
    const operations = stubOperations({
      acquireWriterLease: vi.fn(() => refused()) as unknown as PostVerdictStepOperations['acquireWriterLease'],
    })
    const step = createPostVerdictStep({
      runId: RUN_ID,
      agentQaRoot: AGENT_QA_ROOT,
      knowledgeRoot: KNOWLEDGE_ROOT,
      log: { warn: vi.fn() },
      operations,
    })

    const outcome = await step.port.run({ runId: RUN_ID as never, verdict: 'passed' as never })
    expect(outcome.disposition).toBe('detached')
    expect(outcome.warning?.code).toBe('writer-lease-refused')
    expect(operations.nudgeDaemon, 'nobody to nudge — nobody holds it').not.toHaveBeenCalled()
  })

  it('an UNEXPECTED throw from the capability propagates, so the shell degrade path is reachable', async () => {
    const operations = stubOperations({
      acquireWriterLease: vi.fn(() => {
        throw new Error('EACCES')
      }) as unknown as PostVerdictStepOperations['acquireWriterLease'],
    })
    const step = createPostVerdictStep({
      runId: RUN_ID,
      agentQaRoot: AGENT_QA_ROOT,
      knowledgeRoot: KNOWLEDGE_ROOT,
      log: { warn: vi.fn() },
      operations,
    })

    await expect(
      step.port.run({ runId: RUN_ID as never, verdict: 'passed' as never }),
      'a raise is not a decided posture; the shell names it post-verdict-step-failed',
    ).rejects.toThrow('EACCES')
  })
})

describe('releaseUntakenPostVerdictLease — the no-leak rule for a door with no tail', () => {
  it('releases a lease nobody took and warns by name', () => {
    const operations = stubOperations()
    const step = createPostVerdictStep({
      runId: RUN_ID,
      agentQaRoot: AGENT_QA_ROOT,
      knowledgeRoot: KNOWLEDGE_ROOT,
      log: { warn: vi.fn() },
      operations,
    })
    const warn = vi.fn()

    return step.port.run({ runId: RUN_ID as never, verdict: 'passed' as never }).then(() => {
      releaseUntakenPostVerdictLease({
        handoff: step.handoff,
        knowledgeRoot: KNOWLEDGE_ROOT,
        runId: RUN_ID,
        log: { warn },
        operations: { releaseLease: operations.releaseLease },
      })
      expect(operations.releaseLease).toHaveBeenCalledWith({
        knowledgeRoot: KNOWLEDGE_ROOT,
        leaseId: 'lease-1',
      })
      expect(warn.mock.calls[0][0], 'the fact is named, not silently absorbed').toContain(
        'released untaken',
      )
      expect(
        step.handoff.takeAcquiredLease(),
        'the box is empty afterwards — the release consumed the take',
      ).toBeUndefined()
    })
  })

  it('is a NO-OP when the tail already took the lease — no double release, no warning', () => {
    const operations = stubOperations()
    const step = createPostVerdictStep({
      runId: RUN_ID,
      agentQaRoot: AGENT_QA_ROOT,
      knowledgeRoot: KNOWLEDGE_ROOT,
      log: { warn: vi.fn() },
      operations,
    })
    const warn = vi.fn()

    return step.port.run({ runId: RUN_ID as never, verdict: 'passed' as never }).then(() => {
      expect(step.handoff.takeAcquiredLease()).toEqual({ leaseId: 'lease-1', epoch: 7 })
      releaseUntakenPostVerdictLease({
        handoff: step.handoff,
        knowledgeRoot: KNOWLEDGE_ROOT,
        runId: RUN_ID,
        log: { warn },
        operations: { releaseLease: operations.releaseLease },
      })
      expect(
        operations.releaseLease,
        'the pump owns the release once it has taken the authority',
      ).not.toHaveBeenCalled()
      expect(warn).not.toHaveBeenCalled()
    })
  })
})
