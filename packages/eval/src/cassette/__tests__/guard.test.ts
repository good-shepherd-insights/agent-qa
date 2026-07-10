import { describe, expect, it } from 'vitest'
import {
  CASSETTE_SCHEMA_VERSION,
  CassetteVersionError,
  guardCassette,
  type LeafCassette,
  type ProcedureCassette,
} from '../../index'

const SHA = 'a'.repeat(64)
const BLOB_SHA = 'b'.repeat(64)

function fullCaptureMetadata() {
  return {
    captureMode: 'full',
    coordSpace: 'viewport',
    viewportWidth: 1280,
    viewportHeight: 720,
    scroll: { offsetX: 0, offsetY: 0, contentWidth: 1280, contentHeight: 720 },
    imageWidth: 1280,
    imageHeight: 720,
  }
}

function fullCaptureInput(stepIndex: number) {
  const leaf = validLeafDocument()
  return {
    ...leaf.input,
    stepIndex,
    stateBefore: { ...leaf.input.stateBefore, metadata: fullCaptureMetadata() },
  }
}

function v1LeafDocument(overrides: Record<string, unknown> = {}) {
  return { ...validLeafDocument(), schemaVersion: 1, ...overrides }
}

function v1FullLeafDocument(overrides: Record<string, unknown> = {}) {
  return {
    ...validLeafDocument(),
    schemaVersion: 1,
    input: fullCaptureInput(0),
    ...overrides,
  }
}

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

    const newer = CASSETTE_SCHEMA_VERSION + 1

    try {
      guardCassette(wireRoundTrip({ ...validLeafDocument(), schemaVersion: newer }))
    } catch (error) {
      expect(error).toBeInstanceOf(CassetteVersionError)
      expect((error as CassetteVersionError).foundVersion).toBe(newer)
      expect((error as CassetteVersionError).supportedVersion).toBe(CASSETTE_SCHEMA_VERSION)
    }
  })

  it('parses a current version-2 document directly without migration', () => {
    const cassette = guardCassette(wireRoundTrip(validLeafDocument())) as LeafCassette

    expect(cassette.schemaVersion).toBe(CASSETTE_SCHEMA_VERSION)
    expect(cassette.completeness.missingEvidence).toBeUndefined()
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

describe('guardCassette version-1 to version-2 migration', () => {
  it('migrates a full-capture leaf to evidence-incomplete with one coordinate fact', () => {
    const migrated = guardCassette(wireRoundTrip(v1FullLeafDocument())) as LeafCassette

    expect(migrated.schemaVersion).toBe(CASSETTE_SCHEMA_VERSION)
    expect(migrated.completeness.status).toBe('evidence-incomplete')
    expect(migrated.completeness.missingEvidence).toEqual([
      { kind: 'decision-screenshot-ref', stepIndex: 0, decisionOrdinal: 0 },
    ])
  })

  it('never guesses anonymous version-1 blobs into typed artifact refs', () => {
    const migrated = guardCassette(
      wireRoundTrip(v1FullLeafDocument({ blobs: [SHA, BLOB_SHA] })),
    ) as LeafCassette

    expect(migrated.input.decisionScreenshotRef).toBeUndefined()
    expect(migrated.input.auxiliaryArtifactRefs).toBeUndefined()
    expect(migrated.blobs).toEqual([SHA, BLOB_SHA])
  })

  it('migrates a textOnly leaf preserving its prior status and details', () => {
    const migrated = guardCassette(
      wireRoundTrip(
        v1LeafDocument({
          completeness: { status: 'anchor-unresolved', unresolvedAnchorRef: 'e9' },
        }),
      ),
    ) as LeafCassette

    expect(migrated.schemaVersion).toBe(CASSETTE_SCHEMA_VERSION)
    expect(migrated.completeness.status).toBe('anchor-unresolved')
    expect(migrated.completeness.unresolvedAnchorRef).toBe('e9')
    expect(migrated.completeness.missingEvidence).toBeUndefined()
  })

  it('preserves missing blob and anchor details while evidence-incomplete wins', () => {
    const migrated = guardCassette(
      wireRoundTrip(
        v1FullLeafDocument({
          completeness: {
            status: 'anchor-unresolved',
            missingBlobShas: [BLOB_SHA],
            unresolvedAnchorRef: 'e9',
          },
        }),
      ),
    ) as LeafCassette

    expect(migrated.completeness.status).toBe('evidence-incomplete')
    expect(migrated.completeness.missingBlobShas).toEqual([BLOB_SHA])
    expect(migrated.completeness.unresolvedAnchorRef).toBe('e9')
    expect(migrated.completeness.missingEvidence).toHaveLength(1)
  })

  it('emits one fact per full decision in procedure order and skips other entries', () => {
    const leaf = validLeafDocument()
    const decisionRecord = (input: unknown) => ({
      input,
      sidecar: leaf.sidecar,
      label: leaf.label,
      receipt: leaf.receipt,
    })
    const document = {
      ...validProcedureDocument(),
      schemaVersion: 1,
      steps: [
        {
          kind: 'decision',
          stepIndex: 0,
          decisionOrdinal: 0,
          record: decisionRecord(fullCaptureInput(0)),
        },
        {
          kind: 'decision',
          stepIndex: 1,
          decisionOrdinal: 0,
          record: decisionRecord({ ...leaf.input, stepIndex: 1 }),
        },
        {
          kind: 'decision',
          stepIndex: 2,
          decisionOrdinal: 0,
          record: decisionRecord(fullCaptureInput(2)),
        },
        { kind: 'cache-served', stepIndex: 3, decisionOrdinal: 0 },
        { kind: 'synthesized', stepIndex: 4 },
      ],
    }

    const migrated = guardCassette(wireRoundTrip(document)) as ProcedureCassette

    expect(migrated.schemaVersion).toBe(CASSETTE_SCHEMA_VERSION)
    expect(migrated.completeness.status).toBe('evidence-incomplete')
    expect(migrated.completeness.missingEvidence).toEqual([
      { kind: 'decision-screenshot-ref', stepIndex: 0, decisionOrdinal: 0 },
      { kind: 'decision-screenshot-ref', stepIndex: 2, decisionOrdinal: 0 },
    ])
  })

  it('deduplicates identical full-decision coordinates in a procedure migration', () => {
    const leaf = validLeafDocument()
    const decisionRecord = (input: unknown) => ({
      input,
      sidecar: leaf.sidecar,
      label: leaf.label,
      receipt: leaf.receipt,
    })
    const document = {
      ...validProcedureDocument(),
      schemaVersion: 1,
      steps: [
        {
          kind: 'decision',
          stepIndex: 0,
          decisionOrdinal: 0,
          record: decisionRecord(fullCaptureInput(0)),
        },
        {
          kind: 'decision',
          stepIndex: 0,
          decisionOrdinal: 0,
          record: decisionRecord(fullCaptureInput(0)),
        },
      ],
    }

    const migrated = guardCassette(wireRoundTrip(document)) as ProcedureCassette

    expect(migrated.completeness.missingEvidence).toEqual([
      { kind: 'decision-screenshot-ref', stepIndex: 0, decisionOrdinal: 0 },
    ])
  })

  it('leaves an all-textOnly procedure complete with no migration facts', () => {
    const migrated = guardCassette(
      wireRoundTrip({ ...validProcedureDocument(), schemaVersion: 1 }),
    ) as ProcedureCassette

    expect(migrated.completeness.status).toBe('complete')
    expect(migrated.completeness.missingEvidence).toBeUndefined()
  })

  it('produces a version-2 document that re-guards directly', () => {
    const migrated = guardCassette(wireRoundTrip(v1FullLeafDocument()))
    const reguarded = guardCassette(wireRoundTrip(migrated)) as LeafCassette

    expect(reguarded.schemaVersion).toBe(CASSETTE_SCHEMA_VERSION)
    expect(reguarded.completeness.missingEvidence).toHaveLength(1)
  })

  it('rejects a malformed version-1 document under post-migration structural validation', () => {
    const { sidecar: _removed, ...truncated } = v1FullLeafDocument()
    void _removed

    expect(() => guardCassette(wireRoundTrip(truncated))).toThrow(/sidecar/)
  })
})

type LegName = 'input' | 'sidecar' | 'label' | 'receipt'

const LEG_NAMES: LegName[] = ['input', 'sidecar', 'label', 'receipt']

const LEG_CORRUPTIONS: Record<LegName, { path: string; corrupt: (leg: any) => void }> = {
  input: { path: 'input.stateBefore.elements', corrupt: leg => (leg.stateBefore.elements = 'tampered') },
  sidecar: { path: 'sidecar.opClass', corrupt: leg => (leg.opClass = 42) },
  label: { path: 'label.sourceChannel', corrupt: leg => (leg.sourceChannel = 'bogus-channel') },
  receipt: { path: 'receipt.promptInputHash', corrupt: leg => (leg.promptInputHash = 'not-a-valid-digest') },
}

function mutate(document: unknown, mutator: (doc: any) => void): unknown {
  const clone = JSON.parse(JSON.stringify(document))
  mutator(clone)
  return clone
}

function pathMatcher(fullPath: string): RegExp {
  return new RegExp(fullPath.replace(/\./g, '\\.'))
}

const invalidGoldActions: Array<{ name: string; action: unknown; relPath: string }> = [
  { name: 'a truncated fill action', action: { type: 'fill' }, relPath: 'goldAction.text' },
  {
    name: 'fill missing ref',
    action: { type: 'fill', text: 't', clearMode: 'replace', submit: false },
    relPath: 'goldAction.ref',
  },
  {
    name: 'fill missing clearMode',
    action: { type: 'fill', ref: 'e1', text: 't', submit: false },
    relPath: 'goldAction.clearMode',
  },
  {
    name: 'fill missing submit',
    action: { type: 'fill', ref: 'e1', text: 't', clearMode: 'replace' },
    relPath: 'goldAction.submit',
  },
  { name: 'an unknown action type', action: { type: 'teleport' }, relPath: 'goldAction.type' },
  {
    name: 'wrong-typed fill.text',
    action: { type: 'fill', ref: 'e1', text: 5, clearMode: 'replace', submit: false },
    relPath: 'goldAction.text',
  },
  {
    name: 'wrong-typed select.value',
    action: { type: 'select', ref: 'e1', value: 5 },
    relPath: 'goldAction.value',
  },
  {
    name: 'wrong-typed paste.value',
    action: { type: 'paste', ref: 'e1', value: 5 },
    relPath: 'goldAction.value',
  },
  {
    name: 'wrong-typed nativeSelect.value',
    action: { type: 'nativeSelect', ref: 'e1', value: 5 },
    relPath: 'goldAction.value',
  },
]

const invalidGoldActionsLoose: Array<{ name: string; action: unknown }> = [
  { name: 'wrong-typed pickerSelect.value', action: { type: 'pickerSelect', ref: 'e1', value: 5 } },
  { name: 'malformed pickerSelect order', action: { type: 'pickerSelect', ref: 'e1', order: 'first' } },
  { name: 'navigate to url without url', action: { type: 'navigate', to: 'url' } },
]

const validReplacementGoldActions: Array<{ name: string; action: unknown }> = [
  { name: 'a valid fill action', action: { type: 'fill', ref: 'e1', text: 'x', clearMode: 'replace', submit: false } },
  { name: 'a valid paste action', action: { type: 'paste', ref: 'e1', value: 'clip' } },
]

function setLeafGoldAction(action: unknown): unknown {
  return mutate(validLeafDocument(), doc => {
    doc.sidecar.goldAction = action
  })
}

function setProcedureGoldAction(action: unknown): unknown {
  return mutate(validProcedureDocument(), doc => {
    doc.steps[0].record.sidecar.goldAction = action
  })
}

describe('guardCassette four-leg structural matrix', () => {
  for (const leg of LEG_NAMES) {
    it(`rejects a leaf with a deleted ${leg} leg`, () => {
      const document = mutate(validLeafDocument(), doc => {
        delete doc[leg]
      })

      expect(() => guardCassette(document)).toThrow(pathMatcher(leg))
    })

    it(`rejects a procedure decision with a deleted ${leg} leg`, () => {
      const document = mutate(validProcedureDocument(), doc => {
        delete doc.steps[0].record[leg]
      })

      expect(() => guardCassette(document)).toThrow(pathMatcher(`steps.0.record.${leg}`))
    })

    it(`rejects a leaf with a corrupted ${leg} leg`, () => {
      const { path, corrupt } = LEG_CORRUPTIONS[leg]
      const document = mutate(validLeafDocument(), doc => {
        corrupt(doc[leg])
      })

      expect(() => guardCassette(document)).toThrow(pathMatcher(path))
    })

    it(`rejects a procedure decision with a corrupted ${leg} leg`, () => {
      const { path, corrupt } = LEG_CORRUPTIONS[leg]
      const document = mutate(validProcedureDocument(), doc => {
        corrupt(doc.steps[0].record[leg])
      })

      expect(() => guardCassette(document)).toThrow(pathMatcher(`steps.0.record.${path}`))
    })
  }
})

describe('guardCassette embedded gold action matrix', () => {
  for (const { name, action } of validReplacementGoldActions) {
    it(`accepts ${name} in a leaf cassette`, () => {
      expect(guardCassette(setLeafGoldAction(action)).granularity).toBe('leaf')
    })

    it(`accepts ${name} in a procedure decision`, () => {
      expect(guardCassette(setProcedureGoldAction(action)).granularity).toBe('procedure')
    })
  }

  for (const { name, action, relPath } of invalidGoldActions) {
    it(`rejects ${name} in a leaf cassette`, () => {
      expect(() => guardCassette(setLeafGoldAction(action))).toThrow(
        pathMatcher(`sidecar.${relPath}`),
      )
    })

    it(`rejects ${name} in a procedure decision`, () => {
      expect(() => guardCassette(setProcedureGoldAction(action))).toThrow(
        pathMatcher(`steps.0.record.sidecar.${relPath}`),
      )
    })
  }

  for (const { name, action } of invalidGoldActionsLoose) {
    it(`rejects ${name} in a leaf cassette`, () => {
      expect(() => guardCassette(setLeafGoldAction(action))).toThrow(
        pathMatcher('sidecar.goldAction'),
      )
    })

    it(`rejects ${name} in a procedure decision`, () => {
      expect(() => guardCassette(setProcedureGoldAction(action))).toThrow(
        pathMatcher('steps.0.record.sidecar.goldAction'),
      )
    })
  }

  it('rejects a present platform member on the gold action', () => {
    const action = { type: 'click', ref: 'e1', platform: 'web' }

    expect(() => guardCassette(setLeafGoldAction(action))).toThrow(
      pathMatcher('sidecar.goldAction.platform'),
    )
  })
})
