import { describe, expect, it } from 'vitest'
import type { z } from 'zod'

import {
  RUN_DETAIL_SCHEMA_VERSION,
  RUN_EVENT_ENVELOPE_SCHEMA_VERSION,
  RUN_START_ACKNOWLEDGEMENT_SCHEMA_VERSION,
  RUN_SUMMARY_SCHEMA_VERSION,
  RunDetailSchema,
  RunEventEnvelopeSchema,
  RunStartAcknowledgementSchema,
  RunSummarySchema,
} from '../index'

const scope = { tier: 'suite', key: 'checkout' }

const runSummary = {
  runId: 'run-wire',
  scope,
  buildOrdinal: 4,
  executionContext: 'ci',
  aggregateVerdict: 'passed',
  startedAt: 1_700_000_000_000,
  endedAt: 1_700_000_005_000,
  testCount: 1,
  tests: [{ testIndex: 0, testId: 'checkout-guest', testName: 'Guest checkout' }],
  recordedTargets: { status: 'recorded', names: ['web'] },
}

const runDetail = {
  runId: 'run-wire',
  scope,
  buildOrdinal: 4,
  executionContext: 'ci',
  aggregateVerdict: 'passed',
  configDigests: { suiteConfigDigest: 'suite-d', testConfigDigest: 'test-d' },
  startedAt: 1_700_000_000_000,
  endedAt: 1_700_000_005_000,
  tests: [
    {
      testId: 'checkout-guest',
      testName: 'Guest checkout',
      filePath: 'checkout.spec.yaml',
      testIndex: 0,
      outcome: 'passed',
      stepCount: 2,
    },
  ],
}

const runStartAcknowledgement = {
  runId: 'run-wire',
  scope,
  executionContext: 'ci',
  buildOrdinal: 4,
  startedAt: 1_700_000_000_000,
  testCount: 1,
}

const runEventEnvelope = {
  seq: 1,
  ts: 1_700_000_000_000,
  runId: 'run-wire',
  type: 'runStarted',
  payload: {},
}

// The run outputs spell no stamp on the wire; their version is the constant, and a document that
// carries a stamp of its own is refused by the strict schema.
const unstampedOutputs: ReadonlyArray<readonly [string, number, z.ZodType, Record<string, unknown>]> = [
  ['run summary', RUN_SUMMARY_SCHEMA_VERSION, RunSummarySchema, runSummary],
  ['run detail', RUN_DETAIL_SCHEMA_VERSION, RunDetailSchema, runDetail],
  [
    'run start acknowledgement',
    RUN_START_ACKNOWLEDGEMENT_SCHEMA_VERSION,
    RunStartAcknowledgementSchema,
    runStartAcknowledgement,
  ],
  ['run event envelope', RUN_EVENT_ENVELOPE_SCHEMA_VERSION, RunEventEnvelopeSchema, runEventEnvelope],
]

describe('wire stamps', () => {
  it.each(unstampedOutputs)('the %s version is 2', (_name, version) => {
    expect(version).toBe(2)
  })

  it.each(unstampedOutputs)('a %s parses as its builder produces it', (_name, _version, schema, document) => {
    expect(schema.safeParse(document).success).toBe(true)
  })

  it.each(unstampedOutputs)('a %s stamped 1 is refused', (_name, _version, schema, document) => {
    const result = schema.safeParse({ ...document, schemaVersion: 1 })
    expect(result.success).toBe(false)
    expect(result.error?.issues).toContainEqual(
      expect.objectContaining({ code: 'unrecognized_keys', keys: ['schemaVersion'] }),
    )
  })
})
