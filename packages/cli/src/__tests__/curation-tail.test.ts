import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  HANDOFF_FILE,
  RUNS_SUBDIR,
  slugBranch,
} from '@vostride/agent-qa-runner-local'
import type { KnowledgeHintReader } from '@vostride/agent-qa-runner'
import type {
  AuditSink,
} from '@vostride/agent-qa-safety'
import type {
  CanaryOutcome,
  CompletedRunHandoff,
  GuardrailPolicy,
  MaskingContext,
} from '@vostride/agent-qa-schema'
import { describe, expect, it, vi } from 'vitest'

import {
  runCurationTail,
  runVerdictFirstCurationTail,
  type CurationTailReceipt,
  type RunCurationTailOptions,
} from '../curation/curation-tail.js'

const agentQaRoot = '/workspace/project/.agent-qa'
const configDir = '/workspace/project'
const knowledgeRoot = '/workspace/project/agent-qa-knowledge'
const runId = 'run-curation-tail'
const auditSink = {} as AuditSink
const maskingContext = {} as MaskingContext
const policy = {} as GuardrailPolicy
const modelDeps = {} as RunCurationTailOptions['modelDeps']

function handoff(executionContext: CompletedRunHandoff['executionContext'] = 'ci') {
  return { executionContext, runId } as CompletedRunHandoff
}

function attributableHandoff(): CompletedRunHandoff {
  return {
    executionContext: 'ci',
    runId: 'run-curation-tail',
    buildOrdinal: 42,
    tests: [{
      steps: [{
        stepIndex: 0,
        servedBrief: {
          briefDigest: 'brief-digest-0',
          channel1: [{ id: 'candidate-checkout', servedAsCanary: true }],
        },
        verifierVerdict: { pass: true },
        subActions: [{
          plannedAction: { type: 'click', ref: 'checkout' },
          stateBefore: {
            elements: [{
              ref: 'checkout',
              role: 'button',
              nameNormalized: 'checkout',
            }],
          },
        }],
      }],
    }],
  } as CompletedRunHandoff
}

function baseOptions(
  operations: NonNullable<RunCurationTailOptions['operations']>,
  overrides: Partial<RunCurationTailOptions> = {},
): RunCurationTailOptions {
  return {
    runId,
    agentQaRoot,
    knowledgeConfig: { dir: 'agent-qa-knowledge' },
    configDir,
    auditSink,
    maskingContext,
    modelDeps,
    policy,
    log: { warn: vi.fn() },
    operations,
    ...overrides,
  }
}

function successfulOperations(
  overrides: NonNullable<RunCurationTailOptions['operations']> = {},
): NonNullable<RunCurationTailOptions['operations']> {
  return {
    loadCompletedRunHandoff: () => handoff(),
    resolveKnowledgeRoot: () => knowledgeRoot,
    runSafetyScope: (_bundle, fn) => fn(),
    emitCurationCandidates: vi.fn(() => ({
      enqueued: 0,
      coalesced: 0,
      capExceeded: 0,
      refused: 0,
      details: [],
    })),
    openKnowledgeReader: () => ({ emitCanaryOutcome: vi.fn() }) as unknown as KnowledgeHintReader,
    emitCanaryOutcomes: vi.fn(() => ({ emitted: 0, refused: 0, details: [] })),
    buildCuratorAuthor: () => vi.fn(async () => ({
      kind: 'fallback-required' as const,
      reason: 'no-model' as const,
    })),
    drainQueue: vi.fn(async () => ({
      kind: 'drained' as const,
      jobsProcessed: 0,
      committed: 0,
      downgraded: 0,
      withheld: 0,
      requeued: 0,
      failures: 0,
      failureDetails: [],
      reconcile: undefined,
      writerPass: { kind: 'not-requested' as const },
      gc: { kind: 'not-run' as const },
    })),
    listCompletedRunDirs: () => [
      join(agentQaRoot, RUNS_SUBDIR, slugBranch(runId)),
    ],
    readCurationTailReceipt: () => undefined,
    writeCurationTailReceipt: vi.fn(),
    ...overrides,
  }
}

describe('runCurationTail post-verdict fold (CUR-03/CUR-05)', () => {
  it('loads the handoff, emits candidates and canary outcomes in one scope, then drains', async () => {
    const order: string[] = []
    const controller = new AbortController()
    const ambientExecutionContext = 'local-interactive'
    const completed = attributableHandoff()
    const canaryOutcome: CanaryOutcome = {
      candidateId: 'candidate-checkout' as CanaryOutcome['candidateId'],
      runOutcome: 'positive',
      runId,
      testId: 'checkout::happy-path',
      testIndex: 0,
      buildOrdinal: 42,
      stepIndex: 0,
      briefDigest: 'brief-digest-0',
      attribution: 'candidate-checkout matched checkout on passing step 0',
      exercisedAnchor: { t: 'el', role: 'button', name: 'checkout', ordinal: 0 },
    }
    const author = vi.fn(async () => ({
      kind: 'fallback-required' as const,
      reason: 'no-model' as const,
    }))
    const writeCurationTailReceipt = vi.fn()

    const operations = successfulOperations({
      loadCompletedRunHandoff(file) {
        order.push('handoff')
        expect(file).toBe(
          join(agentQaRoot, RUNS_SUBDIR, slugBranch(runId), HANDOFF_FILE),
        )
        return completed
      },
      resolveKnowledgeRoot(knowledge, seenConfigDir) {
        order.push('knowledge-root')
        expect(knowledge).toEqual({ dir: 'agent-qa-knowledge' })
        expect(seenConfigDir).toBe(configDir)
        return knowledgeRoot
      },
      runSafetyScope(bundle, fn) {
        order.push('scope')
        expect(ambientExecutionContext).not.toBe(completed.executionContext)
        expect(bundle).toEqual({
          maskingContext,
          auditSink,
          executionContext: completed.executionContext,
        })
        return fn()
      },
      emitCurationCandidates(options) {
        order.push('emit')
        expect(options).toMatchObject({
          handoff: completed,
          runDir: join(agentQaRoot, RUNS_SUBDIR, slugBranch(runId)),
          knowledgeRoot,
          policy,
        })
        expect(options.policy).toBe(policy)
        return {
          enqueued: 0,
          coalesced: 0,
          capExceeded: 0,
          refused: 0,
          details: [],
        }
      },
      openKnowledgeReader(config) {
        order.push('reader')
        expect(config).toEqual({ knowledgeRoot })
        return {
          emitCanaryOutcome(outcome: CanaryOutcome) {
            order.push('queue')
            expect(outcome).toEqual(canaryOutcome)
          },
        } as unknown as KnowledgeHintReader
      },
      emitCanaryOutcomes(options) {
        order.push('canary-emit')
        expect(options).toMatchObject({
          handoff: completed,
          runDir: join(agentQaRoot, RUNS_SUBDIR, slugBranch(runId)),
          knowledgeRoot,
        })
        options.emit(canaryOutcome)
        return {
          emitted: 1,
          refused: 0,
          details: [{
            candidateId: canaryOutcome.candidateId,
            testId: canaryOutcome.testId,
            testIndex: canaryOutcome.testIndex,
            stepIndex: 0,
            outcome: { kind: 'emitted' },
          }],
        }
      },
      buildCuratorAuthor(deps) {
        order.push('author')
        expect(deps).toBe(modelDeps)
        return author
      },
      async drainQueue(options) {
        order.push('drain')
        expect(options).toMatchObject({
          knowledgeRoot,
          auditBaseDir: agentQaRoot,
          author,
          executionContext: completed.executionContext,
          policy,
          signal: controller.signal,
        })
        expect(options.policy).toBe(policy)
        return {
          kind: 'drained',
          jobsProcessed: 0,
          committed: 0,
          downgraded: 0,
          withheld: 0,
          requeued: 0,
          failures: 0,
          failureDetails: [],
          reconcile: undefined,
          writerPass: { kind: 'not-requested' },
          gc: { kind: 'not-run' },
        }
      },
      listCompletedRunDirs(root) {
        order.push('list-runs')
        expect(root).toBe(agentQaRoot)
        return [join(agentQaRoot, RUNS_SUBDIR, slugBranch(runId))]
      },
      readCurationTailReceipt(seenRunDir) {
        order.push('read-receipt')
        expect(seenRunDir).toBe(join(agentQaRoot, RUNS_SUBDIR, slugBranch(runId)))
        return undefined
      },
      writeCurationTailReceipt(seenRunDir, receipt) {
        order.push('write-receipt')
        writeCurationTailReceipt(seenRunDir, receipt)
      },
    })

    await expect(
      runCurationTail(baseOptions(operations, { signal: controller.signal })),
    ).resolves.toBeUndefined()

    expect(order).toEqual([
      'handoff',
      'knowledge-root',
      'list-runs',
      'read-receipt',
      'scope',
      'emit',
      'reader',
      'canary-emit',
      'queue',
      'author',
      'drain',
      'write-receipt',
    ])
    expect(writeCurationTailReceipt).toHaveBeenCalledWith(
      join(agentQaRoot, RUNS_SUBDIR, slugBranch(runId)),
      expect.objectContaining({
        schemaVersion: 1,
        runId,
        handoffDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
      }),
    )
  })

  it.each(['emit', 'canary-emit', 'drain'] as const)(
    'swallows a %s failure and warns that incomplete curation resumes on the next run',
    async (failureStage) => {
      const warn = vi.fn()
      const operations = successfulOperations({
        emitCurationCandidates() {
          if (failureStage === 'emit') throw new Error('emit failed')
          return {
            enqueued: 0,
            coalesced: 0,
            capExceeded: 0,
            refused: 0,
            details: [],
          }
        },
        emitCanaryOutcomes() {
          if (failureStage === 'canary-emit') throw new Error('canary emit failed')
          return { emitted: 0, refused: 0, details: [] }
        },
        async drainQueue() {
          if (failureStage === 'drain') throw new Error('drain failed')
          return {
            kind: 'drained',
            jobsProcessed: 0,
            committed: 0,
            downgraded: 0,
            withheld: 0,
            requeued: 0,
            failures: 0,
            failureDetails: [],
            reconcile: undefined,
            writerPass: { kind: 'not-requested' },
            gc: { kind: 'not-run' },
          }
        },
      })

      await expect(
        runCurationTail(baseOptions(operations, { log: { warn } })),
      ).resolves.toBeUndefined()
      expect(warn).toHaveBeenCalledOnce()
      expect(warn.mock.calls[0]?.[0]).toMatch(/curation incomplete/i)
      expect(warn.mock.calls[0]?.[0]).toMatch(/next run/i)
    },
  )

  it.each([
    'candidate-refused',
    'candidate-cap-exceeded',
    'canary-refused',
    'drain-failure',
    'drain-requeued',
    'drain-aborted',
  ] as const)('withholds the durable receipt for a structured %s result', async (condition) => {
    const warn = vi.fn()
    const writeCurationTailReceipt = vi.fn()
    const operations = successfulOperations({
      writeCurationTailReceipt,
      emitCurationCandidates() {
        return {
          enqueued: 0,
          coalesced: 0,
          capExceeded: condition === 'candidate-cap-exceeded' ? 1 : 0,
          refused: condition === 'candidate-refused' ? 1 : 0,
          details: [],
        }
      },
      emitCanaryOutcomes() {
        return {
          emitted: 0,
          refused: condition === 'canary-refused' ? 1 : 0,
          details: [],
        }
      },
      async drainQueue() {
        const aborted = condition === 'drain-aborted'
        return {
          kind: aborted ? 'aborted' as const : 'drained' as const,
          jobsProcessed: 0,
          committed: 0,
          downgraded: 0,
          withheld: 0,
          requeued: condition === 'drain-requeued' ? 1 : 0,
          failures: condition === 'drain-failure' ? 1 : 0,
          failureDetails: [],
          reconcile: undefined,
          writerPass: aborted
            ? { kind: 'skipped' as const, reason: 'aborted' as const }
            : { kind: 'not-requested' as const },
          gc: aborted
            ? { kind: 'skipped' as const, reason: 'aborted' as const }
            : { kind: 'not-run' as const },
        }
      },
    })

    await expect(
      runCurationTail(baseOptions(operations, { log: { warn } })),
    ).resolves.toBeUndefined()

    expect(writeCurationTailReceipt).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/resume on the next run/i))
    const diagnostic = {
      'candidate-refused': 'candidate-refused=1',
      'candidate-cap-exceeded': 'candidate-cap-exceeded=1',
      'canary-refused': 'canary-refused=1',
      'drain-failure': 'drain-failures=1',
      'drain-requeued': 'drain-requeued=1',
      'drain-aborted': 'drain-kind=aborted',
    }[condition]
    expect(warn.mock.calls[0]?.[0]).toContain(diagnostic)
  })

  it('replays a prior failed canary drop once and receipts successful siblings idempotently', async () => {
    const oldRunId = '001-old-run'
    const newRunId = '002-new-run'
    const oldDir = join(agentQaRoot, RUNS_SUBDIR, slugBranch(oldRunId))
    const newDir = join(agentQaRoot, RUNS_SUBDIR, slugBranch(newRunId))
    const oldHandoff = { executionContext: 'ci', runId: oldRunId } as CompletedRunHandoff
    const newHandoff = { executionContext: 'ci', runId: newRunId } as CompletedRunHandoff
    const handoffs = new Map([
      [join(oldDir, HANDOFF_FILE), oldHandoff],
      [join(newDir, HANDOFF_FILE), newHandoff],
    ])
    const receipts = new Map<string, CurationTailReceipt>()
    const durableOutcomes = new Set<string>()
    const canaryRuns: string[] = []
    let successfulSiblingAttempts = 0
    let completedRunDirs = [oldDir]
    let oldAttempts = 0
    const warn = vi.fn()
    const drainQueue = vi.fn(successfulOperations().drainQueue)
    const operations = successfulOperations({
      loadCompletedRunHandoff(file) {
        const loaded = handoffs.get(file)
        if (loaded === undefined) throw new Error(`missing handoff ${file}`)
        return loaded
      },
      listCompletedRunDirs: () => completedRunDirs,
      readCurationTailReceipt: (seenRunDir) => receipts.get(seenRunDir),
      writeCurationTailReceipt(seenRunDir, receipt) {
        receipts.set(seenRunDir, receipt)
      },
      emitCanaryOutcomes({ handoff: completed }) {
        const completedRunId = String(completed.runId)
        canaryRuns.push(completedRunId)
        if (completedRunId === oldRunId) {
          oldAttempts += 1
          successfulSiblingAttempts += 1
          durableOutcomes.add('old-successful-sibling')
          if (oldAttempts === 1) {
            return {
              emitted: 1,
              refused: 1,
              details: [],
            }
          }
          durableOutcomes.add('old-retried-outcome')
          return { emitted: 2, refused: 0, details: [] }
        }
        durableOutcomes.add('new-outcome')
        return { emitted: 1, refused: 0, details: [] }
      },
      drainQueue,
    })

    await runCurationTail(baseOptions(operations, {
      runId: oldRunId,
      log: { warn },
    }))
    expect(receipts.has(oldDir)).toBe(false)
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/resume on the next run/i))

    completedRunDirs = [oldDir, newDir]
    await runCurationTail(baseOptions(operations, {
      runId: newRunId,
      log: { warn },
    }))

    expect(receipts.has(oldDir)).toBe(true)
    expect(receipts.has(newDir)).toBe(true)
    expect(canaryRuns).toEqual([oldRunId, oldRunId, newRunId])
    expect(successfulSiblingAttempts).toBe(2)
    expect([...durableOutcomes].sort()).toEqual([
      'new-outcome',
      'old-retried-outcome',
      'old-successful-sibling',
    ])
    expect(drainQueue).toHaveBeenCalledTimes(3)

    await runCurationTail(baseOptions(operations, {
      runId: newRunId,
      log: { warn },
    }))
    expect(canaryRuns).toEqual([oldRunId, oldRunId, newRunId])
    expect(drainQueue).toHaveBeenCalledTimes(3)
  })

  it.each(['missing', 'malformed'] as const)(
    'treats a %s handoff as a logged skip without emitting or draining',
    async (condition) => {
      const warn = vi.fn()
      const emitCurationCandidates = vi.fn()
      const openKnowledgeReader = vi.fn()
      const emitCanaryOutcomes = vi.fn()
      const drainQueue = vi.fn()
      const operations = successfulOperations({
        loadCompletedRunHandoff() {
          throw new Error(`${condition} handoff`)
        },
        emitCurationCandidates,
        openKnowledgeReader,
        emitCanaryOutcomes,
        drainQueue,
      })

      await expect(
        runCurationTail(baseOptions(operations, { log: { warn } })),
      ).resolves.toBeUndefined()
      expect(warn).toHaveBeenCalledOnce()
      expect(warn.mock.calls[0]?.[0]).toMatch(/skip/i)
      expect(warn.mock.calls[0]?.[0]).toMatch(/handoff/i)
      expect(emitCurationCandidates).not.toHaveBeenCalled()
      expect(openKnowledgeReader).not.toHaveBeenCalled()
      expect(emitCanaryOutcomes).not.toHaveBeenCalled()
      expect(drainQueue).not.toHaveBeenCalled()
    },
  )
})

describe('verdict-first CLI tail wiring (CUR-03)', () => {
  it('returns the fixed verdict exit code even when the defensive tail boundary catches a throw', async () => {
    const unexpected = new Error('tail contract was violated')
    const onUnexpectedError = vi.fn()

    await expect(
      runVerdictFirstCurationTail({
        exitCode: 1,
        detach: false,
        runTail: vi.fn(async () => {
          throw unexpected
        }),
        onUnexpectedError,
      }),
    ).resolves.toBe(1)
    expect(onUnexpectedError).toHaveBeenCalledWith(unexpected)
  })

  it('skips the complete tail under --detach and preserves the verdict code', async () => {
    const runTail = vi.fn()

    await expect(
      runVerdictFirstCurationTail({
        exitCode: 130,
        detach: true,
        runTail,
      }),
    ).resolves.toBe(130)
    expect(runTail).not.toHaveBeenCalled()
  })

  it('keeps the reported verdict when the process signal aborts the drain at its boundary', async () => {
    const controller = new AbortController()
    const drainQueue = vi.fn(async (options) => {
      controller.abort()
      expect(options.signal).toBe(controller.signal)
      expect(options.signal?.aborted).toBe(true)
      return {
        kind: 'aborted' as const,
        jobsProcessed: 0,
        committed: 0,
        downgraded: 0,
        withheld: 0,
        requeued: 0,
        failures: 0,
        failureDetails: [],
        reconcile: undefined,
        writerPass: { kind: 'skipped' as const, reason: 'aborted' as const },
        gc: { kind: 'skipped' as const, reason: 'aborted' as const },
      }
    })
    const operations = successfulOperations({ drainQueue })

    await expect(
      runVerdictFirstCurationTail({
        exitCode: 0,
        detach: false,
        runTail: () =>
          runCurationTail(
            baseOptions(operations, { signal: controller.signal }),
          ),
      }),
    ).resolves.toBe(0)
    expect(drainQueue).toHaveBeenCalledOnce()
  })

  it('registers --detach and invokes the shared tail at both run verdict sites', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../commands/run.ts', import.meta.url)),
      'utf8',
    )

    expect(source).toContain(
      ".option('--detach', 'skip the post-verdict knowledge curation tail')",
    )
    expect(source.match(/runCurationTail\(/g)).toHaveLength(2)
  })
})
