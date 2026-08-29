// `canaryAttributionsFor` — what became of the canary lines a run served (Phase 407, D-08).
//
// The join is between two things a run cannot hold at once: the SERVE-time marker, which is a
// fact about the run and lives in its evidence, and the ATTRIBUTED outcome, which is a fact about
// the committed knowledge store and lives in a bundle's outcomes log. The observation id is the
// only thing that spans them, and it is recomputed here from the run's own tuples rather than
// read from anywhere — which is what makes an answer here evidence rather than a claim.
//
// Every cell below reads COMMITTED bytes. Nothing in this file mints, appends or retracts an
// outcome event to make an assertion true: the write path stays behind the writer lease, and a
// read that could write would be the T-407-11 tampering hazard rather than its mitigation.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  BundleOutcomeEventSchema,
  asRecordId,
} from '@vostride/agent-qa-schema'
import type { BundleOutcomeEvent, RecordId } from '@vostride/agent-qa-schema'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { publishBundle } from '../bundle-publish.test-helper.js'
import type { BundleStoreConfig } from '../bundle-publish.test-helper.js'
import { canaryAttributionsFor } from '../serving/canary-attribution.js'
import { canaryOutcomeObservationId } from '../serving/canary-observation-id.js'
import {
  makeBundleDraftFixture,
  makeScreenStateFixture,
} from './fixtures/bundle-fixture.js'

const RUN_ID = 'run-A'
const TEST_ID = 'checkout'

function event(
  value: Parameters<typeof BundleOutcomeEventSchema.parse>[0],
): BundleOutcomeEvent {
  return BundleOutcomeEventSchema.parse(value)
}

describe('canaryAttributionsFor joins served canary tuples to committed outcomes', () => {
  let root: string
  let knowledgeRoot: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'canary-attribution-'))
    knowledgeRoot = join(root, 'agent-qa-knowledge')
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  function config(): BundleStoreConfig {
    return {
      knowledgeRoot,
      productKey: 'shop',
      auditBaseDir: join(root, '.agent-qa'),
      commitArtifacts: 'none',
    }
  }

  function publishCandidate(
    name: string,
    initialEvents: readonly BundleOutcomeEvent[],
  ): RecordId {
    const outcome = publishBundle(config(), {
      draft: makeBundleDraftFixture({
        anchors: [{ t: 'el', role: 'Button', name }],
        scope: { tier: 'product', key: name.toLowerCase() },
        summary: `${name} fact`,
      }),
      discriminant: {
        kind: 'fact',
        subtype: 'selector',
        elementRef: { role: 'Button', name },
      },
      originClass: 'agent-verified',
      createdAtOrdinal: 3,
      screenStates: [makeScreenStateFixture()],
      initialEvents: [...initialEvents],
      relations: [],
      provenance: {
        mode: 'run-linked',
        runId: RUN_ID,
        testId: TEST_ID,
        stepIndex: 0,
      },
      artifacts: [],
    })

    expect(outcome.kind).toBe('published')
    if (outcome.kind !== 'published') throw new Error('fixture bundle did not publish')
    return outcome.id
  }

  /** The id the WRITER would have stamped for this served line — recomputed, never read. */
  function observationIdFor(candidateId: RecordId, stepIndex: number): string {
    return canaryOutcomeObservationId({
      candidateId,
      runId: RUN_ID,
      testId: TEST_ID,
      testIndex: 0,
      stepIndex,
    })
  }

  function tupleFor(candidateId: string, stepIndex: number) {
    return { candidateId, testId: TEST_ID, testIndex: 0, stepIndex }
  }

  it('reports the confirming outcome for a line whose observation is committed', () => {
    const candidateId = publishCandidate('Confirmed canary', [])
    const observationId = observationIdFor(candidateId, 2)
    // Republished with the event, so the observation id is known before the bundle is written —
    // exactly the order the writer works in.
    rmSync(knowledgeRoot, { recursive: true, force: true })
    const republished = publishCandidate('Confirmed canary', [
      event({
        type: 'confirmed',
        evidenceToken: 'confirmed-canary',
        curationJobId: observationId,
        buildOrdinal: 5,
        observationId,
        origin: 'agent-verified',
      }),
    ])
    expect(republished).toBe(candidateId)

    expect(canaryAttributionsFor({
      knowledgeRoot,
      runId: RUN_ID,
      tuples: [tupleFor(candidateId, 2)],
    })).toEqual([
      {
        candidateId,
        testIndex: 0,
        stepIndex: 2,
        observationId,
        outcome: 'confirmed',
      },
    ])
  })

  it('reports a contradicting outcome the same way — the fold reads the event TYPE', () => {
    const probe = publishCandidate('Contradicted canary', [])
    const observationId = observationIdFor(probe, 4)
    rmSync(knowledgeRoot, { recursive: true, force: true })
    const candidateId = publishCandidate('Contradicted canary', [
      event({
        type: 'contradicted',
        evidenceToken: 'contradicted-canary',
        curationJobId: observationId,
        buildOrdinal: 5,
        observationId,
        origin: 'agent-verified',
      }),
    ])

    expect(canaryAttributionsFor({
      knowledgeRoot,
      runId: RUN_ID,
      tuples: [tupleFor(candidateId, 4)],
    })).toEqual([
      {
        candidateId,
        testIndex: 0,
        stepIndex: 4,
        observationId,
        outcome: 'contradicted',
      },
    ])
  })

  it('a RETRACTED observation carries no outcome key — the surviving-events fold decides', () => {
    const probe = publishCandidate('Retracted canary', [])
    const observationId = observationIdFor(probe, 1)
    rmSync(knowledgeRoot, { recursive: true, force: true })
    const candidateId = publishCandidate('Retracted canary', [
      event({
        type: 'confirmed',
        evidenceToken: 'retracted-canary',
        curationJobId: observationId,
        buildOrdinal: 5,
        observationId,
        origin: 'agent-verified',
      }),
      event({
        type: 'retracted',
        evidenceToken: 'rollback-at-6',
        curationJobId: 'rollback-job',
        buildOrdinal: 6,
        retractsEvidenceToken: 'retracted-canary',
        retractsCurationJobId: observationId,
        rollbackReceiptId: 'rollback-receipt-1',
      }),
    ])

    const rows = canaryAttributionsFor({
      knowledgeRoot,
      runId: RUN_ID,
      tuples: [tupleFor(candidateId, 1)],
    })

    expect(rows).toEqual([
      { candidateId, testIndex: 0, stepIndex: 1, observationId },
    ])
    expect(Object.hasOwn(rows[0]!, 'outcome')).toBe(false)
  })

  it('a LIFECYCLE event carrying the same id attributes nothing — only the four words do', () => {
    const probe = publishCandidate('Deprecated canary', [])
    const observationId = observationIdFor(probe, 3)
    rmSync(knowledgeRoot, { recursive: true, force: true })
    const candidateId = publishCandidate('Deprecated canary', [
      event({
        type: 'deprecated',
        evidenceToken: 'deprecated-canary',
        curationJobId: observationId,
        buildOrdinal: 5,
        observationId,
        reason: 'retired by a later run',
      }),
    ])

    const rows = canaryAttributionsFor({
      knowledgeRoot,
      runId: RUN_ID,
      tuples: [tupleFor(candidateId, 3)],
    })

    expect(rows).toEqual([
      { candidateId, testIndex: 0, stepIndex: 3, observationId },
    ])
  })

  it("another run's committed observation is not this run's — the id is run-scoped", () => {
    const probe = publishCandidate('Other run canary', [])
    const otherRunObservationId = canaryOutcomeObservationId({
      candidateId: probe,
      runId: 'run-B',
      testId: TEST_ID,
      testIndex: 0,
      stepIndex: 2,
    })
    rmSync(knowledgeRoot, { recursive: true, force: true })
    const candidateId = publishCandidate('Other run canary', [
      event({
        type: 'confirmed',
        evidenceToken: 'other-run-canary',
        curationJobId: otherRunObservationId,
        buildOrdinal: 5,
        observationId: otherRunObservationId,
        origin: 'agent-verified',
      }),
    ])

    const rows = canaryAttributionsFor({
      knowledgeRoot,
      runId: RUN_ID,
      tuples: [tupleFor(candidateId, 2)],
    })

    expect(rows[0]!.observationId).toBe(observationIdFor(candidateId, 2))
    expect(rows[0]!.observationId).not.toBe(otherRunObservationId)
    expect(Object.hasOwn(rows[0]!, 'outcome')).toBe(false)
  })

  it('a candidate with no bundle on disk answers an unattributed row, never a throw', () => {
    publishCandidate('Present canary', [])
    const missing = asRecordId('fact-el-button-never-committed-0000000000000000')

    expect(canaryAttributionsFor({
      knowledgeRoot,
      runId: RUN_ID,
      tuples: [tupleFor(missing, 7)],
    })).toEqual([
      {
        candidateId: missing,
        testIndex: 0,
        stepIndex: 7,
        observationId: observationIdFor(missing, 7),
      },
    ])
  })

  it('answers one row per tuple, in the order the caller asked, for the same candidate', () => {
    const probe = publishCandidate('Two step canary', [])
    const first = observationIdFor(probe, 0)
    const second = observationIdFor(probe, 1)
    rmSync(knowledgeRoot, { recursive: true, force: true })
    const candidateId = publishCandidate('Two step canary', [
      event({
        type: 'confirmed',
        evidenceToken: 'two-step-first',
        curationJobId: first,
        buildOrdinal: 5,
        observationId: first,
        origin: 'agent-verified',
      }),
      event({
        type: 'harmful',
        evidenceToken: 'two-step-second',
        curationJobId: second,
        buildOrdinal: 6,
        observationId: second,
        origin: 'agent-observed',
      }),
    ])

    expect(canaryAttributionsFor({
      knowledgeRoot,
      runId: RUN_ID,
      tuples: [tupleFor(candidateId, 1), tupleFor(candidateId, 0)],
    })).toEqual([
      { candidateId, testIndex: 0, stepIndex: 1, observationId: second, outcome: 'harmful' },
      { candidateId, testIndex: 0, stepIndex: 0, observationId: first, outcome: 'confirmed' },
    ])
  })

  it('an empty tuple list answers [] WITHOUT walking the store', () => {
    // A store the walker cannot read: the empty-tuple answer is only honest if it never looked.
    mkdirSync(join(knowledgeRoot, 'memory'), { recursive: true })
    writeFileSync(join(knowledgeRoot, 'memory', 'shop'), 'not a directory', 'utf8')

    expect(canaryAttributionsFor({ knowledgeRoot, runId: RUN_ID, tuples: [] })).toEqual([])
    expect(() => canaryAttributionsFor({
      knowledgeRoot,
      runId: RUN_ID,
      tuples: [tupleFor('fact-anything', 0)],
    })).toThrow(/scan incomplete/i)
  })
})
