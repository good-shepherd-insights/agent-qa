import assert from 'node:assert/strict'
import test from 'node:test'
import {
  REQUIRED_LEGS,
  classifyNodeTest,
  evaluateGate,
  nodeTestFindings,
} from '../gate/evaluate.mjs'

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
