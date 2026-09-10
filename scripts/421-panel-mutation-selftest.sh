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
  'packages/eval/src/judge/config.ts']
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-qa-panel-selftest-'))
console.log(`Selftest evidence: ${work}`)
function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
}
test('panel mutation registration and isolated failure restoration', () => {
  assert.equal(JSON.parse(fs.readFileSync('package.json', 'utf8')).scripts['validate:panel-mutation'],
    'bash scripts/421-panel-mutation.sh', 'panel mutation must be registered')
  for (const mode of ['', 'neutered', 'fatal', 'SIGINT', 'SIGTERM', 'SIGHUP', 'invalid']) {
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
    const result = spawnSync('bash', ['scripts/421-panel-mutation.sh'], {
      cwd: copy, env: { ...process.env, AGENT_QA_PANEL_MUTATION_SELFTEST: mode },
      stdio: ['ignore', fd, fd], timeout: 600000,
    })
    fs.closeSync(fd)
    const output = fs.readFileSync(log, 'utf8')
    assert.equal(result.error, undefined, `${mode}: child tool failure`)
    assert.equal(result.signal, null, `${mode}: uncontrolled child signal`)
    assert.deepEqual(subjects.map(file => sha(path.join(copy, file))), before, `${mode}: restoration`)
    if (mode === '') {
      assert.equal(result.status, 0, output)
      assert.match(output, /PANEL_MUTATION_OK legs=25/)
    } else {
      assert.equal(result.status, 1, output)
      const reason = mode === 'neutered' ? 'suite stayed green' : mode === 'fatal'
        ? 'intentional fatal after P01 mutation' : mode === 'invalid'
          ? 'Unknown AGENT_QA_PANEL_MUTATION_SELFTEST' : `interrupted by ${mode}`
      assert.ok(output.includes(`FATAL: ${reason}`), output)
      assert.ok(!output.includes('PANEL_MUTATION_OK'), output)
      if (mode !== 'invalid') for (const [index, file] of subjects.entries()) {
        assert.ok(output.includes(`RESTORED ${file} sha256=${before[index]}`), output)
      }
    }
    console.log(`SELFTEST ${mode || 'normal'} exit=${result.status} restored=${subjects.length} log=${log}`)
  }
  console.log('PANEL_MUTATION_SELFTEST_OK')
})
NODE
