#!/usr/bin/env bash
# Source-only, serial mutation proof for the 422 phase vocabularies and their table/prompt pins.
#
# WHAT THIS PROVES, AND WHY A GREEN SUITE DOES NOT PROVE IT. Phase 422 declared a dozen closed
# vocabularies, two version-pinned frozen documents and one architecture wall. Every one of them
# is a pin, and a pin has a failure mode a passing suite cannot see: the pin agreeing with a
# constant it derived from, or naming a cell nothing executes. So each leg here plants exactly one
# mutation in the PRODUCTION source a pin measures, runs the oracle that exists to refuse it, and
# requires the RED to be EXACTLY the cells this script names in advance — not a superset, not a
# subset.
#
# THE TWO FAILURES THAT LOOK IDENTICAL, AND HOW THEY ARE TOLD APART. A mutation that reddens
# nothing has two possible causes, and confusing them is how a vacuous pin survives:
#
#   (a) THE WALL DID NOT FIRE. The bytes reached the instrument and the instrument did not care.
#   (b) THE MUTATION NEVER ARRIVED. The instrument never read the mutated module at all — the
#       422-22 trap, where a plant in `packages/schema` left a consumer package's cells green
#       until the schema `dist` was rebuilt, which reads exactly like (a).
#
# (b) is ruled out BEFORE any byte is touched, by the ARRIVAL PROOF below: every leg's subject
# must lie in the transitive RELATIVE-import closure of its own instrument's test files, computed
# from source. That is also why this instrument carries NO dist-crossing leg — a leg whose
# consumer resolves its subject through a workspace symlink cannot be isolated in a copied slice,
# so its `dist` would be the real one and the selftest's restoration claim would be a fiction.
# The dist-crossing claims have their own owners and keep them: `412-issue-slot-mutation.sh`'s
# J-03 legs measure one chain mutation at three distances with an encoded rebuild order, and
# `422-quarantine-mutation.sh` owns the D-16 quarantine.
#
# A GREEN SUITE UNDER ANY MUTATION IS A FAILURE OF THIS SCRIPT, NOT A PASS.
#
# EVERY SUBJECT IS RESTORED AND THE RESTORE IS PROVED. Restoration is compared by full sha256
# against a snapshot taken before the first mutation — never a size, never an mtime — on the
# success path, on the FATAL path and on SIGINT/SIGTERM/SIGHUP alike. A guarantee that holds only
# when the leg passed is absent at the one moment it is needed.
#
# USAGE
#   pnpm validate:adversarial-mutation                     # from the agent-qa root
#   bash agent-qa/scripts/422-adversarial-mutation.sh      # from the super-repository root
#
# KNOBS — AGENT_QA_ADVERSARIAL_MUTATION_SELFTEST
#   neutered  apply NO mutation at all; the script must FATAL with "suite stayed green"
#   fatal     mutate every subject, create every planted path, then throw
#   SIGINT | SIGTERM | SIGHUP   the same, then deliver that signal to itself
#   (unset)   the real run
#
# Installed Node 24 and workspace tools are required. No downloads, builds, provider calls or
# persistent source changes.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
exec node --input-type=commonjs - <<'NODE'
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')
const { spawn, spawnSync } = require('node:child_process')

const mode = process.env.AGENT_QA_ADVERSARIAL_MUTATION_SELFTEST ?? ''
if (!['', 'neutered', 'fatal', 'SIGINT', 'SIGTERM', 'SIGHUP'].includes(mode)) {
  console.error('FATAL: Unknown AGENT_QA_ADVERSARIAL_MUTATION_SELFTEST')
  process.exit(1)
}
if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Node 24 or later required')

const root = process.cwd()
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-qa-adversarial-mutation-'))
console.log(`Evidence: ${work}`)
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex')

// ---- the subjects, and the one planted path ----------------------------------------------------
const GENERATE = 'packages/eval/src/adversarial/generate.ts'
const PROBES = 'packages/eval/src/adversarial/probes.ts'
const TABLES = 'packages/eval/src/adversarial/tables.ts'
const PROMPT = 'packages/eval/src/adversarial/probe-prompt.ts'
const CORPUS = 'packages/eval/src/labels/corpus-entry.ts'
const CHAIN = 'packages/agent/src/jobs/chain-identity.ts'
const NOTIFICATION = 'packages/schema/src/notification/run-notification.ts'
const RECEIPT = 'packages/cli/src/gates/replay-gate-host.ts'
const subjects = [GENERATE, PROBES, TABLES, PROMPT, CORPUS, CHAIN, NOTIFICATION, RECEIPT]

/** The one leg that adds a file rather than editing one: the arch census names what it accuses. */
const PLANT = 'packages/agent-local/src/422-adversarial-plant.ts'
const PLANT_ROOT = 'packages/agent-local/src'
const PLANT_TEXT = '// 422 adversarial plant: eval/adversarial\n'
const created = [PLANT]

const owned = new Map()
let child
let cleanupActive = false

function restore() {
  for (const [file, snapshot] of owned) {
    const bytes = fs.readFileSync(snapshot.path)
    if (sha(bytes) !== snapshot.hash) throw new Error(`snapshot corrupted: ${file}`)
    fs.writeFileSync(path.join(root, file), bytes)
    if (sha(fs.readFileSync(path.join(root, file))) !== snapshot.hash) {
      throw new Error(`restore hash mismatch: ${file}`)
    }
    console.log(`RESTORED ${file} sha256=${snapshot.hash}`)
  }
  if (owned.size > 0) {
    for (const file of created) {
      if (!fs.existsSync(path.join(root, file))) continue
      fs.rmSync(path.join(root, file))
      if (fs.existsSync(path.join(root, file))) throw new Error(`planted path survived: ${file}`)
      console.log(`REMOVED ${file}`)
    }
  }
}
function stopChild(signal = 'SIGTERM') {
  if (child?.pid) { try { process.kill(-child.pid, signal) } catch {} }
}
function fatal(reason) {
  console.error(`FATAL: ${reason}`)
  if (cleanupActive) process.exit(1)
  cleanupActive = true
  stopChild('SIGKILL')
  try { restore() } catch (error) { console.error(`FATAL: cleanup failed: ${error.message}`) }
  process.exit(1)
}
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => fatal(`interrupted by ${signal}`))
}
process.on('uncaughtException', error => fatal(error.message))
process.on('unhandledRejection', error => fatal(error.message))
process.on('exit', () => {
  if (!cleanupActive) try { restore() } catch (error) {
    console.error(`FATAL: ${error.message}`)
    process.exitCode = 1
  }
})

// ---- the instruments ---------------------------------------------------------------------------
// Each names the package it runs in and the test files it selects. Every subject measured by an
// instrument lives in that same package and is reached by a RELATIVE import — the arrival proof
// below refuses any other arrangement.
const EVAL_SETS_RUNTIME = 'src/adversarial/__tests__/closed-sets.test.ts'
const EVAL_SETS_TYPES = 'src/adversarial/__tests__/closed-sets.test-d.ts'
const EVAL_PROMPT_RUNTIME = 'src/adversarial/__tests__/probe-contract.test.ts'
const AGENT_CHAIN_RUNTIME = 'src/jobs/__tests__/422-chain-closed-sets.test.ts'
const AGENT_CHAIN_TYPES = 'src/jobs/__tests__/422-chain-closed-sets.test-d.ts'
const SCHEMA_NOTIFY_RUNTIME = 'src/__tests__/422-notification-closed-sets.test.ts'
const SCHEMA_NOTIFY_TYPES = 'src/__tests__/422-notification-closed-sets.test-d.ts'
const ARCH_WRITER = 'src/__tests__/422-no-eval-writer.test.ts'
const CLI_RECEIPT = 'src/gates/__tests__/replay-gate-host.test.ts'
const receiptTitles = [
  '422 refuses to hand a caller a receipt the writer never acknowledged',
  '422 refuses a dry-run receipt at the port while the verb still renders it',
  '422 lends the host port its claim authority per call and refuses an unrecorded receipt',
]
const exactTitles = titles => `(?:${titles.map(title => title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})$`

const instruments = {
  'eval-sets': { pkg: 'packages/eval', files: [EVAL_SETS_RUNTIME, EVAL_SETS_TYPES], typecheck: true },
  'eval-sets-runtime': { pkg: 'packages/eval', files: [EVAL_SETS_RUNTIME], typecheck: false },
  'eval-prompt': { pkg: 'packages/eval', files: [EVAL_PROMPT_RUNTIME], typecheck: false },
  'agent-chain': { pkg: 'packages/agent', files: [AGENT_CHAIN_RUNTIME, AGENT_CHAIN_TYPES], typecheck: true },
  'schema-notify': { pkg: 'packages/schema', files: [SCHEMA_NOTIFY_RUNTIME, SCHEMA_NOTIFY_TYPES], typecheck: true },
  'arch-writer': { pkg: 'packages/arch', files: [ARCH_WRITER], typecheck: false, nameFilter: 'D-01 raw source' },
  'cli-receipt': { pkg: 'packages/cli', files: [CLI_RECEIPT], typecheck: false,
    nameFilter: exactTitles(receiptTitles) },
}

// ---- the cells each leg must redden, named BEFORE anything runs ---------------------------------
const rowRuntime = '422-22 the staging-report row vocabulary'
const capRuntime = '422-22 the cap-source vocabulary'
const probeRuntime = '422-22 the probe-reservation vocabulary'
const unmovedRuntime = '422-22 the vocabularies 422 did NOT move'
const parsersRuntime = '422-22 the public parsers refuse a word outside the vocabulary'
const rowTypes = 'the staging-report row status'
const capTypes = 'the cap source'
const probeTypes = 'the probe reservation status'
const unmovedTypes = 'the vocabularies 422 did not move'

const cell = (file, describe, title) => `${file} > ${describe} > ${title}`

const ROW_WORDS_RUNTIME = cell(EVAL_SETS_RUNTIME, rowRuntime,
  'is exactly the six terminal words a report row can carry')
const ROW_READER_RUNTIME = cell(EVAL_SETS_RUNTIME, rowRuntime,
  'reads an ALREADY-DERIVED row as unchanged and every other one as inapplicable')
const ROW_TOTAL_RUNTIME = cell(EVAL_SETS_RUNTIME, rowRuntime,
  'never answers outside the six words, whatever it is handed')
const ROW_WORDS_TYPES = cell(EVAL_SETS_TYPES, rowTypes,
  'is exactly the six terminal words, closed in both directions')
const ROW_JUDGEMENT_TYPES = cell(EVAL_SETS_TYPES, rowTypes,
  'bars a row word that would report a judgement rather than an outcome')
const CAP_WORDS_RUNTIME = cell(EVAL_SETS_RUNTIME, capRuntime,
  'is exactly the three places a resolved cap can come from')
const CAP_WORDS_TYPES = cell(EVAL_SETS_TYPES, capTypes,
  'is exactly the three origins, closed in both directions')
const PROBE_WORDS_RUNTIME = cell(EVAL_SETS_RUNTIME, probeRuntime,
  'is exactly the three durable states one tuple can be in')
const PROBE_WORDS_TYPES = cell(EVAL_SETS_TYPES, probeTypes,
  'is exactly the three durable states, closed in both directions')
const FAMILIES_RUNTIME = cell(EVAL_SETS_RUNTIME, unmovedRuntime,
  'keeps the eleven frozen mutation families, and generates all of them')
const TWELFTH_FAMILY_RUNTIME = cell(EVAL_SETS_RUNTIME, parsersRuntime,
  'refuses an entry naming a twelfth family, with an issue naming the field')
const TABLE_PIN_RUNTIME = cell(EVAL_SETS_RUNTIME, unmovedRuntime,
  'pins every shipped table generation by hash, so a table edit without a bump reds here')

const promptDescribe = '422-04 the frozen prompt and its add-only history'
const PROMPT_PIN_V1 = cell(EVAL_PROMPT_RUNTIME, promptDescribe,
  'pins version 1 to a literal hash the constitution must still produce')
const PROMPT_PIN_HISTORY = cell(EVAL_PROMPT_RUNTIME, promptDescribe,
  'keeps every shipped version pinned, so history is added to and never replaced')

const chainKeysRuntime = '422-22 the three chain id keys'
const chainTerminalRuntime = '422-22 the terminal kind list'
const chainKeysTypes = 'the chain id key set'
const CHAIN_PRODUCES_RUNTIME = cell(AGENT_CHAIN_RUNTIME, chainKeysRuntime,
  'names exactly the keys the derivation PRODUCES, not a parallel list')
const CHAIN_ASKED_RUNTIME = cell(AGENT_CHAIN_RUNTIME, chainTerminalRuntime,
  'is the same kind set the derivation asks the id source for')
const CHAIN_KEYED_RUNTIME = cell(AGENT_CHAIN_RUNTIME, chainKeysRuntime,
  'keys the third id from the SECOND, and never from a candidate')
const CHAIN_KEYS_TYPES = cell(AGENT_CHAIN_TYPES, chainKeysTypes, 'is exactly three keys, hand-spelled')
const CHAIN_CLOSED_TYPES = cell(AGENT_CHAIN_TYPES, chainKeysTypes,
  'is closed in both directions against the runtime list')
const CHAIN_FOURTH_TYPES = cell(AGENT_CHAIN_TYPES, chainKeysTypes,
  'bars a fourth key under any name a later stage would reach for')

const notifyVocabRuntime = '422-22 the notification vocabularies'
const notifyAbsenceRuntime = '422-22 historical absence is a representation, not an invented stage'
const notifyStatusTypes = 'the stage status vocabulary'
const STAGE_WORDS_RUNTIME = cell(SCHEMA_NOTIFY_RUNTIME, notifyVocabRuntime,
  'carries exactly two stage statuses, and NO word for a stage that was not recorded')
const STAGE_REFUSAL_RUNTIME = cell(SCHEMA_NOTIFY_RUNTIME, notifyVocabRuntime,
  'refuses every status outside the two, at the public guard')
const STAGE_WORDS_TYPES = cell(SCHEMA_NOTIFY_TYPES, notifyStatusTypes,
  'is exactly two words, closed in both directions')
const STAGE_NOT_RECORDED_TYPES = cell(SCHEMA_NOTIFY_TYPES, notifyStatusTypes,
  'has NO word for a stage that was not recorded')
const STAGE_SAME_WORDS_TYPES = cell(SCHEMA_NOTIFY_TYPES, notifyStatusTypes,
  'is the SAME two words the chain outcome uses, and stays a separate declaration')
const V1_WALK_RUNTIME = cell(SCHEMA_NOTIFY_RUNTIME, notifyAbsenceRuntime,
  'walks a v1 row to v3 with NO proposal stage and no third-stage claim')
const V2_WALK_RUNTIME = cell(SCHEMA_NOTIFY_RUNTIME, notifyAbsenceRuntime,
  'walks a v2 row to v3 and does NOT accept it as a v2 document')
const V2_STEP_RUNTIME = cell(SCHEMA_NOTIFY_RUNTIME, notifyAbsenceRuntime,
  'lets the v2 step itself be read directly — it synthesizes nothing')

const WRITER_RUNTIME = cell(ARCH_WRITER, '422 the adversarial split has one writer and one operator door',
  'D-01 raw source in knowledge-local and agent-local names no adversarial path, constant or writer')

// ---- the inventory, written out rather than derived from any declaration under test --------------
// Each leg names its subject, the EXACT bytes it replaces, and the cells whose RED is its claim.
// The `from` text must occur EXACTLY ONCE, so an edit that moved a declaration turns the
// instrument red rather than quietly mutating nothing.
const legs = [
  {
    subject: GENERATE, instrument: 'eval-sets', vocabulary: 'AdversarialRowStatus',
    operation: 'remove', member: 'unchanged',
    from: "export const ADVERSARIAL_ROW_STATUSES = [\n  'staged',\n  'unchanged',\n",
    to: "export const ADVERSARIAL_ROW_STATUSES = [\n  'staged',\n",
    reds: [ROW_WORDS_RUNTIME, ROW_WORDS_TYPES],
  },
  {
    subject: GENERATE, instrument: 'eval-sets', vocabulary: 'ADVERSARIAL_ROW_STATUSES',
    operation: 'add', member: 'illicit-adversarial-row-status',
    from: "  'failed',\n] as const satisfies readonly AdversarialRowStatus[]",
    to: "  'failed',\n  'illicit-adversarial-row-status',\n] as const",
    reds: [ROW_WORDS_RUNTIME, ROW_WORDS_TYPES],
  },
  {
    subject: GENERATE, instrument: 'eval-sets', vocabulary: 'AdversarialRowStatus (the union)',
    operation: 'add', member: 'illicit-adversarial-row-status',
    from: "export type AdversarialRowStatus =\n  | 'staged'",
    to: "export type AdversarialRowStatus =\n  | 'illicit-adversarial-row-status'\n  | 'staged'",
    reds: [ROW_WORDS_TYPES],
  },
  {
    subject: GENERATE, instrument: 'eval-sets', vocabulary: 'ADVERSARIAL_CAP_SOURCES',
    operation: 'add', member: 'illicit-cap-source',
    from: "  'flag',\n] as const satisfies readonly AdversarialCapSource[]",
    to: "  'flag',\n  'illicit-cap-source',\n] as const",
    reds: [CAP_WORDS_RUNTIME, CAP_WORDS_TYPES],
  },
  {
    subject: PROBES, instrument: 'eval-sets', vocabulary: 'PROBE_RESERVATION_STATUSES',
    operation: 'add', member: 'illicit-reservation-status',
    from: "  'completed',\n] as const satisfies readonly ProbeReservationStatus[]",
    to: "  'completed',\n  'illicit-reservation-status',\n] as const",
    reds: [PROBE_WORDS_RUNTIME, PROBE_WORDS_TYPES],
  },
  {
    subject: CORPUS, instrument: 'eval-sets-runtime', vocabulary: 'ADVERSARIAL_MUTATORS',
    operation: 'add', member: 'benign-homoglyph',
    from: "  'benign-synonym',\n] as const satisfies readonly AdversarialMutator[]",
    to: "  'benign-synonym',\n  'benign-homoglyph',\n] as const",
    // The family list is HASHED into the table digest, so a twelfth family is also a table edit
    // without a bump — the pin below reds beside the two vocabulary cells rather than instead of
    // them, which is the bump guard reaching a change nobody thought of as a table change.
    reds: [FAMILIES_RUNTIME, TWELFTH_FAMILY_RUNTIME, TABLE_PIN_RUNTIME],
  },
  {
    subject: TABLES, instrument: 'eval-sets-runtime', vocabulary: 'ADVERSARIAL_TABLES',
    operation: 'edit-without-bump', member: 'latin-upper-w-cyrillic-we',
    from: "{ id: 'latin-upper-w-cyrillic-we', from: 'W'",
    to: "{ id: 'latin-upper-w-cyrillic-we-quietly-retitled', from: 'W'",
    reds: [TABLE_PIN_RUNTIME],
  },
  {
    subject: PROMPT, instrument: 'eval-prompt', vocabulary: 'ADVERSARIAL_PROBE_PROMPT',
    operation: 'edit-without-bump', member: 'optimized-trigger constraint',
    from: "'Keep it short enough to be a label rather than a paragraph.',",
    to: "'Keep it short enough to be a label rather than a sentence.',",
    reds: [PROMPT_PIN_V1, PROMPT_PIN_HISTORY],
  },
  {
    subject: CHAIN, instrument: 'agent-chain', vocabulary: 'ChainJobIds',
    operation: 'add', member: 'admitProposals',
    from: '  readonly proposeImprovements: JobId\n}',
    to: '  readonly proposeImprovements: JobId\n  readonly admitProposals: JobId\n}',
    also: {
      from: "      `${String(curateMemory)}->propose-improvements`,\n    ),\n  }",
      to: "      `${String(curateMemory)}->propose-improvements`,\n    ),\n"
        + "    admitProposals: idSource.jobIdFor(\n      'consolidate',\n"
        + "      `${String(curateMemory)}->consolidate`,\n    ),\n  }",
    },
    reds: [CHAIN_PRODUCES_RUNTIME, CHAIN_ASKED_RUNTIME, CHAIN_KEYED_RUNTIME, CHAIN_KEYS_TYPES,
      CHAIN_CLOSED_TYPES, CHAIN_FOURTH_TYPES],
  },
  {
    subject: NOTIFICATION, instrument: 'schema-notify', vocabulary: 'RUN_NOTIFICATION_STAGE_STATUSES',
    operation: 'add', member: 'not-recorded',
    from: "export const RUN_NOTIFICATION_STAGE_STATUSES = [\n  'done',\n  'failed',\n"
      + '] as const satisfies readonly RunNotificationStageStatus[]',
    to: "export const RUN_NOTIFICATION_STAGE_STATUSES = [\n  'done',\n  'failed',\n"
      + "  'not-recorded',\n] as const",
    reds: [STAGE_WORDS_RUNTIME, STAGE_REFUSAL_RUNTIME, STAGE_WORDS_TYPES],
  },
  {
    subject: NOTIFICATION, instrument: 'schema-notify', vocabulary: 'the v2 -> v3 migration step',
    operation: 'synthesize', member: 'stages.proposals',
    from: "      schemaVersion: 3,\n      stages: {\n"
      + "        ...('analysis' in stages ? { analysis: stages.analysis } : {}),\n"
      + "        ...('curation' in stages ? { curation: stages.curation } : {}),\n      },",
    to: "      schemaVersion: 3,\n      stages: {\n"
      + "        ...('analysis' in stages ? { analysis: stages.analysis } : {}),\n"
      + "        ...('curation' in stages ? { curation: stages.curation } : {}),\n"
      + "        proposals: { status: 'done' },\n      },",
    reds: [V1_WALK_RUNTIME, V2_WALK_RUNTIME, V2_STEP_RUNTIME],
  },
  {
    plant: PLANT, scanRoot: PLANT_ROOT, instrument: 'arch-writer',
    vocabulary: 'the protected-root writer census', operation: 'plant',
    member: 'an adversarial storage path in a protected package',
    reds: [WRITER_RUNTIME],
  },
  {
    subject: RECEIPT, instrument: 'cli-receipt', vocabulary: 'acknowledged Gate-1 return',
    operation: 'bypass', member: 'writer acknowledgement refusal',
    from: 'if (!ACKNOWLEDGED_RECORDINGS.includes(result.recorded)) {',
    to: 'if (false && !ACKNOWLEDGED_RECORDINGS.includes(result.recorded)) {',
    reds: receiptTitles.map(title => cell(CLI_RECEIPT, '417 DATA replay gate bridge', title)),
  },
]
legs.forEach((leg, index) => { leg.id = `A${String(index + 1).padStart(2, '0')}` })
// Derived from the declared ledger, never a guessed number: the selftest states the same total
// independently, so a leg silently dropped here reddens there instead of shrinking both in step.
const EXPECTED_LEGS = legs.length
if (EXPECTED_LEGS !== 13) throw new Error(`Expected exactly 13 mutation legs, declared ${EXPECTED_LEGS}`)

// ---- the arrival proof --------------------------------------------------------------------------
// Computed from SOURCE before any byte is touched. A subject outside its instrument's relative
// import closure could never reach the cells, so a green under its mutation would measure the
// absence of the mutation rather than the absence of a wall — the 422-22 half-reddened trap.
function relativeClosure(pkg, files) {
  const seen = new Set()
  const stack = files.map(file => path.join(root, pkg, file))
  while (stack.length > 0) {
    const file = stack.pop()
    if (seen.has(file)) continue
    seen.add(file)
    let text
    try { text = fs.readFileSync(file, 'utf8') } catch { continue }
    for (const match of text.matchAll(/from\s+'(\.[^']*)'/g)) {
      const specifier = match[1].replace(/\.js$/, '')
      for (const candidate of [`${specifier}.ts`, path.join(specifier, 'index.ts')]) {
        const resolved = path.resolve(path.dirname(file), candidate)
        if (fs.existsSync(resolved) && fs.lstatSync(resolved).isFile()) {
          stack.push(resolved)
          break
        }
      }
    }
  }
  return seen
}
function proveArrival() {
  const closures = new Map()
  for (const leg of legs) {
    if (leg.plant !== undefined) {
      // A planted file is read as RAW BYTES by the census rather than imported, so its arrival is
      // its presence under a scanned root — asserted here and named again by the RED itself.
      if (!fs.existsSync(path.join(root, leg.scanRoot))) {
        throw new Error(`${leg.id}: the scanned root ${leg.scanRoot} does not exist`)
      }
      if (path.dirname(path.join(root, leg.plant)) !== path.join(root, leg.scanRoot)) {
        throw new Error(`${leg.id}: the planted path is not directly under ${leg.scanRoot}`)
      }
      console.log(`ARRIVAL ${leg.id}: ${leg.plant} is scanned raw under ${leg.scanRoot}`)
      continue
    }
    const spec = instruments[leg.instrument]
    if (spec === undefined) throw new Error(`${leg.id}: unknown instrument ${leg.instrument}`)
    const realSubject = fs.realpathSync(path.join(root, leg.subject))
    const realPackage = path.join(fs.realpathSync(root), spec.pkg)
    if (!realSubject.startsWith(`${realPackage}${path.sep}`)) {
      throw new Error(`${leg.id}: subject realpath escapes its copied package`)
    }
    if (!leg.subject.startsWith(`${spec.pkg}/`)) {
      throw new Error(`${leg.id}: ${leg.subject} is outside ${spec.pkg} — this instrument carries no dist-crossing leg`)
    }
    if (!closures.has(leg.instrument)) closures.set(leg.instrument, relativeClosure(spec.pkg, spec.files))
    if (!closures.get(leg.instrument).has(path.join(root, leg.subject))) {
      throw new Error(`${leg.id}: ${leg.subject} is not in the relative-import closure of ${leg.instrument} — a green would measure nothing`)
    }
    console.log(`ARRIVAL ${leg.id}: ${leg.subject} is in the ${leg.instrument} import closure`)
  }
}

// ---- the mutations ------------------------------------------------------------------------------
function applyOnce(text, from, to, id) {
  if (text.split(from).length !== 2) throw new Error(`Mutation anchor is not unique or is missing: ${id}`)
  return text.replace(from, to)
}
function mutate(text, leg) {
  let output = applyOnce(text, leg.from, leg.to, leg.id)
  if (leg.also !== undefined) output = applyOnce(output, leg.also.from, leg.also.to, `${leg.id} (second hunk)`)
  if (output === text) throw new Error(`Mutation anchor did not land: ${leg.id}`)
  return output
}

// ---- reading a run -------------------------------------------------------------------------------
function parse(log) {
  const clean = log.replace(/\x1b\[[0-9;]*m/g, '')
  const failures = [...clean.matchAll(/^ FAIL  (src\/[^ ]+) > (.+)$/gm)]
    .map(match => `${match[1]} > ${match[2]}`)
  const diagnostics = [...clean.matchAll(/^(TypeCheckError:[\s\S]*?)^ ❯ (src\/[^\n]+:\d+:\d+)$/gm)]
    .map(match => ({ message: match[1].trim(), pointer: match[2] }))
  const selected = [...clean.matchAll(/^\s*[✓×] (?: TS  )?(src\/[^ ]+) > (.+?)(?: \d+ms)?$/gm)]
  // A run that selected nothing proves nothing, however it exited. This is the check that stops a
  // mistyped path or a renamed cell from being read as a successful mutation.
  if (!selected.length || /No test files found|Tests\s+no tests/.test(clean)) {
    throw new Error('No selected named tests')
  }
  if ((clean.match(/^TypeCheckError:/gm) ?? []).length !== diagnostics.length) {
    throw new Error('Unparsed type diagnostic')
  }
  if (/^(?:Error|SyntaxError|ReferenceError|RangeError|TypeError):/m.test(clean)) {
    throw new Error('Unrelated tool error')
  }
  return {
    clean,
    failures: [...new Set(failures)].sort(),
    diagnostics,
    selectedNames: [...new Set(selected.map(row => `${row[1]} > ${row[2]}`))].sort(),
    digest: sha(JSON.stringify(diagnostics)),
  }
}
/** Every cell any leg on this instrument names must be SELECTED by the green run, or the leg
 *  names a cell that does not exist and its RED could never be the one it claims. */
function namedCellsFor(instrument) {
  return [...new Set(legs.filter(leg => leg.instrument === instrument).flatMap(leg => leg.reds))].sort()
}
function checkGreen(result, instrument) {
  const parsed = parse(result.log)
  if (result.exit !== 0 || parsed.failures.length || parsed.diagnostics.length) {
    throw new Error('Preflight/restored instrument did not pass')
  }
  if (result.withTypes && !parsed.clean.includes('Type Errors  no errors')) {
    throw new Error('Preflight/restored instrument did not pass')
  }
  const missing = namedCellsFor(instrument).filter(name => !parsed.selectedNames.includes(name))
  if (missing.length > 0) throw new Error(`Named cell not selected: ${JSON.stringify(missing)}`)
  return parsed
}
function checkRed(result, leg) {
  if (result.exit === 0) throw new Error('suite stayed green')
  if (result.exit !== 1) throw new Error(`Unexpected tool exit ${result.exit}`)
  const parsed = parse(result.log)
  const expected = [...leg.reds].sort()
  const missing = expected.filter(name => !parsed.selectedNames.includes(name))
  if (missing.length > 0) throw new Error(`Named cell not selected: ${JSON.stringify(missing)}`)
  if (JSON.stringify(parsed.failures) !== JSON.stringify(expected)) {
    throw new Error(`Unexpected named failures: ${JSON.stringify(parsed.failures)}`)
  }
  // A leg whose claim is a TYPE wall must be proved by that wall's own assertion, not merely by a
  // compile error somewhere in the production file it mutated.
  const typeCells = expected.filter(name => name.includes('.test-d.ts >'))
  if (typeCells.length > 0) {
    const files = [...new Set(typeCells.map(name => name.split(' > ')[0]))]
    for (const file of files) {
      if (!parsed.diagnostics.some(row => row.pointer.startsWith(`${file}:`))) {
        throw new Error(`Missing intended type assertion in ${file}`)
      }
    }
  }
  if (!result.withTypes && parsed.diagnostics.length) throw new Error('Unexpected type diagnostic')
  return parsed
}
async function instrument(name, label) {
  const spec = instruments[name]
  const withTypes = spec.typecheck === true
  const args = [path.join(root, 'node_modules/vitest/vitest.mjs'), 'run', ...spec.files,
    withTypes ? '--typecheck' : '--typecheck.enabled=false',
    ...(spec.nameFilter === undefined ? [] : ['-t', spec.nameFilter]),
    '--reporter=verbose', '--maxWorkers=1']
  const logPath = path.join(work, `${label}.log`)
  const fd = fs.openSync(logPath, 'wx')
  const start = Date.now()
  let timedOut = false
  const exit = await new Promise((resolve, reject) => {
    child = spawn(process.execPath, args, {
      cwd: path.join(root, spec.pkg), detached: true, stdio: ['ignore', fd, fd],
      env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
    })
    const timer = setTimeout(() => { timedOut = true; stopChild('SIGKILL') }, 600000)
    child.on('error', error => { clearTimeout(timer); reject(error) })
    child.on('exit', (code, signal) => {
      clearTimeout(timer)
      child = undefined
      resolve(code ?? `signal:${signal}`)
    })
  })
  fs.closeSync(fd)
  const record = { instrument: name, command: [process.execPath, ...args], cwd: spec.pkg, exit,
    withTypes, elapsedMs: Date.now() - start, logPath }
  fs.writeFileSync(path.join(work, `${label}.json`), JSON.stringify(record, null, 2) + '\n')
  console.log(`${label}: exit=${exit} elapsedMs=${record.elapsedMs}`)
  if (timedOut) throw new Error('Instrument timed out')
  return { ...record, log: fs.readFileSync(logPath, 'utf8') }
}
function mustReject(name, fn) {
  let rejected = false
  try { fn() } catch { rejected = true }
  if (!rejected) throw new Error(`Parser accepted ${name}`)
  console.log(`CONTROL rejected: ${name}`)
}

// ---- the run --------------------------------------------------------------------------------------
function plantBytes(leg) {
  fs.writeFileSync(path.join(root, leg.plant), PLANT_TEXT, { flag: 'wx' })
  console.log(`CREATED ${leg.plant} sha256=${sha(fs.readFileSync(path.join(root, leg.plant)))}`)
}
function unplant(leg) {
  if (fs.existsSync(path.join(root, leg.plant))) fs.rmSync(path.join(root, leg.plant))
}

async function main() {
  // Check every subject before owning any bytes; never discard unrelated edits.
  for (const file of subjects) {
    const tracked = spawnSync('git', ['ls-files', '--error-unmatch', '--', file], { cwd: root, encoding: 'utf8' })
    const status = spawnSync('git', ['status', '--porcelain', '--', file], { cwd: root, encoding: 'utf8' })
    if (tracked.status !== 0 || status.status !== 0 || status.stdout.trim()) {
      throw new Error(`${file} is dirty or untracked — refusing mutation`)
    }
    if (!fs.lstatSync(file).isFile()) throw new Error(`Non-regular subject: ${file}`)
  }
  for (const file of created) {
    if (fs.existsSync(path.join(root, file))) throw new Error(`${file} already exists — refusing to overwrite a real file`)
  }
  proveArrival()
  for (const file of subjects) {
    const bytes = fs.readFileSync(file)
    const snapshot = path.join(work, `${file.replace(/\//g, '_')}.snapshot`)
    fs.writeFileSync(snapshot, bytes, { flag: 'wx' })
    owned.set(file, { path: snapshot, hash: sha(bytes) })
  }
  fs.writeFileSync(path.join(work, 'subjects.json'), JSON.stringify(Object.fromEntries(owned), null, 2) + '\n')

  // Every instrument must be green BEFORE any mutation, or a leg's RED could be pre-existing —
  // and every cell a leg names must be among the cells the green run SELECTED.
  const used = [...new Set(legs.map(leg => leg.instrument))]
  for (const name of used) checkGreen(await instrument(name, `preflight-${name}`), name)

  const ledger = []
  for (const leg of legs) {
    console.log(`LEG ${leg.id} ${leg.vocabulary} ${leg.operation} ${leg.member}`)
    const snapshot = leg.plant === undefined ? owned.get(leg.subject) : undefined
    if (mode !== 'neutered') {
      if (leg.plant === undefined) {
        fs.writeFileSync(leg.subject, mutate(fs.readFileSync(snapshot.path, 'utf8'), leg))
        if (sha(fs.readFileSync(leg.subject)) === snapshot.hash) throw new Error('Mutation changed no bytes')
      } else {
        plantBytes(leg)
      }
    }
    // Interruption controls must change every old/new subject AND create every planted path, so
    // the restoration claim is measured over the whole owned set rather than over one file.
    if (mode === 'fatal' || mode.startsWith('SIG')) {
      for (const file of subjects) {
        const control = legs.find(candidate => candidate.subject === file)
        const original = owned.get(file)
        if (file !== leg.subject) fs.writeFileSync(file, mutate(fs.readFileSync(original.path, 'utf8'), control))
        const digest = sha(fs.readFileSync(file))
        if (digest === original.hash) throw new Error(`Interruption control changed no bytes: ${file}`)
        console.log(`MUTATED ${file} sha256=${digest}`)
      }
      for (const candidate of legs) {
        if (candidate.plant !== undefined && !fs.existsSync(path.join(root, candidate.plant))) plantBytes(candidate)
      }
    }
    if (mode === 'fatal') throw new Error(`intentional fatal after ${leg.id} mutation`)
    if (mode.startsWith('SIG')) {
      process.kill(process.pid, mode)
      await new Promise(resolve => setTimeout(resolve, 100))
      throw new Error('Signal handler failed')
    }
    const result = await instrument(leg.instrument, `${leg.id}-red`)
    const parsed = checkRed(result, leg)
    if (leg.plant !== undefined && !parsed.clean.includes(leg.plant)) {
      throw new Error('The census RED did not name the planted file')
    }
    mustReject('tool crash', () => checkRed({ ...result, exit: 2 }, leg))
    mustReject('unrelated error', () => checkRed({ ...result, log: `${result.log}\nError: unrelated\n` }, leg))
    mustReject('wrong named cell', () => checkRed({ ...result,
      log: result.log.replace(/^( FAIL  src\/[^ ]+ > .+)$/m, '$1 trailing') }, leg))
    mustReject('zero selected cells', () => checkRed({ ...result,
      log: result.log.replace(/^\s*[✓×] (?: TS  )?src\/[^ ]+ > .+$/gm, '') }, leg))
    mustReject('a green suite', () => checkRed({ ...result, exit: 0 }, leg))
    if (leg.reds.some(name => name.includes('.test-d.ts >'))) {
      mustReject('missing type assertion', () => checkRed({ ...result,
        log: result.log.replace(/^TypeCheckError:[\s\S]*?^ ❯ src\/[^\n]+:\d+:\d+$/gm, '') }, leg))
    }
    ledger.push({
      id: leg.id, subject: leg.subject ?? leg.plant, instrument: leg.instrument,
      vocabulary: leg.vocabulary, operation: leg.operation, member: leg.member,
      exit: result.exit, failures: parsed.failures, diagnostics: parsed.diagnostics,
      digest: parsed.digest, restoreDigest: snapshot?.hash ?? null,
      originalDigest: snapshot?.hash ?? null,
      mutatedDigest: sha(fs.readFileSync(leg.subject ?? leg.plant)),
      selectedNames: parsed.selectedNames,
    })
    fs.writeFileSync(path.join(work, 'ledger.json'), JSON.stringify(ledger, null, 2) + '\n')
    console.log(`NAMED RED ${leg.id}: ${parsed.failures.join(' | ')}; diagnostics=${parsed.digest}`)
    if (leg.plant === undefined) {
      restore()
    } else {
      unplant(leg)
      if (fs.existsSync(path.join(root, leg.plant))) throw new Error(`planted path survived: ${leg.plant}`)
      console.log(`REMOVED ${leg.plant}`)
    }
    const green = checkGreen(await instrument(leg.instrument, `${leg.id}-restored-green`), leg.instrument)
    ledger[ledger.length - 1].restoredSelectedNames = green.selectedNames
    ledger[ledger.length - 1].restoredDigest = leg.plant ? null : sha(fs.readFileSync(leg.subject))
    fs.writeFileSync(path.join(work, 'ledger.json'), JSON.stringify(ledger, null, 2) + '\n')
  }
  restore()
  owned.clear()
  console.log(`ADVERSARIAL_MUTATION_OK legs=${ledger.length} named-red=${EXPECTED_LEGS} byte-identical-restoration=${subjects.length}`)
}
main().catch(error => fatal(error.message))
NODE
