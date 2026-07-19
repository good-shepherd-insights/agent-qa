import { describe, expect, it, vi } from 'vitest'

import {
  createVersionGuard,
  VersionGuardError,
} from '../create-version-guard'
import {
  guardCompletedRunHandoff,
  HandoffVersionError,
} from '../../handoff/load-completed-run-handoff'
import type { CompletedRunHandoff } from '../../handoff/completed-run-handoff'
import type { PerTestOutcome } from '../../handoff/per-test-outcome'
import type { StepEvidence } from '../../handoff/step-evidence'

interface TestDocument {
  schemaVersion: number
  value: string
}

class CustomVersionError extends Error {
  readonly foundVersion: number
  readonly supportedVersion: number

  constructor(found: number, supported: number) {
    super(`custom ${found}/${supported}`)
    this.name = 'CustomVersionError'
    this.foundVersion = found
    this.supportedVersion = supported
  }
}

function makeCompleteHandoff(): CompletedRunHandoff {
  return {
    schemaVersion: 3,
    runId: 'run-complete' as CompletedRunHandoff['runId'],
    scope: { tier: 'product', key: 'shop-web' },
    buildOrdinal: 42,
    executionContext: 'ci',
    aggregateVerdict: 'passed',
    configDigests: {
      suiteConfigDigest: 'suite-digest',
      testConfigDigest: 'test-digest',
    },
    startedAt: 100,
    endedAt: 200,
    tests: [{
      testId: 'checkout-happy-1',
      testName: 'checkout happy path',
      filePath: 'suite/checkout.test.ts',
      testIndex: 0,
      outcome: 'passed',
      steps: [{
        stepIndex: 0,
        stepText: 'Click checkout',
        cacheStatus: 'miss',
        servedBrief: {
          scope: { tier: 'product', key: 'shop-web' },
          asOfBuild: 42,
          budget: 128,
          truncation: 'none',
          channel1: [],
          channel2: [],
          channel3: [],
          briefDigest: 'brief-digest',
        },
        subActions: [],
        verifierVerdict: { pass: true, reasoning: 'Observed checkout' },
      }],
    }],
  }
}

function mutateCompleteHandoff(
  mutate: (handoff: CompletedRunHandoff) => void,
): CompletedRunHandoff {
  const handoff = structuredClone(makeCompleteHandoff())
  mutate(handoff)
  return handoff
}

function omitHandoffField(field: keyof CompletedRunHandoff): CompletedRunHandoff {
  return mutateCompleteHandoff((handoff) => {
    delete (handoff as Partial<CompletedRunHandoff>)[field]
  })
}

function omitTestField(field: keyof PerTestOutcome): CompletedRunHandoff {
  return mutateCompleteHandoff((handoff) => {
    delete (handoff.tests[0] as Partial<PerTestOutcome>)[field]
  })
}

function omitStepField(field: keyof StepEvidence): CompletedRunHandoff {
  return mutateCompleteHandoff((handoff) => {
    delete (handoff.tests[0]!.steps[0] as Partial<StepEvidence>)[field]
  })
}

describe('createVersionGuard (D-13)', () => {
  it.each([null, undefined, 'document', 1])(
    'rejects non-object input %j with a document-naming TypeError',
    (value) => {
      const guard = createVersionGuard<TestDocument>({
        name: 'Doc',
        current: 2,
        migrations: {},
      })

      expect(() => guard(value)).toThrowError(TypeError)
      expect(() => guard(value)).toThrow('Doc must be an object')
    },
  )

  it.each([
    {},
    { schemaVersion: '1' },
    { schemaVersion: Number.NaN },
    { schemaVersion: Number.POSITIVE_INFINITY },
  ])('requires a finite numeric schemaVersion for %j', (value) => {
    const guard = createVersionGuard<TestDocument>({
      name: 'Doc',
      current: 2,
      migrations: {},
    })

    expect(() => guard(value)).toThrowError(TypeError)
    expect(() => guard(value)).toThrow('Doc requires a numeric schemaVersion')
  })

  it('rejects newer documents with a typed VersionGuardError', () => {
    const guard = createVersionGuard<TestDocument>({
      name: 'Doc',
      current: 2,
      migrations: {},
    })

    let thrown: unknown
    try {
      guard({ schemaVersion: 3, value: 'future' })
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(VersionGuardError)
    const error = thrown as VersionGuardError
    expect(error.name).toBe('VersionGuardError')
    expect(error.message).toBe(
      'Doc schemaVersion 3 is not supported (this build supports 2)',
    )
    expect(error.documentName).toBe('Doc')
    expect(error.foundVersion).toBe(3)
    expect(error.supportedVersion).toBe(2)
  })

  it('walks a registered migration and passes it the original document', () => {
    const original = { schemaVersion: 1, value: 'before' }
    const migrated: TestDocument = { schemaVersion: 2, value: 'after' }
    const migration = vi.fn(() => migrated)
    const guard = createVersionGuard<TestDocument>({
      name: 'Doc',
      current: 2,
      migrations: { 1: migration },
    })

    expect(guard(original)).toBe(migrated)
    expect(migration).toHaveBeenCalledOnce()
    expect(migration).toHaveBeenCalledWith(original)
  })

  it('rejects an older document when a migration step is missing', () => {
    const guard = createVersionGuard<TestDocument>({
      name: 'Doc',
      current: 2,
      migrations: {},
    })

    expect(() => guard({ schemaVersion: 1, value: 'old' })).toThrowError(
      VersionGuardError,
    )

    try {
      guard({ schemaVersion: 1, value: 'old' })
    } catch (error) {
      expect(error).toMatchObject({
        documentName: 'Doc',
        foundVersion: 1,
        supportedVersion: 2,
      })
    }
  })

  it('casts a current-version document through unchanged', () => {
    const current: TestDocument = { schemaVersion: 2, value: 'current' }
    const guard = createVersionGuard<TestDocument>({
      name: 'Doc',
      current: 2,
      migrations: {},
    })

    expect(guard(current)).toBe(current)
  })

  it('rejects a current-version document that fails structural validation', () => {
    const guard = createVersionGuard<TestDocument>({
      name: 'Doc',
      current: 2,
      migrations: {},
      shape: () => false,
    })

    expect(() => guard({ schemaVersion: 2, value: 'invalid' })).toThrowError(TypeError)
    expect(() => guard({ schemaVersion: 2, value: 'invalid' })).toThrow(
      'Doc failed structural validation',
    )
  })

  it('returns a current-version document that passes structural validation', () => {
    const current: TestDocument = { schemaVersion: 2, value: 'current' }
    const shape = vi.fn(() => true)
    const guard = createVersionGuard<TestDocument>({
      name: 'Doc',
      current: 2,
      migrations: {},
      shape,
    })

    expect(guard(current)).toBe(current)
    expect(shape).toHaveBeenCalledOnce()
    expect(shape).toHaveBeenCalledWith(current)
  })

  it('runs structural validation after the migration walk', () => {
    const migrated: TestDocument = { schemaVersion: 2, value: 'after' }
    const shape = vi.fn((value: unknown) => value === migrated)
    const guard = createVersionGuard<TestDocument>({
      name: 'Doc',
      current: 2,
      migrations: { 1: () => migrated },
      shape,
    })

    expect(guard({ schemaVersion: 1, value: 'before' })).toBe(migrated)
    expect(shape).toHaveBeenCalledOnce()
    expect(shape).toHaveBeenCalledWith(migrated)
  })

  it('uses the configured error constructor for version failures', () => {
    const guard = createVersionGuard<TestDocument>({
      name: 'Doc',
      current: 2,
      migrations: {},
      error: CustomVersionError,
    })

    expect(() => guard({ schemaVersion: 3, value: 'future' })).toThrowError(
      CustomVersionError,
    )
    expect(() => guard({ schemaVersion: 1, value: 'old' })).toThrowError(
      CustomVersionError,
    )
  })
})

describe('guardCompletedRunHandoff factory instance compatibility', () => {
  it('preserves the HandoffVersionError name, message, and version fields', () => {
    let thrown: unknown
    try {
      guardCompletedRunHandoff({ schemaVersion: 4 })
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(HandoffVersionError)
    expect(thrown).toBeInstanceOf(VersionGuardError)
    expect(thrown).toMatchObject({
      name: 'HandoffVersionError',
      message:
        'CompletedRunHandoff schemaVersion 4 is not supported (this build supports 3)',
      foundVersion: 4,
      supportedVersion: 3,
    })
  })

  const invalidHandoffs: Array<[string, unknown]> = [
    ['missing every root field after schemaVersion', { schemaVersion: 3 }],
    ['missing required root fields around an empty tests array', { schemaVersion: 3, tests: [] }],
    [
      'missing required root and member fields around an empty steps array',
      { schemaVersion: 3, tests: [{ steps: [] }] },
    ],
    ['non-array tests', { schemaVersion: 3, tests: {} }],
    ['null test member', { schemaVersion: 3, tests: [null] }],
    ['test member missing steps', { schemaVersion: 3, tests: [{}] }],
    ['non-array steps', { schemaVersion: 3, tests: [{ steps: {} }] }],
    ['null step member', { schemaVersion: 3, tests: [{ steps: [null] }] }],
    ['missing runId', omitHandoffField('runId')],
    ['missing scope', omitHandoffField('scope')],
    [
      'scope tier outside the union',
      mutateCompleteHandoff((handoff) => {
        handoff.scope.tier = 'workspace' as CompletedRunHandoff['scope']['tier']
      }),
    ],
    [
      'empty scope key',
      mutateCompleteHandoff((handoff) => {
        handoff.scope.key = ''
      }),
    ],
    ['missing buildOrdinal', omitHandoffField('buildOrdinal')],
    [
      'excludedFromOutcomes other than literal true',
      mutateCompleteHandoff((handoff) => {
        handoff.excludedFromOutcomes = false as unknown as true
      }),
    ],
    ['missing executionContext', omitHandoffField('executionContext')],
    [
      'executionContext outside the union',
      mutateCompleteHandoff((handoff) => {
        handoff.executionContext = 'laptop' as CompletedRunHandoff['executionContext']
      }),
    ],
    ['missing aggregateVerdict', omitHandoffField('aggregateVerdict')],
    [
      'aggregateVerdict outside the union',
      mutateCompleteHandoff((handoff) => {
        handoff.aggregateVerdict = 'skipped' as CompletedRunHandoff['aggregateVerdict']
      }),
    ],
    ['missing configDigests', omitHandoffField('configDigests')],
    [
      'non-string suiteConfigDigest',
      mutateCompleteHandoff((handoff) => {
        handoff.configDigests.suiteConfigDigest = 42 as unknown as string
      }),
    ],
    [
      'missing testConfigDigest',
      mutateCompleteHandoff((handoff) => {
        delete (handoff.configDigests as Partial<CompletedRunHandoff['configDigests']>)
          .testConfigDigest
      }),
    ],
    ['missing startedAt', omitHandoffField('startedAt')],
    ['missing endedAt', omitHandoffField('endedAt')],
    ['missing testId', omitTestField('testId')],
    ['missing testName', omitTestField('testName')],
    [
      'empty testName',
      mutateCompleteHandoff((handoff) => {
        handoff.tests[0]!.testName = ''
      }),
    ],
    ['missing filePath', omitTestField('filePath')],
    [
      'empty filePath',
      mutateCompleteHandoff((handoff) => {
        handoff.tests[0]!.filePath = ''
      }),
    ],
    ['missing testIndex', omitTestField('testIndex')],
    [
      'outcome outside the union',
      mutateCompleteHandoff((handoff) => {
        handoff.tests[0]!.outcome = 'exploded' as PerTestOutcome['outcome']
      }),
    ],
    ['missing steps', omitTestField('steps')],
    [
      'null rootCause',
      mutateCompleteHandoff((handoff) => {
        handoff.tests[0]!.rootCause = null as unknown as NonNullable<PerTestOutcome['rootCause']>
      }),
    ],
    ['step missing stepIndex', omitStepField('stepIndex')],
    ['step missing stepText', omitStepField('stepText')],
    ['step missing cacheStatus', omitStepField('cacheStatus')],
    [
      'cacheStatus outside the union',
      mutateCompleteHandoff((handoff) => {
        handoff.tests[0]!.steps[0]!.cacheStatus = 'stale' as StepEvidence['cacheStatus']
      }),
    ],
    ['step missing servedBrief', omitStepField('servedBrief')],
    [
      'servedBrief missing channel1',
      mutateCompleteHandoff((handoff) => {
        delete (handoff.tests[0]!.steps[0]!.servedBrief as Partial<StepEvidence['servedBrief']>)
          .channel1
      }),
    ],
    ['step missing subActions', omitStepField('subActions')],
    ['step missing verifierVerdict', omitStepField('verifierVerdict')],
    [
      'verifierVerdict pass is not boolean',
      mutateCompleteHandoff((handoff) => {
        handoff.tests[0]!.steps[0]!.verifierVerdict.pass = 'yes' as unknown as boolean
      }),
    ],
    [
      'verifierVerdict reasoning is not a string',
      mutateCompleteHandoff((handoff) => {
        handoff.tests[0]!.steps[0]!.verifierVerdict.reasoning = 42 as unknown as string
      }),
    ],
    [
      'planSource is null',
      mutateCompleteHandoff((handoff) => {
        handoff.tests[0]!.steps[0]!.planSource = null as unknown as NonNullable<StepEvidence['planSource']>
      }),
    ],
  ]

  it.each(invalidHandoffs)('rejects a structurally unsafe current-version handoff: %s', (_label, handoff) => {
    expect(() => guardCompletedRunHandoff(handoff)).toThrowError(TypeError)
    expect(() => guardCompletedRunHandoff(handoff)).toThrow(
      'CompletedRunHandoff failed structural validation',
    )
  })

  const complete = makeCompleteHandoff()
  const emptyTests = mutateCompleteHandoff((handoff) => {
    handoff.tests = []
  })
  const emptySteps = mutateCompleteHandoff((handoff) => {
    handoff.tests[0]!.steps = []
  })

  it.each([
    ['complete DTO', complete],
    ['complete DTO with tests: []', emptyTests],
    ['complete member with steps: []', emptySteps],
  ] as const)('accepts a complete current-version handoff: %s', (_label, handoff) => {
    expect(guardCompletedRunHandoff(handoff)).toBe(handoff)
  })
})
