import assert from 'node:assert/strict'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { REQUIRED_LEGS } from '../gate/evaluate.mjs'
import * as gate from '../gate/run.mjs'

const SHA = 'a'.repeat(40)
const FILES = ['a.test.mjs', 'b.test.mjs']

function populateRoot(root) {
  mkdirSync(join(root, 'scripts/__tests__'), { recursive: true })
  mkdirSync(join(root, 'scripts/gate/inputs'), { recursive: true })
  for (const file of FILES) writeFileSync(join(root, 'scripts/__tests__', file), '')
  writeFileSync(
    join(root, 'scripts/gate/inputs/node-tests.json'),
    JSON.stringify({ schemaVersion: 1, files: FILES }),
  )
}

function greenReport() {
  const file = '/r/scripts/__tests__/a.test.mjs'
  const tests = [{ file, name: 'one', nesting: 0, status: 'passed' }]
  return JSON.stringify({ schemaVersion: 1, tests, summary: null })
}

async function fixture(t) {
  const base = await mkdtemp(join(tmpdir(), 'agent-qa-gate-run-test-'))
  t.after(() => rm(base, { recursive: true, force: true }))
  const source = join(base, 'source')
  const temp = join(base, 'tmp')
  populateRoot(source)
  mkdirSync(temp)
  return { source, out: join(base, 'out'), temp }
}

function fakeDeps({ temp, porcelain = '', logBytes = 0, legs } = {}) {
  const lines = []
  const calls = []
  const deps = {
    tmpdir: () => temp,
    now: () => new Date('2026-10-06T07:08:09Z'),
    pid: 42,
    output: { write: chunk => lines.push(...chunk.split('\n').filter(Boolean)) },
    exec(command, args) {
      calls.push([command, ...args])
      if (args.includes('rev-parse')) return { status: 0, stdout: `${SHA}\n`, stderr: '' }
      if (args.includes('status')) return { status: 0, stdout: porcelain, stderr: '' }
      return { status: 0, stdout: '', stderr: '' }
    },
    async run(command, args, { logPath }) {
      calls.push([command, ...args])
      writeFileSync(logPath, logBytes > 0 && command === 'node' ? 'x'.repeat(logBytes) : 'ok\n')
      if (command === 'git' && args[0] === 'clone') populateRoot(args.at(-1))
      const destination = args.find(
        arg => arg.startsWith('--test-reporter-destination=') && arg.endsWith('.json'),
      )
      if (destination) writeFileSync(destination.slice(destination.indexOf('=') + 1), greenReport())
      return { exitCode: 0, durationMs: 1 }
    },
  }
  if (legs) deps.buildGateLegs = legs
  return { deps, lines, calls }
}

function everyLegAsNodeTest({ root, runDir }) {
  return REQUIRED_LEGS.map(id => {
    const raw = join(runDir, 'raw', `${id.replace(/[^A-Za-z0-9._-]/g, '_')}.json`)
    return {
      id,
      kind: 'node-test',
      needsBuild: false,
      cwd: root,
      argv: ['node', '--test', `--test-reporter-destination=${raw}`],
      raw,
    }
  })
}

test('parseGateArgs rejects a missing --out, --in-place with --sha, an unknown leg or flag', () => {
  const { parseGateArgs } = gate
  const messageOf = argv => {
    try {
      parseGateArgs(argv)
    } catch (error) {
      return error.message
    }
    return '<no error>'
  }
  assert.match(messageOf([]), /missing --out/)
  assert.match(
    messageOf(['--out', 'x', '--in-place', '--sha', 'abc']),
    /--in-place cannot be combined with --sha/,
  )
  assert.match(messageOf(['--out', 'x', '--only', 'nope']), /unknown leg/)
  assert.match(messageOf(['--out', 'x', '--bogus']), /unknown argument/)
  const parsed = parseGateArgs(['--', '--out', 'x', '--in-place', '--keep-clone'])
  assert.equal(parsed.inPlace, true)
  assert.equal(parsed.keepClone, true)
})

test('runDirName names the mode, the UTC stamp and the pid', () => {
  assert.equal(typeof gate.runDirName, 'function')
  const { runDirName } = gate
  const now = new Date('2026-10-06T07:08:09Z')
  assert.equal(runDirName({ mode: 'in-place', now, pid: 42 }), 'in-place-20261006T070809Z-42')
})

test('an in-place run is never a record and says so', async t => {
  const { source, out, temp } = await fixture(t)
  const { deps, lines, calls } = fakeDeps({ temp })
  const summary = await gate.runGate({ out, source, inPlace: true, only: ['node-test'] }, deps)
  assert.equal(summary.mode, 'in-place')
  assert.equal(summary.record, false)
  assert.equal(summary.exitCode, 0)
  assert.equal(summary.clonePath, null)
  assert.equal(calls.some(call => call[1] === 'clone'), false)
  assert.deepEqual(summary.steps.find(step => step.id === 'install').skipped, 'in-place')
  assert.ok(lines.some(line => line.includes('in-place run: NOT A RECORD')))
  assert.match(lines.at(-1), /^summary: \//)
  assert.ok(summary.runDir.endsWith(join(SHA, 'in-place-20261006T070809Z-42')))
})

test('a partial clone run is not a record and says so', async t => {
  const { source, out, temp } = await fixture(t)
  const { deps, lines } = fakeDeps({ temp })
  const summary = await gate.runGate({ out, source, only: ['node-test'] }, deps)
  assert.equal(summary.mode, 'clone')
  assert.equal(summary.partial, true)
  assert.equal(summary.record, false)
  assert.ok(lines.some(line => line.includes('partial run (node-test): NOT A RECORD')))
})

test('a full clone run with no leg-missing finding is a record', async t => {
  const { source, out, temp } = await fixture(t)
  const { deps } = fakeDeps({ temp, legs: everyLegAsNodeTest })
  const summary = await gate.runGate({ out, source, only: null }, deps)
  assert.deepEqual(summary.findings, [])
  assert.equal(summary.partial, false)
  assert.equal(summary.record, true)
  assert.equal(summary.cloneRemoved, true)
  assert.equal(existsSync(summary.clonePath), false)
})

test('shouldRemoveClone removes only a green run without --keep-clone', () => {
  assert.equal(typeof gate.shouldRemoveClone, 'function')
  const { shouldRemoveClone } = gate
  assert.equal(shouldRemoveClone({ exitCode: 0, keepClone: false }), true)
  assert.equal(shouldRemoveClone({ exitCode: 0 }), true)
  assert.equal(shouldRemoveClone({ exitCode: 0, keepClone: true }), false)
  assert.equal(shouldRemoveClone({ exitCode: 1, keepClone: false }), false)
})

test('a dirty source in clone mode warns how many paths the clone did not include', async t => {
  const { source, out, temp } = await fixture(t)
  const { deps } = fakeDeps({ temp, porcelain: ' M a.txt\n?? b.txt\n D c.txt\n' })
  const summary = await gate.runGate({ out, source, only: ['node-test'] }, deps)
  assert.equal(summary.sourceDirty, true)
  assert.equal(summary.warnings.length, 1)
  assert.match(summary.warnings[0], /3 uncommitted path\(s\) the clone did not include/)
})

test('a leg log over 2 MiB is gzipped and the leg names the .gz path', async t => {
  const { source, out, temp } = await fixture(t)
  const { deps } = fakeDeps({ temp, logBytes: 3 * 1024 * 1024 })
  const summary = await gate.runGate({ out, source, only: ['node-test'] }, deps)
  const leg = summary.legs.find(entry => entry.id === 'node-test')
  assert.match(leg.log, /node-test\.log\.gz$/)
  assert.equal(existsSync(leg.log), true)
  assert.equal(existsSync(leg.log.replace(/\.gz$/, '')), false)
})
