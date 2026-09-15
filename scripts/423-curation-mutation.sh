#!/usr/bin/env bash
# 423-curation-mutation.sh — curation's fixed snapshot, its durable classification and its closed
# vocabularies cannot silently regress (423-23, PXH-KNOW-06 / PXH-RUN-06).
#
# WHAT THIS PROVES, AND WHY A GREEN SUITE DOES NOT PROVE IT. A run's curation snapshot is a RECORD:
# the classification curation made when it committed, copied forward byte for byte and never
# re-derived from the store's present state. Every tempting shortcut — reading the applied delta
# instead of the recorded downgrade, writing the receipt after the outer checkpoint, refolding the
# snapshot from today's diff, handing the notification the live object — produces a plausible
# snapshot that is wrong exactly when a crash, a later promotion or a downgrade happened. So each
# leg plants one of those shortcuts in production source and requires its named cell to red while
# the listed controls hold. The closed sets (buckets, stages, snapshot arms, receipt versions) are
# widened COHERENTLY so production still compiles and only the independent oracle can object.
#
# THE LEGS
#   C01  a sixth bucket joins the bucket union and list (production compiles)  -> C423-BUCKETS-EXACT runtime+type
#   C02  a fourth detail stage joins the stage union and list                  -> C423-STAGES-EXACT runtime+type
#   C03  the row validator picks the WEAKEST recorded bucket                   -> STRONGEST-ONCE (schema)
#   C04  the snapshot validator admits a replacement Add as its own row        -> REPLACEMENT-NOT-ADDED
#   C05  the proposed snapshot arm admits a deprecation change                 -> SNAPSHOT-DISCRIMINANTS runtime + arm type census
#   C06  the effect read discards the recorded downgrade and uses the change   -> DOWNGRADE-ORIGIN
#   C07  completion receipts are written only after the intent is cleared      -> CRASH-BEFORE-OUTER-CHECKPOINT
#   C08  the fold keeps a replacement's Add as a second membership             -> STRONGEST-ONCE (fold)
#   C09  the effect receipt admits a second schema version                     -> EFFECT-RECEIPT-ROUNDTRIP (receipt census)
#   C10  runs.knowledge re-reads the snapshot's changes from the current diff  -> SNAPSHOT-STABLE
#   C11  the terminal notification carries the live snapshot, not its copy    -> NOTIFICATION-COPY
#   C12  a third withheld reason joins the withheld union and list            -> C423-WITHHELD-EXACT runtime+type
#   C13  a refused snapshot projection throws instead of withholding          -> POSTPROCESSING-SNAPSHOT-WITHHELD
#   C14  cold masking refuses every source when one auth payload is missing   -> COLD-AUTH-SKIPPED
#
# C06 and C07 are the "replay classification loss" pair: one loses the original disposition at
# read time, the other loses the durable receipt across a crash between receipt and checkpoint.
#
# Engine, arrival proof, counted selection and restoration: scripts/423-mutation-engine.cjs.
#
# USAGE
#   pnpm run validate:423-curation-mutation              # from the agent-qa root
#   bash agent-qa/scripts/423-curation-mutation.sh       # from the super-repository root
#
# KNOBS — AGENT_QA_423_CURATION_MUTATION_SELFTEST
#   neutered  apply NO mutation; the run must FATAL with "<leg>: suite stayed green"
#   fatal     mutate every subject, then throw; every subject must be restored
#   SIGINT | SIGTERM | SIGHUP   the same, then deliver that signal to itself
# AGENT_QA_423_CURATION_MUTATION_LEG=C01..C14 runs one leg (normal or neutered runs only).
# AGENT_QA_423_CURATION_MUTATION_LIST=1 prints the declared inventory and exits.
#
# Installed Node 24 and workspace tools are required. No downloads or provider calls. Ends with a
# forced workspace build whenever a byte was mutated.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
exec node --input-type=commonjs - <<'NODE'
const path = require('node:path')
const { runGate, cell } = require(path.join(process.cwd(), 'scripts/423-mutation-engine.cjs'))

const SNAP = 'packages/schema/src/notification/curation-snapshot.ts'
const STAGES = 'packages/schema/src/notification/post-processing-status.ts'
const FOLD = 'packages/knowledge-local/src/curator/curation-snapshot.ts'
const COMMIT = 'packages/knowledge-local/src/curator/commit.ts'
const RECEIPT = 'packages/knowledge-local/src/journal/curation-effect-receipt.ts'
const KNOWLEDGE = 'packages/agent/src/functions/ops/runs-knowledge.ts'
const CHAIN = 'packages/agent/src/jobs/chain-identity.ts'
const READ = 'packages/agent/src/functions/ops/runs-post-processing.ts'
const COLD = 'packages/cli/src/composition/local-agent-host.ts'

const CUR = 'src/__tests__/423-curation-contracts.test.ts'
const CUR_D = 'src/__tests__/423-curation-contracts.test-d.ts'
const STG = 'src/__tests__/423-stage-contracts.test.ts'
const STG_D = 'src/__tests__/423-stage-contracts.test-d.ts'
const SNAPSHOT = 'src/__tests__/423-curation-snapshot.test.ts'
const RECOVERY = 'src/__tests__/423-curation-recovery.test.ts'
const RUNS = 'src/functions/__tests__/runs-knowledge.test.ts'
const CHAIN_T = 'src/jobs/__tests__/chain-identity.test.ts'
const READ_T = 'src/functions/__tests__/runs-post-processing.test.ts'
const COLD_T = 'src/composition/__tests__/cold-read-masking.test.ts'

const instruments = {
  'schema-curation': { pkg: 'packages/schema', files: [CUR, CUR_D], typecheck: true, count: 21 },
  'schema-stages': { pkg: 'packages/schema', files: [STG, STG_D], typecheck: true, count: 23 },
  'curation-store': { pkg: 'packages/knowledge-local', files: [SNAPSHOT, RECOVERY], typecheck: false, count: 30 },
  'runs-knowledge': { pkg: 'packages/agent', files: [RUNS], typecheck: false, count: 69 },
  'chain-notification': { pkg: 'packages/agent', files: [CHAIN_T], typecheck: false, count: 13 },
  'post-processing-read': { pkg: 'packages/agent', files: [READ_T], typecheck: false, count: 13 },
  'cold-read': { pkg: 'packages/cli', files: [COLD_T], typecheck: false, count: 28, env: { VITEST_MAX_WORKERS: '1' } },
}

const cur = name => cell('schema-curation', CUR, name)
const curD = name => cell('schema-curation', CUR_D, name)
const stg = name => cell('schema-stages', STG, `C423-STAGES-EXACT > ${name}`)
const stgD = name => cell('schema-stages', STG_D, `C423-STAGES-EXACT > ${name}`)
const snap = (name, count) => cell('curation-store', SNAPSHOT, name, count)
const rec = (name, count) => cell('curation-store', RECOVERY, name, count)
const runs = name => cell('runs-knowledge', RUNS, name)
const chain = (name, count) => cell('chain-notification', CHAIN_T, name, count)
const withheld = name => cell('schema-stages', STG, `C423-WITHHELD-EXACT > ${name}`)
const withheldD = name => cell('schema-stages', STG_D, `C423-WITHHELD-EXACT > ${name}`)
const read = (name, count) => cell('post-processing-read', READ_T, name, count)
const coldRead = (name, count) => cell('cold-read', COLD_T, name, count)

const legs = [
  {
    subject: SNAP, instrument: 'schema-curation', claim: 'C423-BUCKETS-EXACT', operation: 'widen the bucket union and list with a sixth reinforced bucket',
    edits: [
      { from: "export type CurationBucket = 'added' | 'confirmed' | 'superseded' | 'deprecated' | 'proposed'\n",
        to: "export type CurationBucket = 'added' | 'confirmed' | 'superseded' | 'deprecated' | 'proposed' | 'reinforced'\n" },
      { from: "export const CURATION_BREAKDOWN_BUCKETS = [\n  'added', 'confirmed', 'superseded', 'deprecated', 'proposed',\n]",
        to: "export const CURATION_BREAKDOWN_BUCKETS = [\n  'added', 'confirmed', 'superseded', 'deprecated', 'proposed', 'reinforced',\n]" },
      { from: 'export const CurationBucketSchema = z.enum(CURATION_BREAKDOWN_BUCKETS)\n',
        to: "export const CurationBucketSchema = z.enum(CURATION_BREAKDOWN_BUCKETS)\nconst counted423 = CURATION_BREAKDOWN_BUCKETS.filter((bucket): bucket is Exclude<CurationBucket, 'reinforced'> => bucket !== 'reinforced')\n" },
      { from: '  const counts: CurationBreakdown = {\n    added: 0, confirmed: 0, superseded: 0, deprecated: 0, proposed: 0,\n  }',
        to: '  const counts: Record<CurationBucket, number> = {\n    added: 0, confirmed: 0, superseded: 0, deprecated: 0, proposed: 0, reinforced: 0,\n  }' },
      { from: '  for (const bucket of CURATION_BREAKDOWN_BUCKETS) {\n    if (snapshot.breakdown[bucket]',
        to: '  for (const bucket of counted423) {\n    if (snapshot.breakdown[bucket]' },
    ],
    reds: [cur('C423-BUCKETS-EXACT'), curD('C423-BUCKETS-EXACT')],
    allowed: [curD('STRONGEST-ONCE: rows retain historical changes with exact bucket discriminants')],
    greens: [cur('SNAPSHOT-COUNTS-EXACT'), cur('INVALID-BREAKDOWN'), curD('SNAPSHOT-COUNTS-EXACT'),
      curD('REPLACEMENT-NOT-ADDED'), cur('STRONGEST-ONCE: every stronger historical bucket wins regardless of ordering')],
  },
  {
    subject: STAGES, instrument: 'schema-stages', claim: 'C423-STAGES-EXACT', operation: 'widen the detail stage union and list with an admission stage',
    edits: [
      { from: "export type PostProcessingDetailStage = 'analysis' | 'curation' | 'proposals'\n",
        to: "export type PostProcessingDetailStage = 'analysis' | 'curation' | 'proposals' | 'admission'\n" },
      { from: "  'proposals',\n] as const satisfies readonly PostProcessingDetailStage[]",
        to: "  'proposals',\n  'admission',\n] as const satisfies readonly PostProcessingDetailStage[]" },
    ],
    reds: [stg('pins the public detail list and schema to independent exact vocabularies'),
      stg('accepts the hand-spelled three detail stages and rejects a fourth'),
      stgD('pins three detail stages in both directions through public exports'),
      stgD('refuses a fourth stage and third chip at the type boundary')],
    allowed: [stgD('keeps each stage optional on the DTO and inferred result')],
    greens: [stg('keeps exactly two required chips with exactly four statuses'),
      stgD('pins exactly two chip keys and four statuses independently'),
      stgD('carries only the seven optional recorded facts through both barrels'),
      cell('schema-stages', STG, 'STAGE-DETAIL-OPTIONAL > parses all three recorded stage details through the public result schema')],
  },
  {
    subject: SNAP, instrument: 'schema-curation', claim: 'STRONGEST-ONCE', operation: 'classify a row by its weakest recorded bucket',
    edits: [{ from: '  const strongest = CURATION_BUCKET_PRECEDENCE.find((bucket) =>',
      to: '  const strongest = [...CURATION_BUCKET_PRECEDENCE].reverse().find((bucket) =>' }],
    reds: [cur('STRONGEST-ONCE: every stronger historical bucket wins regardless of ordering')],
    allowed: [],
    greens: [cur('STRONGEST-ONCE: duplicate affected records reject even with matching inflated counts'),
      cur('STRONGEST-ONCE: confirmation, canary and promotion retain distinct identities in one unit'),
      cur('C423-BUCKETS-EXACT'), cur('SNAPSHOT-COUNTS-EXACT'), cur('SNAPSHOT-STABLE')],
  },
  {
    subject: SNAP, instrument: 'schema-curation', claim: 'REPLACEMENT-NOT-ADDED', operation: 'admit a replacement Add as a second affected-record row',
    edits: [{ from: "    if (row.bucket === 'added' && replacements.has(row.recordId)) {",
      to: "    if (row.bucket === 'added' && replacements.has(row.recordId) && row.changes.length < 0) {" }],
    reds: [cur('REPLACEMENT-NOT-ADDED: victim represents replacement Add identity without a second membership'),
      cur('REPLACEMENT-NOT-ADDED: historical replacements remain suppressed after a later supersession')],
    allowed: [],
    greens: [curD('REPLACEMENT-NOT-ADDED'), cur('STRONGEST-ONCE: duplicate affected records reject even with matching inflated counts'),
      cur('SNAPSHOT-HISTORY'), cur('SNAPSHOT-COUNTS-EXACT'), cur('C423-BUCKETS-EXACT')],
  },
  {
    subject: SNAP, instrument: 'schema-curation', claim: 'SNAPSHOT-DISCRIMINANTS', operation: 'let the proposed snapshot arm carry a deprecation change',
    edits: [{ from: "    change: RecordChangeSchema.safeExtend({ change: z.enum(['added', 'confirmed']) }),",
      to: "    change: RecordChangeSchema.safeExtend({ change: z.enum(['added', 'confirmed', 'deprecated']) })," }],
    reds: [cur('SNAPSHOT-DISCRIMINANTS'),
      curD('STRONGEST-ONCE: rows retain historical changes with exact bucket discriminants')],
    allowed: [],
    greens: [cur('C423-BUCKETS-EXACT'), curD('C423-BUCKETS-EXACT'), curD('REPLACEMENT-NOT-ADDED'),
      cur('STRONGEST-ONCE: every stronger historical bucket wins regardless of ordering'), cur('SNAPSHOT-HISTORY')],
  },
  {
    subject: FOLD, instrument: 'curation-store', claim: 'DOWNGRADE-ORIGIN', operation: 'classify a receipt by its applied change, discarding the recorded downgrade',
    edits: [{ from: "    const bucket = receipt.disposition === 'downgraded' ? 'proposed' : receipt.change\n",
      to: '    const bucket = receipt.change\n' }],
    reds: [snap('DOWNGRADE-ORIGIN', 4)],
    allowed: [snap('CURATION-FIVE-BUCKETS'), snap('RESTART-REFOLD'), snap('PARTIAL-NO-FAKE-ZERO siblings')],
    greens: [snap('STRONGEST-ONCE'), snap('CANARY-SURVIVAL'), snap('LATER-PROMOTION-STORE'), snap('PARTIAL-NO-FAKE-ZERO single'),
      rec('DOWNGRADE-PROPOSE-ONLY'), rec('DOWNGRADE-EXISTING'), rec('CRASH-BEFORE-OUTER-CHECKPOINT')],
  },
  {
    subject: COMMIT, instrument: 'curation-store', claim: 'CRASH-BEFORE-OUTER-CHECKPOINT', operation: 'write completion receipts only after the commit intent is cleared',
    edits: [
      { from: '  deps.hooks?.afterEffectReceiptsWritten?.()\n  clearCommitIntent(deps.knowledgeRoot, job.candidateId)\n  deps.hooks?.afterIntentCleared?.()\n', to: '' },
      { from: '  projectSuccessfulPrefix = true,\n  completeClaim = true,\n): void {\n',
        to: '  projectSuccessfulPrefix = true,\n  completeClaim = true,\n): void {\n  deps.hooks?.afterEffectReceiptsWritten?.()\n  clearCommitIntent(deps.knowledgeRoot, job.candidateId)\n  deps.hooks?.afterIntentCleared?.()\n' },
    ],
    reds: [rec('CRASH-BEFORE-OUTER-CHECKPOINT')],
    allowed: [],
    greens: [rec('CRASH-AFTER-COMMIT'), rec('CRASH-AFTER-RECEIPT'), rec('CRASH-BEFORE-PUBLICATION'), rec('RESTART-REFOLD'),
      rec('EFFECT-IDEMPOTENT'), snap('RESTART-REFOLD'), snap('DOWNGRADE-ORIGIN', 4)],
  },
  {
    subject: FOLD, instrument: 'curation-store', claim: 'STRONGEST-ONCE', operation: "keep a replacement's Add as its own affected-record membership",
    edits: [{ from: '      replacement.changes = replacement.changes.filter(e => !adds.includes(e))\n', to: '' }],
    reds: [snap('STRONGEST-ONCE')],
    allowed: [snap('REPLACEMENT-INDEPENDENT-CONFIRM'), snap('CURATION-FIVE-BUCKETS'), snap('PARTIAL-NO-FAKE-ZERO', 2)],
    greens: [snap('DOWNGRADE-ORIGIN', 4), snap('CANARY-SURVIVAL'), snap('LATER-PROMOTION-STORE'), snap('HISTORICAL-MISSING'),
      rec('COMMIT-PARTIAL-EFFECTS')],
  },
  {
    subject: RECEIPT, instrument: 'curation-store', claim: 'EFFECT-RECEIPT-ROUNDTRIP', operation: 'admit a second schema version on the completion receipt',
    edits: [{ from: 'export const curationEffectReceiptSchema = z.object({\n  schemaVersion: z.literal(1),',
      to: 'export const curationEffectReceiptSchema = z.object({\n  schemaVersion: z.union([z.literal(1), z.literal(9)]),' }],
    reds: [rec('EFFECT-RECEIPT-ROUNDTRIP')],
    allowed: [],
    greens: [rec('EFFECT-IDEMPOTENT'), rec('INTENT-HISTORICAL'), rec('STALE-EPOCH-EFFECT'),
      rec('CRASH-BEFORE-OUTER-CHECKPOINT'), snap('RESTART-REFOLD')],
  },
  {
    subject: KNOWLEDGE, instrument: 'runs-knowledge', claim: 'SNAPSHOT-STABLE', operation: "re-read the fixed snapshot's changes from the current records diff",
    edits: [{ from: '    const curationSnapshot = status?.curationSnapshot\n      ?? status?.notification?.stages.curation.curationSnapshot\n',
      to: '    const recorded423 = status?.curationSnapshot\n      ?? status?.notification?.stages.curation.curationSnapshot\n'
        + '    const curationSnapshot = recorded423 === undefined ? undefined : { ...recorded423, rows: recorded423.rows.map((row) => ({ ...row,\n'
        + '      changes: row.changes.map((entry) => ({ ...entry, change: (changes.find((current) => current.recordId === entry.change.recordId\n'
        + '        && current.change === entry.change.change && current.atOrdinal === entry.change.atOrdinal) ?? entry.change) as typeof entry.change })) })) }\n' }],
    reds: [runs('SNAPSHOT-STABLE')],
    allowed: [runs('LATER-PROMOTION')],
    greens: [runs('FAILED-CHAIN-ROWS-RETAINED'), runs('CURRENT-VS-HISTORICAL'), runs('NOT-FOUND-RETAINED'),
      runs('JOINED-STRINGS-MASKED'), runs('keeps only rows this run produced and drops the neighbour and the orphan')],
  },
  {
    subject: CHAIN, instrument: 'chain-notification', claim: 'NOTIFICATION-COPY', operation: 'carry the live committed snapshot object instead of its checkpointed copy',
    edits: [{ from: "        ...(snapshot?.success ? { curationSnapshot: snapshot.data } : {}),\n      }\n    : { status: 'failed' }",
      to: "        ...(snapshot?.success ? { curationSnapshot: committed.curationSnapshot as typeof snapshot.data } : {}),\n      }\n    : { status: 'failed' }" }],
    reds: [chain('NOTIFICATION-COPY: direct completed curation detaches the authoritative snapshot')],
    allowed: [],
    greens: [chain('NOTIFICATION-COPY: actual handler successor preserves exact checkpoint for proposals', 2),
      chain('NOTIFICATION-COPY: historical complete and failed partial curation never invent a snapshot'),
      chain('NOTIFICATION-COPY: a present invalid snapshot fails generically rather than disappearing'),
      chain('still reads counts off the finishing job when curate-memory itself is the terminal')],
  },
  {
    subject: STAGES, instrument: 'schema-stages', claim: 'C423-WITHHELD-EXACT', operation: 'widen the withheld reason union and list with a fold-failed member',
    edits: [
      { from: "export type CurationSnapshotWithheldReason = 'masking-unavailable' | 'projection-refused'\n\n"
          + "export const CURATION_SNAPSHOT_WITHHELD_REASONS = [\n  'masking-unavailable',\n  'projection-refused',\n]",
        to: "export type CurationSnapshotWithheldReason = 'masking-unavailable' | 'projection-refused' | 'fold-failed'\n\n"
          + "export const CURATION_SNAPSHOT_WITHHELD_REASONS = [\n  'masking-unavailable',\n  'projection-refused',\n  'fold-failed',\n]" },
    ],
    reds: [withheld('pins the withheld reasons to an independent exact list through both barrels'),
      withheld('accepts each hand-spelled reason and rejects a third reason or an extra key'),
      withheld('parses a served snapshot alone and a withheld flag alone on the public result'),
      withheldD('pins exactly two withheld reasons in both directions through both barrels'),
      withheldD('refuses a third withheld reason at the type boundary')],
    allowed: [],
    greens: [stg('pins the public detail list and schema to independent exact vocabularies'),
      stg('accepts the hand-spelled three detail stages and rejects a fourth'),
      stg('keeps exactly two required chips with exactly four statuses'),
      stgD('pins three detail stages in both directions through public exports'),
      stgD('refuses a fourth stage and third chip at the type boundary')],
  },
  {
    subject: READ, instrument: 'post-processing-read', claim: 'POSTPROCESSING-SNAPSHOT-WITHHELD', operation: 'throw the projection refusal instead of withholding the snapshot',
    edits: [{ from: "const refused = (): CurationSnapshotProjection => ({ kind: 'withheld', reason: 'projection-refused' })\n",
      to: "const refused = (): CurationSnapshotProjection => { throw new Error('The recorded curation snapshot cannot be projected safely.') }\n" }],
    reds: [read('POSTPROCESSING-SNAPSHOT-WITHHELD')],
    allowed: [read('NOTIFICATION-MASK-COLLISION')],
    greens: [read('POSTPROCESSING-SNAPSHOT-EARLY'), read('POSTPROCESSING-HISTORICAL-COUNTS', 2),
      read('NOTIFICATION-MASK'), read('THREE-STAGE-ROWS'), read('MASK-NO-CONTEXT')],
  },
  {
    subject: COLD, instrument: 'cold-read', claim: 'COLD-AUTH-SKIPPED', operation: "refuse every cold source when one declaration's payload file is missing",
    edits: [{ from: '        if (!existsSync(resolveAuthStatePaths(location).payloadPath)) continue\n', to: '' }],
    reds: [coldRead('COLD-AUTH-SKIPPED missing'), coldRead('COLD-AUTH-SKIPPED capture-missing'),
      coldRead('COLD-AUTH-SKIPPED coexisting')],
    allowed: [],
    greens: [coldRead('COLD-AUTH-SKIPPED invalid-declaration'), coldRead('COLD-AUTH-REFUSAL', 7), coldRead('COLD-AUTH'),
      coldRead('COLD-AUTH-INHERITANCE', 3), coldRead('COLD-KNOWLEDGE-WITHHELD')],
  },
]

runGate({
  slug: '423-curation-mutation', envPrefix: 'AGENT_QA_423_CURATION_MUTATION', idPrefix: 'C',
  instruments, legs, expectedLegs: 14, banner: 'CURATION_MUTATION_OK',
})
NODE
