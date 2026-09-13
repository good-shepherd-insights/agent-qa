#!/usr/bin/env bash
# The instrument's own test. Isolated copies share installed tools only; each mode owns a fresh
# source checkout, so a mode whose cleanup is broken cannot be read as the next mode's restoration.
#
# THE INVENTORY BELOW IS WRITTEN OUT, NOT DERIVED. A total read off the instrument agrees with the
# instrument however it changes; a leg silently dropped from 422-adversarial-mutation.sh reddens
# HERE instead of shrinking both in step.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
exec node --test-reporter=tap --input-type=commonjs - <<'NODE'
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')
const assert = require('node:assert/strict')
const { test } = require('node:test')
const { spawnSync } = require('node:child_process')

const root = process.cwd()
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')

const GENERATE = 'packages/eval/src/adversarial/generate.ts'
const PROBES = 'packages/eval/src/adversarial/probes.ts'
const TABLES = 'packages/eval/src/adversarial/tables.ts'
const PROMPT = 'packages/eval/src/adversarial/probe-prompt.ts'
const CORPUS = 'packages/eval/src/labels/corpus-entry.ts'
const CHAIN = 'packages/agent/src/jobs/chain-identity.ts'
const NOTIFICATION = 'packages/schema/src/notification/run-notification.ts'
const RECEIPT = 'packages/cli/src/gates/replay-gate-host.ts'
const EVIDENCE = 'packages/schema/src/verdict/misdirection-evidence.ts'
const HARM = 'packages/cli/src/curation/emit-canary-outcomes.ts'
const subjects = [GENERATE, PROBES, TABLES, PROMPT, CORPUS, CHAIN, NOTIFICATION, RECEIPT,
  EVIDENCE, HARM]
const PLANT = 'packages/agent-local/src/422-adversarial-plant.ts'

/** Packages an instrument RUNS in; the rest are copied for their raw source alone. */
const RUNNER_PACKAGES = ['eval', 'agent', 'schema', 'arch', 'cli']

const expected = [
  { subject: GENERATE, instrument: 'eval-sets', vocabulary: 'AdversarialRowStatus',
    operation: 'remove', member: 'unchanged' },
  { subject: GENERATE, instrument: 'eval-sets', vocabulary: 'ADVERSARIAL_ROW_STATUSES',
    operation: 'add', member: 'illicit-adversarial-row-status' },
  { subject: GENERATE, instrument: 'eval-sets', vocabulary: 'AdversarialRowStatus (the union)',
    operation: 'add', member: 'illicit-adversarial-row-status' },
  { subject: GENERATE, instrument: 'eval-sets', vocabulary: 'ADVERSARIAL_CAP_SOURCES',
    operation: 'add', member: 'illicit-cap-source' },
  { subject: PROBES, instrument: 'eval-sets', vocabulary: 'PROBE_RESERVATION_STATUSES',
    operation: 'add', member: 'illicit-reservation-status' },
  { subject: CORPUS, instrument: 'eval-sets-runtime', vocabulary: 'ADVERSARIAL_MUTATORS',
    operation: 'add', member: 'benign-homoglyph' },
  { subject: TABLES, instrument: 'eval-sets-runtime', vocabulary: 'ADVERSARIAL_TABLES',
    operation: 'edit-without-bump', member: 'latin-upper-w-cyrillic-we' },
  { subject: PROMPT, instrument: 'eval-prompt', vocabulary: 'ADVERSARIAL_PROBE_PROMPT',
    operation: 'edit-without-bump', member: 'optimized-trigger constraint' },
  { subject: CHAIN, instrument: 'agent-chain', vocabulary: 'ChainJobIds',
    operation: 'add', member: 'admitProposals' },
  { subject: NOTIFICATION, instrument: 'schema-notify',
    vocabulary: 'RUN_NOTIFICATION_STAGE_STATUSES', operation: 'add', member: 'not-recorded' },
  { subject: NOTIFICATION, instrument: 'schema-notify',
    vocabulary: 'the v2 -> v3 migration step', operation: 'synthesize', member: 'stages.proposals' },
  { subject: PLANT, instrument: 'arch-writer', vocabulary: 'the protected-root writer census',
    operation: 'plant', member: 'an adversarial storage path in a protected package' },
  { subject: RECEIPT, instrument: 'cli-receipt', vocabulary: 'acknowledged Gate-1 return',
    operation: 'bypass', member: 'writer acknowledgement refusal' },
  { subject: EVIDENCE, instrument: 'schema-membership', vocabulary: 'code-owned memory membership',
    operation: 'erase', member: 'candidate and served-canary trust' },
  { subject: EVIDENCE, instrument: 'schema-aggregation', vocabulary: 'all-held evidence law',
    operation: 'bypass', member: 'unresolved siblings' },
  { subject: HARM, instrument: 'cli-harm', vocabulary: 'class-independent flipped harm',
    operation: 'erase', member: 'causal outcome precedence' },
]
expected.forEach((leg, index) => { leg.id = `A${String(index + 1).padStart(2, '0')}` })

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-qa-adversarial-selftest-'))
console.log(`Selftest evidence: ${work}`)

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
}

// Include source and existing dist paths, so additions/removals cannot hide behind equal hashes.
function hostBytes() {
  const inventory = {}
  function visit(dir) {
    if (!fs.existsSync(dir)) return
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name)
      if (entry.isDirectory()) visit(file)
      else if (entry.isFile()) inventory[path.relative(root, file)] = sha(file)
      else if (entry.isSymbolicLink()) inventory[path.relative(root, file)] = `symlink:${fs.readlinkSync(file)}`
    }
  }
  for (const entry of fs.readdirSync(path.join(root, 'packages'), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    for (const tree of ['src', 'dist']) visit(path.join(root, 'packages', entry.name, tree))
  }
  return inventory
}

/**
 * A fresh slice per mode.
 *
 * EVERY package's `src` is copied, not only the four an instrument runs in: the arch census walks
 * every workspace root it finds on disk and reads two more by name, so a slice carrying a subset
 * would measure a census over a tree that does not exist anywhere.
 */
function makeCopy(name) {
  const copy = path.join(work, name)
  fs.mkdirSync(path.join(copy, 'scripts'), { recursive: true })
  for (const entry of fs.readdirSync(path.join(root, 'packages'), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const source = path.join(root, 'packages', entry.name, 'src')
    if (!fs.existsSync(source)) continue
    fs.mkdirSync(path.join(copy, 'packages', entry.name), { recursive: true })
    fs.cpSync(source, path.join(copy, 'packages', entry.name, 'src'), { recursive: true })
    // CLI witnesses also import source fixtures from sibling packages. Their external imports
    // need installed dependencies too; source itself remains copied, and nothing is rebuilt.
    const dependencies = path.join(root, 'packages', entry.name, 'node_modules')
    if (fs.existsSync(dependencies)) {
      fs.symlinkSync(dependencies, path.join(copy, 'packages', entry.name, 'node_modules'), 'dir')
    }
  }
  for (const pkg of RUNNER_PACKAGES) {
    for (const file of ['package.json', 'tsconfig.json', 'vitest.config.ts']) {
      fs.copyFileSync(path.join(root, 'packages', pkg, file), path.join(copy, 'packages', pkg, file))
    }
  }
  for (const file of ['package.json', 'tsconfig.base.json', 'scripts/422-adversarial-mutation.sh']) {
    fs.copyFileSync(path.join(root, file), path.join(copy, file))
  }
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(copy, 'node_modules'), 'dir')
  git(copy, ['init', '-q'])
  git(copy, ['add', ...subjects])
  git(copy, ['-c', 'commit.gpgsign=false', '-c', 'user.name=Fixture',
    '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture subjects'])
  return copy
}

function runMode(mode, options = {}) {
  const name = options.label ?? (mode === '' ? 'normal' : mode)
  const hostBefore = hostBytes()
  const copy = makeCopy(name)
  if (options.prepare !== undefined) options.prepare(copy)
  const before = subjects.map(file => sha(path.join(copy, file)))
  const log = path.join(work, `${name}.log`)
  const fd = fs.openSync(log, 'wx')
  const started = Date.now()
  const result = spawnSync('bash', ['scripts/422-adversarial-mutation.sh'], {
    cwd: copy, env: { ...process.env, AGENT_QA_ADVERSARIAL_MUTATION_SELFTEST: mode },
    stdio: ['ignore', fd, fd], timeout: 2_700_000,
  })
  fs.closeSync(fd)
  const after = subjects.map(file => sha(path.join(copy, file)))
  const hostAfter = hostBytes()
  fs.writeFileSync(path.join(work, `${name}-host-integrity.json`), JSON.stringify({
    before: hostBefore, after: hostAfter,
  }, null, 2) + '\n')
  assert.deepEqual(hostAfter, hostBefore, `${name}: host source/dist integrity`)
  fs.writeFileSync(path.join(work, `${name}.json`), JSON.stringify({
    mode, status: result.status, signal: result.signal, error: result.error?.message,
    elapsedMs: Date.now() - started, before, after,
  }, null, 2) + '\n')
  const output = fs.readFileSync(log, 'utf8')
  assert.equal(result.error, undefined, `${name}: child tool failure`)
  assert.equal(result.signal, null, `${name}: uncontrolled child signal`)
  // THE RESTORATION CLAIM, on every path: normal, refused, fatal and each interruption. It is
  // asserted for the REFUSED runs too, and there it is the stronger claim: a refused subject that
  // came back byte-identical to how the run FOUND it is one the instrument never owned.
  assert.deepEqual(after, before, `${name}: restoration`)
  if (options.expectPlant !== true) {
    assert.equal(fs.existsSync(path.join(copy, PLANT)), false, `${name}: planted path survived`)
  }
  return { copy, output, status: result.status, before, after }
}

/** The reason each refusing mode must print, and nothing else. */
function reasonFor(mode) {
  if (mode === 'neutered') return 'suite stayed green'
  if (mode === 'fatal') return 'intentional fatal after A01 mutation'
  if (mode === 'invalid') return 'Unknown AGENT_QA_ADVERSARIAL_MUTATION_SELFTEST'
  return `interrupted by ${mode}`
}

test('adversarial mutation legs redden by name and restore byte-identically', () => {
  const scripts = JSON.parse(fs.readFileSync('package.json', 'utf8')).scripts
  // An unregistered instrument is one no gate can run. The phase gate ALSO invokes the dedicated
  // quarantine instrument without absorbing it: 422-10 owns `validate:quarantine-mutation` and
  // keeps it, and this entry reaches that script rather than re-declaring its legs here.
  assert.equal(scripts['validate:adversarial-mutation'],
    'bash scripts/422-adversarial-mutation.sh && bash scripts/422-quarantine-mutation.sh',
    'the phase mutation gate must be registered and must invoke the quarantine instrument')
  assert.equal(scripts['validate:adversarial-mutation-selftest'],
    'bash scripts/422-adversarial-mutation-selftest.sh && bash scripts/422-quarantine-mutation-selftest.sh',
    'the phase selftest gate must be registered and must invoke the quarantine selftest')
  assert.equal(scripts['validate:quarantine-mutation'], 'bash scripts/422-quarantine-mutation.sh',
    '422-10 keeps its own registration — the phase gate borrows the instrument, it does not absorb it')
  assert.ok(fs.existsSync('scripts/422-adversarial-mutation.sh'), 'the instrument must exist')
  assert.ok(fs.existsSync('scripts/422-quarantine-mutation.sh'), 'the quarantine instrument must exist')
  assert.equal(expected.length, 16)
  const declared = fs.readFileSync('scripts/422-adversarial-mutation.sh', 'utf8')
    .split('const legs = [')[1].split('legs.forEach')[0]
  assert.equal((declared.match(/^  \{$/gm) ?? []).length, expected.length,
    'independent behavioral mutation inventory must be implemented')

  const { output, status, before } = runMode('')
  assert.equal(status, 0, output)
  assert.match(output, /^ADVERSARIAL_MUTATION_OK legs=16 named-red=16 byte-identical-restoration=10$/m)
  assert.ok(!output.includes('FATAL:'), output)

  // The arrival proof ran for EVERY leg before any byte moved. Without it a leg whose subject the
  // instrument never reads would report a green that measures the absence of the mutation.
  assert.equal((output.match(/^ARRIVAL A\d+: /gm) ?? []).length, 16, output)
  assert.equal((output.match(/^NAMED RED A\d+:/gm) ?? []).length, 16, output)

  const evidence = /^Evidence: (.+)$/m.exec(output)?.[1]
  assert.ok(evidence, 'the run must retain its evidence directory')
  const ledger = JSON.parse(fs.readFileSync(path.join(evidence, 'ledger.json'), 'utf8'))
  assert.equal(ledger.length, 16)
  const snapshots = JSON.parse(fs.readFileSync(path.join(evidence, 'subjects.json'), 'utf8'))
  assert.deepEqual(Object.keys(snapshots), subjects)
  for (const [index, file] of subjects.entries()) assert.equal(snapshots[file].hash, before[index])

  for (const [index, leg] of ledger.entries()) {
    const contract = expected[index]
    assert.deepEqual(Object.fromEntries(Object.keys(contract).map(key => [key, leg[key]])), contract)
    // ACTUAL exits, not the instrument's own opinion of them: a RED leg really failed and the
    // restored tree really passed, each in a child process of its own.
    assert.equal(leg.exit, 1, `${leg.id}: actual RED exit`)
    assert.ok(leg.failures.length > 0, `${leg.id}: a RED leg must name failing cells`)
    if (contract.operation === 'plant') {
      assert.equal(leg.restoreDigest, null, `${leg.id}: a planted leg owns no snapshot`)
    } else {
      assert.equal(leg.restoreDigest, before[subjects.indexOf(leg.subject)])
      assert.equal(leg.originalDigest, leg.restoreDigest)
      assert.equal(leg.restoredDigest, leg.originalDigest)
      assert.notEqual(leg.mutatedDigest, leg.originalDigest)
    }
    const digest = crypto.createHash('sha256').update(JSON.stringify(leg.diagnostics)).digest('hex')
    assert.equal(leg.digest, digest, `${leg.id}: diagnostics digest`)
    for (const [suffix, exit] of [['red', 1], ['restored-green', 0]]) {
      const record = JSON.parse(fs.readFileSync(path.join(evidence, `${leg.id}-${suffix}.json`), 'utf8'))
      assert.equal(record.exit, exit, `${leg.id}: ${suffix} actual exit`)
      assert.equal(record.instrument, contract.instrument, `${leg.id}: ${suffix} instrument`)
    }
  }
  console.log(`SELFTEST normal exit=${status} legs=${ledger.length} restored=${subjects.length}`)

  // ---- the refusing modes ------------------------------------------------------------------
  // Each owns a FRESH slice: an interruption mode leaves a mutated tree behind if the
  // instrument's cleanup is broken, and sharing one copy would let the FIRST mode's damage be
  // read as the second mode's restoration.
  for (const mode of ['neutered', 'fatal', 'SIGINT', 'SIGTERM', 'SIGHUP', 'invalid']) {
    const run = runMode(mode)
    assert.equal(run.status, 1, run.output)
    const reason = reasonFor(mode)
    assert.ok(run.output.includes(`FATAL: ${reason}`), run.output)
    assert.deepEqual(run.output.match(/^FATAL: .+$/gm), [`FATAL: ${reason}`], `${mode}: no unexplained failure`)
    assert.ok(!run.output.includes('ADVERSARIAL_MUTATION_OK'), run.output)
    if (mode !== 'invalid') {
      for (const [index, file] of subjects.entries()) {
        assert.ok(run.output.includes(`RESTORED ${file} sha256=${run.before[index]}`), run.output)
      }
    }
    if (mode === 'fatal' || mode.startsWith('SIG')) {
      // EVERY subject must have changed before the interruption, and the planted path must have
      // existed — a restoration claim over a tree nothing touched proves nothing.
      const mutations = [...run.output.matchAll(/^MUTATED (.+) sha256=([a-f0-9]{64})$/gm)]
      assert.deepEqual(mutations.map(row => row[1]), subjects, `${mode}: every subject must change`)
      for (const [index, row] of mutations.entries()) assert.notEqual(row[2], run.before[index])
      assert.match(run.output, /^CREATED packages\/agent-local\/src\/422-adversarial-plant\.ts sha256=/m)
      assert.match(run.output, /^REMOVED packages\/agent-local\/src\/422-adversarial-plant\.ts$/m)
    }
    if (mode === 'neutered') {
      // The refusal must follow an ACTUAL green child, not a skipped one: a neutered run that
      // never invoked the suite would "refuse" without proving the suite is the thing that reds.
      assert.match(run.output, /^A01-red: exit=0 /m, 'neutered refusal must follow an actual green child')
      assert.ok(!run.output.includes('MUTATED '), run.output)
    }
    if (mode === 'invalid') {
      // Nothing was owned, so nothing is restored — and nothing may be claimed as restored either.
      assert.ok(!run.output.includes('RESTORED '), run.output)
    }
    console.log(`SELFTEST ${mode} exit=${run.status} reason=${reason}`)
  }

  // ---- the preflight's clean-source protection ------------------------------------------------
  // A dirty subject is REFUSED and LEFT ALONE. Restoring it from a snapshot taken after the dirt
  // landed would launder someone else's uncommitted work into a byte-identical-looking success.
  const dirtyMark = '\n// selftest: an uncommitted edit the instrument must refuse to own\n'
  const dirty = runMode('', {
    label: 'dirty-subject',
    prepare: copy => fs.appendFileSync(path.join(copy, GENERATE), dirtyMark),
  })
  assert.equal(dirty.status, 1, dirty.output)
  assert.ok(dirty.output.includes(`FATAL: ${GENERATE} is dirty or untracked — refusing mutation`), dirty.output)
  assert.ok(!dirty.output.includes('ARRIVAL '), 'the clean gate runs BEFORE anything else')
  assert.ok(fs.readFileSync(path.join(dirty.copy, GENERATE), 'utf8').endsWith(dirtyMark),
    'a refused subject must be left exactly as it was found')
  for (const [index, file] of subjects.entries()) {
    if (file === GENERATE) continue
    assert.equal(dirty.after[index], dirty.before[index], `${file}: untouched by a refused run`)
  }
  console.log('SELFTEST dirty-subject exit=1 refused-without-modifying=1')

  // ---- the planted path may never overwrite a real file ----------------------------------------
  const occupied = runMode('', {
    label: 'occupied-plant',
    expectPlant: true,
    prepare: copy => fs.writeFileSync(path.join(copy, PLANT), '// a real file that happens to be here\n'),
  })
  assert.equal(occupied.status, 1, occupied.output)
  assert.ok(occupied.output.includes(`FATAL: ${PLANT} already exists — refusing to overwrite a real file`),
    occupied.output)
  assert.equal(fs.readFileSync(path.join(occupied.copy, PLANT), 'utf8'),
    '// a real file that happens to be here\n', 'the occupying file must survive untouched')
  console.log('SELFTEST occupied-plant exit=1 refused-without-overwriting=1')

  console.log('ADVERSARIAL_MUTATION_SELFTEST_OK')
})
NODE
