import { createHash } from 'node:crypto'
import { cp, mkdtemp, readFile, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { extractRunCassettes, guardCassette } from '@vostride/agent-qa-eval'
import { FsHandoffStore, RUNS_SUBDIR } from '@vostride/agent-qa-runner-local'
import { HandoffVersionError } from '@vostride/agent-qa-schema'
import { afterEach, describe, expect, it } from 'vitest'

import { DirArtifactSource } from '../artifact-source.js'
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

  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
  })

  async function runPipeline(options: {
    runRoot: string
    blobDir: string
    bundleRoot: string
  }) {
    const loaded = new FsHandoffSource({
      root: options.runRoot,
      runId: LOCAL_FIXTURE_RUN_ID,
    }).load()
    const extraction = extractRunCassettes({
      handoff: loaded,
      artifacts: new DirArtifactSource({ dir: options.blobDir }),
    })
    const store = new FsCassetteStore({ root: options.bundleRoot })
    return {
      extraction,
      written: extraction.cassettes.map(cassette => store.write(cassette)),
    }
  }

  it('copies leaf and procedure bundles that guard-load with every blob and no source path', async () => {
    const runRoot = await tempRoot('eval-local-run-')
    const blobDir = await tempRoot('eval-local-blobs-')
    const bundleRoot = await tempRoot('eval-local-bundles-')
    const copiedRoot = await tempRoot('eval-local-copied-')
    new FsHandoffStore({ root: runRoot, runId: LOCAL_FIXTURE_RUN_ID }).save(
      makeLocalV2Handoff(),
    )
    await writeFile(join(blobDir, LOCAL_FIXTURE_BLOB_SHA), LOCAL_FIXTURE_BLOB_BYTES)

    const { extraction, written } = await runPipeline({ runRoot, blobDir, bundleRoot })
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

    expect(await exists(join(copiedRoot, RUNS_SUBDIR))).toBe(false)
    for (const bundle of copiedBundles) {
      const raw = await readFile(join(bundle.destination, CASSETTE_FILE), 'utf8')
      const cassette = guardCassette(JSON.parse(raw))
      expect(cassette.blobs).toEqual([LOCAL_FIXTURE_BLOB_SHA])
      for (const sha of cassette.blobs) {
        const bytes = await readFile(join(bundle.destination, BLOBS_SUBDIR, sha))
        expect(bytes).toEqual(Buffer.from(LOCAL_FIXTURE_BLOB_BYTES))
        expect(createHash('sha256').update(bytes).digest('hex')).toBe(sha)
      }
      expect(raw).not.toContain(runRoot)
      expect(raw).not.toContain(blobDir)
      expect(raw).not.toContain(bundleRoot)
    }
  })

  it('writes every affected cassette as evidence-incomplete after source-blob GC', async () => {
    const runRoot = await tempRoot('eval-local-gc-run-')
    const blobDir = await tempRoot('eval-local-gc-blobs-')
    const bundleRoot = await tempRoot('eval-local-gc-bundles-')
    new FsHandoffStore({ root: runRoot, runId: LOCAL_FIXTURE_RUN_ID }).save(
      makeLocalV2Handoff(),
    )
    const blobPath = join(blobDir, LOCAL_FIXTURE_BLOB_SHA)
    await writeFile(blobPath, LOCAL_FIXTURE_BLOB_BYTES)
    await unlink(blobPath)

    const { extraction, written } = await runPipeline({ runRoot, blobDir, bundleRoot })
    const affected = extraction.cassettes
      .map((entry, index) => ({ entry, written: written[index]! }))
      .filter(({ entry }) => entry.cassette.blobs.includes(LOCAL_FIXTURE_BLOB_SHA))

    expect(affected).toHaveLength(2)
    for (const item of affected) {
      expect(item.entry.cassette.completeness).toEqual({
        status: 'evidence-incomplete',
        missingBlobShas: [LOCAL_FIXTURE_BLOB_SHA],
      })
      expect(await exists(join(item.written.dir, CASSETTE_FILE))).toBe(true)
      const persisted = guardCassette(
        JSON.parse(await readFile(join(item.written.dir, CASSETTE_FILE), 'utf8')),
      )
      expect(persisted.completeness).toEqual({
        status: 'evidence-incomplete',
        missingBlobShas: [LOCAL_FIXTURE_BLOB_SHA],
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
