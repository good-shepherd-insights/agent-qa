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
  return { executionContext } as CompletedRunHandoff
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
    emitCurationCandidates: vi.fn(),
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
    })

    await expect(
      runCurationTail(baseOptions(operations, { signal: controller.signal })),
    ).resolves.toBeUndefined()

    expect(order).toEqual([
      'handoff',
      'knowledge-root',
      'scope',
      'emit',
      'reader',
      'canary-emit',
      'queue',
      'author',
      'drain',
    ])
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
