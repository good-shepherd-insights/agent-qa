#!/usr/bin/env bash
# Source-only, serial mutation proof for the 422 D-16 quarantine (ADV-03).
# Installed Node 24 and workspace tools are required.
# AGENT_QA_QUARANTINE_MUTATION_SELFTEST is exactly empty, neutered, fatal, SIGINT, SIGTERM or SIGHUP.
# No downloads, builds, provider calls, or persistent source changes.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
exec node --input-type=commonjs - <<'NODE'
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')
const { spawn, spawnSync } = require('node:child_process')
const mode = process.env.AGENT_QA_QUARANTINE_MUTATION_SELFTEST ?? ''
if (!['', 'neutered', 'fatal', 'SIGINT', 'SIGTERM', 'SIGHUP'].includes(mode)) {
  console.error('FATAL: Unknown AGENT_QA_QUARANTINE_MUTATION_SELFTEST')
  process.exit(1)
}
if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Node 24 or later required')
const root = process.cwd()
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-qa-quarantine-mutation-'))
console.log(`Evidence: ${work}`)
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
const CONCLUSION = 'packages/schema/src/job/job.ts'
const STORE = 'packages/agent-local/src/store/sqlite-job-store.ts'
const subjects = [CONCLUSION, STORE]
const owned = new Map()
let child, cleanupActive = false
function restore() {
  for (const [file, snapshot] of owned) {
    const bytes = fs.readFileSync(snapshot.path)
    if (sha(bytes) !== snapshot.hash) throw new Error(`snapshot corrupted: ${file}`)
    fs.writeFileSync(path.join(root, file), bytes)
    if (sha(fs.readFileSync(path.join(root, file))) !== snapshot.hash) throw new Error(`restore hash mismatch: ${file}`)
    console.log(`RESTORED ${file} sha256=${snapshot.hash}`)
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
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => fatal(`interrupted by ${signal}`))
process.on('uncaughtException', error => fatal(error.message))
process.on('unhandledRejection', error => fatal(error.message))
process.on('exit', () => {
  if (!cleanupActive) try { restore() } catch (error) {
    console.error(`FATAL: ${error.message}`)
    process.exitCode = 1
  }
})

// ---- the cells each leg must redden, named BEFORE anything runs -----------------------------------
const conclusionRuntime = 'src/job/__tests__/job-contracts.test.ts'
const conclusionTypes = 'src/job/__tests__/job-contracts.test-d.ts'
const RUNTIME_CELL = `${conclusionRuntime} > jobConclusionKind, the 422 D-16 vocabulary > job conclusion kinds exact`
const TYPE_CELL = `${conclusionTypes} > job conclusion kinds exact type bars`
const storeFiles = ['src/__tests__/quarantined-job-history.test.ts',
  'src/__tests__/kill-matrix/kill-matrix-adversarial.test.ts']
const POISON_CELL = `${storeFiles[1]} > a retired-kind row at the head of the FIFO (D-16, ADV-03) `
  + '> lands every poisoned head permanently with its attempt spent and runs the valid follower'
const projection = 'the diagnostic projection of a quarantined row (422 D-16)'
const requeue = 'requeueing a quarantined row (422 D-16)'
const HISTORY_CELLS = [
  `${storeFiles[0]} > ${projection} > reports the original retired kind, the unreadable-kind conclusion and the spent attempt`,
  `${storeFiles[0]} > ${projection} > leaves a readable row with no conclusion at all — the control for the cell above`,
  `${storeFiles[0]} > ${projection} > reports no conclusion for a retired-kind row that has not been quarantined yet`,
  `${storeFiles[0]} > ${requeue} > refuses by name and leaves every column of the history exactly as it found it`,
  `${storeFiles[0]} > ${requeue} > still requeues an ordinary terminal row — the control for the refusal above`,
  `${storeFiles[0]} > ${requeue} > drains subsequent valid work after the refusal, across a reopen`,
]
const STORE_CELLS = [POISON_CELL, ...HISTORY_CELLS].sort()

// The bypass legs must NOT redden the one cell that describes a retired-kind row nobody has
// claimed yet: that row is queued either way, so a leg claiming it as evidence would be claiming
// evidence the mutation did not produce.
const UNQUARANTINED_CELL = HISTORY_CELLS[2]
const STORE_REDS = [POISON_CELL, ...HISTORY_CELLS.filter(cell => cell !== UNQUARANTINED_CELL)].sort()

// ---- the inventory, written out rather than derived from any declaration under test ---------------
const legs = [
  { subject: CONCLUSION, target: 'list', member: 'unreadable_kind', operation: 'remove',
    reds: [RUNTIME_CELL, TYPE_CELL] },
  { subject: CONCLUSION, target: 'list', member: 'illicit-conclusion-kind', operation: 'add',
    reds: [RUNTIME_CELL, TYPE_CELL] },
  { subject: CONCLUSION, target: 'type', member: 'unreadable_kind', operation: 'remove',
    reds: [TYPE_CELL] },
  { subject: CONCLUSION, target: 'type', member: 'illicit-conclusion-kind', operation: 'add',
    reds: [TYPE_CELL] },
  { subject: STORE, target: 'detector', operation: 'bypass', reds: STORE_REDS },
  { subject: STORE, target: 'claim-site', operation: 'bypass', reds: STORE_REDS },
]
legs.forEach((leg, index) => { leg.id = `Q${String(index + 1).padStart(2, '0')}` })
if (legs.length !== 6) throw new Error('Expected exactly 6 mutation legs')

// ---- the mutations ---------------------------------------------------------------------------
// Each anchor is required to land EXACTLY once and to change bytes, so an edit that moved the
// declaration turns the instrument red instead of quietly mutating nothing.
const BYPASS = {
  detector: {
    from: 'return !isJobKind(String(row.kind))',
    to: 'return false',
  },
  'claim-site': {
    from: 'if (isUnreadableKindRow(claimed)) {',
    to: 'if (false && isUnreadableKindRow(claimed)) {',
  },
}
function mutate(text, leg) {
  if (leg.target === 'detector' || leg.target === 'claim-site') {
    const { from, to } = BYPASS[leg.target]
    if (text.split(from).length !== 2) throw new Error(`Missing bypass anchor: ${leg.id}`)
    return text.replace(from, to)
  }
  const pattern = leg.target === 'list'
    ? /(export const jobConclusionKindValues = )(\[[\s\S]*?\])( as const satisfies readonly JobConclusionKind\[\])/
    : /(export type JobConclusionKind =)([^\n]*(?:\n  \|[^\n]*)*)/
  let count = 0
  const output = text.replace(pattern, (all, prefix, declaration, suffix = '') => {
    count++
    const values = declaration.match(/'[^']*'/g) ?? []
    const quoted = `'${leg.member}'`
    if (leg.operation === 'remove' && values.filter(value => value === quoted).length !== 1) throw new Error(`Missing member ${leg.member}`)
    const changed = leg.operation === 'remove' ? values.filter(value => value !== quoted) : [...values, quoted]
    // The `satisfies` clause is dropped only for list-ADDITION legs, so the addition reaches the
    // independent instruments instead of being absorbed by a compile error in the subject itself.
    return leg.target === 'list'
      ? prefix + `[${changed.join(', ')}]` + (leg.operation === 'add' ? ' as const' : suffix)
      : prefix + ' ' + changed.join(' | ')
  })
  if (count !== 1 || output === text) throw new Error(`Mutation anchor did not land: ${leg.id}`)
  return output
}

// ---- reading a run ----------------------------------------------------------------------------
function parse(log) {
  const clean = log.replace(/\x1b\[[0-9;]*m/g, '')
  const failures = [...clean.matchAll(/^ FAIL  (src\/[^ ]+) > (.+)$/gm)]
    .map(match => `${match[1]} > ${match[2]}`)
  const diagnostics = [...clean.matchAll(/^(TypeCheckError:[\s\S]*?)^ ❯ (src\/[^\n]+:\d+:\d+)$/gm)]
    .map(match => ({ message: match[1].trim(), pointer: match[2] }))
  const selected = [...clean.matchAll(/^\s*[✓×] (?: TS  )?(src\/[^ ]+) > (.+?)(?: \d+ms)?$/gm)]
  // A run that selected nothing proves nothing, however it exited. This is the check that stops a
  // mistyped path or a renamed cell from being read as a successful mutation.
  if (!selected.length || /No test files found|Tests\s+no tests/.test(clean)) throw new Error('No selected named tests')
  if ((clean.match(/^TypeCheckError:/gm) ?? []).length !== diagnostics.length) throw new Error('Unparsed type diagnostic')
  if (/^(?:Error|SyntaxError|ReferenceError|RangeError|TypeError):/m.test(clean)) throw new Error('Unrelated tool error')
  return {
    clean,
    failures: [...new Set(failures)].sort(),
    diagnostics,
    selectedNames: selected.map(row => `${row[1]} > ${row[2]}`).sort(),
    digest: sha(JSON.stringify(diagnostics)),
  }
}
function checkGreen(result) {
  const parsed = parse(result.log)
  if (JSON.stringify(parsed.selectedNames) !== JSON.stringify(result.expectedNames)) throw new Error('Missing or unexpected selected cell')
  if (result.exit !== 0 || parsed.failures.length || parsed.diagnostics.length) throw new Error('Preflight/restored instrument did not pass')
  if (result.withTypes && !parsed.clean.includes('Type Errors  no errors')) throw new Error('Preflight/restored instrument did not pass')
}
function checkRed(result, leg) {
  if (result.exit === 0) throw new Error('suite stayed green')
  if (result.exit !== 1) throw new Error(`Unexpected tool exit ${result.exit}`)
  const parsed = parse(result.log)
  if (JSON.stringify(parsed.selectedNames) !== JSON.stringify(result.expectedNames)) throw new Error('Missing or unexpected selected cell')
  const expected = [...leg.reds].sort()
  if (JSON.stringify(parsed.failures) !== JSON.stringify(expected)) {
    throw new Error(`Unexpected named failures: ${JSON.stringify(parsed.failures)}`)
  }
  // A type leg must be proved by the TYPE instrument's own assertion, not merely by a compile
  // error somewhere in the subject file it mutated.
  if (result.withTypes && expected.includes(TYPE_CELL)) {
    if (!parsed.diagnostics.some(row => row.pointer.startsWith(conclusionTypes + ':'))) throw new Error('Missing intended type assertion')
  }
  if (!result.withTypes && parsed.diagnostics.length) throw new Error('Unexpected type diagnostic')
  return parsed
}
async function instrument(leg, label) {
  const withTypes = leg.subject === CONCLUSION
  const cwd = withTypes ? 'packages/schema' : 'packages/agent-local'
  const expectedNames = withTypes ? [RUNTIME_CELL, TYPE_CELL].sort() : STORE_CELLS
  const args = [path.join(root, 'node_modules/vitest/vitest.mjs'), 'run',
    ...(withTypes
      ? [conclusionRuntime, conclusionTypes, '--typecheck', '-t', 'job conclusion kinds exact']
      : [...storeFiles, '--typecheck.enabled=false', '-t', 'D-16']),
    '--reporter=verbose', '--maxWorkers=1']
  const logPath = path.join(work, `${label}.log`)
  const fd = fs.openSync(logPath, 'wx')
  const start = Date.now()
  let timedOut = false
  const exit = await new Promise((resolve, reject) => {
    child = spawn(process.execPath, args, { cwd: path.join(root, cwd), detached: true,
      stdio: ['ignore', fd, fd], env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' } })
    const timer = setTimeout(() => { timedOut = true; stopChild('SIGKILL') }, 180000)
    child.on('error', error => { clearTimeout(timer); reject(error) })
    child.on('exit', (code, signal) => { clearTimeout(timer); child = undefined; resolve(code ?? `signal:${signal}`) })
  })
  fs.closeSync(fd)
  const record = { command: [process.execPath, ...args], cwd, exit, withTypes, expectedNames,
    elapsedMs: Date.now() - start, logPath }
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
async function main() {
  // Check every subject before owning any bytes; never discard unrelated edits.
  for (const file of subjects) {
    const status = spawnSync('git', ['status', '--porcelain', '--', file], { cwd: root, encoding: 'utf8' })
    if (status.status !== 0 || status.stdout.trim()) throw new Error(`${file} is dirty or untracked — refusing mutation`)
    if (!fs.lstatSync(file).isFile()) throw new Error(`Non-regular subject: ${file}`)
  }
  for (const file of subjects) {
    const bytes = fs.readFileSync(file)
    const snapshot = path.join(work, path.basename(file) + '.snapshot')
    fs.writeFileSync(snapshot, bytes, { flag: 'wx' })
    owned.set(file, { path: snapshot, hash: sha(bytes) })
  }
  fs.writeFileSync(path.join(work, 'subjects.json'), JSON.stringify(Object.fromEntries(owned), null, 2) + '\n')
  // Both suites must be green BEFORE any mutation, or a leg's RED could be pre-existing.
  checkGreen(await instrument(legs[0], 'preflight-conclusion'))
  checkGreen(await instrument(legs[4], 'preflight-store'))
  const ledger = []
  for (const leg of legs) {
    console.log(`LEG ${leg.id} ${leg.target} ${leg.operation} ${leg.member ?? 'quarantine'}`)
    const snapshot = owned.get(leg.subject)
    if (mode !== 'neutered') {
      fs.writeFileSync(leg.subject, mutate(fs.readFileSync(snapshot.path, 'utf8'), leg))
      if (sha(fs.readFileSync(leg.subject)) === snapshot.hash) throw new Error('Mutation changed no bytes')
    }
    // Interruption controls must restore changed bytes for every old/new subject,
    // not merely re-write the unchanged snapshots of subjects after the first leg.
    if (mode === 'fatal' || mode.startsWith('SIG')) {
      for (const file of subjects) {
        const control = legs.find(candidate => candidate.subject === file)
        const original = owned.get(file)
        if (file !== leg.subject) fs.writeFileSync(file, mutate(fs.readFileSync(original.path, 'utf8'), control))
        const digest = sha(fs.readFileSync(file))
        if (digest === original.hash) throw new Error(`Interruption control changed no bytes: ${file}`)
        console.log(`MUTATED ${file} sha256=${digest}`)
      }
    }
    if (mode === 'fatal') throw new Error(`intentional fatal after ${leg.id} mutation`)
    if (mode.startsWith('SIG')) {
      process.kill(process.pid, mode)
      await new Promise(resolve => setTimeout(resolve, 100))
      throw new Error('Signal handler failed')
    }
    const result = await instrument(leg, `${leg.id}-red`)
    const parsed = checkRed(result, leg)
    mustReject('tool crash', () => checkRed({ ...result, exit: 2 }, leg))
    mustReject('unrelated error', () => checkRed({ ...result, log: result.log + '\nError: unrelated\n' }, leg))
    mustReject('wrong named cell', () => checkRed({ ...result,
      log: result.log.replace(/^( FAIL  src\/[^ ]+ > .+)$/m, '$1 trailing') }, leg))
    mustReject('zero selected cells', () => checkRed({ ...result,
      log: result.log.replace(/^\s*[✓×] (?: TS  )?src\/[^ ]+ > .+$/gm, '') }, leg))
    mustReject('wrong selected cell', () => checkRed({ ...result,
      log: result.log.replace(/^(\s*[✓×] (?: TS  )?src\/[^ ]+ > .+)$/m, '$1 trailing') }, leg))
    if (result.withTypes && leg.reds.includes(TYPE_CELL)) mustReject('missing type assertion', () => checkRed({ ...result,
      log: result.log.replace(/^TypeCheckError:[\s\S]*?^ ❯ src\/job\/__tests__\/job-contracts\.test-d\.ts:[^\n]+$/gm, '') }, leg))
    ledger.push({ ...leg, exit: result.exit, failures: parsed.failures, diagnostics: parsed.diagnostics,
      digest: parsed.digest, restoreDigest: snapshot.hash })
    fs.writeFileSync(path.join(work, 'ledger.json'), JSON.stringify(ledger, null, 2) + '\n')
    console.log(`NAMED RED ${leg.id}: ${parsed.failures.join(' | ')}; diagnostics=${parsed.digest}`)
    restore()
    checkGreen(await instrument(leg, `${leg.id}-restored-green`))
  }
  restore()
  owned.clear()
  console.log(`QUARANTINE_MUTATION_OK legs=${ledger.length} named-red=6 byte-identical-restoration=6`)
}
main().catch(error => fatal(error.message))
NODE
