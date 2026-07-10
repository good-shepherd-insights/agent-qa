import { createHash } from 'node:crypto'
import { cp, mkdtemp, readFile, rm, stat, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { extractRunCassettes, guardCassette } from '@vostride/agent-qa-eval'
import {
  FsEvidenceArtifactStore,
  FsHandoffStore,
  RUNS_SUBDIR,
  RUN_EVIDENCE_BLOBS_SUBDIR,
  slugBranch,
} from '@vostride/agent-qa-runner-local'
import { HandoffVersionError } from '@vostride/agent-qa-schema'
import { afterEach, describe, expect, it } from 'vitest'

import { FsRunArtifactSource } from '../artifact-source.js'
import { BLOBS_SUBDIR, CASSETTE_FILE, FsCassetteStore } from '../cassette-store.js'
import { FsHandoffSource } from '../handoff-source.js'
import {
  LOCAL_FIXTURE_BLOB_BYTES,
  LOCAL_FIXTURE_BLOB_SHA,
  LOCAL_FIXTURE_RUN_ID,
  makeLocalV2Handoff,
} from './fixtures/local-handoff-fixture.js'

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

describe('standalone cassette pipeline (CASS-02)', () => {
  const tempRoots: string[] = []

  async function tempRoot(prefix: string): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), prefix))
    tempRoots.push(root)
    return root
  }

  function runBlobPath(runRoot: string, sha: string): string {
    return join(
      runRoot,
      RUNS_SUBDIR,
      slugBranch(LOCAL_FIXTURE_RUN_ID),
      RUN_EVIDENCE_BLOBS_SUBDIR,
      sha,
    )
  }

  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
  })

  function runPipeline(options: { runRoot: string; bundleRoot: string }) {
    const loaded = new FsHandoffSource({
      root: options.runRoot,
      runId: LOCAL_FIXTURE_RUN_ID,
    }).load()
    const extraction = extractRunCassettes({
      handoff: loaded,
      artifacts: new FsRunArtifactSource({ root: options.runRoot, runId: LOCAL_FIXTURE_RUN_ID }),
    })
    const store = new FsCassetteStore({ root: options.bundleRoot })
    return {
      extraction,
      written: extraction.cassettes.map(cassette => store.write(cassette)),
    }
  }

  it('copies leaf and procedure bundles from a store-minted screenshot ref', async () => {
    const runRoot = await tempRoot('eval-local-run-')
    const bundleRoot = await tempRoot('eval-local-bundles-')
    const copiedRoot = await tempRoot('eval-local-copied-')

    const ref = new FsEvidenceArtifactStore({
      root: runRoot,
      runId: LOCAL_FIXTURE_RUN_ID,
    }).persistDecisionScreenshot(LOCAL_FIXTURE_BLOB_BYTES)
    expect(ref.sha).toBe(LOCAL_FIXTURE_BLOB_SHA)
    new FsHandoffStore({ root: runRoot, runId: LOCAL_FIXTURE_RUN_ID }).save(
      makeLocalV2Handoff({}, ref),
    )

    const { extraction, written } = runPipeline({ runRoot, bundleRoot })
    const leafIndex = extraction.cassettes.findIndex(entry => entry.cassette.granularity === 'leaf')
    const procedureIndex = extraction.cassettes.findIndex(
      entry => entry.cassette.granularity === 'procedure',
    )
    expect(leafIndex).toBeGreaterThanOrEqual(0)
    expect(procedureIndex).toBeGreaterThanOrEqual(0)

    const copiedBundles = [
      { source: written[leafIndex]!.dir, destination: join(copiedRoot, 'leaf') },
      { source: written[procedureIndex]!.dir, destination: join(copiedRoot, 'procedure') },
    ]
    for (const bundle of copiedBundles) {
      await cp(bundle.source, bundle.destination, { recursive: true })
    }

    for (const bundle of copiedBundles) {
      const raw = await readFile(join(bundle.destination, CASSETTE_FILE), 'utf8')
      const cassette = guardCassette(JSON.parse(raw))
      expect(cassette.blobs).toEqual([ref.sha])
      for (const sha of cassette.blobs) {
        const bytes = await readFile(join(bundle.destination, BLOBS_SUBDIR, sha))
        expect(bytes).toEqual(Buffer.from(LOCAL_FIXTURE_BLOB_BYTES))
        expect(createHash('sha256').update(bytes).digest('hex')).toBe(sha)
      }
      expect(raw).not.toContain(runRoot)
      expect(raw).not.toContain(bundleRoot)
    }
  })

  it('writes every affected cassette as evidence-incomplete after source-blob GC', async () => {
    const runRoot = await tempRoot('eval-local-gc-run-')
    const bundleRoot = await tempRoot('eval-local-gc-bundles-')

    const ref = new FsEvidenceArtifactStore({
      root: runRoot,
      runId: LOCAL_FIXTURE_RUN_ID,
    }).persistDecisionScreenshot(LOCAL_FIXTURE_BLOB_BYTES)
    new FsHandoffStore({ root: runRoot, runId: LOCAL_FIXTURE_RUN_ID }).save(
      makeLocalV2Handoff({}, ref),
    )
    await unlink(runBlobPath(runRoot, ref.sha))

    const { extraction, written } = runPipeline({ runRoot, bundleRoot })
    const affected = extraction.cassettes
      .map((entry, index) => ({ entry, written: written[index]! }))
      .filter(({ entry }) => entry.cassette.blobs.includes(ref.sha))

    expect(affected).toHaveLength(2)
    for (const item of affected) {
      expect(item.entry.cassette.completeness).toEqual({
        status: 'evidence-incomplete',
        missingBlobShas: [ref.sha],
      })
      const persisted = guardCassette(
        JSON.parse(await readFile(join(item.written.dir, CASSETTE_FILE), 'utf8')),
      )
      expect(persisted.completeness).toEqual({
        status: 'evidence-incomplete',
        missingBlobShas: [ref.sha],
      })
      expect(item.written.writtenBlobShas).toEqual([])
      expect(await exists(join(item.written.dir, BLOBS_SUBDIR))).toBe(false)
    }
  })

  it('rejects a pre-instrumentation handoff through the typed runner-local guard', async () => {
    const runRoot = await tempRoot('eval-local-v1-run-')
    new FsHandoffStore({ root: runRoot, runId: LOCAL_FIXTURE_RUN_ID }).save(
      makeLocalV2Handoff({ schemaVersion: 1 }),
    )
    const source = new FsHandoffSource({ root: runRoot, runId: LOCAL_FIXTURE_RUN_ID })

    expect(() => source.load()).toThrowError(HandoffVersionError)
  })
})
