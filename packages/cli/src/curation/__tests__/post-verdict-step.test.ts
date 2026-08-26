// The D-09 decision table and the ONE lease acquisition, pinned (Phase 404 plan 01, D-10/D-11).
//
// TWO CLAIMS, AND THEY ARE DIFFERENT CLAIMS. `dispositionOf` is a pure mapping and is pinned TOTAL
// over the lease probe's `kind` domain plus the two inputs that have no probe at all — because
// what it returns is written into a frozen bus field that 408's embed and every thin client parse,
// and a case nobody chose is a value nobody chose. `createPostVerdictStep` is pinned on the
// behaviour AROUND that mapping: a decision taken WITHOUT mutating the lease, at most one
// acquisition per run and only when a pump asks for it, a nudge on `held`, and a take-ONCE handoff
// box, which is the whole of RESEARCH Pitfall 3's mitigation.
//
// THE LAZINESS IS ITSELF A PINNED CLAIM (2026-08-26). `run()` used to call `acquireWriterLease`
// eagerly, which minted an epoch and a lease file for every run — including the runs that end
// above the tail, where the no-leak backstop then released it and printed `released untaken` on
// stderr. `run-parity.e2e.test.ts` caught that as changed ordinary-run output; the cells below are
// where it is caught at unit range: after a `drained` decision with no pump, `acquireWriterLease`
// has not been called, the release is a no-op, and nothing is warned.
//
// NO REAL KNOWLEDGE ROOT IS TOUCHED. Every cell stubs `operations`, so nothing here mints an epoch,
// writes a lease file or wakes a daemon — the acquisition under test is the CALL, not the file
// system underneath it, which `writer-lease`'s own suite owns.

import { describe, expect, it, vi } from 'vitest'

import {
  createPostVerdictStep,
  dispositionOf,
  probeWriterLease,
  releaseUntakenPostVerdictLease,
  type PostVerdictHandoff,
  type PostVerdictStepOperations,
  type WriterLeaseOutcome,
  type WriterLeaseReadOutcome,
} from '../post-verdict-step.js'
import type { CurationWriterAuthority } from '../curation-tail.js'

const KNOWLEDGE_ROOT = '/tmp/agent-qa-404-fake-knowledge'
const AGENT_QA_ROOT = '/tmp/agent-qa-404-fake/.agent-qa'
const RUN_ID = 'r_fake-post-verdict-step-run'
const NOW_MS = 1_700_000_000_000

const ACQUIRED: WriterLeaseOutcome = { kind: 'acquired', leaseId: 'lease-1', epoch: 7 }
const HELD: WriterLeaseOutcome = {
  kind: 'held',
  holder: { leaseId: 'other', pid: 4242, epoch: 6, heartbeatAtMs: 1 },
} as WriterLeaseOutcome

/** A `refused` acquisition arm built through the union, so its `reason` is real. */
function refusedAcquisition(): WriterLeaseOutcome {
  return {
    kind: 'refused',
    reason: 'corrupt-epoch-state',
    error: new Error('epoch bytes are not a number'),
  } as unknown as WriterLeaseOutcome
}

const PARSED_LEASE: WriterLeaseReadOutcome = {
  kind: 'parsed',
  lease: { leaseId: 'other', pid: 4242, epoch: 6, heartbeatAtMs: NOW_MS },
} as WriterLeaseReadOutcome

/**
 * The default table: NOBODY holds the lease (the ordinary local run), and an acquisition, if one is
 * ever made, succeeds. Every cell that wants a different world overrides one member.
 */
function stubOperations(
  overrides: Partial<PostVerdictStepOperations> = {},
): Partial<PostVerdictStepOperations> {
  return {
    acquireWriterLease: vi.fn(() => ACQUIRED) as unknown as PostVerdictStepOperations['acquireWriterLease'],
    releaseLease: vi.fn(() => ({ kind: 'released' })) as unknown as PostVerdictStepOperations['releaseLease'],
    readWriterLease: vi.fn(() => ({ kind: 'absent' })) as unknown as PostVerdictStepOperations['readWriterLease'],
    deriveWriterLeaseFreshness: vi.fn(() => ({
      kind: 'fresh',
    })) as unknown as PostVerdictStepOperations['deriveWriterLeaseFreshness'],
    nudgeDaemon: vi.fn(async () => undefined) as unknown as PostVerdictStepOperations['nudgeDaemon'],
    now: () => NOW_MS,
    ...overrides,
  }
}

function probeOperations(
  overrides: Partial<PostVerdictStepOperations> = {},
): Pick<PostVerdictStepOperations, 'readWriterLease' | 'deriveWriterLeaseFreshness' | 'now'> {
  const stub = stubOperations(overrides)
  return {
    readWriterLease: stub.readWriterLease as PostVerdictStepOperations['readWriterLease'],
    deriveWriterLeaseFreshness:
      stub.deriveWriterLeaseFreshness as PostVerdictStepOperations['deriveWriterLeaseFreshness'],
    now: stub.now as PostVerdictStepOperations['now'],
  }
}

/** A box that already holds an authority nobody claimed — what the backstop exists for. */
function boxHolding(authority: CurationWriterAuthority): PostVerdictHandoff {
  let held: CurationWriterAuthority | undefined = authority
  const take = (): CurationWriterAuthority | undefined => {
    const value = held
    held = undefined
    return value
  }
  return { outcome: undefined, takeAcquiredLease: take, takeUnclaimedLease: take }
}

describe('probeWriterLease — the decision read, total over the four read kinds and MUTATING NOTHING', () => {
  it('a fresh current-epoch holder ⇒ held', () => {
    const operations = probeOperations({
      readWriterLease: vi.fn(() => PARSED_LEASE) as unknown as PostVerdictStepOperations['readWriterLease'],
    })
    expect(probeWriterLease({ knowledgeRoot: KNOWLEDGE_ROOT, operations })).toEqual({ kind: 'held' })
    expect(
      operations.deriveWriterLeaseFreshness,
      'the freshness verdict decides, never the lease bytes alone (CR-01/CR-08)',
    ).toHaveBeenCalledWith(KNOWLEDGE_ROOT, PARSED_LEASE.kind === 'parsed' ? PARSED_LEASE.lease : undefined, NOW_MS)
  })

  it('a reclaimable holder ⇒ free — a stale or superseded lease holds nothing up', () => {
    const operations = probeOperations({
      readWriterLease: vi.fn(() => PARSED_LEASE) as unknown as PostVerdictStepOperations['readWriterLease'],
      deriveWriterLeaseFreshness: vi.fn(() => ({
        kind: 'reclaimable',
      })) as unknown as PostVerdictStepOperations['deriveWriterLeaseFreshness'],
    })
    expect(probeWriterLease({ knowledgeRoot: KNOWLEDGE_ROOT, operations })).toEqual({ kind: 'free' })
  })

  it('an UNKNOWN freshness verdict ⇒ refused, never free — an unreadable epoch is not evidence nobody holds it', () => {
    const operations = probeOperations({
      readWriterLease: vi.fn(() => PARSED_LEASE) as unknown as PostVerdictStepOperations['readWriterLease'],
      deriveWriterLeaseFreshness: vi.fn(() => ({
        kind: 'unknown',
        error: new Error('epoch unreadable'),
      })) as unknown as PostVerdictStepOperations['deriveWriterLeaseFreshness'],
    })
    expect(probeWriterLease({ knowledgeRoot: KNOWLEDGE_ROOT, operations })).toEqual({
      kind: 'refused',
      reason: 'corrupt-epoch-state',
    })
  })

  it('absent and malformed ⇒ free; UNREADABLE ⇒ refused CARRYING THE ERRNO', () => {
    for (const kind of ['absent', 'malformed'] as const) {
      const operations = probeOperations({
        readWriterLease: vi.fn(() => ({ kind })) as unknown as PostVerdictStepOperations['readWriterLease'],
      })
      expect(
        probeWriterLease({ knowledgeRoot: KNOWLEDGE_ROOT, operations }),
        `${kind} is genuine recovery input — an acquisition would reclaim`,
      ).toEqual({ kind: 'free' })
    }
    const unreadable = probeOperations({
      readWriterLease: vi.fn(() => ({
        kind: 'unreadable',
        code: 'EACCES',
      })) as unknown as PostVerdictStepOperations['readWriterLease'],
    })
    const outcome = probeWriterLease({ knowledgeRoot: KNOWLEDGE_ROOT, operations: unreadable })
    expect(outcome.kind, 'a lease that EXISTS and cannot be opened is not a free lease').toBe('refused')
    expect(outcome.kind === 'refused' ? outcome.reason : '').toContain('EACCES')
  })
})

describe('dispositionOf — total over the lease probe domain (404 D-09/D-11)', () => {
  it('held ⇒ handedOff, with nothing to warn about', () => {
    expect(
      dispositionOf({ probe: { kind: 'held' }, leaseSkipped: false }),
      'a current-epoch holder exists, so somebody else will pump',
    ).toEqual({ disposition: 'handedOff' })
  })

  it('free ⇒ drained, with nothing to warn about', () => {
    expect(
      dispositionOf({ probe: { kind: 'free' }, leaseSkipped: false }),
      'nobody holds it, so this process is the one that will take it and pump',
    ).toEqual({ disposition: 'drained' })
  })

  it('refused ⇒ detached plus writer-lease-refused CARRYING THE REFUSAL\'S OWN REASON', () => {
    const outcome = dispositionOf({
      probe: { kind: 'refused', reason: 'corrupt-epoch-state' },
      leaseSkipped: false,
    })
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
      dispositionOf({ probe: { kind: 'free' }, leaseSkipped: true }),
      'the skip wins: a lease that was never meant to be consulted cannot promise a drain',
    ).toEqual({ disposition: 'detached' })
  })

  it('no probe at all and not skipped ⇒ detached plus post-processing-unbound', () => {
    const outcome = dispositionOf({ leaseSkipped: false })
    expect(outcome.disposition).toBe('detached')
    expect(
      outcome.warning?.code,
      'a host with no lease capability says so by name rather than looking like a refusal',
    ).toBe('post-processing-unbound')
  })
})

describe('createPostVerdictStep — decide without mutating, acquire only for a pump (404 D-10, Pitfall 3)', () => {
  it('a free lease reads drained and ACQUIRES NOTHING until a pump asks', async () => {
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
      operations.readWriterLease,
      'the decision is taken from the non-mutating read',
    ).toHaveBeenCalledWith(KNOWLEDGE_ROOT)
    expect(
      operations.acquireWriterLease,
      'THE regression: deciding the posture must not mint an epoch for a chain nobody asked to pump',
    ).not.toHaveBeenCalled()

    expect(
      step.handoff.takeAcquiredLease(),
      'the pump receives the authority, epoch included — acquired at the moment it asked',
    ).toEqual({ leaseId: 'lease-1', epoch: 7 })
    expect(
      operations.acquireWriterLease,
      'THE one acquisition: a second consult would answer `held` by this very process',
    ).toHaveBeenCalledTimes(1)
    expect(operations.acquireWriterLease).toHaveBeenCalledWith(KNOWLEDGE_ROOT)
    expect(
      step.handoff.takeAcquiredLease(),
      'take-ONCE: two callers each believing they hold the lease is the defect this box prevents',
    ).toBeUndefined()
    expect(
      operations.acquireWriterLease,
      'and the second take acquires nothing either — take-once bounds the acquisition too',
    ).toHaveBeenCalledTimes(1)
    expect(step.handoff.outcome).toEqual({ disposition: 'drained' })
  })

  it('a pump that arrives after a daemon took the lease gets NOTHING, and this process acquires nothing twice', async () => {
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

    expect(await step.port.run({ runId: RUN_ID as never, verdict: 'passed' as never })).toEqual({
      disposition: 'drained',
    })
    expect(
      step.handoff.takeAcquiredLease(),
      'the race is lost honestly: nothing was acquired, so nothing is handed over and the tail\'s own consult decides',
    ).toBeUndefined()
    expect(operations.acquireWriterLease).toHaveBeenCalledTimes(1)
  })

  it('a held lease reads handedOff, nudges the holder once, and hands NOTHING to the pump', async () => {
    const operations = stubOperations({
      readWriterLease: vi.fn(() => PARSED_LEASE) as unknown as PostVerdictStepOperations['readWriterLease'],
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
    expect(operations.readWriterLease, 'still exactly one consult').toHaveBeenCalledTimes(1)
    expect(
      operations.acquireWriterLease,
      'a holder exists — taking the lease from underneath it is the Pitfall 3 defect',
    ).not.toHaveBeenCalled()
    expect(operations.nudgeDaemon, 'the holder is woken exactly once').toHaveBeenCalledTimes(1)
    expect(operations.nudgeDaemon).toHaveBeenCalledWith(AGENT_QA_ROOT, {
      knowledgeRoot: KNOWLEDGE_ROOT,
    })
    expect(
      step.handoff.takeAcquiredLease(),
      'this process acquired nothing, so it hands the pump nothing',
    ).toBeUndefined()
    expect(
      operations.acquireWriterLease,
      'and the pump asking does not change that: the step planned no acquisition',
    ).not.toHaveBeenCalled()
  })

  it('a refused probe is a WARNING, never a throw — the shell\'s own degrade path stays reserved for real faults', async () => {
    const operations = stubOperations({
      readWriterLease: vi.fn(() => ({
        kind: 'unreadable',
        code: 'EACCES',
      })) as unknown as PostVerdictStepOperations['readWriterLease'],
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
    expect(
      operations.acquireWriterLease,
      'a detached posture promises no pump, so no pump acquires',
    ).not.toHaveBeenCalled()
    expect(step.handoff.takeAcquiredLease()).toBeUndefined()
  })

  it('an UNEXPECTED throw from the capability propagates, so the shell degrade path is reachable', async () => {
    const operations = stubOperations({
      readWriterLease: vi.fn(() => {
        throw new Error('EACCES')
      }) as unknown as PostVerdictStepOperations['readWriterLease'],
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

  it('an acquisition that is REFUSED at pump time hands back nothing rather than a half-authority', async () => {
    const operations = stubOperations({
      acquireWriterLease: vi.fn(() => refusedAcquisition()) as unknown as PostVerdictStepOperations['acquireWriterLease'],
    })
    const step = createPostVerdictStep({
      runId: RUN_ID,
      agentQaRoot: AGENT_QA_ROOT,
      knowledgeRoot: KNOWLEDGE_ROOT,
      log: { warn: vi.fn() },
      operations,
    })

    await step.port.run({ runId: RUN_ID as never, verdict: 'passed' as never })
    expect(step.handoff.takeAcquiredLease()).toBeUndefined()
  })
})

describe('releaseUntakenPostVerdictLease — the no-leak rule for a door with no tail', () => {
  it('releases a lease nobody took and warns by name', () => {
    const releaseLease = vi.fn(() => ({ kind: 'released' }))
    const warn = vi.fn()
    const handoff = boxHolding({ leaseId: 'lease-1', epoch: 7 })

    releaseUntakenPostVerdictLease({
      handoff,
      knowledgeRoot: KNOWLEDGE_ROOT,
      runId: RUN_ID,
      log: { warn },
      operations: { releaseLease: releaseLease as unknown as PostVerdictStepOperations['releaseLease'] },
    })

    expect(releaseLease).toHaveBeenCalledWith({
      knowledgeRoot: KNOWLEDGE_ROOT,
      leaseId: 'lease-1',
    })
    expect(warn.mock.calls[0][0], 'the fact is named, not silently absorbed').toContain(
      'released untaken',
    )
    expect(
      handoff.takeAcquiredLease(),
      'the box is empty afterwards — the release consumed the take',
    ).toBeUndefined()
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

  it('IS SILENT on the ordinary run that never reached a pump — nothing acquired, nothing released, nothing said', () => {
    const operations = stubOperations()
    const step = createPostVerdictStep({
      runId: RUN_ID,
      agentQaRoot: AGENT_QA_ROOT,
      knowledgeRoot: KNOWLEDGE_ROOT,
      log: { warn: vi.fn() },
      operations,
    })
    const warn = vi.fn()

    // The framework-error shape: the shell ran the step, the drive re-threw above `afterVerdict`,
    // and the outermost `finally` is the next thing that happens. This is what put
    // `post-run lease released untaken` on the stderr of ordinary runs.
    return step.port.run({ runId: RUN_ID as never, verdict: 'failed' as never }).then(() => {
      releaseUntakenPostVerdictLease({
        handoff: step.handoff,
        knowledgeRoot: KNOWLEDGE_ROOT,
        runId: RUN_ID,
        log: { warn },
        operations: { releaseLease: operations.releaseLease },
      })
      expect(
        operations.acquireWriterLease,
        'the backstop must never be what acquires the lease it releases',
      ).not.toHaveBeenCalled()
      expect(operations.releaseLease).not.toHaveBeenCalled()
      expect(warn, 'an ordinary run has nothing to say about a lease it never took').not.toHaveBeenCalled()
    })
  })
})
