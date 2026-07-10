import type {
  ArtifactRef,
  ScreenStateMetadata,
  SubActionEvidence,
} from '@vostride/agent-qa-schema'
import type { CassetteInputLeg } from '../../cassette/input-leg'
import type { ArtifactSource } from '../../ports'
import { describe, expect, it } from 'vitest'
import {
  FIXTURE_ARTIFACT_SHA,
  FIXTURE_SCREENSHOT_SHA,
  makeArtifactRefV2Handoff,
  makeV2Handoff,
} from '../../__tests__/fixtures/handoff-fixtures'
import { projectInputLeg } from '../input-leg'
import {
  buildCompleteness,
  collectBlobShas,
  missingRequiredEvidence,
  resolveBlobClosure,
} from '../blob-closure'

function mapSource(entries: ReadonlyMap<string, Uint8Array>): ArtifactSource {
  return {
    getBlob(sha) {
      return entries.get(sha)
    },
  }
}

const textOnlyMetadata: ScreenStateMetadata = {
  captureMode: 'textOnly',
  coordSpace: 'viewport',
  viewportWidth: 1_280,
  viewportHeight: 720,
  scroll: { offsetX: 0, offsetY: 0, contentWidth: 1_280, contentHeight: 1_440 },
  domContext: 'checkout-frame',
}

interface LegOptions {
  captureMode: 'full' | 'textOnly'
  screenshot?: ArtifactRef
  auxiliary?: readonly ArtifactRef[]
  raw?: boolean
  stepIndex?: number
  decisionOrdinal?: number
}

function buildLeg(opts: LegOptions): CassetteInputLeg {
  const handoffTest = makeV2Handoff().tests[0]!
  const step = handoffTest.steps[0]!
  const base = step.subActions[0]!

  const metadata: ScreenStateMetadata =
    opts.captureMode === 'textOnly'
      ? textOnlyMetadata
      : opts.raw === true
        ? { ...base.stateBefore.metadata, domContext: 'raw-no-sizing-frame' }
        : base.stateBefore.metadata

  const subAction: SubActionEvidence = {
    ...base,
    stateBefore: { ...base.stateBefore, metadata },
    ...(opts.screenshot === undefined
      ? { decisionScreenshotRef: undefined }
      : { decisionScreenshotRef: opts.screenshot }),
    ...(opts.auxiliary === undefined ? {} : { artifactRefs: [...opts.auxiliary] }),
  }

  return projectInputLeg({
    handoffTest,
    step,
    subAction,
    testIndex: handoffTest.testIndex,
    stepIndex: opts.stepIndex ?? step.stepIndex,
    decisionOrdinal: opts.decisionOrdinal ?? 0,
  })
}

const usableScreenshot: ArtifactRef = { id: 'decision-shot', sha: FIXTURE_SCREENSHOT_SHA }
const incompleteScreenshot: ArtifactRef = {
  id: 'decision-shot',
  sha: FIXTURE_SCREENSHOT_SHA,
  evidenceIncomplete: true,
}

describe('missingRequiredEvidence authoritative modality policy', () => {
  it('compressed full capture mode with no ref requires a decision-screenshot-ref fact', () => {
    expect(buildLeg({ captureMode: 'full', stepIndex: 3, decisionOrdinal: 2 })).toBeDefined()
    expect(
      missingRequiredEvidence(buildLeg({ captureMode: 'full', stepIndex: 3, decisionOrdinal: 2 })),
    ).toEqual([{ kind: 'decision-screenshot-ref', stepIndex: 3, decisionOrdinal: 2 }])
  })

  it('raw no-sizing full capture mode classifies identically to compressed', () => {
    const compressed = missingRequiredEvidence(
      buildLeg({ captureMode: 'full', raw: false, stepIndex: 1, decisionOrdinal: 0 }),
    )
    const raw = missingRequiredEvidence(
      buildLeg({ captureMode: 'full', raw: true, stepIndex: 1, decisionOrdinal: 0 }),
    )

    expect(raw).toEqual(compressed)
    expect(raw).toEqual([{ kind: 'decision-screenshot-ref', stepIndex: 1, decisionOrdinal: 0 }])
  })

  it('full capture mode with an evidenceIncomplete ref still requires screenshot identity', () => {
    expect(
      missingRequiredEvidence(
        buildLeg({
          captureMode: 'full',
          screenshot: incompleteScreenshot,
          stepIndex: 0,
          decisionOrdinal: 4,
        }),
      ),
    ).toEqual([{ kind: 'decision-screenshot-ref', stepIndex: 0, decisionOrdinal: 4 }])
  })

  it('full capture mode with a usable ref needs no required screenshot fact', () => {
    expect(
      missingRequiredEvidence(
        buildLeg({ captureMode: 'full', screenshot: usableScreenshot }),
      ),
    ).toEqual([])
  })

  it('textOnly capture mode with no ref requires no screenshot identity', () => {
    expect(missingRequiredEvidence(buildLeg({ captureMode: 'textOnly' }))).toEqual([])
  })

  it('vision-capable textOnly capture mode still requires no screenshot identity', () => {
    const leg = buildLeg({ captureMode: 'textOnly' })
    expect(leg.modelProfile?.vision).toBe(true)
    expect(missingRequiredEvidence(leg)).toEqual([])
  })

  it('auxiliary refs and blobs never substitute for the full capture mode fact', () => {
    expect(
      missingRequiredEvidence(
        buildLeg({
          captureMode: 'full',
          auxiliary: [{ id: 'aux', sha: FIXTURE_ARTIFACT_SHA }],
        }),
      ),
    ).toEqual([{ kind: 'decision-screenshot-ref', stepIndex: 0, decisionOrdinal: 0 }])
  })
})

describe('D-11 blob closure and completeness', () => {
  it('collects screenshot then artifact shas in recorded order and deduplicates them', () => {
    const source = makeArtifactRefV2Handoff().tests[0]!.steps[0]!.subActions[0]!
    const subAction = {
      ...source,
      artifactRefs: [
        ...source.artifactRefs!,
        { id: 'duplicate-artifact', sha: FIXTURE_ARTIFACT_SHA },
        { id: 'duplicate-screenshot', sha: FIXTURE_SCREENSHOT_SHA },
      ],
    }

    expect(collectBlobShas(subAction)).toEqual([
      FIXTURE_SCREENSHOT_SHA,
      FIXTURE_ARTIFACT_SHA,
    ])
  })

  it('resolves every served blob without reporting missing evidence', () => {
    const screenshotBytes = new Uint8Array([1, 2, 3])
    const artifactBytes = new Uint8Array([4, 5])
    const source = mapSource(
      new Map([
        [FIXTURE_SCREENSHOT_SHA, screenshotBytes],
        [FIXTURE_ARTIFACT_SHA, artifactBytes],
      ]),
    )

    expect(resolveBlobClosure([FIXTURE_SCREENSHOT_SHA, FIXTURE_ARTIFACT_SHA], source)).toEqual({
      blobs: [
        { sha: FIXTURE_SCREENSHOT_SHA, bytes: screenshotBytes },
        { sha: FIXTURE_ARTIFACT_SHA, bytes: artifactBytes },
      ],
      missingShas: [],
    })
  })

  it('keeps served bytes while listing every unserved referenced sha', () => {
    const screenshotBytes = new Uint8Array([1, 2, 3])
    const source = mapSource(new Map([[FIXTURE_SCREENSHOT_SHA, screenshotBytes]]))

    expect(resolveBlobClosure([FIXTURE_SCREENSHOT_SHA, FIXTURE_ARTIFACT_SHA], source)).toEqual({
      blobs: [{ sha: FIXTURE_SCREENSHOT_SHA, bytes: screenshotBytes }],
      missingShas: [FIXTURE_ARTIFACT_SHA],
    })
  })

  it('treats absent refs as a legitimately complete text-only closure', () => {
    const subAction = makeV2Handoff().tests[0]!.steps[0]!.subActions[0]!
    const shas = collectBlobShas(subAction)
    const resolved = resolveBlobClosure(shas, mapSource(new Map()))

    expect(shas).toEqual([])
    expect(resolved).toEqual({ blobs: [], missingShas: [] })
    expect(
      buildCompleteness({
        missingShas: resolved.missingShas,
        anchorUnresolved: false,
      }),
    ).toEqual({ status: 'complete' })
  })

  it('assembles the single-status completeness vocabulary with evidence precedence', () => {
    expect(buildCompleteness({ missingShas: [], anchorUnresolved: false })).toEqual({
      status: 'complete',
    })
    expect(
      buildCompleteness({
        missingShas: [FIXTURE_ARTIFACT_SHA],
        anchorUnresolved: false,
      }),
    ).toEqual({
      status: 'evidence-incomplete',
      missingBlobShas: [FIXTURE_ARTIFACT_SHA],
    })
    expect(
      buildCompleteness({
        missingShas: [],
        anchorUnresolved: true,
        unresolvedAnchorRef: 'e-missing',
      }),
    ).toEqual({
      status: 'anchor-unresolved',
      unresolvedAnchorRef: 'e-missing',
    })
    expect(
      buildCompleteness({
        missingShas: [FIXTURE_ARTIFACT_SHA],
        anchorUnresolved: true,
        unresolvedAnchorRef: 'e-missing',
      }),
    ).toEqual({
      status: 'evidence-incomplete',
      missingBlobShas: [FIXTURE_ARTIFACT_SHA],
      unresolvedAnchorRef: 'e-missing',
    })
  })
})
