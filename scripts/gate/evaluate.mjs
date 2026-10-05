export const REQUIRED_LEGS = [
  'turbo-build-typecheck',
  'turbo-test',
  'validate:skills',
  'validate:agents',
  'validate:publish',
  'validate:tools',
  'validate:arch',
  'validate:safety',
  'validate:431-discovery-imports',
  'lint:namespace',
  'node-test',
  'conformance-selftest',
  'conformance',
  'audit',
]

const NODE_TEST_STATUSES = new Set(['passed', 'failed', 'skipped', 'todo', 'cancelled'])

function baseName(file) {
  return String(file ?? '').split(/[\\/]/).pop()
}

function finding(rule, leg, detail) {
  return { rule, leg, detail }
}

export function classifyNodeTest(report) {
  const cells = (report?.tests ?? []).map(test => ({
    file: baseName(test.file),
    name: test.name,
    nesting: test.nesting,
    status: NODE_TEST_STATUSES.has(test.status) ? test.status : 'cancelled',
  }))
  const count = status => cells.filter(cell => cell.status === status).length
  const passed = count('passed')
  const failed = count('failed')
  return {
    executed: passed + failed,
    passed,
    failed,
    skipped: count('skipped'),
    todo: count('todo'),
    notRun: count('cancelled'),
    cells,
  }
}

export function nodeTestFindings(report, { pinnedFiles, onDiskFiles, exitCode } = {}) {
  const leg = 'node-test'
  const mismatch = 'node-test-files-mismatch'
  const findings = []
  const counts = classifyNodeTest(report)
  if (exitCode !== 0) findings.push(finding('leg-exit-nonzero', leg, `exit code ${exitCode}`))
  if (!report) findings.push(finding('results-missing', leg, 'no node:test structured report'))
  if (!Array.isArray(pinnedFiles)) {
    findings.push(finding(mismatch, leg, 'the pinned node:test list is unreadable'))
  } else {
    const pinned = new Set(pinnedFiles.map(baseName))
    const onDisk = new Set((onDiskFiles ?? []).map(baseName))
    for (const file of [...pinned].sort()) {
      if (!onDisk.has(file)) {
        findings.push(finding(mismatch, leg, `pinned file ${file} is not on disk`))
      }
    }
    for (const file of [...onDisk].sort()) {
      if (!pinned.has(file)) {
        findings.push(finding(mismatch, leg, `on-disk file ${file} is not pinned`))
      }
    }
  }
  if (report && counts.executed === 0) {
    findings.push(finding('zero-executed', leg, 'the node:test run executed 0 tests'))
  }
  for (const cell of counts.cells) {
    if (cell.status === 'failed') {
      findings.push(finding('test-failed', leg, `${cell.file} > ${cell.name}`))
    } else if (cell.status !== 'passed') {
      findings.push(finding('unlisted-skip', leg, `${cell.file} > ${cell.name} (${cell.status})`))
    }
  }
  const { cells, ...totals } = counts
  return { counts: totals, findings }
}

export function evaluateGate({ legs = [], steps = [], partial = false, selected, preflight } = {}) {
  const findings = []
  for (const entry of preflight?.required ?? []) {
    if (!entry.ok) {
      findings.push(finding('preflight-missing-tool', 'preflight', `${entry.tool}: ${entry.hint}`))
    }
  }
  for (const step of steps) findings.push(...(step.findings ?? []))
  for (const leg of legs) findings.push(...(leg.findings ?? []))
  const present = new Set(legs.map(leg => leg.id))
  const expected = partial ? REQUIRED_LEGS.filter(id => selected?.includes(id)) : REQUIRED_LEGS
  for (const id of expected) {
    if (!present.has(id)) findings.push(finding('leg-missing', id, `leg ${id} did not run`))
  }
  return { findings, exitCode: findings.length > 0 ? 1 : 0 }
}
