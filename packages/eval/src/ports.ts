// Eval-owned read ports (D-02). CRITICAL: provider-neutral and storage-neutral.
// Implementations live in eval-local; this package only consumes in-memory values.

import type { CompletedRunHandoff } from '@vostride/agent-qa-schema'

/**
 * One loaded run handoff. An instance is bound to one run; eval-local's
 * `FsHandoffSource` owns the host-backed implementation.
 */
export interface HandoffSource {
  load(): CompletedRunHandoff
}

/**
 * Content-addressed artifact bytes. Absence is legitimate and is classified by
 * cassette completeness; eval-local supplies `absentArtifactSource` and
 * `DirArtifactSource` implementations.
 */
export interface ArtifactSource {
  getBlob(sha: string): Uint8Array | undefined
}
