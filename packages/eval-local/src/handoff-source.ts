// Filesystem handoff source for eval extraction (Phase 367, D-02).
//
// Implements eval's storage-neutral HandoffSource over the one runner-local read leg. The path is
// composed exclusively from runner-local's exported layout constants and sanitizer:
//
//   <root>/runs/<slug(runId)>/handoff.json
//
// `loadCompletedRunHandoff` remains the sole JSON read + handoff version guard. This adapter owns
// host path composition without re-deriving either the run-directory layout or version discipline.

import { join } from 'node:path'

import type { HandoffSource } from '@vostride/agent-qa-eval'
import {
  HANDOFF_FILE,
  RUNS_SUBDIR,
  loadCompletedRunHandoff,
  slugBranch,
} from '@vostride/agent-qa-runner-local'
import type { CompletedRunHandoff } from '@vostride/agent-qa-schema'

export interface FsHandoffSourceConfig {
  /** Runtime root (for example, the workdir's `.agent-qa` directory). */
  root: string
  /** The run to load; runner-local sanitizes it before path use. */
  runId: string
}

export class FsHandoffSource implements HandoffSource {
  private readonly file: string

  constructor(config: FsHandoffSourceConfig) {
    this.file = join(config.root, RUNS_SUBDIR, slugBranch(config.runId), HANDOFF_FILE)
  }

  load(): CompletedRunHandoff {
    return loadCompletedRunHandoff(this.file)
  }
}
