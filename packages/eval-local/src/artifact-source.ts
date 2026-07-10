// Filesystem artifact-source implementations for eval extraction (Phase 367, D-02 / Open Q1a).
//
// No run directory currently owns a sha-keyed blob store. `absentArtifactSource` states that fact
// honestly so a present-but-unservable reference becomes evidence-incomplete downstream. The
// directory-backed implementation is the real copy-in seam for tests and future callers:
//
//   <dir>/<lowercase 64-hex sha>
//
// The sha is validated before any path or filesystem use. A future runner-local blob write leg can
// bind the same eval port without changing pure extraction logic.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { ArtifactSource } from '@vostride/agent-qa-eval'

const BLOB_SHA_RE = /^[0-9a-f]{64}$/

export const absentArtifactSource: ArtifactSource = {
  getBlob: () => undefined,
}

export interface DirArtifactSourceConfig {
  /** Directory containing one file per lowercase 64-hex content sha. */
  dir: string
}

export class DirArtifactSource implements ArtifactSource {
  private readonly dir: string

  constructor(config: DirArtifactSourceConfig) {
    this.dir = config.dir
  }

  getBlob(sha: string): Uint8Array | undefined {
    if (!BLOB_SHA_RE.test(sha)) return undefined

    try {
      return new Uint8Array(readFileSync(join(this.dir, sha)))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
  }
}
