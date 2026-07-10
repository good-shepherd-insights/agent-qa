import { describe, expect, it } from 'vitest'
import {
  CASSETTE_SCHEMA_VERSION,
  CassetteVersionError,
  guardCassette,
} from '../../index'

const SHA = 'a'.repeat(64)

function validLeafDocument() {
  return {
    schemaVersion: CASSETTE_SCHEMA_VERSION,
    id: 'run-one/step-00-decision-00-leaf',
    runId: 'run-one',
    testId: 'test-one',
    testIndex: 0,
    blobs: [SHA],
    completeness: { status: 'complete' },
    granularity: 'leaf',
    stepIndex: 0,
    decisionOrdinal: 0,
    input: {
      testId: 'test-one',
      testIndex: 0,
      stepIndex: 0,
      decisionOrdinal: 0,
      stepText: 'Submit the form',
      stateBefore: {
        platform: 'web',
        tree: '- button "Submit" [ref=e1]',
        elements: [
          {
            ref: 'e1',
            role: 'button',
            name: 'Submit',
            nameNormalized: 'submit',
            bounds: { x: 10, y: 20, width: 80, height: 32 },
            center: { x: 50, y: 36 },
            state: { enabled: true, focused: false, visible: true, clickable: true },
            labels: { ariaLabel: 'Submit' },
            hierarchy: { childRefs: [] },
            attributes: { type: 'submit' },
          },
        ],
        refMap: {
          e1: {
            bounds: { x: 10, y: 20, width: 80, height: 32 },
            center: { x: 50, y: 36 },
            scrollContext: { offsetX: 0, offsetY: 0 },
          },
        },
        url: 'https://example.test/form',
        timestamp: 123,
        metadata: {
          captureMode: 'textOnly',
          coordSpace: 'viewport',
          viewportWidth: 1280,
          viewportHeight: 720,
          scroll: { offsetX: 0, offsetY: 0, contentWidth: 1280, contentHeight: 720 },
        },
      },
      servedBrief: {
        scope: { tier: 'test', key: 'test-one' },
        asOfBuild: 7,
        budget: 256,
        truncation: 'none',
        channel1: [
          {
            id: 'record-one',
            kind: 'fact',
            summary: 'Submit once',
            trust: 0.8,
            status: 'active',
            servedAsCanary: false,
            tier: 'L1',
          },
        ],
        channel2: [],
        channel3: [],
        briefDigest: SHA,
      },
      workingMemory: [
        {
          key: 'email',
          value: 'masked@example.test',
          kind: 'extracted-value',
          provenance: 'observation',
          testIndex: 0,
          stepIndex: 0,
        },
      ],
      exchanges: [{ tool: 'inspect', args: { what: 'console' }, result: [] }],
      modelProfile: {
        provider: 'openai-compatible',
        modelId: 'planner-model',
        vision: false,
        maxOutputTokens: 1024,
        sampling: { temperature: 0, topP: 1, stop: ['done'], seed: 1 },
      },
    },
    sidecar: {
      goldAction: { type: 'click', ref: 'e1' },
      opClass: 'click',
      goldAnchor: { role: 'button', nameNormalized: 'submit', ordinal: 0, ref: 'e1' },
      equivalenceSet: [{ role: 'button', nameNormalized: 'submit', ordinal: 0 }],
      annotation: {
        kind: 'point',
        viewport: { width: 1280, height: 720 },
        point: { x: 50, y: 36, boundingBox: { x: 10, y: 20, width: 80, height: 32 } },
      },
    },
    label: {
      verdict: { pass: true, reasoning: 'Submitted successfully' },
      sourceChannel: 'recorded-verdict',
      tier: 'silver',
    },
    receipt: {
      promptInputHash: SHA,
      model: {
        declared: { provider: 'openai-compatible', modelId: 'planner-model' },
        resolvedModelId: 'planner-model-2026',
        fingerprint: 'fp-one',
      },
      sampling: { declared: { temperature: 0 }, effective: { temperature: 0 } },
      toolSchemaDigest: SHA,
      screenStateHash: SHA,
      memoryBriefDigest: SHA,
      judge: {
        recordedVerifier: { provider: 'openai-compatible', modelId: 'verifier-model' },
      },
      buildOrdinal: 7,
    },
  }
}

function validProcedureDocument() {
  const leaf = validLeafDocument()

  return {
    schemaVersion: CASSETTE_SCHEMA_VERSION,
    id: 'run-one/test-00-procedure',
    runId: leaf.runId,
    testId: leaf.testId,
    testIndex: leaf.testIndex,
    blobs: leaf.blobs,
    completeness: leaf.completeness,
    granularity: 'procedure',
    steps: [
      {
        kind: 'decision',
        stepIndex: leaf.stepIndex,
        decisionOrdinal: leaf.decisionOrdinal,
        record: {
          input: leaf.input,
          sidecar: leaf.sidecar,
          label: leaf.label,
          receipt: leaf.receipt,
        },
      },
      { kind: 'cache-served', stepIndex: 1, decisionOrdinal: 0 },
      { kind: 'synthesized', stepIndex: 2 },
    ],
    endState: {
      outcome: 'passed',
      finalVerdict: { pass: true, reasoning: 'Procedure completed' },
      finalAssert: {
        source: 'url',
        op: 'contains',
        expected: '/done',
        actual: 'https://example.test/done',
        passed: true,
      },
    },
  }
}

function wireRoundTrip(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown
}

describe('guardCassette', () => {
  it('accepts a JSON-round-tripped leaf cassette', () => {
    const cassette = guardCassette(wireRoundTrip(validLeafDocument()))

    expect(cassette.granularity).toBe('leaf')
  })

  it('accepts a JSON-round-tripped procedure cassette', () => {
    const cassette = guardCassette(wireRoundTrip(validProcedureDocument()))

    expect(cassette.granularity).toBe('procedure')
  })

  it('rejects a newer schema version with typed diagnostics', () => {
    expect.assertions(3)

    try {
      guardCassette(wireRoundTrip({ ...validLeafDocument(), schemaVersion: 2 }))
    } catch (error) {
      expect(error).toBeInstanceOf(CassetteVersionError)
      expect((error as CassetteVersionError).foundVersion).toBe(2)
      expect((error as CassetteVersionError).supportedVersion).toBe(1)
    }
  })

  it('rejects an older version when the migration registry has no path', () => {
    expect(() =>
      guardCassette(wireRoundTrip({ ...validLeafDocument(), schemaVersion: 0 })),
    ).toThrow(CassetteVersionError)
  })

  it('rejects non-objects and missing or non-numeric versions', () => {
    const { schemaVersion: _missing, ...withoutVersion } = validLeafDocument()
    void _missing

    expect(() => guardCassette('not-an-object')).toThrow(TypeError)
    expect(() => guardCassette(wireRoundTrip(withoutVersion))).toThrow(TypeError)
    expect(() =>
      guardCassette(wireRoundTrip({ ...validLeafDocument(), schemaVersion: '1' })),
    ).toThrow(TypeError)
  })

  it('rejects a truncated document and names the missing leg', () => {
    const { sidecar: _removed, ...truncated } = validLeafDocument()
    void _removed

    expect(() => guardCassette(wireRoundTrip(truncated))).toThrow(/sidecar/)
  })

  it('rejects a hand-edited kernel field and names its path', () => {
    const document = validLeafDocument()
    const changed = {
      ...document,
      input: {
        ...document.input,
        stateBefore: { ...document.input.stateBefore, elements: 'tampered' },
      },
    }

    expect(() => guardCassette(wireRoundTrip(changed))).toThrow(
      /input\.stateBefore\.elements/,
    )
  })

  it('rejects a blob closure entry that is not lowercase 64-hex', () => {
    const changed = { ...validLeafDocument(), blobs: ['NOT-A-DIGEST'] }

    expect(() => guardCassette(wireRoundTrip(changed))).toThrow(/blobs\.0/)
  })
})
