// Concrete filesystem content-addressed evidence artifact store (Phase 367, CASS-02).
//
// Implements the storage-neutral `EvidenceArtifactStorePort` from @vostride/agent-qa-runner. This
// is a storageImplementation home for node:crypto + node:fs + node:path (the FsHandoffStore /
// FsRunArtifactStore boundary) — the sha-keyed screenshot-byte writes live here, never in the
// runner (validate:arch storageNeutral). On-disk layout, in the SAME run family as
// events.jsonl / handoff.json / artifact.json:
//
//   <root>/runs/<slug(runId)>/blobs/<sha>
//
// The runId directory component is slugged traversal-safe (the shared `slugBranch` idiom via
// RUNS_SUBDIR) so a planner-supplied `../..`-shaped runId can never escape the runs root; the path
// is never re-minted here. Filenames ARE the lowercase SHA-256 of their exact bytes, so a repeat
// write of identical bytes overwrites the same file and stays idempotent. `getBlob` validates the
// lowercase 64-hex shape before any path use so a malformed/traversal-shaped sha can never address
// an arbitrary file (T-367-16); ENOENT is honest absence, other host failures surface.
//
// PRESENCE IS A STAT, NOT A READ (Phase 406, D-17). `hasBlob` answers whether a run still holds
// the bytes behind an artifact ref so a durable read can annotate a whole run's refs without
// loading a single screenshot; it runs the SAME regex guard first, for the same reason, and
// touches the filesystem only after the shape is known good.

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { ArtifactRef, EvidenceDocument } from '@vostride/agent-qa-schema'
import type { EvidenceArtifactStorePort } from '@vostride/agent-qa-runner'

import { slugBranch } from './branch-resolver.js'
import { RUNS_SUBDIR } from './event-log.js'

/** Subdirectory under each slugged run dir holding the content-addressed evidence blobs. */
export const RUN_EVIDENCE_BLOBS_SUBDIR = 'blobs'

const SHA256_HEX_RE = /^[0-9a-f]{64}$/

export interface FsEvidenceArtifactStoreConfig {
  /** Runtime root (e.g. DEFAULT_AGENT_QA_DIR = '.agent-qa'). */
  root: string
  /** The run these blobs belong to; slugged before it becomes a path segment. */
  runId: string
}

export class FsEvidenceArtifactStore implements EvidenceArtifactStorePort {
  private readonly dir: string

  constructor(config: FsEvidenceArtifactStoreConfig) {
    this.dir = join(config.root, RUNS_SUBDIR, slugBranch(config.runId), RUN_EVIDENCE_BLOBS_SUBDIR)
  }

  persistDecisionScreenshot(bytes: Uint8Array): ArtifactRef {
    const sha = createHash('sha256').update(bytes).digest('hex')
    mkdirSync(this.dir, { recursive: true })
    writeFileSync(join(this.dir, sha), bytes)
    return { id: `decision-screenshot:${sha}`, sha }
  }

  persistEvidenceDocument(document: Exclude<EvidenceDocument, { kind: 'variables' }>): ArtifactRef {
    return this.persistDecisionScreenshot(Buffer.from(JSON.stringify(document)))
  }

  hasBlob(sha: string): boolean {
    if (!SHA256_HEX_RE.test(sha)) return false
    return existsSync(join(this.dir, sha))
  }

  getBlob(sha: string): Uint8Array | undefined {
    if (!SHA256_HEX_RE.test(sha)) return undefined
    try {
      return new Uint8Array(readFileSync(join(this.dir, sha)))
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw err
    }
  }
}
