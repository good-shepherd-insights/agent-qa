// Bundle publication is the D-11/D-12/D-15 store seam beneath KnowledgePort (D-04).
// It copies capped artifacts into an invisible sibling staging directory, checkpoints every
// committed text part as one unit, writes manifest.json last (§7.8), then atomically renames.
// BNDL-02/D-05 only treats an occupied target as already-exists after full-identity equality.

import { randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'

import {
  canonicalJson,
  guardBundleManifest,
  slugBranch,
  verifyManifestIdentity,
} from '@vostride/agent-qa-schema'
import type {
  BundleIdentityCore,
  BundleManifest,
  GuardrailPolicy,
  RecordId,
} from '@vostride/agent-qa-schema'

import { copyArtifacts } from './artifact-copy.js'
import type {
  ArtifactCopyInput,
  ArtifactCopyResult,
  ArtifactCopySkipReason,
  SkippedArtifact,
} from './artifact-copy.js'
import { checkpointCommittedParts } from './bundle-egress.js'
import { renderBundleParts } from './bundle-parts.js'
import type { RenderBundlePartsInput } from './bundle-parts.js'
import { durableRename, fsyncDirectory, fsyncTree } from './durable-fs.js'

export interface BundleStoreConfig {
  /** Absolute committed-root path. Deliberately no working-directory default. */
  knowledgeRoot: string
  productKey: string
  auditBaseDir: string
  commitArtifacts: 'none' | 'thumbnails'
  /** Active writer identity used to attribute crash-left staging trees. */
  writerLeaseId?: string
  policy?: GuardrailPolicy
  hooks?: {
    /** Test/chaos seam after all staged bytes exist but before the visibility rename. */
    beforePublishRename?: () => void
    /** Test/chaos seam after each durable mutable-file replacement. */
    afterMutableReplacement?: (targetRelPath: string) => void
  }
}

export interface PublishBundleInput
  extends Omit<RenderBundlePartsInput, 'copiedArtifacts' | 'evidenceIncomplete'> {
  artifacts: readonly ArtifactCopyInput[]
  /** Refusals already decided by the Curator's required pre-copy safety pass. */
  preSkippedArtifacts?: readonly SkippedArtifact<
    ArtifactCopySkipReason | 'capture-blacklist'
  >[]
}

export type PublishBundleOutcome =
  | { kind: 'published'; id: RecordId; dir: string; evidenceIncomplete: boolean }
  | { kind: 'egress-blocked'; detections: readonly { label: string; detector: string }[] }
  | { kind: 'already-exists'; id: RecordId }
  | {
      kind: 'identity-collision'
      id: RecordId
      dir: string
      reason:
        | 'identity-hash-mismatch'
        | 'identity-core-mismatch'
        | 'existing-manifest-corrupt'
      expectedIdentityHash: string
      existingIdentityHash: string | null
    }

const EMPTY_ARTIFACT_COPY: ArtifactCopyResult = {
  copied: [],
  skipped: [],
  evidenceIncomplete: false,
}

// Matches the path-safe token grammar enforced for claimed queue lease directories.
const SAFE_WRITER_LEASE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

type ExistingBundleTargetClassification =
  | { kind: 'same-identity' }
  | {
      kind: 'collision'
      reason:
        | 'identity-hash-mismatch'
        | 'identity-core-mismatch'
        | 'existing-manifest-corrupt'
      existingIdentityHash: string | null
    }

interface ExpectedBundleIdentity {
  id: RecordId
  identityHash: string
  identityCore: BundleIdentityCore
}

function classifyExistingBundleTarget(
  finalDir: string,
  expected: ExpectedBundleIdentity,
): ExistingBundleTargetClassification {
  let manifest: BundleManifest
  try {
    manifest = guardBundleManifest(
      JSON.parse(readFileSync(join(finalDir, 'manifest.json'), 'utf8')),
    )
  } catch {
    return {
      kind: 'collision',
      reason: 'existing-manifest-corrupt',
      existingIdentityHash: null,
    }
  }

  if (manifest.complete !== true || verifyManifestIdentity(manifest).length > 0) {
    return {
      kind: 'collision',
      reason: 'existing-manifest-corrupt',
      existingIdentityHash: manifest.identityHash,
    }
  }
  if (manifest.identityHash !== expected.identityHash) {
    return {
      kind: 'collision',
      reason: 'identity-hash-mismatch',
      existingIdentityHash: manifest.identityHash,
    }
  }
  if (canonicalJson(manifest.identityCore) !== canonicalJson(expected.identityCore)) {
    return {
      kind: 'collision',
      reason: 'identity-core-mismatch',
      existingIdentityHash: manifest.identityHash,
    }
  }
  return { kind: 'same-identity' }
}

function identityCollisionOutcome(
  finalDir: string,
  expected: ExpectedBundleIdentity,
  collision: Extract<ExistingBundleTargetClassification, { kind: 'collision' }>,
): Extract<PublishBundleOutcome, { kind: 'identity-collision' }> {
  return {
    kind: 'identity-collision',
    id: expected.id,
    dir: finalDir,
    reason: collision.reason,
    expectedIdentityHash: expected.identityHash,
    existingIdentityHash: collision.existingIdentityHash,
  }
}

function removeEmptyStagingRoot(stagingRoot: string, bundlesDir: string): void {
  let removed = false
  try {
    rmdirSync(stagingRoot)
    removed = true
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'ENOENT' && code !== 'ENOTEMPTY' && code !== 'EEXIST') throw error
  }
  if (removed) fsyncDirectory(bundlesDir)
}

function removeStaging(
  stagingDir: string,
  stagingRoot: string,
  bundlesDir: string,
): void {
  rmSync(stagingDir, { recursive: true, force: true })
  if (existsSync(stagingRoot)) fsyncDirectory(stagingRoot)
  removeEmptyStagingRoot(stagingRoot, bundlesDir)
}

function writePart(stagingDir: string, part: { relPath: string; text: string }): void {
  const target = join(stagingDir, part.relPath)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, part.text, 'utf8')
}

export function publishBundle(
  config: BundleStoreConfig,
  input: PublishBundleInput,
): PublishBundleOutcome {
  if (config.commitArtifacts === 'thumbnails') {
    throw new Error(
      "commitArtifacts 'thumbnails' is not implemented; Phase 380 visual review owns it",
    )
  }
  if (!isAbsolute(config.knowledgeRoot)) {
    throw new TypeError('BundleStoreConfig.knowledgeRoot must be absolute')
  }
  if (
    config.writerLeaseId !== undefined
    && !SAFE_WRITER_LEASE_ID.test(config.writerLeaseId)
  ) {
    throw new TypeError('BundleStoreConfig.writerLeaseId must be a non-empty path-safe token')
  }

  const { artifacts, preSkippedArtifacts, ...renderInput } = input
  const identity = renderBundleParts({
    ...renderInput,
    copiedArtifacts: EMPTY_ARTIFACT_COPY,
    evidenceIncomplete: false,
  })
  const bundlesDir = join(
    config.knowledgeRoot,
    'memory',
    slugBranch(config.productKey),
    'bundles',
  )
  const finalDir = join(bundlesDir, identity.id)

  if (existsSync(finalDir)) {
    const existing = classifyExistingBundleTarget(finalDir, identity)
    return existing.kind === 'same-identity'
      ? { kind: 'already-exists', id: identity.id }
      : identityCollisionOutcome(finalDir, identity, existing)
  }

  const stagingRoot = join(bundlesDir, '.staging')
  const stagingBasename = config.writerLeaseId === undefined
    ? `${identity.id}-${randomUUID()}`
    : `${config.writerLeaseId}-${identity.id}-${randomUUID()}`
  const stagingDir = join(stagingRoot, stagingBasename)
  mkdirSync(stagingDir, { recursive: true })

  try {
    const copiedArtifacts = copyArtifacts<'capture-blacklist'>(
      artifacts,
      join(stagingDir, 'artifacts'),
      { preSkipped: preSkippedArtifacts },
    )
    const rendered = renderBundleParts({
      ...renderInput,
      copiedArtifacts,
      evidenceIncomplete: copiedArtifacts.evidenceIncomplete,
    })
    const checkpoint = checkpointCommittedParts(
      rendered.parts.map(({ label, text }) => ({ label, text })),
      {
        auditBaseDir: config.auditBaseDir,
        ...(config.policy === undefined ? {} : { policy: config.policy }),
      },
    )

    if (checkpoint.kind === 'egress-blocked') {
      removeStaging(stagingDir, stagingRoot, bundlesDir)
      return checkpoint
    }

    const manifest = rendered.parts.at(-1)
    if (manifest?.relPath !== 'manifest.json') {
      throw new TypeError('renderBundleParts must return manifest.json last')
    }
    for (const renderedPart of rendered.parts.slice(0, -1)) {
      writePart(stagingDir, renderedPart)
    }
    writePart(stagingDir, manifest)
    fsyncTree(stagingDir)
    fsyncDirectory(stagingRoot)
    config.hooks?.beforePublishRename?.()

    try {
      durableRename(stagingDir, finalDir)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if ((code === 'EEXIST' || code === 'ENOTEMPTY') && existsSync(finalDir)) {
        const existing = classifyExistingBundleTarget(finalDir, rendered)
        removeStaging(stagingDir, stagingRoot, bundlesDir)
        return existing.kind === 'same-identity'
          ? { kind: 'already-exists', id: rendered.id }
          : identityCollisionOutcome(finalDir, rendered, existing)
      }
      throw error
    }
    removeEmptyStagingRoot(stagingRoot, bundlesDir)

    return {
      kind: 'published',
      id: rendered.id,
      dir: finalDir,
      evidenceIncomplete: copiedArtifacts.evidenceIncomplete,
    }
  } catch (error) {
    removeStaging(stagingDir, stagingRoot, bundlesDir)
    throw error
  }
}
