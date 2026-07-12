import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  ARTIFACT_RUN_CAP_BYTES,
  ARTIFACT_STEP_CAP_BYTES,
  copyArtifacts,
} from '../artifact-copy.js'
import type { ArtifactCopyInput, ArtifactCopyResult } from '../artifact-copy.js'

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

describe('copyArtifacts', () => {
  let root: string
  let sourceDir: string
  let destArtifactsDir: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'knowledge-artifact-copy-'))
    sourceDir = join(root, 'sources')
    destArtifactsDir = join(root, 'artifacts')
    mkdirSync(sourceDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  function input(
    name: string,
    bytes: Uint8Array,
    stepIndex: number,
    overrides: Partial<ArtifactCopyInput> = {},
  ): ArtifactCopyInput {
    const sourcePath = join(sourceDir, name)
    writeFileSync(sourcePath, bytes)
    return {
      ref: { id: `artifact-${name}`, sha: sha256(bytes) },
      sourcePath,
      stepIndex,
      ...overrides,
    }
  }

  function expectNoDanglingRows(result: ArtifactCopyResult): void {
    for (const copied of result.copied) {
      expect(existsSync(join(root, copied.relPath)), copied.relPath).toBe(true)
    }
  }

  it('copies verified bytes content-addressed and reports complete evidence', () => {
    const bytes = Buffer.from('verified screenshot bytes')
    const artifact = input('screen.png', bytes, 3, {
      role: 'screenshot',
      originalName: 'checkout.png',
    })

    const result = copyArtifacts([artifact], destArtifactsDir)

    expect(result.skipped).toEqual([])
    expect(result.evidenceIncomplete).toBe(false)
    expect(result.copied).toEqual([
      {
        ref: artifact.ref,
        relPath: `artifacts/${artifact.ref.sha}`,
        bytes: bytes.byteLength,
        stepIndex: 3,
        role: 'screenshot',
        originalName: 'checkout.png',
      },
    ])
    expectNoDanglingRows(result)
  })

  it('skips the artifact that would overflow the per-step copied-byte cap', () => {
    const first = input('step-a.bin', Buffer.alloc(1_200_000, 1), 7)
    const overflowing = input('step-b.bin', Buffer.alloc(1_200_000, 2), 7)

    const result = copyArtifacts([first, overflowing], destArtifactsDir)

    expect(ARTIFACT_STEP_CAP_BYTES).toBe(2 * 1024 * 1024)
    expect(result.copied.map(({ ref }) => ref.id)).toEqual([first.ref.id])
    expect(result.skipped).toEqual([
      { ref: overflowing.ref, stepIndex: 7, reason: 'step-cap' },
    ])
    expect(result.evidenceIncomplete).toBe(true)
    expect(existsSync(join(destArtifactsDir, overflowing.ref.sha))).toBe(false)
    expectNoDanglingRows(result)
  })

  it('skips the artifact that would overflow the run-wide copied-byte cap', () => {
    const bytesPerArtifact = ARTIFACT_STEP_CAP_BYTES - 1
    const artifacts = Array.from({ length: 13 }, (_, index) =>
      input(`run-${index}.bin`, Buffer.alloc(bytesPerArtifact, index), index),
    )

    const result = copyArtifacts(artifacts, destArtifactsDir)

    expect(ARTIFACT_RUN_CAP_BYTES).toBe(25 * 1024 * 1024)
    expect(result.copied).toHaveLength(12)
    expect(result.skipped).toEqual([
      { ref: artifacts[12]!.ref, stepIndex: 12, reason: 'run-cap' },
    ])
    expect(result.evidenceIncomplete).toBe(true)
    expect(existsSync(join(destArtifactsDir, artifacts[12]!.ref.sha))).toBe(false)
    expectNoDanglingRows(result)
  })

  it('marks a missing source as pruned and never creates a dangling row', () => {
    const missing: ArtifactCopyInput = {
      ref: { id: 'artifact-pruned', sha: sha256(Buffer.from('pruned bytes')) },
      sourcePath: join(sourceDir, 'already-pruned.bin'),
      stepIndex: 2,
    }

    const result = copyArtifacts([missing], destArtifactsDir)

    expect(result.copied).toEqual([])
    expect(result.skipped).toEqual([{ ref: missing.ref, stepIndex: 2, reason: 'pruned-source' }])
    expect(result.evidenceIncomplete).toBe(true)
  })

  it('refuses mismatched bytes without writing under the declared sha', () => {
    const declaredSha = sha256(Buffer.from('declared bytes'))
    const mismatched = input('mismatch.bin', Buffer.from('different actual bytes'), 4, {
      ref: { id: 'artifact-mismatch', sha: declaredSha },
    })

    const result = copyArtifacts([mismatched], destArtifactsDir)

    expect(result.copied).toEqual([])
    expect(result.skipped).toEqual([
      { ref: mismatched.ref, stepIndex: 4, reason: 'sha-mismatch' },
    ])
    expect(result.evidenceIncomplete).toBe(true)
    expect(existsSync(join(destArtifactsDir, declaredSha))).toBe(false)
  })

  it('deduplicates identical content while retaining both accepted inventory rows', () => {
    const bytes = Buffer.from('shared content-addressed artifact')
    const first = input('dedupe-a.bin', bytes, 0)
    const second = input('dedupe-b.bin', bytes, 1)

    const result = copyArtifacts([first, second], destArtifactsDir)

    expect(result.skipped).toEqual([])
    expect(result.evidenceIncomplete).toBe(false)
    expect(result.copied).toHaveLength(2)
    expect(result.copied.map(({ relPath }) => relPath)).toEqual([
      `artifacts/${first.ref.sha}`,
      `artifacts/${first.ref.sha}`,
    ])
    expect(readdirSync(destArtifactsDir)).toEqual([first.ref.sha])
    expectNoDanglingRows(result)
  })
})
