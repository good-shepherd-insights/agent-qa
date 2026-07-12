import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { BundleOutcomeEventSchema } from '@vostride/agent-qa-schema'
import type { ArtifactRef } from '@vostride/agent-qa-schema'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { appendOutcomeEvent } from '../bundle-append.js'
import {
  publishBundle,
  type BundleStoreConfig,
  type PublishBundleInput,
} from '../bundle-publish.js'
import {
  KNOWLEDGE_GITIGNORE_TEXT,
  makeBundleDraftFixture,
  makeDiscriminantFixture,
  makeScreenStateFixture,
  parseKnowledgeGitignoreRules,
  scaffoldKnowledgeRoot,
  walkKnowledgeRoot,
} from './fixtures/bundle-fixture.js'

// AKIA + 16 uppercase-alphanumerics is the detector-shaped awsKey control.
const AWS_KEY = 'AKIAIOSFODNN7EXAMPLE'

function sha(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function filesContaining(root: string, relPaths: readonly string[], needle: string): string[] {
  return relPaths.filter((relPath) => readFileSync(join(root, relPath)).includes(needle))
}

describe('KDIR-02 planted-secret committed-tree refusal proof', () => {
  let root: string
  let knowledgeRoot: string
  let auditBaseDir: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'knowledge-egress-proof-'))
    knowledgeRoot = join(root, 'agent-qa-knowledge')
    auditBaseDir = join(root, '.agent-qa')
    scaffoldKnowledgeRoot(knowledgeRoot)
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  function config(productKey: string): BundleStoreConfig {
    return {
      knowledgeRoot,
      productKey,
      auditBaseDir,
      commitArtifacts: 'none',
    }
  }

  function input(overrides: Partial<PublishBundleInput> = {}): PublishBundleInput {
    return {
      draft: makeBundleDraftFixture(),
      discriminant: makeDiscriminantFixture(),
      originClass: 'agent-verified',
      createdAtOrdinal: 42,
      screenStates: [makeScreenStateFixture()],
      initialEvents: [],
      relations: [],
      provenance: {
        mode: 'run-linked',
        runId: 'egress-proof-run',
        testId: 'egress-proof-test',
        stepIndex: 0,
      },
      artifacts: [],
      ...overrides,
    }
  }

  it('uses the exact init scaffold dialect and rejects unsupported rule shapes', () => {
    expect(readFileSync(join(knowledgeRoot, '.gitignore'), 'utf8')).toBe(
      KNOWLEDGE_GITIGNORE_TEXT,
    )
    expect(parseKnowledgeGitignoreRules(KNOWLEDGE_GITIGNORE_TEXT)).toHaveLength(6)
    expect(() => parseKnowledgeGitignoreRules('*.tmp\n')).toThrow(
      'unsupported scaffolded ignore rule',
    )
  })

  it('refuses detector-shaped bundle text with audit and zero tracked secret bytes', () => {
    const carryingInput = input({
      draft: makeBundleDraftFixture({
        body: `This committed bundle body carries ${AWS_KEY}.`,
      }),
    })
    expect(carryingInput.draft.body).toContain(AWS_KEY)

    const blocked = publishBundle(config('egress-blocked-text'), carryingInput)

    expect(blocked.kind).toBe('egress-blocked')
    if (blocked.kind !== 'egress-blocked') throw new Error('expected egress refusal')
    expect(blocked.detections.some((detection) => detection.detector === 'awsKey')).toBe(true)
    expect(readFileSync(join(auditBaseDir, 'guardrail_audit.jsonl'), 'utf8')).toContain(
      'knowledge-bundle:record.md',
    )
    const walkAfterRefusal = walkKnowledgeRoot(knowledgeRoot)
    expect(walkAfterRefusal.trackedPaths.length).toBeGreaterThan(0)
    expect(filesContaining(knowledgeRoot, walkAfterRefusal.trackedPaths, AWS_KEY)).toEqual([])

    const clean = publishBundle(config('egress-blocked-text'), input())
    expect(clean.kind).toBe('published')
  })

  it('allows secret bytes only in an ignore-classified artifact blob', () => {
    const artifactBytes = Uint8Array.from(Buffer.from(`binary-control:${AWS_KEY}`))
    const sourcePath = join(root, 'secret-artifact.bin')
    writeFileSync(sourcePath, artifactBytes)
    const artifactRef: ArtifactRef = {
      id: 'binary-secret-control',
      sha: sha(artifactBytes),
    }

    const published = publishBundle(
      config('egress-binary-bypass'),
      input({
        draft: makeBundleDraftFixture({
          anchors: [
            { t: 'el', role: 'Button', name: 'Binary proof' },
            { t: 'page', route: '/binary-proof' },
          ],
        }),
        artifacts: [{ ref: artifactRef, sourcePath, stepIndex: 0, role: 'binary-control' }],
      }),
    )
    expect(published.kind).toBe('published')
    if (published.kind !== 'published') throw new Error('expected binary-bypass publication')

    const walk = walkKnowledgeRoot(knowledgeRoot)
    const artifactRelPath = walk.ignoredPaths.find((relPath) => relPath.endsWith(artifactRef.sha))
    expect(artifactRelPath).toBeDefined()
    expect(filesContaining(knowledgeRoot, walk.ignoredPaths, AWS_KEY)).toEqual([artifactRelPath])
    expect(filesContaining(knowledgeRoot, walk.trackedPaths, AWS_KEY)).toEqual([])
  })

  it('refuses a secret-bearing append with audit and no tracked secret bytes', () => {
    const storeConfig = config('egress-append')
    const published = publishBundle(
      storeConfig,
      input({
        draft: makeBundleDraftFixture({
          anchors: [
            { t: 'el', role: 'Button', name: 'Append proof' },
            { t: 'page', route: '/append-proof' },
          ],
        }),
      }),
    )
    expect(published.kind).toBe('published')
    if (published.kind !== 'published') throw new Error('expected append fixture publication')
    const carryingEvent = BundleOutcomeEventSchema.parse({
      type: 'deprecated',
      evidenceToken: 'egress-append-secret',
      curationJobId: 'egress-append-secret-job',
      buildOrdinal: 43,
      reason: `credential ${AWS_KEY}`,
    })

    const blocked = appendOutcomeEvent(storeConfig, published.id, carryingEvent)

    expect(blocked.kind).toBe('egress-blocked')
    expect(readFileSync(join(auditBaseDir, 'guardrail_audit.jsonl'), 'utf8')).toContain(
      'knowledge-bundle:evidence/outcomes.jsonl',
    )
    const walk = walkKnowledgeRoot(knowledgeRoot)
    expect(filesContaining(knowledgeRoot, walk.trackedPaths, AWS_KEY)).toEqual([])
  })
})
