#!/usr/bin/env bash
# 423-rung-mutation.sh — a recorded retrieval-rung cause keeps its meaning, its version and its
# wording (423-23, PXH-KNOW-06).
#
# WHAT THIS PROVES, AND WHY A GREEN SUITE DOES NOT PROVE IT. A degraded run records WHY the index
# face degraded: not built, locked or corrupt, on a strict `schemaVersion: 2` arm. Pre-423 runs
# recorded one word, `index-unavailable`, whose cause nobody knows. Each cheap regression below
# produces a banner that reads fine and is wrong: two causes collapsed into one, the historical
# word minted again for a live fault, an old run silently upgraded to a cause it never recorded,
# a v1 value admitted with a cause v1 could not have held, or doctor and the dashboard drifting to
# two wordings of one fact. So each leg plants one of those in production source and requires its
# named cell to red while the listed controls hold.
#
# THE LEGS
#   R01  an absent index folds to index-corrupt                                -> RUNG-ABSENT
#   R02  a locked index folds to index-corrupt                                 -> RUNG-LOCKED
#   R03  a corrupt index folds to index-locked                                 -> RUNG-CORRUPT
#   R04  a schema-version mismatch folds to index-not-built                    -> RUNG-SCHEMA
#   R05  an absent index mints the historical index-unavailable word again     -> LEGACY-HISTORICAL (fold)
#   R06  the step-finalized projection upgrades a v1 index-unavailable to v2   -> LEGACY-HISTORICAL (readers)
#   R07  a twelfth current reason joins the vocabulary                         -> C423-RUNG-REASONS-EXACT runtime+type
#   R08  the historical v1 arm admits the eleven current reasons               -> C423-RUNG-REASONS-EXACT runtime+type
#   R09  doctor's index-locked label drifts from the dashboard's               -> RUNG-LABEL-PARITY
#
# Engine, arrival proof, counted selection and restoration: scripts/423-mutation-engine.cjs.
#
# USAGE
#   pnpm run validate:423-rung-mutation                  # from the agent-qa root
#   bash agent-qa/scripts/423-rung-mutation.sh           # from the super-repository root
#
# KNOBS — AGENT_QA_423_RUNG_MUTATION_SELFTEST
#   neutered  apply NO mutation; the run must FATAL with "<leg>: suite stayed green"
#   fatal     mutate every subject, then throw; every subject must be restored
#   SIGINT | SIGTERM | SIGHUP   the same, then deliver that signal to itself
# AGENT_QA_423_RUNG_MUTATION_LEG=R01..R09 runs one leg (normal or neutered runs only).
# AGENT_QA_423_RUNG_MUTATION_LIST=1 prints the declared inventory and exits.
#
# Installed Node 24 and workspace tools are required. No downloads or provider calls. Ends with a
# forced workspace build whenever a byte was mutated.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
exec node --input-type=commonjs - <<'NODE'
const path = require('node:path')
const { runGate, cell } = require(path.join(process.cwd(), 'scripts/423-mutation-engine.cjs'))

const FOLD = 'packages/knowledge-local/src/retrieval-rung.ts'
const VOCAB = 'packages/schema/src/brief/retrieval-rung.ts'
const BUS = 'packages/schema/src/run/bus-projections.ts'
const DOCTOR = 'packages/cli/src/commands/doctor-knowledge-checks.ts'

const KL = 'src/__tests__/423-retrieval-rung.test.ts'
const SR = 'src/__tests__/423-rung-contracts.test.ts'
const SR_D = 'src/__tests__/423-rung-contracts.test-d.ts'
const LABELS = 'src/__tests__/rung-label-parity.test.ts'

const instruments = {
  'rung-fold': { pkg: 'packages/knowledge-local', files: [KL], typecheck: false, count: 10 },
  'rung-schema': { pkg: 'packages/schema', files: [SR, SR_D], typecheck: true, count: 50 },
  'rung-labels': { pkg: 'packages/cli', files: [LABELS], typecheck: false, count: 14 },
}

const fold = (describe, title) => cell('rung-fold', KL, `${describe} > ${title}`)
const ABSENT = ['folds an absent index to bundle-scan/index-not-built under every embedder', 'records index-not-built for a fresh store with no index file on disk']
const LOCKED = ['folds a locked index to bundle-scan/index-locked under every embedder', 'records index-locked while another connection holds an exclusive lock']
const CORRUPT = ['folds a corrupt index to bundle-scan/index-corrupt under every embedder', 'records index-corrupt for an index file holding garbage bytes']
const SCHEMA = ['folds a schema-version mismatch to the same index-corrupt cause', 'records index-corrupt for a built index whose schema version is missing']
const NEVER_MINTS = 'never mints the historical index-unavailable word or the v1 stamp'
const DISTINCT = 'keeps the three causes distinct values rather than one collapsed word'
const group = (describe, titles) => titles.map(title => fold(describe, title))

const sr = (describe, title) => cell('rung-schema', SR, `${describe} > ${title}`)
const srD = (describe, title) => cell('rung-schema', SR_D, `${describe} > ${title}`)
const C423 = 'C423-RUNG-REASONS-EXACT'
const V1_LEGACY = 'historical bytes stay readable and byte-identical through every reader: {"schemaVersion":1,"rung":"bundle-scan","reason":"index-unavailable"}'
const V2 = reason => `current bytes stay readable and byte-identical through every reader: {"schemaVersion":2,"rung":"bundle-scan","reason":"${reason}"}`

const lab = (describe, title) => cell('rung-labels', LABELS, `${describe} > ${title}`)
const PARITY_407 = 'the retrieval-rung cause labels are one wording on two doors (407-11)'

const legs = [
  {
    subject: FOLD, instrument: 'rung-fold', claim: 'RUNG-ABSENT', operation: 'fold an absent index to index-corrupt',
    edits: [{ from: "  absent: 'index-not-built',\n", to: "  absent: 'index-corrupt',\n" }],
    reds: group('RUNG-ABSENT', ABSENT),
    allowed: [fold('LEGACY-HISTORICAL', NEVER_MINTS), fold('LEGACY-HISTORICAL', DISTINCT)],
    greens: [...group('RUNG-LOCKED', LOCKED), ...group('RUNG-CORRUPT', CORRUPT), ...group('RUNG-SCHEMA', SCHEMA)],
  },
  {
    subject: FOLD, instrument: 'rung-fold', claim: 'RUNG-LOCKED', operation: 'fold a locked index to index-corrupt',
    edits: [{ from: "  locked: 'index-locked',\n", to: "  locked: 'index-corrupt',\n" }],
    reds: group('RUNG-LOCKED', LOCKED),
    allowed: [fold('LEGACY-HISTORICAL', NEVER_MINTS), fold('LEGACY-HISTORICAL', DISTINCT)],
    greens: [...group('RUNG-ABSENT', ABSENT), ...group('RUNG-CORRUPT', CORRUPT), ...group('RUNG-SCHEMA', SCHEMA)],
  },
  {
    subject: FOLD, instrument: 'rung-fold', claim: 'RUNG-CORRUPT', operation: 'fold a corrupt index to index-locked',
    edits: [{ from: "  corrupt: 'index-corrupt',\n", to: "  corrupt: 'index-locked',\n" }],
    reds: group('RUNG-CORRUPT', CORRUPT),
    allowed: [fold('LEGACY-HISTORICAL', DISTINCT)],
    greens: [...group('RUNG-ABSENT', ABSENT), ...group('RUNG-LOCKED', LOCKED), ...group('RUNG-SCHEMA', SCHEMA),
      fold('LEGACY-HISTORICAL', NEVER_MINTS)],
  },
  {
    subject: FOLD, instrument: 'rung-fold', claim: 'RUNG-SCHEMA', operation: 'fold a schema-version mismatch to index-not-built',
    edits: [{ from: "  'schema-version': 'index-corrupt',\n", to: "  'schema-version': 'index-not-built',\n" }],
    reds: group('RUNG-SCHEMA', SCHEMA),
    allowed: [],
    greens: [...group('RUNG-ABSENT', ABSENT), ...group('RUNG-LOCKED', LOCKED), ...group('RUNG-CORRUPT', CORRUPT),
      fold('LEGACY-HISTORICAL', NEVER_MINTS), fold('LEGACY-HISTORICAL', DISTINCT)],
  },
  {
    subject: FOLD, instrument: 'rung-fold', claim: 'LEGACY-HISTORICAL', operation: 'mint the historical index-unavailable word for an absent index',
    edits: [{ from: "  absent: 'index-not-built',\n", to: "  absent: 'index-unavailable',\n" }],
    reds: [fold('LEGACY-HISTORICAL', NEVER_MINTS)],
    allowed: group('RUNG-ABSENT', ABSENT),
    greens: [...group('RUNG-LOCKED', LOCKED), ...group('RUNG-CORRUPT', CORRUPT), ...group('RUNG-SCHEMA', SCHEMA),
      fold('LEGACY-HISTORICAL', DISTINCT)],
  },
  {
    subject: BUS, instrument: 'rung-schema', claim: 'LEGACY-HISTORICAL', operation: 'upgrade a v1 index-unavailable to a v2 index-not-built on the step-finalized read',
    edits: [{ from: '    ...(evidence.retrievalRung !== undefined ? { retrievalRung: evidence.retrievalRung } : {}),',
      to: "    ...(evidence.retrievalRung !== undefined ? { retrievalRung: evidence.retrievalRung.schemaVersion === 1 && evidence.retrievalRung.reason === 'index-unavailable'\n"
        + "      ? { schemaVersion: 2 as const, rung: evidence.retrievalRung.rung, reason: 'index-not-built' as const } : evidence.retrievalRung } : {})," }],
    reds: [sr('LEGACY-HISTORICAL', 'a v1 index-unavailable is never upgraded, reinterpreted or re-versioned by a read')],
    allowed: [sr('RUNG-V1', V1_LEGACY)],
    greens: [sr('LEGACY-HISTORICAL', 'the legacy code stays a member of the current vocabulary with its historical meaning'),
      sr('RUNG-V2', V2('index-not-built')), sr('RUNG-V2', 'the three new causes remain distinct values after a read'),
      sr(C423, 'the historical v1 arm admits exactly the eight pre-423 reasons'),
      srD(C423, 'pins the historical v1 arm to exactly the eight pre-423 reasons')],
  },
  {
    subject: VOCAB, instrument: 'rung-schema', claim: C423, operation: 'widen the current reason vocabulary with a twelfth reason',
    edits: [{ from: "  'index-corrupt',\n] as const\n", to: "  'index-corrupt',\n  'index-evicted',\n] as const\n" }],
    reds: [sr(C423, 'pins eleven current reasons, in order, against an independent list'),
      srD(C423, 'pins eleven current reasons in both directions through public exports')],
    allowed: [srD(C423, 'pins the current v2 arm to exactly the eleven reasons'),
      srD(C423, 'pins exactly two strict versioned arms over the same four rungs')],
    greens: [sr(C423, 'the historical v1 arm admits exactly the eight pre-423 reasons'),
      srD(C423, 'pins the historical v1 arm to exactly the eight pre-423 reasons'),
      sr('LEGACY-HISTORICAL', 'a v1 index-unavailable is never upgraded, reinterpreted or re-versioned by a read'),
      srD('RUNG-INVALID-VERSION', 'refuses a third version and a v1 value carrying a 423 cause at the type boundary')],
  },
  {
    subject: VOCAB, instrument: 'rung-schema', claim: C423, operation: 'let the historical v1 arm admit every current reason',
    edits: [{ from: '  reason: z.enum(HISTORICAL_RETRIEVAL_RUNG_REASONS).optional(),\n', to: '  reason: z.enum(RETRIEVAL_RUNG_REASONS).optional(),\n' }],
    reds: [sr(C423, 'the historical v1 arm admits exactly the eight pre-423 reasons'),
      srD(C423, 'pins the historical v1 arm to exactly the eight pre-423 reasons')],
    allowed: [sr('RUNG-INVALID-VERSION', 'the schema refuses a mislabelled, future or widened value:'),
      sr('RUNG-INVALID-VERSION', 'the persisted handoff guard refuses the same step:'),
      sr('RUNG-INVALID-VERSION', 'the runs.knowledge wire contract refuses it at run level:'),
      srD(C423, 'pins exactly two strict versioned arms over the same four rungs'),
      srD('RUNG-INVALID-VERSION', 'refuses a third version and a v1 value carrying a 423 cause at the type boundary')],
    greens: [sr(C423, 'pins eleven current reasons, in order, against an independent list'),
      srD(C423, 'pins eleven current reasons in both directions through public exports'),
      sr('RUNG-V1', V1_LEGACY),
      sr('LEGACY-HISTORICAL', 'a v1 index-unavailable is never upgraded, reinterpreted or re-versioned by a read')],
  },
  {
    subject: DOCTOR, instrument: 'rung-labels', claim: 'RUNG-LABEL-PARITY', operation: "drift doctor's index-locked label from the dashboard wording",
    edits: [{ from: "  'index-locked': 'knowledge index locked by another process, scanning bundles',\n",
      to: "  'index-locked': 'knowledge index busy, scanning bundles',\n" }],
    reds: [lab('RUNG-LABEL-PARITY', 'pins each index cause to the same exact bytes on both doors')],
    allowed: [lab(PARITY_407, 'every reason reads the same words on both doors, byte for byte'),
      lab('LEGACY-LABEL', 'never lends a current cause its wording'),
      lab('DOCTOR-CURRENT-SEPARATE', "doctor names the live 'locked' face as 'index-locked', never the historical word")],
    greens: [lab('RUNG-LABEL-PARITY', 'both doors key exactly the eleven hand-spelled reasons'),
      lab('RUNG-LABEL-PARITY', 'never presents not-built as corrupt, and keeps every cause label distinct'),
      lab('LEGACY-LABEL', 'reads the historical word as cause not recorded on both doors'),
      lab('DOCTOR-CURRENT-SEPARATE', "doctor names the live 'absent' face as 'index-not-built', never the historical word"),
      lab('DOCTOR-CURRENT-SEPARATE', 'adds no current-health read op; current health stays on agent-qa doctor (D-23)')],
  },
]

runGate({
  slug: '423-rung-mutation', envPrefix: 'AGENT_QA_423_RUNG_MUTATION', idPrefix: 'R',
  instruments, legs, expectedLegs: 9, banner: 'RUNG_MUTATION_OK',
})
NODE
