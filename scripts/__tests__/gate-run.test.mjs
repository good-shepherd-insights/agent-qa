import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import test from 'node:test'
import { REQUIRED_LEGS } from '../gate/evaluate.mjs'
import * as gate from '../gate/run.mjs'

const host = await import('../gate/host.mjs').catch(() => ({}))

const SHA = 'a'.repeat(40)
const FILES = ['a.test.mjs', 'b.test.mjs']
const TOOLS = {
  git: 'git version 2.50.1',
  pnpm: '10.6.1',
  expect: 'expect version 5.45',
  python3: 'Python 3.14.5',
  adb: 'List of devices attached\n',
  xcrun: '== Devices ==\n-- iOS 18.2 --\n',
}
const CHROMIUM = { revision: '1228', browserVersion: '149.0.7827.55' }

function toolExec(overrides = {}) {
  const tools = { ...TOOLS, ...overrides }
  return (command, args = []) => {
    if (command === 'pnpm' && args[0] === 'exec') {
      return { status: 0, stdout: '2.9.7\n', stderr: '' }
    }
    if (command === 'ps') return { status: 0, stdout: '', stderr: '' }
    const stdout = tools[command]
    if (stdout === null || stdout === undefined) {
      return { status: 127, stdout: '', stderr: `${command}: not found` }
    }
    return { status: 0, stdout: `${stdout}\n`, stderr: '' }
  }
}

const fakeHost = {
  chromiumCheck: () => ({
    required: { tool: 'playwright-chromium', version: '1228', ok: true, hint: 'install it' },
    optional: [
      { platform: 'firefox', present: false },
      { platform: 'webkit', present: false },
    ],
    chromium: CHROMIUM,
  }),
}

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

function fakeDeps({ temp, porcelain = '', logBytes = 0, legs, tools } = {}) {
  const lines = []
  const calls = []
  const tool = toolExec(tools)
  const deps = {
    host: fakeHost,
    tmpdir: () => temp,
    now: () => new Date('2026-10-06T07:08:09Z'),
    pid: 42,
    output: { write: chunk => lines.push(...chunk.split('\n').filter(Boolean)) },
    exec(command, args) {
      calls.push([command, ...args])
      if (args.includes('rev-parse')) return { status: 0, stdout: `${SHA}\n`, stderr: '' }
      if (args.includes('status')) return { status: 0, stdout: porcelain, stderr: '' }
      return tool(command, args)
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

test('a missing expect stops preflight with an install hint and the gate runs no leg', async t => {
  assert.equal(typeof host.preflight, 'function')
  const result = host.preflight({ exec: toolExec({ expect: null }), nodeVersion: '24.15.0' })
  assert.equal(result.ok, false)
  assert.match(result.message, /expect/)
  assert.match(result.message, /brew install expect/)

  const { source, out, temp } = await fixture(t)
  const { deps, calls, lines } = fakeDeps({ temp, tools: { expect: null } })
  const summary = await gate.runGate({ out, source, only: ['node-test'] }, deps)
  const missingTool = summary.findings.filter(f => f.rule === 'preflight-missing-tool')
  assert.ok(missingTool.some(f => /expect/.test(f.detail)))
  assert.deepEqual(summary.legs, [])
  assert.equal(summary.exitCode, 1)
  assert.equal(calls.some(call => call[0] === 'node' || call[1] === 'clone'), false)
  assert.ok(lines.some(line => line.includes('brew install expect')))
})

test('pnpm 11 or a Node major of 22 does not pass preflight', () => {
  assert.equal(typeof host.preflight, 'function')
  const pnpm11 = host.preflight({ exec: toolExec({ pnpm: '11.0.0' }), nodeVersion: '24.15.0' })
  assert.equal(pnpm11.ok, false)
  assert.equal(pnpm11.required.find(entry => entry.tool === 'pnpm').ok, false)
  const node22 = host.preflight({ exec: toolExec(), nodeVersion: '22.11.0' })
  assert.equal(node22.ok, false)
  assert.equal(node22.required.find(entry => entry.tool === 'node').ok, false)
  assert.equal(host.preflight({ exec: toolExec(), nodeVersion: '24.15.0' }).ok, true)
})

test('absent Firefox, WebKit, adb device or booted simulator is recorded and never fails', () => {
  assert.equal(typeof host.preflight, 'function')
  assert.equal(typeof host.chromiumCheck, 'function')
  const result = host.preflight({ exec: toolExec(), nodeVersion: '24.15.0', platform: 'darwin' })
  assert.equal(result.ok, true)
  assert.deepEqual(result.optional, [
    { platform: 'android', present: false },
    { platform: 'ios', present: false },
  ])
  const withDevice = host.preflight({
    exec: toolExec({ adb: 'List of devices attached\nemulator-5554\tdevice' }),
    nodeVersion: '24.15.0',
    platform: 'darwin',
  })
  assert.equal(withDevice.optional.find(entry => entry.platform === 'android').present, true)

  const browsers = [
    { name: 'chromium', ...CHROMIUM },
    { name: 'firefox', revision: '1532', browserVersion: '151.0' },
    { name: 'webkit', revision: '2311', browserVersion: '26.5' },
  ]
  const executables = { chromium: '/pw/chromium', firefox: '/pw/firefox', webkit: '/pw/webkit' }
  const check = host.chromiumCheck({
    root: '/clone/agent-qa',
    load: () => ({ browsers, executables }),
    exists: path => path === '/pw/chromium',
  })
  assert.equal(check.required.ok, true)
  assert.deepEqual(check.chromium, CHROMIUM)
  assert.deepEqual(check.optional, [
    { platform: 'firefox', present: false },
    { platform: 'webkit', present: false },
  ])
  const missing = host.chromiumCheck({
    root: '/clone/agent-qa',
    load: () => ({ browsers, executables }),
    exists: () => false,
  })
  assert.equal(missing.required.ok, false)
  assert.match(missing.required.hint, /playwright install chromium/)
})

test('machineSnapshot records pid, executable basename and keyword only, never arguments', () => {
  assert.equal(typeof host.machineSnapshot, 'function')
  const comm = [
    '  1     0 /sbin/launchd',
    '101     1 /Applications/Chromium.app/Contents/MacOS/Chromium',
    '102   199 /usr/local/bin/node',
    '199     1 /usr/local/bin/node',
    '200   199 /usr/local/bin/node',
  ].join('\n')
  const args = [
    '  1 /sbin/launchd',
    '101 /Applications/Chromium.app/Contents/MacOS/Chromium --user-data-dir=/secret/TOKEN',
    '102 node /x/node_modules/vitest/vitest.mjs run --api-key=SECRET',
    '199 node /x/agent-qa/node_modules/.bin/pnpm run gate:local',
    '200 node /x/agent-qa/scripts/gate/run.mjs --out /tmp/o',
  ].join('\n')
  const exec = (command, argv) => {
    assert.equal(command, 'ps')
    return { status: 0, stdout: argv[1].includes('comm') ? comm : args, stderr: '' }
  }
  const snapshot = host.machineSnapshot({ exec, selfPid: 200 })
  assert.ok(snapshot.cpus > 0)
  assert.equal(snapshot.load.length, 3)
  assert.deepEqual(snapshot.processes, [
    { pid: 101, exe: 'Chromium', keyword: 'chrom' },
    { pid: 102, exe: 'node', keyword: 'vitest' },
  ])
  assert.equal(JSON.stringify(snapshot).includes('SECRET'), false)
  assert.equal(JSON.stringify(snapshot).includes('TOKEN'), false)
})

const MEMBERS = JSON.parse(
  readFileSync(new URL('../gate/inputs/packages.json', import.meta.url), 'utf8'),
).members

function turboDeps({ temp, source }) {
  const base = fakeDeps({ temp })
  const turboCalls = []
  const listing = [
    { name: 'agent-qa-monorepo', path: source },
    ...MEMBERS.map((name, index) => ({ name, path: join(source, 'packages', `p${index}`) })),
  ]
  const dry = {
    packages: MEMBERS,
    tasks: MEMBERS.flatMap(name => [
      { taskId: `${name}#build`, command: name === 'embedding-bench' ? '<NONEXISTENT>' : 'tsup' },
      { taskId: `${name}#typecheck`, command: 'tsc --noEmit' },
    ]),
  }
  const exec = base.deps.exec
  base.deps.exec = (command, args, opts) => {
    if (command === 'pnpm' && args[0] === 'ls') {
      return { status: 0, stdout: JSON.stringify(listing), stderr: '' }
    }
    if (command === 'pnpm' && args.includes('--dry-run=json')) {
      turboCalls.push(args)
      return { status: 0, stdout: JSON.stringify(dry), stderr: '' }
    }
    return exec(command, args, opts)
  }
  const run = base.deps.run
  base.deps.run = async (command, args, opts) => {
    if (command === 'pnpm' && args.includes('turbo')) {
      turboCalls.push(args)
      writeFileSync(opts.logPath, 'ok\n')
      const tasks = dry.tasks
        .filter(task => task.command !== '<NONEXISTENT>')
        .map(({ taskId }) => ({ taskId, execution: { exitCode: 0 }, cache: { status: 'MISS' } }))
      const n = tasks.length
      const execution = { attempted: n, success: n, failed: 0, cached: 0, exitCode: 0 }
      mkdirSync(join(source, '.turbo/runs'), { recursive: true })
      writeFileSync(
        join(source, '.turbo/runs/run1.json'),
        JSON.stringify({ envMode: 'strict', execution, tasks }),
      )
      return { exitCode: 0, durationMs: 1 }
    }
    return run(command, args, opts)
  }
  return { ...base, turboCalls }
}

function populatePin(root) {
  writeFileSync(
    join(root, 'scripts/gate/inputs/packages.json'),
    JSON.stringify({ schemaVersion: 1, members: MEMBERS }),
  )
}

test('the build/typecheck leg is forced, continued, summarized and set-checked', async t => {
  const { source, out, temp } = await fixture(t)
  populatePin(source)
  const { deps, turboCalls } = turboDeps({ temp, source })
  const summary = await gate.runGate(
    { out, source, inPlace: true, only: ['turbo-build-typecheck'], turboConcurrency: 4 },
    deps,
  )
  assert.deepEqual(summary.findings, [])
  assert.equal(summary.exitCode, 0)
  assert.equal(summary.members.length, 24)
  assert.equal(summary.members.find(member => member.name === 'agent-qa').dir, 'packages/p22')
  const leg = summary.legs.find(entry => entry.id === 'turbo-build-typecheck')
  assert.equal(leg.executed, 47)
  assert.equal(leg.expectedTasks, 47)
  assert.deepEqual(turboCalls[0], ['exec', 'turbo', 'run', 'build', 'typecheck', '--dry-run=json'])
  for (const flag of ['--force', '--continue', '--summarize', '--concurrency=4']) {
    assert.ok(turboCalls[1].includes(flag), flag)
  }
  assert.equal(turboCalls.flat().some(arg => arg.includes('--filter')), false)
  assert.equal(summary.turbo.envMode, 'strict')
  assert.equal(summary.turbo.concurrency, 4)
  const raw = join(summary.runDir, 'raw', 'turbo-build-typecheck-summary.json.gz')
  assert.equal(JSON.parse(gunzipSync(readFileSync(raw))).execution.attempted, 47)
  assert.ok(existsSync(join(summary.runDir, 'raw', 'turbo-build-typecheck-dry-run.json.gz')))
  assert.equal(gate.parseGateArgs(['--out', 'x', '--turbo-concurrency', '4']).turboConcurrency, 4)
  assert.throws(() => gate.parseGateArgs(['--out', 'x', '--turbo-concurrency', '0']), /invalid/)
})

test('a leg with no new turbo run summary, or a pnpm listing off the pin, is red', async t => {
  const { source, out, temp } = await fixture(t)
  populatePin(source)
  const { deps } = turboDeps({ temp, source })
  const run = deps.run
  deps.run = async (command, args, opts) => {
    const result = await run(command, args, opts)
    writeFileSync(join(source, '.turbo/runs/run2.json'), '{}')
    return result
  }
  const exec = deps.exec
  deps.exec = (command, args, opts) => {
    if (command === 'pnpm' && args[0] === 'ls') {
      return { status: 0, stdout: JSON.stringify([{ name: 'agent-qa', path: '/x' }]), stderr: '' }
    }
    return exec(command, args, opts)
  }
  const summary = await gate.runGate(
    { out, source, inPlace: true, only: ['turbo-build-typecheck'] },
    deps,
  )
  const byRule = rule => summary.findings.filter(f => f.rule === rule)
  assert.match(byRule('results-missing')[0].detail, /one new run summary.*found 2/)
  assert.match(byRule('package-set-mismatch')[0].detail, /^pnpm workspace listing: missing/)
  assert.equal(summary.exitCode, 1)
})
