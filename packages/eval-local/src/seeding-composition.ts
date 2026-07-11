// The ONE sanctioned seeding-composition helper (Phase 371, ROOT-02/D-13/D-14/D-15/D-16/D-17) —
// sibling of runCassetteReplay, same recipe. It EXECUTES a pure eval-core SeedingPlan against the
// write-once committed root and returns a typed SeedingReport; it never selects, labels, or
// re-decides (the planner is the only decision-maker, D-16). Phase 372's CLI wraps exactly this
// function.
//
// Composition law (ROOT-02):
//   - Every committed TEXT write — gitignore, root marker, contracts projections, cassette, label
//     record, corpus entry — passes through `assertCommittedEgressSafe` with a labeled part, the
//     'eval-seeding' channel, and a JsonlAuditSink BEFORE any byte reaches the store. Cassette text
//     arrives placeholder-masked from record time (the MaskingContext layer is upstream at
//     recording; ROOT-02's "after masking" is satisfied by construction) — this checkpoint is the
//     LAST line of defense, fail-closed on pattern detections, audit rows appended before any throw.
//   - The atomic unit is the CASE: cassette + label record + corpus entry are checkpointed in ONE
//     call and land together or not at all. A block refuses the whole case as a typed refusal
//     carrying the detector labels, and the batch continues — never a batch abort (D-14).
//   - Write-once (D-17): all of a case's text paths are PREVIEWED against the store before any
//     write; a conflict on ANY file refuses the whole case before anything lands. Byte-identical
//     re-seeding reports 'unchanged' everywhere and mutates nothing.
//   - Blob bytes bypass the text checkpoint (pixels are unscannable) and land only under
//     ignore-covered blobs/ paths after the store's sha-format + byte-hash verification (D-15). A
//     blob verification refusal surfaces as the same typed write-conflict — never silent.
//   - Every committed text is serialized by eval core's committedFileText (the ONE serializer);
//     canonical key order is what makes the byte-compare idempotence hold across re-seeds.
//   - The helper makes ZERO model calls and opens no safety scope: the audit sink goes to the
//     checkpoint opts directly.

import {
  committedFileText,
  contractFileName,
  projectJudgeConfigContract,
  projectMatcherConfigContract,
} from '@vostride/agent-qa-eval'
import type {
  ExtractedCassette,
  PairSkip,
  SeedingPlan,
  SilverExclusion,
} from '@vostride/agent-qa-eval'
import {
  CommittedEgressBlockedError,
  assertCommittedEgressSafe,
  defaultGuardrailPolicyInput,
  loadGuardrailPolicy,
} from '@vostride/agent-qa-safety'
import { JsonlAuditSink } from '@vostride/agent-qa-safety-local'
import type { GuardrailPolicy } from '@vostride/agent-qa-schema'

import {
  COMMITTED_GITIGNORE_TEXT,
  FsCommittedRootStore,
  buildRootMarkerValue,
  committedBlobPath,
  committedCassettePath,
  committedContractPath,
  committedCorpusPath,
  committedLabelPath,
} from './committed-root-store.js'
import type { CommittedWriteOutcome } from './committed-root-store.js'

/** The ROOT-02 checkpoint channel: audit rows land as `eval-seeding:<part label>`. */
export const SEEDING_EGRESS_CHANNEL = 'eval-seeding'

export interface SeedCommittedCorpusInput {
  /** The pure eval-core plan — the ONLY decision-maker; this helper executes it verbatim (D-16). */
  plan: SeedingPlan
  /** The extracted cassettes the plan's cases reference (cassette bytes + verified blobs). */
  cassettes: readonly ExtractedCassette[]
  /** Explicit absolute committed-root path — `<configDir>/agent-qa-eval` for the 372 CLI. */
  committedRoot: string
  /** Seeding-scoped audit-sink base dir (the JsonlAuditSink lands guardrail rows here). */
  seedingOutputBaseDir: string
  /** Guardrail policy; defaults to the shipped default input, injectable for tests. */
  policy?: GuardrailPolicy
}

export type SeedingRefusal =
  | {
      cassetteId: string
      kind: 'egress-blocked'
      detections: readonly { label: string; detector: string }[]
    }
  | { cassetteId: string; kind: 'write-conflict'; path: string }
  | { cassetteId: string; kind: 'missing-cassette' }

export interface SeedingReport {
  product: string
  runId: string
  committedRoot: string
  /** Cases with at least one newly written file. */
  seededCount: number
  /** Cases whose every file was byte-identical (D-17 idempotent no-op). */
  unchangedCount: number
  /** Typed per-case refusals — egress blocks, write conflicts, missing cassettes. Never silent. */
  refusals: SeedingRefusal[]
  /** Matcher skips, carried verbatim from the plan. */
  pairSkips: PairSkip[]
  /** Sampler exclusions, carried verbatim from the plan. */
  silverExclusions: SilverExclusion[]
  /** Both pair classes counted, carried verbatim from the plan (D-07). */
  pairCounts: { total: number; sameState: number; differingState: number }
  /** Count of 'procedure-granularity' exclusions, carried verbatim from the plan. */
  proceduresExcludedCount: number
  /** Per-contract-file outcome for the D-04 constitution projections. */
  contracts: { fileName: string; outcome: CommittedWriteOutcome['kind'] }[]
  /** D-15 scaffold outcomes for the blobs-covering gitignore and the schemaVersion marker. */
  scaffold: {
    gitignore: CommittedWriteOutcome['kind']
    marker: CommittedWriteOutcome['kind']
  }
}

/**
 * Execute a SeedingPlan against the committed root: scaffold (D-15), contracts projections
 * (D-04), then each case as an atomic checkpoint-then-preview-then-write unit (D-14/D-17).
 * Blocked or conflicted cases refuse atomically; the batch always runs to completion.
 */
export function seedCommittedCorpus(input: SeedCommittedCorpusInput): SeedingReport {
  const store = new FsCommittedRootStore({ committedRoot: input.committedRoot })
  const auditSink = new JsonlAuditSink(input.seedingOutputBaseDir)
  const policy = input.policy ?? loadGuardrailPolicy(defaultGuardrailPolicyInput)
  const checkpointOpts = { policy, channel: SEEDING_EGRESS_CHANNEL, auditSink }

  // (1) Scaffold: both texts checkpointed in one call, then handed to the store pre-checked
  // (the store never imports the guardrail — this helper owns content policy).
  const checkedScaffold = assertCommittedEgressSafe(
    [
      { label: 'gitignore', text: COMMITTED_GITIGNORE_TEXT },
      { label: 'root-marker', text: committedFileText(buildRootMarkerValue()) },
    ],
    checkpointOpts,
  )
  const scaffoldOutcomes = store.scaffold(checkedScaffold[0]!, checkedScaffold[1]!)

  // (2) D-04 contracts projections, through the same checkpoint, one file per version.
  const contracts: SeedingReport['contracts'] = []
  for (const projection of [projectMatcherConfigContract(), projectJudgeConfigContract()]) {
    const fileName = contractFileName(projection)
    const checked = assertCommittedEgressSafe(
      [{ label: `contracts:${fileName}`, text: committedFileText(projection) }],
      checkpointOpts,
    )
    const outcome = store.writeText(committedContractPath(fileName), checked[0]!)
    contracts.push({ fileName, outcome: outcome.kind })
  }

  // (3) Per case, in plan order — the atomic unit is cassette + label record + corpus entry.
  const cassettesById = new Map<string, ExtractedCassette>()
  for (const entry of input.cassettes) {
    cassettesById.set(entry.cassette.id, entry)
  }

  const product = input.plan.product
  const refusals: SeedingRefusal[] = []
  let seededCount = 0
  let unchangedCount = 0

  for (const planCase of input.plan.cases) {
    const cassetteId = planCase.cassetteId
    const extracted = cassettesById.get(cassetteId)
    if (extracted === undefined) {
      refusals.push({ cassetteId, kind: 'missing-cassette' })
      continue
    }

    const texts: { relPath: string; text: string }[] = [
      { relPath: committedCassettePath(product, cassetteId), text: committedFileText(extracted.cassette) },
      { relPath: committedLabelPath(product, cassetteId), text: committedFileText(planCase.labelRecord) },
      { relPath: committedCorpusPath(product, cassetteId), text: committedFileText(planCase.corpusEntry) },
    ]

    // ONE checkpoint call covering ALL of the case's text parts — a block refuses the whole
    // unit with the detector labels and the batch continues (D-14).
    try {
      assertCommittedEgressSafe(
        [
          { label: `cassette:${cassetteId}`, text: texts[0]!.text },
          { label: `label:${cassetteId}`, text: texts[1]!.text },
          { label: `corpus:${cassetteId}`, text: texts[2]!.text },
        ],
        checkpointOpts,
      )
    } catch (err) {
      if (err instanceof CommittedEgressBlockedError) {
        refusals.push({
          cassetteId,
          kind: 'egress-blocked',
          detections: err.blocked.map(({ label, detector }) => ({ label, detector })),
        })
        continue
      }
      throw err
    }

    // Preview ALL text paths before writing ANY — a conflict on one file refuses the whole
    // case with nothing partial landed (per-case atomicity across D-17 too).
    const conflicting = texts.find(
      (candidate) => store.previewText(candidate.relPath, candidate.text) === 'conflict',
    )
    if (conflicting !== undefined) {
      refusals.push({ cassetteId, kind: 'write-conflict', path: conflicting.relPath })
      continue
    }

    const outcomes: CommittedWriteOutcome[] = texts.map((candidate) =>
      store.writeText(candidate.relPath, candidate.text),
    )
    // Blob bytes bypass the checkpoint (binary, ignore-covered, D-15); the store verifies
    // sha format + byte hash before landing. A verification refusal is surfaced typed.
    let blobConflictPath: string | undefined
    for (const blob of extracted.blobs) {
      const relBlobPath = committedBlobPath(product, cassetteId, blob.sha)
      const outcome = store.writeBlob(relBlobPath, blob)
      outcomes.push(outcome)
      if (outcome.kind === 'write-conflict' && blobConflictPath === undefined) {
        blobConflictPath = outcome.path
      }
    }
    if (blobConflictPath !== undefined) {
      refusals.push({ cassetteId, kind: 'write-conflict', path: blobConflictPath })
      continue
    }

    if (outcomes.some((outcome) => outcome.kind === 'written')) {
      seededCount += 1
    } else {
      unchangedCount += 1
    }
  }

  // (4) The report: every skip, refusal, and count visible — never silent (T-371-18).
  return {
    product,
    runId: input.plan.runId,
    committedRoot: input.committedRoot,
    seededCount,
    unchangedCount,
    refusals,
    pairSkips: [...input.plan.pairSkips],
    silverExclusions: [...input.plan.silverExclusions],
    pairCounts: { ...input.plan.pairCounts },
    proceduresExcludedCount: input.plan.proceduresExcludedCount,
    contracts,
    scaffold: {
      gitignore: scaffoldOutcomes.gitignore.kind,
      marker: scaffoldOutcomes.rootMarker.kind,
    },
  }
}
