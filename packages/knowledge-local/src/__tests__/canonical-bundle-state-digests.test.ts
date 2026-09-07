import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { distilledScreenStateDigest, type ScreenState } from '@vostride/agent-qa-schema'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { publishBundle } from '../bundle-publish.test-helper.js'
import { readCanonicalBundleStateDigests } from '../canonical-bundle-state-digests.js'
import {
  makeBundleDraftFixture, makeDiscriminantFixture, makeScreenStateFixture,
  scaffoldKnowledgeRoot,
} from './fixtures/bundle-fixture.js'

describe('418 canonical bundle state digests', () => {
  let root: string
  let knowledgeRoot: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'canary-state-digests-'))
    knowledgeRoot = join(root, 'agent-qa-knowledge')
    scaffoldKnowledgeRoot(knowledgeRoot)
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  function publish(screenStates: ScreenState[]) {
    const result = publishBundle({
      knowledgeRoot, productKey: 'storefront', auditBaseDir: join(root, '.agent-qa'),
      commitArtifacts: 'none',
    }, {
      draft: makeBundleDraftFixture(), discriminant: makeDiscriminantFixture(),
      originClass: 'agent-verified', createdAtOrdinal: 42, screenStates,
      initialEvents: [], relations: [], artifacts: [],
      provenance: { mode: 'run-linked', runId: 'snapshot-fixture', testId: 'snapshot-fixture', stepIndex: 0 },
    })
    if (result.kind !== 'published') throw new Error(result.kind)
    return result
  }

  it('returns verified snapshot digests in snapshot order', () => {
    const bundle = publish([makeScreenStateFixture(), { ...makeScreenStateFixture(), url: '/next' }])
    const digests = [0, 1].map((step) => distilledScreenStateDigest(JSON.parse(readFileSync(
      join(bundle.dir, `evidence/screenstates/step-${step}.json`), 'utf8',
    )) as ScreenState))
    expect(readCanonicalBundleStateDigests({ knowledgeRoot, candidateId: bundle.id }))
      .toEqual({ kind: 'found', digests })
    expect(new Set(digests).size).toBe(2)
  })

  it('returns not-found for an unknown candidate', () => {
    expect(readCanonicalBundleStateDigests({ knowledgeRoot, candidateId: 'absent' }))
      .toEqual({ kind: 'not-found' })
  })

  it('returns an empty list when the bundle has no snapshots', () => {
    const bundle = publish([])
    expect(readCanonicalBundleStateDigests({ knowledgeRoot, candidateId: bundle.id }))
      .toEqual({ kind: 'found', digests: [] })
  })

  it('does not use a tampered snapshot as validity evidence', () => {
    const bundle = publish([makeScreenStateFixture()])
    writeFileSync(join(bundle.dir, 'evidence/screenstates/step-0.json'), '{}')
    expect(readCanonicalBundleStateDigests({ knowledgeRoot, candidateId: bundle.id }))
      .toEqual({ kind: 'not-found' })
  })
})
