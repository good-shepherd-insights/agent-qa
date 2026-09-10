#!/usr/bin/env bash
# Serial final evidence; installed tools only. No temporary helper is required.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
if [ -x /Users/pranshu/.nvm/versions/node/v24.15.0/bin/node ]; then
  export PATH="/Users/pranshu/.nvm/versions/node/v24.15.0/bin:$PATH"
fi
if [ -x /private/tmp/gsd420-bin/pnpm ]; then
  export PATH="/private/tmp/gsd420-bin:$PATH"
fi
exec node --input-type=commonjs - "$@" <<'NODE'
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')
const { spawn, spawnSync } = require('node:child_process')
const root = process.cwd()
const gates = [
  { label: 'build', argv: ['pnpm', 'build', '--force', '--concurrency=1'], kind: 'turbo' },
  { label: 'typecheck', argv: ['pnpm', 'typecheck', '--force', '--concurrency=1'], kind: 'turbo' },
  { label: 'test', argv: ['pnpm', 'test', '--force', '--concurrency=1', '--', '--maxWorkers=4'], kind: 'turbo-test' },
  { label: 'validate-arch', argv: ['pnpm', 'run', 'validate:arch'], kind: 'vitest' },
  { label: 'validate-safety', argv: ['pnpm', 'run', 'validate:safety'], kind: 'vitest' },
  { label: 'validate-eval-root-hygiene', argv: ['pnpm', 'run', 'validate:eval-root-hygiene'], kind: 'hygiene' },
  { label: 'validate-panel-mutation', argv: ['pnpm', 'run', 'validate:panel-mutation'], kind: 'mutation' },
  { label: 'panel-selftest', argv: ['bash', 'scripts/421-panel-mutation-selftest.sh'], kind: 'selftest' },
  { label: 'validate-skills', argv: ['pnpm', 'run', 'validate:skills'], kind: 'skills' },
  { label: 'validate-publish', argv: ['pnpm', 'run', 'validate:publish'], kind: 'publish' },
  { label: 'lint-namespace', argv: ['pnpm', 'run', 'lint:namespace'], kind: 'namespace' },
]
const subjects = ['packages/eval/src/judge/panel.ts', 'packages/eval/src/match/score.ts',
  'packages/eval/src/judge/config.ts', 'packages/eval/src/judge/calibration.ts']
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const hashes = () => Object.fromEntries(subjects.map(file => [file, sha(file)]))
function git(args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`git ${args[0]} failed: ${result.stderr}`)
  return result.stdout.trim()
}
const plain = text => text.replace(/\x1b\[[0-9;]*m/g, '')

// The result validator is shared by real gates and subprocess controls.
function validateOutput(gate, output) {
  const errors = []
  const requireMatch = (pattern, message) => { if (!pattern.test(output)) errors.push(message) }
  if (gate.kind.startsWith('turbo')) {
    const tasks = [...output.matchAll(/Tasks:\s+(\d+) successful,\s+(\d+) total/g)].at(-1)
    const cached = [...output.matchAll(/Cached:\s+(\d+) cached,\s+(\d+) total/g)].at(-1)
    if (!tasks || Number(tasks[1]) <= 0 || tasks[1] !== tasks[2]) errors.push('Complete positive Turbo task summary missing')
    if (!cached || cached[1] !== '0' || (tasks && cached[2] !== tasks[2])) errors.push('Fresh zero-cache task proof missing')
  }
  if (gate.kind === 'turbo-test' || gate.kind === 'vitest') {
    requireMatch(/Test Files\s+[1-9]\d* passed/, 'Positive test-file summary missing')
    requireMatch(/Tests\s+[1-9]\d* passed/, 'Positive test summary missing')
    if (/Tests\s+[^\n]*\d+ failed|Test Files\s+[^\n]*\d+ failed|No test files found/.test(output)) errors.push('Failed or empty test selection')
    // Named standalone gates have no optional lanes; the full workspace retains its historic skips.
    if (gate.kind === 'vitest' && /(?:Tests|Test Files)\s+[^\n]*\d+ skipped/.test(output)) errors.push('Requested named gate skipped cells')
    for (const name of gate.packages ?? []) {
      const lines = output.split('\n').filter(line => line.startsWith(`${name}:test:`)).join('\n')
      if (!/Tests\s+[1-9]\d* passed/.test(lines) || !/Test Files\s+[1-9]\d* passed/.test(lines)) {
        errors.push(`Workspace package lacks positive test summaries: ${name}`)
      }
    }
  }
  if (gate.kind === 'hygiene') {
    for (let leg = 1; leg <= 6; leg++) requireMatch(new RegExp(`^PASS L${leg}(?:\\s|$)`, 'm'), `Hygiene L${leg} missing`)
    if (/^FAIL /m.test(output)) errors.push('Hygiene failure')
  }
  if (gate.kind === 'mutation') {
    requireMatch(/^PANEL_MUTATION_OK legs=41 named-red=41 byte-identical-restoration=41$/m, 'Complete mutation summary missing')
    if ((output.match(/^NAMED RED P\d+:/gm) ?? []).length !== 41) errors.push('Named mutation leg inventory incomplete')
  }
  if (gate.kind === 'selftest') {
    requireMatch(/^PANEL_MUTATION_SELFTEST_OK$/m, 'Panel selftest sentinel missing')
    requireMatch(/(?:# |ℹ )pass 1\b/, 'Panel selftest positive count missing')
    requireMatch(/(?:# |ℹ )fail 0\b/, 'Panel selftest zero-failure summary missing')
    requireMatch(/(?:# |ℹ )skipped 0\b/, 'Panel selftest no-skip summary missing')
  }
  if (gate.kind === 'skills') requireMatch(/^agent-qa skills pack validation passed$/m, 'Skills validation summary missing')
  if (gate.kind === 'publish') requireMatch(/^publish surface validation passed \(full\)$/m, 'Full publish validation summary missing')
  return errors
}
function verdict(processCode, errors) {
  return processCode !== 0 ? processCode : errors.length ? 1 : 0
}
function namespaceInventory() {
  let count = 0
  function scan(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink() || ['node_modules', 'dist'].includes(entry.name)) continue
      const file = path.join(directory, entry.name)
      if (entry.isDirectory()) scan(file)
      else if (/\.(ts|js|json)$/.test(entry.name)) {
        count++
        if (fs.readFileSync(file, 'utf8').includes('@agent-qa/')) throw new Error(`Forbidden namespace: ${file}`)
      }
    }
  }
  scan(path.join(root, 'packages'))
  if (!count) throw new Error('Namespace scan selected no source files')
  return count
}
async function runGate(gate, out, sourceHead, initialHashes) {
  if (git(['rev-parse', 'HEAD']) !== sourceHead || git(['status', '--porcelain'])) {
    throw new Error('Source must remain committed and clean before every gate')
  }
  const log = path.join(out, `${gate.label}.log`)
  const fd = fs.openSync(log, 'wx')
  const started = new Date().toISOString()
  const start = performance.now()
  console.log(`START ${gate.label}: ${JSON.stringify(gate.argv)}`)
  let launchError
  const processResult = await new Promise(resolve => {
    const child = spawn(gate.argv[0], gate.argv.slice(1), { cwd: root,
      env: { ...process.env, TURBO_FORCE: 'true' },
      stdio: ['ignore', fd, fd] })
    const heartbeat = setInterval(() => console.log(`${gate.label}: running (${Math.round((performance.now() - start) / 1000)}s)`), 30000)
    child.on('error', error => { launchError = error.message })
    child.on('close', (code, signal) => {
      clearInterval(heartbeat)
      resolve({ code, signal })
    })
  })
  fs.closeSync(fd)
  const output = plain(fs.readFileSync(log, 'utf8'))
  const errors = validateOutput(gate, output)
  const finishedHead = git(['rev-parse', 'HEAD'])
  const clean = !git(['status', '--porcelain'])
  const after = hashes()
  if (launchError) errors.push(`Child launch failed: ${launchError}`)
  if (finishedHead !== sourceHead || !clean) errors.push('Source changed during gate')
  if (JSON.stringify(after) !== JSON.stringify(initialHashes)) errors.push('Mutation subject not restored')
  let namespaceFiles
  if (gate.kind === 'namespace') {
    try { namespaceFiles = namespaceInventory() } catch (error) { errors.push(error.message) }
  }
  const processCode = processResult.code ?? (processResult.signal ? 128 + (os.constants.signals[processResult.signal] ?? 1) : 1)
  const record = { label: gate.label, argv: gate.argv, cwd: root, source_head: sourceHead,
    source_head_finished: finishedHead, source_clean_finished: clean, process_exit_code: processCode,
    signal: processResult.signal, validation_errors: errors, started_at: started,
    finished_at: new Date().toISOString(), elapsed_seconds: Number(((performance.now() - start) / 1000).toFixed(3)),
    exit_code: verdict(processCode, errors), timed_out: false, turbo_force: 'true', log,
    summaries: output.split('\n').filter(line => /Tasks:|Cached:|Test Files |Tests |^(?:# |ℹ )(tests|pass|fail|skipped)|^PASS L|^PANEL_|validation passed/.test(line)),
    subjects_before: initialHashes, subjects_after: after, ...(namespaceFiles ? { namespace_files: namespaceFiles } : {}) }
  fs.writeFileSync(path.join(out, `${gate.label}.json`), JSON.stringify(record, null, 2) + '\n', { flag: 'wx' })
  console.log(JSON.stringify(record, null, 2))
  if (record.exit_code) throw Object.assign(new Error(`${gate.label} failed; see ${log}`), { exitCode: record.exit_code })
  return record
}
function selftest() {
  const assert = require('node:assert/strict')
  const { test } = require('node:test')
  const fixture = (output, code = 0) => {
    const result = spawnSync(process.execPath, ['-e', 'process.stdout.write(process.argv[1]); process.exitCode = Number(process.argv[2])', output, String(code)], { encoding: 'utf8' })
    assert.equal(result.error, undefined)
    assert.equal(result.signal, null)
    return result
  }
  test('final runner rejects process-zero incomplete Turbo execution', () => {
    const result = fixture('Tasks: 44 successful, 46 total\nCached: 0 cached, 46 total\n')
    assert.equal(result.status, 0)
    assert.equal(verdict(result.status, validateOutput(gates[0], result.stdout)), 1,
      'an incomplete positive task summary must fail aggregate acceptance')
  })
  test('final runner preserves an actual child failure exit', () => {
    const result = fixture('Tasks: 22 successful, 22 total\nCached: 0 cached, 22 total\n', 7)
    assert.equal(verdict(result.status, validateOutput(gates[0], result.stdout)), 7)
  })
  test('final runner rejects empty cached failed and absent named summaries', () => {
    for (const output of ['', 'Tasks: 0 successful, 0 total\nCached: 0 cached, 0 total\n',
      'Tasks: 22 successful, 22 total\nCached: 1 cached, 22 total\n']) {
      const result = fixture(output)
      assert.equal(verdict(result.status, validateOutput(gates[0], result.stdout)), 1)
    }
    for (const gate of gates.filter(gate => gate.kind !== 'namespace')) {
      assert.ok(validateOutput(gate, fixture('').stdout).length, `${gate.label} needs positive output`)
    }
    const failure = fixture('Test Files 1 passed (1)\nTests 1 passed | 1 failed (2)\n')
    assert.equal(verdict(failure.status, validateOutput(gates[3], failure.stdout)), 1)
  })
  test('final runner accepts complete positive fresh summaries and preserves workspace skips', () => {
    const output = 'Tasks: 46 successful, 46 total\nCached: 0 cached, 46 total\nTest Files 2 passed (2)\nTests 36 passed | 1 skipped (37)\n'
    assert.deepEqual(validateOutput(gates[2], fixture(output).stdout), [])
    assert.ok(validateOutput(gates[3], output).length, 'named standalone gates cannot skip requested cells')
    assert.ok(validateOutput({ ...gates[2], packages: ['fixture'] }, output).length,
      'another package cannot stand in for the expected package')
    assert.deepEqual(validateOutput(gates[0], fixture('Tasks: 22 successful, 22 total\nCached: 0 cached, 22 total\n').stdout), [])
  })
}
async function main() {
  const args = process.argv.slice(2)
  if (args.length === 1 && args[0] === '--selftest') { selftest(); return }
  if (args.length) throw new Error('Only --selftest is supported; normal execution runs every required gate')
  if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Installed Node >=24 required')
  const sourceHead = git(['rev-parse', 'HEAD'])
  if (git(['status', '--porcelain'])) throw new Error('Commit source and stop editing before final checks')
  const out = process.env.AGENT_QA_PANEL_FINAL_EVIDENCE_DIR
    ? path.resolve(process.env.AGENT_QA_PANEL_FINAL_EVIDENCE_DIR)
    : fs.mkdtempSync(path.join(os.tmpdir(), 'agent-qa-panel-final-'))
  fs.mkdirSync(out, { recursive: true })
  const initialHashes = hashes()
  // Workspace globs are the existing packages/* and tools/*; demand every test task's own result.
  gates[2].packages = ['packages', 'tools'].flatMap(base => fs.readdirSync(base).flatMap(name => {
    const file = path.join(base, name, 'package.json')
    if (!fs.existsSync(file)) return []
    const manifest = JSON.parse(fs.readFileSync(file, 'utf8'))
    return manifest.scripts?.test ? [manifest.name] : []
  }))
  if (!gates[2].packages.length) throw new Error('Workspace test inventory empty')
  const records = []
  console.log(`FINAL SOURCE FREEZE ${sourceHead}\nFinal evidence: ${out}`)
  for (const gate of gates) records.push(await runGate(gate, out, sourceHead, initialHashes))
  if (records.length !== 11) throw new Error('Required gate inventory incomplete')
  fs.writeFileSync(path.join(out, 'aggregate.json'), JSON.stringify({ source_head: sourceHead,
    source_clean_finished: true, records, status: 'passed' }, null, 2) + '\n', { flag: 'wx' })
  console.log('PANEL_FINAL_GATES_OK')
}
main().catch(error => { console.error(error.message); process.exitCode = error.exitCode ?? 1 })
NODE
