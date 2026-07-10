import type { ArtifactSource } from '../../ports'
import { describe, expect, it } from 'vitest'
import {
  FIXTURE_ARTIFACT_SHA,
  FIXTURE_SCREENSHOT_SHA,
  makeArtifactRefV2Handoff,
  makeV2Handoff,
} from '../../__tests__/fixtures/handoff-fixtures'
import { buildCompleteness, collectBlobShas, resolveBlobClosure } from '../blob-closure'

function mapSource(entries: ReadonlyMap<string, Uint8Array>): ArtifactSource {
  return {
    getBlob(sha) {
      return entries.get(sha)
    },
  }
}

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
