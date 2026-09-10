#!/usr/bin/env bash
# Isolated copies share installed tools only; each mode owns a fresh source checkout.
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
const subjects = ['packages/eval/src/judge/panel.ts', 'packages/eval/src/match/score.ts',
  'packages/eval/src/judge/config.ts', 'packages/eval/src/judge/calibration.ts']
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-qa-panel-selftest-'))
console.log(`Selftest evidence: ${work}`)
function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
}
// Independent final inventory: a matching total cannot hide a duplicated or missing leg.
const expected = []
function expectSet(subject, type, list, members, title) {
  for (const target of ['list', 'type']) {
    for (const member of members) expected.push({ subject, type, list, target, member, operation: 'remove', title })
    expected.push({ subject, type, list, target, member: 'illicit-panel-member', operation: 'add', title })
  }
}
expectSet(subjects[0], 'PanelPoolingMode', 'PANEL_POOLING_MODES', ['max', 'avg'], 'panel pooling modes exact')
expectSet(subjects[1], 'JudgeAbstentionCause', 'JUDGE_ABSTENTION_CAUSES', [
  'unsure-verdict', 'below-threshold', 'swap-disagreement', 'candidate-overflow',
  'missing-evidence', 'residual-tie', 'below-quorum', 'panel-disagreement',
], 'panel abstention causes exact')
expected.push({ subject: subjects[2], target: 'constitution', operation: 'perturb',
  title: 'JUDGE_CONFIG > requires every material change to carry a pinned judge-version bump' })
expectSet(subjects[3], 'JudgeCalibrationGapReason', 'JUDGE_CALIBRATION_GAP_REASONS', [
  'panel-not-configured', 'no-credential', 'single-family-host',
], 'judge calibration gaps exact')
expectSet(subjects[3], 'JudgeCalibrationStatus', 'JUDGE_CALIBRATION_STATUSES', [
  'calibrated', 'uncalibrated', 'capability-gap',
], 'judge calibration statuses exact')
expected.forEach((leg, index) => { leg.id = `P${String(index + 1).padStart(2, '0')}` })
test('panel mutation registration and isolated failure restoration', () => {
  assert.equal(JSON.parse(fs.readFileSync('package.json', 'utf8')).scripts['validate:panel-mutation'],
    'bash scripts/421-panel-mutation.sh', 'panel mutation must be registered')
  assert.equal(expected.length, 41)
  for (const mode of ['neutered', 'fatal', 'SIGINT', 'SIGTERM', 'SIGHUP', '', 'invalid']) {
    const copy = path.join(work, mode || 'normal')
    fs.mkdirSync(path.join(copy, 'packages/eval'), { recursive: true })
    fs.mkdirSync(path.join(copy, 'scripts'))
    fs.cpSync('packages/eval/src', path.join(copy, 'packages/eval/src'), { recursive: true })
    for (const file of ['package.json', 'tsconfig.base.json', 'packages/eval/package.json',
      'packages/eval/tsconfig.json', 'packages/eval/vitest.config.ts', 'scripts/421-panel-mutation.sh']) {
      fs.copyFileSync(file, path.join(copy, file))
    }
    for (const directory of ['node_modules', 'packages/eval/node_modules']) {
      fs.symlinkSync(path.join(root, directory), path.join(copy, directory), 'dir')
    }
    git(copy, ['init', '-q'])
    git(copy, ['add', ...subjects])
    git(copy, ['-c', 'commit.gpgsign=false', '-c', 'user.name=Fixture',
      '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture subjects'])
    const before = subjects.map(file => sha(path.join(copy, file)))
    const log = path.join(work, `${mode || 'normal'}.log`)
    const fd = fs.openSync(log, 'wx')
    const started = Date.now()
    const result = spawnSync('bash', ['scripts/421-panel-mutation.sh'], {
      cwd: copy, env: { ...process.env, AGENT_QA_PANEL_MUTATION_SELFTEST: mode },
      stdio: ['ignore', fd, fd], timeout: 600000,
    })
    fs.closeSync(fd)
    fs.writeFileSync(path.join(work, `${mode || 'normal'}.json`), JSON.stringify({
      mode, status: result.status, signal: result.signal, error: result.error?.message,
      elapsedMs: Date.now() - started, before, after: subjects.map(file => sha(path.join(copy, file))),
    }, null, 2) + '\n')
    const output = fs.readFileSync(log, 'utf8')
    assert.equal(result.error, undefined, `${mode}: child tool failure`)
    assert.equal(result.signal, null, `${mode}: uncontrolled child signal`)
    assert.deepEqual(subjects.map(file => sha(path.join(copy, file))), before, `${mode}: restoration`)
    if (mode === '') {
      assert.equal(result.status, 0, output)
      assert.match(output, /^PANEL_MUTATION_OK legs=41 named-red=41 byte-identical-restoration=41$/m)
      assert.ok(!output.includes('FATAL:'), output)
      const evidence = /^Evidence: (.+)$/m.exec(output)?.[1]
      assert.ok(evidence, 'normal child must retain evidence')
      const ledger = JSON.parse(fs.readFileSync(path.join(evidence, 'ledger.json'), 'utf8'))
      assert.equal(ledger.length, 41)
      const snapshots = JSON.parse(fs.readFileSync(path.join(evidence, 'subjects.json'), 'utf8'))
      assert.deepEqual(Object.keys(snapshots), subjects)
      for (const [index, leg] of ledger.entries()) {
        const contract = expected[index]
        assert.deepEqual(Object.fromEntries(Object.keys(contract).map(key => [key, leg[key]])), contract)
        assert.equal(leg.exit, 1, `${leg.id}: actual RED exit`)
        assert.equal(leg.restoreDigest, before[subjects.indexOf(leg.subject)])
        const calibration = leg.subject === subjects[3]
        const base = `src/judge/__tests__/${calibration ? 'calibration' : 'panel'}-closed-sets`
        const names = leg.target === 'constitution' ? [`src/judge/__tests__/config.test.ts > ${leg.title}`]
          : [...(leg.target === 'list' ? [`${base}.test.ts > ${leg.title}`] : []), `${base}.test-d.ts > ${leg.title} type bars`]
        assert.deepEqual([...new Set(leg.failures.map(row => `${row.file} > ${row.title}`))].sort(), names.sort())
        if (leg.target !== 'constitution') assert.ok(leg.diagnostics.some(row => row.pointer.startsWith(`${base}.test-d.ts:`)))
        const digest = crypto.createHash('sha256').update(JSON.stringify(leg.diagnostics)).digest('hex')
        assert.equal(leg.digest, digest)
        for (const [suffix, exit] of [['red', 1], ['restored-green', 0]]) {
          const record = JSON.parse(fs.readFileSync(path.join(evidence, `${leg.id}-${suffix}.json`), 'utf8'))
          assert.equal(record.exit, exit, `${leg.id}: ${suffix} actual exit`)
        }
      }
      for (const [index, file] of subjects.entries()) assert.equal(snapshots[file].hash, before[index])
      assert.equal((output.match(/^NAMED RED P\d+:/gm) ?? []).length, 41)
    } else {
      assert.equal(result.status, 1, output)
      const reason = mode === 'neutered' ? 'suite stayed green' : mode === 'fatal'
        ? 'intentional fatal after P01 mutation' : mode === 'invalid'
          ? 'Unknown AGENT_QA_PANEL_MUTATION_SELFTEST' : `interrupted by ${mode}`
      assert.ok(output.includes(`FATAL: ${reason}`), output)
      assert.deepEqual(output.match(/^FATAL: .+$/gm), [`FATAL: ${reason}`], 'no unexplained failure')
      assert.ok(!output.includes('PANEL_MUTATION_OK'), output)
      if (mode !== 'invalid') for (const [index, file] of subjects.entries()) {
        assert.ok(output.includes(`RESTORED ${file} sha256=${before[index]}`), output)
      }
      if (mode === 'fatal' || mode.startsWith('SIG')) {
        const mutations = [...output.matchAll(/^MUTATED (.+) sha256=([a-f0-9]{64})$/gm)]
        assert.deepEqual(mutations.map(row => row[1]), subjects, 'every subject must change before interruption')
        for (const [index, row] of mutations.entries()) assert.notEqual(row[2], before[index])
      }
      if (mode === 'neutered') {
        assert.match(output, /^P01-red: exit=0 /m, 'neutered refusal must follow an actual green child')
        assert.ok(!output.includes('MUTATED '), output)
      }
    }
    console.log(`SELFTEST ${mode || 'normal'} exit=${result.status} restored=${subjects.length} log=${log}`)
  }
  console.log('PANEL_MUTATION_SELFTEST_OK')
})
NODE
