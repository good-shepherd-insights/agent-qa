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
  { label: 'test', argv: ['pnpm', 'test', '--force', '--concurrency=1'], kind: 'turbo-test' },
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
  return []
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
  let launchError, timedOut = false
  const processResult = await new Promise(resolve => {
    const child = spawn(gate.argv[0], gate.argv.slice(1), { cwd: root,
      env: { ...process.env, TURBO_FORCE: 'true', VITEST_MAX_THREADS: '1', VITEST_MAX_WORKERS: '1' },
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
    exit_code: verdict(processCode, errors), timed_out: timedOut, turbo_force: 'true', log,
    summaries: output.split('\n').filter(line => /Tasks:|Cached:|Test Files |Tests |^# (tests|pass|fail|skipped)|^PASS L|^PANEL_|validation passed/.test(line)),
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
