#!/usr/bin/env bash
# The instrument's own test. Isolated copies share installed tools only; each mode owns a fresh
# source checkout, so a mode whose cleanup is broken cannot be read as the next mode's restoration.
#
# THE INVENTORY BELOW IS WRITTEN OUT, NOT DERIVED. A total read off the instrument agrees with the
# instrument however it changes; a leg silently dropped from 422-adversarial-mutation.sh reddens
# HERE instead of shrinking both in step.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
exec node --input-type=commonjs - <<'NODE'
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
const subjects = [GENERATE, PROBES, TABLES, PROMPT, CORPUS, CHAIN, NOTIFICATION]
const PLANT = 'packages/agent-local/src/422-adversarial-plant.ts'

/** The four packages an instrument RUNS in; the rest are copied for their raw source alone. */
const RUNNER_PACKAGES = ['eval', 'agent', 'schema', 'arch']

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
]
expected.forEach((leg, index) => { leg.id = `A${String(index + 1).padStart(2, '0')}` })

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-qa-adversarial-selftest-'))
console.log(`Selftest evidence: ${work}`)

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
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
  }
  for (const pkg of RUNNER_PACKAGES) {
    for (const file of ['package.json', 'tsconfig.json', 'vitest.config.ts']) {
      fs.copyFileSync(path.join(root, 'packages', pkg, file), path.join(copy, 'packages', pkg, file))
    }
    fs.symlinkSync(path.join(root, 'packages', pkg, 'node_modules'),
      path.join(copy, 'packages', pkg, 'node_modules'), 'dir')
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

function runMode(mode) {
  const name = mode === '' ? 'normal' : mode
  const copy = makeCopy(name)
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
  fs.writeFileSync(path.join(work, `${name}.json`), JSON.stringify({
    mode, status: result.status, signal: result.signal, error: result.error?.message,
    elapsedMs: Date.now() - started, before, after,
  }, null, 2) + '\n')
  const output = fs.readFileSync(log, 'utf8')
  assert.equal(result.error, undefined, `${name}: child tool failure`)
  assert.equal(result.signal, null, `${name}: uncontrolled child signal`)
  // THE RESTORATION CLAIM: byte-identity of every subject, and the absence of the planted path.
  assert.deepEqual(after, before, `${name}: restoration`)
  assert.equal(fs.existsSync(path.join(copy, PLANT)), false, `${name}: planted path survived`)
  return { copy, output, status: result.status, before }
}

test('adversarial mutation legs redden by name and restore byte-identically', () => {
  assert.ok(fs.existsSync('scripts/422-adversarial-mutation.sh'), 'the instrument must exist')
  assert.equal(expected.length, 12)

  const { output, status, before } = runMode('')
  assert.equal(status, 0, output)
  assert.match(output, /^ADVERSARIAL_MUTATION_OK legs=12 named-red=12 byte-identical-restoration=7$/m)
  assert.ok(!output.includes('FATAL:'), output)

  // The arrival proof ran for EVERY leg before any byte moved. Without it a leg whose subject the
  // instrument never reads would report a green that measures the absence of the mutation.
  assert.equal((output.match(/^ARRIVAL A\d+: /gm) ?? []).length, 12, output)
  assert.equal((output.match(/^NAMED RED A\d+:/gm) ?? []).length, 12, output)

  const evidence = /^Evidence: (.+)$/m.exec(output)?.[1]
  assert.ok(evidence, 'the run must retain its evidence directory')
  const ledger = JSON.parse(fs.readFileSync(path.join(evidence, 'ledger.json'), 'utf8'))
  assert.equal(ledger.length, 12)
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
  console.log('ADVERSARIAL_MUTATION_SELFTEST_OK')
})
NODE
