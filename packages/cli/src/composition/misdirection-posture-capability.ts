// The durable per-run root posture, composed once for both hosts (422-27, D-19).
//
// A module of its own: doctor imports misdirection-run-state and must not pull in
// curation-tail; the daemon's strip-only source loader must not pull terminal-host
// machinery. Both hosts spread this one builder so the recorded posture follows the
// same run-directory and strict-record laws whichever host drains the analysis.

import type { PostRunJobCapabilities } from '@vostride/agent-qa-agent'

import { completedRunDir } from '../curation/curation-tail.js'
import { readMisdirectionRunPosture } from '../curation/misdirection-run-state.js'

export type MisdirectionPostureCapability = Required<
  Pick<PostRunJobCapabilities, 'readMisdirectionRootPosture'>
>

export function misdirectionPostureCapability(input: {
  agentQaRoot: string
}): MisdirectionPostureCapability {
  return {
    readMisdirectionRootPosture: (runId) =>
      readMisdirectionRunPosture(completedRunDir(input.agentQaRoot, runId), runId)?.kind,
  }
}
