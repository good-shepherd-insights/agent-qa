import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { DirArtifactSource, absentArtifactSource } from '../artifact-source.js'
import {
  LOCAL_FIXTURE_BLOB_BYTES,
  LOCAL_FIXTURE_BLOB_SHA,
} from './fixtures/local-handoff-fixture.js'

describe('artifact sources (D-02 / Open Q1a)', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'eval-local-artifacts-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('models a run with no sha-keyed blob store as honest absence', () => {
    expect(absentArtifactSource.getBlob(LOCAL_FIXTURE_BLOB_SHA)).toBeUndefined()
  })

  it('serves an existing lowercase 64-hex blob and reports an absent blob', async () => {
    await writeFile(join(dir, LOCAL_FIXTURE_BLOB_SHA), LOCAL_FIXTURE_BLOB_BYTES)
    const source = new DirArtifactSource({ dir })

    expect(source.getBlob(LOCAL_FIXTURE_BLOB_SHA)).toEqual(LOCAL_FIXTURE_BLOB_BYTES)
    expect(source.getBlob('f'.repeat(64))).toBeUndefined()
  })

  it('rejects malformed shas before any filesystem read', () => {
    const source = new DirArtifactSource({ dir: '\0must-not-reach-fs' })

    expect(source.getBlob('../outside')).toBeUndefined()
    expect(source.getBlob('A'.repeat(64))).toBeUndefined()
  })
})
