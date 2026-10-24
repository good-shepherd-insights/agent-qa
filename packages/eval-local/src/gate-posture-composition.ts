// GATE-SIDE posture composition (414 D-15, ROOT-10) — the committed-root read leg folded into
// eval core's pure `readGatePosture`.
//
// Composition law, the census-committing shape applied to the gate: every filesystem read lives
// in eval-local and every derivation lives in eval core. This helper loads the corpus snapshot
// and the partition manifests off disk and hands both to `readGatePosture`, which computes.
// Nothing here counts, resolves a scope or judges capability.
//
// WHY THE MAIN ENTRY. This is the GATE's view of what could gate, and the gate is not the
// proposer. Plan 06's `/reader` subpath is the proposer-visible port — it must never see private
// held-out entries, and D-09 says private entries DO gate. Exporting the posture from `/reader`
// would hand the proposer a count of the very entries the split exists to hide from it, so this
// symbol lives on the main entry and the reader port does not re-export it.
//
// Refusal posture, inherited from both reads: a committed root is hand-editable, so an
// unadmittable manifest or corpus entry is a refusal ROW carried out to the caller beside the
// posture, never a throw and never a silently smaller answer. A refused manifest is a manifest
// that is not there — the partition echo reports `absent` and the posture still answers.

import { readGatePosture } from '@vostride/agent-qa-eval'
import type {
  CanaryEvidenceSummary,
  GatePosture,
  JudgeCapabilityInput,
} from '@vostride/agent-qa-eval'
import type { ScopeKey } from '@vostride/agent-qa-schema'

import { dirname, join } from 'node:path'
import { readActiveCommittedCorpus, readPartitionManifests } from './committed-corpus-source.js'
import type { CommittedReadRefusal } from './committed-corpus-source.js'

export interface ReadGatePostureForInput {
  /** Explicit absolute committed-root path — `<configDir>/agent-qa-eval` for the CLI. */
  committedRoot: string
  agentQaRoot?: string
  /** The scope being asked about; `resolveProductPartition` is the ONE mapping (D-16). */
  scope: ScopeKey
  /** REQUIRED integer floor, >= 1. No default exists anywhere (D-12). */
  minimumGateSet: number
  /** Complete raw judge declaration and recorded identity; passed intact to the pure fold. */
  judge: JudgeCapabilityInput
  /** Canary evidence as DATA; eval never imports knowledge-local. */
  canary: CanaryEvidenceSummary
}

export interface ReadGatePostureForResult {
  posture: GatePosture
  /** Every notice both reads produced, in read order: corpus first, then manifests. */
  notices: string[]
  /** Every refusal both reads produced — never dropped, never merged into a count. */
  refusals: readonly CommittedReadRefusal[]
}

/**
 * Read the committed root and fold it into the gate posture for one scope.
 *
 * Throws only what `readGatePosture` throws: a `minimumGateSet` that is not a positive integer is
 * a caller bug, not data. Everything the DISK got wrong is a refusal row.
 */
export function readGatePostureFor(input: ReadGatePostureForInput): ReadGatePostureForResult {
  const corpus = readActiveCommittedCorpus(input.committedRoot,
    input.agentQaRoot ?? join(dirname(input.committedRoot), '.agent-qa'))
  const manifests = readPartitionManifests(input.committedRoot)

  const posture = readGatePosture({
    snapshot: corpus.snapshot,
    manifests: manifests.manifests,
    scope: input.scope,
    minimumGateSet: input.minimumGateSet,
    judge: input.judge,
    canary: input.canary,
  })

  return {
    posture,
    notices: [...corpus.notices, ...manifests.notices],
    refusals: [...corpus.refusals, ...manifests.refusals],
  }
}
