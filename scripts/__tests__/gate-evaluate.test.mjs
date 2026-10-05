import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  REQUIRED_LEGS,
  classifyNodeTest,
  evaluateGate,
  expectedTurboTasks,
  nodeTestFindings,
  orderRootCause,
  packageSetFindings,
  turboFindings,
} from '../gate/evaluate.mjs'
import * as gateRules from '../gate/evaluate.mjs'

const PACKAGE_PIN = JSON.parse(
  readFileSync(new URL('../gate/inputs/packages.json', import.meta.url), 'utf8'),
).members

const PINNED = ['a.test.mjs', 'b.test.mjs']

function report(tests) {
  return { schemaVersion: 1, tests, summary: null }
}

function cell(file, name, status) {
  return { file: `/clone/agent-qa/scripts/__tests__/${file}`, name, nesting: 0, status }
}

function greenReport() {
  return report([
    cell('a.test.mjs', 'one', 'passed'),
    cell('a.test.mjs', 'two', 'passed'),
    cell('b.test.mjs', 'three', 'passed'),
  ])
}

function rules(findings) {
  return findings.map(f => f.rule)
}

test('a green node:test report with the pinned files on disk has no findings', () => {
  const { counts, findings } = nodeTestFindings(greenReport(), {
    pinnedFiles: PINNED,
    onDiskFiles: PINNED,
    exitCode: 0,
  })
  assert.deepEqual(findings, [])
  assert.equal(counts.executed, 3)
  assert.equal(counts.passed, 3)
})

test('a report with no passed and no failed tests is zero-executed', () => {
  const { findings } = nodeTestFindings(report([]), {
    pinnedFiles: PINNED,
    onDiskFiles: PINNED,
    exitCode: 0,
  })
  assert.deepEqual(rules(findings), ['zero-executed'])
})

test('a pinned file absent on disk is a node-test-files-mismatch naming it', () => {
  const { findings } = nodeTestFindings(greenReport(), {
    pinnedFiles: [...PINNED, 'gone.test.mjs'],
    onDiskFiles: PINNED,
    exitCode: 0,
  })
  assert.deepEqual(rules(findings), ['node-test-files-mismatch'])
  assert.match(findings[0].detail, /gone\.test\.mjs/)
})

test('an on-disk file absent from the pin is a node-test-files-mismatch naming it', () => {
  const { findings } = nodeTestFindings(greenReport(), {
    pinnedFiles: PINNED,
    onDiskFiles: [...PINNED, 'new.test.mjs'],
    exitCode: 0,
  })
  assert.deepEqual(rules(findings), ['node-test-files-mismatch'])
  assert.match(findings[0].detail, /new\.test\.mjs/)
})

test('skipped, todo and cancelled tests keep their own columns and are unlisted skips', () => {
  const input = report([
    cell('a.test.mjs', 'ran', 'passed'),
    cell('a.test.mjs', 'skipped one', 'skipped'),
    cell('b.test.mjs', 'todo one', 'todo'),
    cell('b.test.mjs', 'cancelled one', 'cancelled'),
  ])
  const counts = classifyNodeTest(input)
  assert.equal(counts.passed, 1)
  assert.equal(counts.executed, 1)
  assert.equal(counts.skipped, 1)
  assert.equal(counts.todo, 1)
  assert.equal(counts.notRun, 1)

  const { findings } = nodeTestFindings(input, {
    pinnedFiles: PINNED,
    onDiskFiles: PINNED,
    exitCode: 0,
  })
  assert.deepEqual(rules(findings), ['unlisted-skip', 'unlisted-skip', 'unlisted-skip'])
  assert.match(findings[0].detail, /a\.test\.mjs > skipped one/)
  assert.match(findings[1].detail, /b\.test\.mjs > todo one/)
  assert.match(findings[2].detail, /b\.test\.mjs > cancelled one/)
})

test('a missing report is results-missing', () => {
  const { findings } = nodeTestFindings(null, {
    pinnedFiles: PINNED,
    onDiskFiles: PINNED,
    exitCode: 0,
  })
  assert.deepEqual(rules(findings), ['results-missing'])
})

test('a non-zero leg exit is leg-exit-nonzero', () => {
  const { findings } = nodeTestFindings(greenReport(), {
    pinnedFiles: PINNED,
    onDiskFiles: PINNED,
    exitCode: 1,
  })
  assert.deepEqual(rules(findings), ['leg-exit-nonzero'])
})

test('a failed test is a finding even when the exit code says 0', () => {
  const { counts, findings } = nodeTestFindings(
    report([cell('a.test.mjs', 'one', 'passed'), cell('b.test.mjs', 'broken', 'failed')]),
    { pinnedFiles: PINNED, onDiskFiles: PINNED, exitCode: 0 },
  )
  assert.equal(counts.failed, 1)
  assert.deepEqual(rules(findings), ['test-failed'])
})

test('REQUIRED_LEGS names the 14 legs in run order', () => {
  assert.equal(REQUIRED_LEGS.length, 14)
  assert.equal(REQUIRED_LEGS[0], 'turbo-build-typecheck')
  assert.equal(REQUIRED_LEGS.at(-1), 'audit')
  assert.ok(REQUIRED_LEGS.includes('node-test'))
})

test('a non-partial run lacking required legs is leg-missing for each one', () => {
  const { findings, exitCode } = evaluateGate({
    legs: [{ id: 'node-test', findings: [] }],
    partial: false,
  })
  const missing = findings.filter(f => f.rule === 'leg-missing').map(f => f.leg)
  assert.deepEqual(
    missing,
    REQUIRED_LEGS.filter(id => id !== 'node-test'),
  )
  assert.equal(exitCode, 1)
})

test('a partial run reports no leg-missing for unselected legs', () => {
  const { findings, exitCode } = evaluateGate({
    legs: [{ id: 'node-test', findings: [] }],
    partial: true,
    selected: ['node-test'],
  })
  assert.deepEqual(findings, [])
  assert.equal(exitCode, 0)
})

test('a partial run whose selected leg never ran is leg-missing', () => {
  const { findings } = evaluateGate({ legs: [], partial: true, selected: ['node-test'] })
  assert.deepEqual(rules(findings), ['leg-missing'])
})

test('evaluateGate exits 1 whenever any finding exists, and 0 only when none do', () => {
  const allGreen = REQUIRED_LEGS.map(id => ({ id, findings: [] }))
  assert.deepEqual(evaluateGate({ legs: allGreen, partial: false }), { findings: [], exitCode: 0 })

  const oneRed = allGreen.map(leg =>
    leg.id === 'audit' ? { ...leg, findings: [{ rule: 'leg-exit-nonzero', leg: 'audit' }] } : leg,
  )
  assert.equal(evaluateGate({ legs: oneRed, partial: false }).exitCode, 1)

  const stepRed = evaluateGate({
    legs: allGreen,
    steps: [{ id: 'install', findings: [{ rule: 'install-failed', leg: 'install' }] }],
    partial: false,
  })
  assert.deepEqual(rules(stepRed.findings), ['install-failed'])
  assert.equal(stepRed.exitCode, 1)
})

test('evaluateGate reports every finding rather than stopping at the first', () => {
  const legs = [
    { id: 'node-test', findings: [{ rule: 'zero-executed', leg: 'node-test' }] },
    { id: 'audit', findings: [{ rule: 'leg-exit-nonzero', leg: 'audit' }] },
  ]
  const { findings } = evaluateGate({ legs, partial: true, selected: ['node-test', 'audit'] })
  assert.deepEqual(rules(findings), ['zero-executed', 'leg-exit-nonzero'])
})

function dryRun(tasks, packages = ['a', 'b']) {
  return { packages, tasks: tasks.map(([taskId, command]) => ({ taskId, command })) }
}

function runSummary(tasks, execution = {}) {
  const ran = tasks.map(([taskId, exitCode, status = 'MISS']) => ({
    taskId,
    execution: { exitCode },
    cache: { status },
  }))
  const success = ran.filter(task => task.execution.exitCode === 0).length
  return {
    execution: {
      attempted: ran.length,
      success,
      failed: ran.length - success,
      cached: 0,
      exitCode: success === ran.length ? 0 : 1,
      ...execution,
    },
    tasks: ran,
  }
}

const TWO_TASKS = dryRun([
  ['a#build', 'tsup'],
  ['a#typecheck', 'tsc --noEmit'],
  ['b#build', '<NONEXISTENT>'],
])

test('the package pin names 24 sorted members including agent-qa, embedding-bench and arch', () => {
  assert.equal(PACKAGE_PIN.length, 24)
  assert.deepEqual([...PACKAGE_PIN].sort(), PACKAGE_PIN)
  for (const name of ['agent-qa', 'embedding-bench', '@vostride/agent-qa-arch']) {
    assert.ok(PACKAGE_PIN.includes(name), name)
  }
})

test('expectedTurboTasks drops <NONEXISTENT> tasks and keeps the rest', () => {
  assert.deepEqual(expectedTurboTasks(TWO_TASKS), ['a#build', 'a#typecheck'])
})

test('an expected task absent from the run summary is cancelled-or-missing', () => {
  const findings = turboFindings({
    legId: 'turbo-test',
    dryRun: TWO_TASKS,
    runSummary: runSummary([['a#build', 0]], { attempted: 2, failed: 1, success: 1 }),
  })
  assert.deepEqual(rules(findings), ['cancelled-or-missing'])
  assert.match(findings[0].detail, /a#typecheck/)
})

test('a task with a non-zero exit code is task-failed', () => {
  const findings = turboFindings({
    legId: 'turbo-build-typecheck',
    dryRun: TWO_TASKS,
    runSummary: runSummary([
      ['a#build', 0],
      ['a#typecheck', 1],
    ]),
    exitCode: 1,
  })
  assert.deepEqual(rules(findings), ['task-failed'])
  assert.equal(findings[0].taskId, 'a#typecheck')
})

test('attempted not equal to success + failed + cached is unaccounted-tasks', () => {
  const findings = turboFindings({
    legId: 'turbo-build-typecheck',
    dryRun: TWO_TASKS,
    runSummary: runSummary(
      [
        ['a#build', 0],
        ['a#typecheck', 0],
      ],
      { attempted: 3, success: 1, failed: 1, cached: 0 },
    ),
  })
  assert.deepEqual(rules(findings), ['unaccounted-tasks'])
})

test('a cached task is red under a forced run', () => {
  const findings = turboFindings({
    legId: 'turbo-build-typecheck',
    dryRun: TWO_TASKS,
    runSummary: runSummary(
      [
        ['a#build', 0, 'HIT'],
        ['a#typecheck', 0],
      ],
      { attempted: 2, success: 1, failed: 0, cached: 1 },
    ),
  })
  assert.deepEqual(rules(findings), ['cached'])
  assert.match(findings[0].detail, /a#build/)
})

test('a clean forced run summary has no turbo findings', () => {
  const findings = turboFindings({
    legId: 'turbo-build-typecheck',
    dryRun: TWO_TASKS,
    runSummary: runSummary([
      ['a#build', 0],
      ['a#typecheck', 0],
    ]),
    exitCode: 0,
  })
  assert.deepEqual(findings, [])
})

test('a dry run with zero tasks (a filter matching nothing) is a package-set-mismatch', () => {
  const empty = { packages: [], tasks: [] }
  const findings = packageSetFindings({
    leg: 'turbo-build-typecheck',
    pinned: PACKAGE_PIN,
    dryRunPackages: empty.packages,
  })
  assert.deepEqual(rules(findings), ['package-set-mismatch'])
  assert.match(findings[0].detail, /turbo dry-run packages: missing .*embedding-bench/)
  const turbo = turboFindings({
    legId: 'turbo-build-typecheck',
    dryRun: empty,
    runSummary: runSummary([]),
    exitCode: 0,
  })
  assert.deepEqual(rules(turbo), ['zero-executed'])
})

test('a pnpm listing off the pin, or a differing dry run, names the source and names', () => {
  const missing = packageSetFindings({
    pinned: PACKAGE_PIN,
    pnpmMembers: PACKAGE_PIN.filter(name => name !== 'embedding-bench'),
  })
  assert.deepEqual(rules(missing), ['package-set-mismatch'])
  assert.match(missing[0].detail, /^pnpm workspace listing: missing embedding-bench$/)

  const extra = packageSetFindings({ pinned: PACKAGE_PIN, pnpmMembers: [...PACKAGE_PIN, 'x'] })
  assert.deepEqual(rules(extra), ['package-set-mismatch'])
  assert.match(extra[0].detail, /^pnpm workspace listing: extra x$/)

  const dry = packageSetFindings({
    pinned: PACKAGE_PIN,
    pnpmMembers: PACKAGE_PIN,
    dryRunPackages: PACKAGE_PIN.filter(name => name !== 'agent-qa'),
  })
  assert.deepEqual(rules(dry), ['package-set-mismatch'])
  assert.match(dry[0].detail, /^turbo dry-run packages: missing agent-qa$/)

  const all = { pinned: PACKAGE_PIN, pnpmMembers: PACKAGE_PIN, dryRunPackages: PACKAGE_PIN }
  assert.deepEqual(packageSetFindings(all), [])
})

test('orderRootCause lists failed #build tasks first and as the root cause', () => {
  const input = [
    { rule: 'unlisted-skip', leg: 'turbo-test', detail: 'x' },
    { rule: 'task-failed', leg: 'turbo-test', detail: 'a#test exited 1', taskId: 'a#test' },
    { rule: 'task-failed', leg: 'turbo-test', detail: 'b#build exited 1', taskId: 'b#build' },
  ]
  const { findings, rootCause } = orderRootCause(input)
  assert.deepEqual(
    findings.map(f => f.taskId ?? f.rule),
    ['b#build', 'unlisted-skip', 'a#test'],
  )
  assert.deepEqual(rootCause.map(f => f.taskId), ['b#build'])
  assert.deepEqual(orderRootCause([input[0]]).rootCause, [])
})

const ROOT = '/private/var/clone/agent-qa'

function vitestJson(files, success = true) {
  return {
    numTotalTests: 0,
    numPassedTests: 0,
    numPendingTests: 0,
    success,
    testResults: files.map(([name, status, assertions, message = '']) => ({
      name: `${ROOT}/${name}`,
      status,
      message,
      assertionResults: assertions.map(([title, state]) => ({
        ancestorTitles: ['suite'],
        title,
        fullName: `suite ${title}`,
        status: state,
      })),
    })),
  }
}

test('classifyVitest counts by status and keeps relative file, fullName and status', () => {
  assert.equal(typeof gateRules.classifyVitest, 'function')
  const json = vitestJson([
    [
      'packages/x/src/a.test.ts',
      'failed',
      [
        ['p1', 'passed'],
        ['p2', 'passed'],
        ['f1', 'failed'],
      ],
    ],
    [
      'packages/x/src/b.test.ts',
      'passed',
      [
        ['s1', 'skipped'],
        ['t1', 'todo'],
        ['q1', 'pending'],
      ],
    ],
  ])
  json.numPassedTests = 99
  json.numPendingTests = 99
  const counts = gateRules.classifyVitest(json, ROOT)
  assert.equal(counts.executed, 3)
  assert.equal(counts.passed, 2)
  assert.equal(counts.failed, 1)
  assert.equal(counts.skipped, 1)
  assert.equal(counts.todo, 1)
  assert.equal(counts.notRun, 1)
  assert.deepEqual(counts.cells[0], {
    file: 'packages/x/src/a.test.ts',
    fullName: 'suite p1',
    status: 'passed',
  })
})

test('a vitest JSON with clean counts but success false is success-false', () => {
  assert.equal(typeof gateRules.vitestFindings, 'function')
  const json = vitestJson([['packages/x/src/a.test.ts', 'passed', [['p1', 'passed']]]], false)
  const findings = gateRules.vitestFindings('x', gateRules.classifyVitest(json, ROOT))
  assert.deepEqual(rules(findings), ['success-false'])
  assert.match(findings[0].detail, /^x:/)
})

test('a failed file with no assertions is file-failed naming the file and its message', () => {
  assert.equal(typeof gateRules.vitestFindings, 'function')
  const json = vitestJson(
    [
      ['packages/x/src/a.test.ts', 'passed', [['p1', 'passed']]],
      ['packages/x/src/posture.test.ts', 'failed', [], 'ENOENT: no such file, open demo/init'],
    ],
    false,
  )
  const findings = gateRules.vitestFindings('x', gateRules.classifyVitest(json, ROOT))
  assert.deepEqual(rules(findings), ['file-failed'])
  assert.match(findings[0].detail, /packages\/x\/src\/posture\.test\.ts/)
  assert.match(findings[0].detail, /ENOENT/)
})

test('an all-skipped member is zero-executed and skips never count as passed', () => {
  assert.equal(typeof gateRules.vitestFindings, 'function')
  const json = vitestJson([
    [
      'packages/x/src/a.test.ts',
      'passed',
      [
        ['s1', 'skipped'],
        ['s2', 'skipped'],
      ],
    ],
  ])
  const counts = gateRules.classifyVitest(json, ROOT)
  assert.equal(counts.passed, 0)
  assert.equal(counts.executed, 0)
  const findings = gateRules.vitestFindings('x', counts)
  assert.deepEqual(rules(findings), ['zero-executed', 'unlisted-skip', 'unlisted-skip'])
})

test('no JSON is results-missing and a JSON older than the leg is stale-results', () => {
  assert.equal(typeof gateRules.vitestFindings, 'function')
  assert.equal(typeof gateRules.staleResultFindings, 'function')
  assert.deepEqual(rules(gateRules.vitestFindings('x', null)), ['results-missing'])
  const stale = gateRules.staleResultFindings(
    [
      { member: 'x', file: 'packages/x/test-results/gate-vitest.json', mtimeMs: 900 },
      { member: 'y', file: 'packages/y/test-results/gate-vitest.json', mtimeMs: 1100 },
      { member: 'z', file: null, mtimeMs: null },
    ],
    1000,
  )
  assert.deepEqual(rules(stale), ['stale-results'])
  assert.match(stale[0].detail, /^x:/)
})

test('under strict env mode CI passes as a turbo built-in and DO_NOT_TRACK is stripped', () => {
  assert.equal(typeof gateRules.turboEnvDisposition, 'function')
  const disposition = gateRules.turboEnvDisposition({
    turboJson: { tasks: { build: { dependsOn: ['^build'] }, test: {} } },
    envMode: 'strict',
    gateEnv: { CI: 'true', DO_NOT_TRACK: '1' },
  })
  assert.deepEqual(disposition, {
    CI: 'passed (turbo built-in)',
    DO_NOT_TRACK: 'stripped (strict env mode; not declared in turbo.json)',
  })
  const declared = gateRules.turboEnvDisposition({
    turboJson: { globalPassThroughEnv: ['DO_NOT_TRACK'], tasks: {} },
    envMode: 'strict',
    gateEnv: { DO_NOT_TRACK: '1' },
  })
  assert.match(declared.DO_NOT_TRACK, /^passed/)
})
