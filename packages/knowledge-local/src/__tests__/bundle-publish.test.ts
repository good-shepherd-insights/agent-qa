import { createHash } from 'node:crypto'
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  BundleOutcomeEventSchema,
  committedFileText,
  guardArtifactsIndex,
  guardBundleManifest,
  parseRecordMarkdown,
  slugBranch,
} from '@vostride/agent-qa-schema'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ARTIFACT_STEP_CAP_BYTES } from '../artifact-copy.js'
import {
  publishBundle,
  type BundleStoreConfig,
  type PublishBundleInput,
} from '../bundle-publish.js'
import { renderBundleParts } from '../bundle-parts.js'
import {
  makeArtifactFixture,
  makeBundleDraftFixture,
  makeDiscriminantFixture,
  makeScreenStateFixture,
} from './fixtures/bundle-fixture.js'

const AWS_KEY = 'AKIAIOSFODNN7EXAMPLE'

function sha(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function walkFiles(root: string): string[] {
  if (!existsSync(root)) return []
  const paths: string[] = []
  const visit = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const relPath = prefix === '' ? entry.name : `${prefix}/${entry.name}`
      const absolute = join(dir, entry.name)
      if (entry.isDirectory()) visit(absolute, relPath)
      else paths.push(relPath)
    }
  }
  visit(root, '')
  return paths.sort()
}

describe('publishBundle staged committed publish (D-11/D-12/D-15)', () => {
  let root: string
  let knowledgeRoot: string
  let auditBaseDir: string
  let artifactSource: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'knowledge-bundle-publish-'))
    knowledgeRoot = join(root, 'agent-qa-knowledge')
    auditBaseDir = join(root, '.agent-qa')
    artifactSource = join(root, 'fixture-artifact.bin')
    writeFileSync(artifactSource, makeArtifactFixture().bytes)
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  function config(overrides: Partial<BundleStoreConfig> = {}): BundleStoreConfig {
    return {
      knowledgeRoot,
      productKey: 'Example Store / production',
      auditBaseDir,
      commitArtifacts: 'none',
      ...overrides,
    }
  }

  function input(overrides: Partial<PublishBundleInput> = {}): PublishBundleInput {
    const artifact = makeArtifactFixture()
    return {
      draft: makeBundleDraftFixture(),
      discriminant: makeDiscriminantFixture(),
      originClass: 'agent-verified',
      createdAtOrdinal: 42,
      screenStates: [makeScreenStateFixture()],
      initialEvents: [
        BundleOutcomeEventSchema.parse({
          type: 'confirmed',
          evidenceToken: 'publish-confirmed',
          curationJobId: 'publish-job',
          buildOrdinal: 42,
          origin: 'agent-verified',
        }),
      ],
      relations: [],
      provenance: {
        mode: 'run-linked',
        runId: 'publish-run',
        testId: 'publish-sign-in',
        stepIndex: 0,
      },
      artifacts: [
        {
          ref: artifact.ref,
          sourcePath: artifactSource,
          stepIndex: 0,
          role: 'decision-screenshot',
          originalName: 'sign-in.png',
        },
      ],
      evidenceMarkdown: 'Recorded from the sign-in decision.\n',
      ...overrides,
    }
  }

  function bundlesDir(): string {
    return join(knowledgeRoot, 'memory', slugBranch(config().productKey), 'bundles')
  }

  it('lazily creates and atomically publishes the complete BNDL-01 tree', () => {
    expect(existsSync(join(knowledgeRoot, 'memory'))).toBe(false)

    const outcome = publishBundle(config(), input())

    expect(outcome.kind).toBe('published')
    if (outcome.kind !== 'published') throw new Error('expected published outcome')
    expect(outcome.evidenceIncomplete).toBe(false)
    expect(walkFiles(outcome.dir)).toEqual([
      'artifacts.index.json',
      `artifacts/${makeArtifactFixture().sha}`,
      'evidence/evidence.md',
      'evidence/outcomes.jsonl',
      'evidence/screenstates/step-0.json',
      'manifest.json',
      'provenance.json',
      'record.md',
      'relations.json',
    ])

    const manifest = guardBundleManifest(
      JSON.parse(readFileSync(join(outcome.dir, 'manifest.json'), 'utf8')),
    )
    expect(manifest.complete).toBe(true)
    expect(existsSync(join(outcome.dir, 'artifacts.index.json'))).toBe(true)
    expect(existsSync(join(outcome.dir, 'artifacts', 'artifacts.index.json'))).toBe(false)
    expect(readdirSync(bundlesDir())).not.toContain('.staging')
  })

  it('refuses a detector-shaped secret with audit but no bundle or staging bytes', () => {
    const blockedInput = input({
      draft: makeBundleDraftFixture({ body: `Do not commit ${AWS_KEY}` }),
    })

    const outcome = publishBundle(config(), blockedInput)

    expect(outcome.kind).toBe('egress-blocked')
    if (outcome.kind !== 'egress-blocked') throw new Error('expected egress refusal')
    expect(outcome.detections).toContainEqual({ label: 'record.md', detector: 'awsKey' })
    expect(readdirSync(bundlesDir())).toEqual([])
    expect(
      walkFiles(knowledgeRoot).filter((relPath) =>
        readFileSync(join(knowledgeRoot, relPath)).includes(Buffer.from(AWS_KEY)),
      ),
    ).toEqual([])
    expect(readFileSync(join(auditBaseDir, 'guardrail_audit.jsonl'), 'utf8')).toContain(
      'knowledge-bundle:record.md',
    )
  })

  it('throws loudly when thumbnails are requested', () => {
    expect(() => publishBundle(config({ commitArtifacts: 'thumbnails' }), input())).toThrow(
      /Phase 380.*visual review/i,
    )
    expect(existsSync(knowledgeRoot)).toBe(false)
  })

  it('returns already-exists for the same complete content address', () => {
    const first = publishBundle(config(), input())
    expect(first.kind).toBe('published')
    if (first.kind !== 'published') throw new Error('expected first publish')

    expect(publishBundle(config(), input())).toEqual({ kind: 'already-exists', id: first.id })
    expect(readdirSync(bundlesDir())).toEqual([first.id])
  })

  it('refuses a schema-valid but self-inconsistent existing identity hash', () => {
    const first = publishBundle(config(), input())
    expect(first.kind).toBe('published')
    if (first.kind !== 'published') throw new Error('expected first publish')
    const manifestPath = join(first.dir, 'manifest.json')
    const manifest = guardBundleManifest(JSON.parse(readFileSync(manifestPath, 'utf8')))
    const replacementFirstHex = manifest.identityHash.startsWith('0') ? '1' : '0'
    const tamperedText = committedFileText({
      ...manifest,
      identityHash: `${replacementFirstHex}${manifest.identityHash.slice(1)}`,
    })
    writeFileSync(manifestPath, tamperedText, 'utf8')

    const outcome = publishBundle(config(), input())

    expect(outcome.kind).toBe('identity-collision')
    if (outcome.kind !== 'identity-collision') throw new Error('expected identity collision')
    expect(outcome.reason).toBe('existing-manifest-corrupt')
    expect(readFileSync(manifestPath, 'utf8')).toBe(tamperedText)
    expect(readdirSync(bundlesDir())).not.toContain('.staging')
  })

  it('refuses a self-consistent foreign bundle at the truncated target id', () => {
    const first = publishBundle(config(), input())
    expect(first.kind).toBe('published')
    if (first.kind !== 'published') throw new Error('expected first publish')
    const foreignInput = input({
      draft: makeBundleDraftFixture({
        anchors: [
          { t: 'el', role: 'Button', name: 'Check out' },
          { t: 'page', route: '/checkout' },
        ],
      }),
      discriminant: {
        kind: 'fact',
        subtype: 'selector',
        elementRef: { role: 'Button', name: 'Check out' },
      },
    })
    const foreign = publishBundle(config(), foreignInput)
    expect(foreign.kind).toBe('published')
    if (foreign.kind !== 'published') throw new Error('expected foreign publish')
    const foreignManifest = guardBundleManifest(
      JSON.parse(readFileSync(join(foreign.dir, 'manifest.json'), 'utf8')),
    )
    rmSync(first.dir, { recursive: true, force: true })
    cpSync(foreign.dir, first.dir, { recursive: true })
    const occupiedManifestPath = join(first.dir, 'manifest.json')
    const occupiedManifestText = readFileSync(occupiedManifestPath, 'utf8')

    const outcome = publishBundle(config(), input())

    expect(outcome.kind).toBe('identity-collision')
    if (outcome.kind !== 'identity-collision') throw new Error('expected identity collision')
    expect(outcome.reason).toBe('identity-hash-mismatch')
    expect(outcome.existingIdentityHash).toBe(foreignManifest.identityHash)
    expect(readFileSync(occupiedManifestPath, 'utf8')).toBe(occupiedManifestText)
    expect(readdirSync(bundlesDir())).not.toContain('.staging')
  })

  it('returns the canonical identityCore rendered into the manifest', () => {
    const { artifacts: _artifacts, ...renderInput } = input()
    const rendered = renderBundleParts({
      ...renderInput,
      copiedArtifacts: { copied: [], skipped: [], evidenceIncomplete: false },
      evidenceIncomplete: false,
    })
    const manifest = guardBundleManifest(JSON.parse(rendered.parts.at(-1)!.text))

    expect(rendered.identityCore).toEqual(manifest.identityCore)
  })

  it('mints artifact overflow into both immutable markers with no dangling row', () => {
    const bytes = new Uint8Array(ARTIFACT_STEP_CAP_BYTES + 1).fill(97)
    const sourcePath = join(root, 'oversized.bin')
    writeFileSync(sourcePath, bytes)
    const artifactSha = sha(bytes)

    const outcome = publishBundle(
      config(),
      input({
        artifacts: [
          {
            ref: { id: 'oversized-screenshot', sha: artifactSha },
            sourcePath,
            stepIndex: 0,
          },
        ],
      }),
    )

    expect(outcome.kind).toBe('published')
    if (outcome.kind !== 'published') throw new Error('expected overflow-marked publish')
    expect(outcome.evidenceIncomplete).toBe(true)
    const manifest = guardBundleManifest(
      JSON.parse(readFileSync(join(outcome.dir, 'manifest.json'), 'utf8')),
    )
    const record = parseRecordMarkdown(readFileSync(join(outcome.dir, 'record.md'), 'utf8'))
    const artifactIndex = guardArtifactsIndex(
      JSON.parse(readFileSync(join(outcome.dir, 'artifacts.index.json'), 'utf8')),
    )

    expect(manifest.evidenceIncomplete).toBe(true)
    expect(record.frontmatter.evidenceIncomplete).toBe(true)
    expect(artifactIndex.artifacts).toEqual([])
    expect(existsSync(join(outcome.dir, 'artifacts', artifactSha))).toBe(false)
  })
})
