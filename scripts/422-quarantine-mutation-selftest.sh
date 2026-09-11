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
const subjects = ['packages/schema/src/job/job.ts',
  'packages/agent-local/src/store/sqlite-job-store.ts']
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-qa-quarantine-selftest-'))
console.log(`Selftest evidence: ${work}`)
function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
}
// Independent final inventory: a matching total cannot hide a duplicated or missing leg.
// Written out here rather than derived from the instrument, so a leg silently dropped from
// 422-quarantine-mutation.sh reddens this file instead of shrinking both in step.
const expected = [
  { subject: subjects[0], target: 'list', member: 'unreadable_kind', operation: 'remove' },
  { subject: subjects[0], target: 'list', member: 'illicit-conclusion-kind', operation: 'add' },
  { subject: subjects[0], target: 'type', member: 'unreadable_kind', operation: 'remove' },
  { subject: subjects[0], target: 'type', member: 'illicit-conclusion-kind', operation: 'add' },
  { subject: subjects[1], target: 'detector', operation: 'bypass' },
  { subject: subjects[1], target: 'claim-site', operation: 'bypass' },
]
expected.forEach((leg, index) => { leg.id = `Q${String(index + 1).padStart(2, '0')}` })

test('quarantine mutation registration and isolated failure restoration', () => {
  assert.equal(JSON.parse(fs.readFileSync('package.json', 'utf8')).scripts['validate:quarantine-mutation'],
    'bash scripts/422-quarantine-mutation.sh', 'quarantine mutation must be registered')
  assert.ok(fs.existsSync('scripts/422-quarantine-mutation.sh'), 'the instrument must exist')
  assert.equal(expected.length, 6)
  for (const mode of ['neutered', 'fatal', 'SIGINT', 'SIGTERM', 'SIGHUP', '', 'invalid']) {
    const copy = path.join(work, mode || 'normal')
    // A fresh checkout per mode: the interruption modes leave a mutated tree behind if the
    // instrument's cleanup is broken, and sharing one copy would let the FIRST mode's damage be
    // read as the second mode's restoration.
    fs.mkdirSync(path.join(copy, 'packages/schema'), { recursive: true })
    fs.mkdirSync(path.join(copy, 'packages/agent-local'), { recursive: true })
    fs.mkdirSync(path.join(copy, 'packages/agent'), { recursive: true })
    fs.mkdirSync(path.join(copy, 'scripts'))
    for (const pkg of ['schema', 'agent-local', 'agent']) {
      fs.cpSync(`packages/${pkg}/src`, path.join(copy, `packages/${pkg}/src`), { recursive: true })
      for (const file of ['package.json', 'tsconfig.json', 'vitest.config.ts']) {
        fs.copyFileSync(`packages/${pkg}/${file}`, path.join(copy, `packages/${pkg}/${file}`))
      }
      fs.cpSync(`packages/${pkg}/dist`, path.join(copy, `packages/${pkg}/dist`), { recursive: true })
    }
    for (const file of ['package.json', 'tsconfig.base.json', 'scripts/422-quarantine-mutation.sh']) {
      fs.copyFileSync(file, path.join(copy, file))
    }
    for (const directory of ['node_modules', 'packages/schema/node_modules',
      'packages/agent-local/node_modules', 'packages/agent/node_modules']) {
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
    const result = spawnSync('bash', ['scripts/422-quarantine-mutation.sh'], {
      cwd: copy, env: { ...process.env, AGENT_QA_QUARANTINE_MUTATION_SELFTEST: mode },
      stdio: ['ignore', fd, fd], timeout: 900000,
    })
    fs.closeSync(fd)
    fs.writeFileSync(path.join(work, `${mode || 'normal'}.json`), JSON.stringify({
      mode, status: result.status, signal: result.signal, error: result.error?.message,
      elapsedMs: Date.now() - started, before, after: subjects.map(file => sha(path.join(copy, file))),
    }, null, 2) + '\n')
    const output = fs.readFileSync(log, 'utf8')
    assert.equal(result.error, undefined, `${mode}: child tool failure`)
    assert.equal(result.signal, null, `${mode}: uncontrolled child signal`)
    // THE RESTORATION CLAIM, on every path: normal, refused, fatal and each interruption.
    assert.deepEqual(subjects.map(file => sha(path.join(copy, file))), before, `${mode}: restoration`)
    if (mode === '') {
      assert.equal(result.status, 0, output)
      assert.match(output, /^QUARANTINE_MUTATION_OK legs=6 named-red=6 byte-identical-restoration=6$/m)
      assert.ok(!output.includes('FATAL:'), output)
      const evidence = /^Evidence: (.+)$/m.exec(output)?.[1]
      assert.ok(evidence, 'normal child must retain evidence')
      const ledger = JSON.parse(fs.readFileSync(path.join(evidence, 'ledger.json'), 'utf8'))
      assert.equal(ledger.length, 6)
      const snapshots = JSON.parse(fs.readFileSync(path.join(evidence, 'subjects.json'), 'utf8'))
      assert.deepEqual(Object.keys(snapshots), subjects)
      for (const [index, leg] of ledger.entries()) {
        const contract = expected[index]
        assert.deepEqual(Object.fromEntries(Object.keys(contract).map(key => [key, leg[key]])), contract)
        // ACTUAL exits, not the instrument's own opinion of them: a RED leg really failed and the
        // restored tree really passed, each in a child process of its own.
        assert.equal(leg.exit, 1, `${leg.id}: actual RED exit`)
        assert.equal(leg.restoreDigest, before[subjects.indexOf(leg.subject)])
        assert.ok(leg.failures.length > 0, `${leg.id}: a RED leg must name failing cells`)
        for (const [suffix, exit] of [['red', 1], ['restored-green', 0]]) {
          const record = JSON.parse(fs.readFileSync(path.join(evidence, `${leg.id}-${suffix}.json`), 'utf8'))
          assert.equal(record.exit, exit, `${leg.id}: ${suffix} actual exit`)
        }
      }
      for (const [index, file] of subjects.entries()) assert.equal(snapshots[file].hash, before[index])
      assert.equal((output.match(/^NAMED RED Q\d+:/gm) ?? []).length, 6)
    } else {
      assert.equal(result.status, 1, output)
      const reason = mode === 'neutered' ? 'suite stayed green' : mode === 'fatal'
        ? 'intentional fatal after Q01 mutation' : mode === 'invalid'
          ? 'Unknown AGENT_QA_QUARANTINE_MUTATION_SELFTEST' : `interrupted by ${mode}`
      assert.ok(output.includes(`FATAL: ${reason}`), output)
      assert.deepEqual(output.match(/^FATAL: .+$/gm), [`FATAL: ${reason}`], 'no unexplained failure')
      assert.ok(!output.includes('QUARANTINE_MUTATION_OK'), output)
      if (mode !== 'invalid') for (const [index, file] of subjects.entries()) {
        assert.ok(output.includes(`RESTORED ${file} sha256=${before[index]}`), output)
      }
      if (mode === 'fatal' || mode.startsWith('SIG')) {
        const mutations = [...output.matchAll(/^MUTATED (.+) sha256=([a-f0-9]{64})$/gm)]
        assert.deepEqual(mutations.map(row => row[1]), subjects, 'every subject must change before interruption')
        for (const [index, row] of mutations.entries()) assert.notEqual(row[2], before[index])
      }
      if (mode === 'neutered') {
        // The refusal must follow an ACTUAL green child, not a skipped one: a neutered run that
        // never invoked the suite would "refuse" without proving the suite is the thing that reds.
        assert.match(output, /^Q01-red: exit=0 /m, 'neutered refusal must follow an actual green child')
        assert.ok(!output.includes('MUTATED '), output)
      }
    }
    console.log(`SELFTEST ${mode || 'normal'} exit=${result.status} restored=${subjects.length} log=${log}`)
  }
  console.log('QUARANTINE_MUTATION_SELFTEST_OK')
})
NODE
