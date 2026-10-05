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

export function expectedTurboTasks(dryRun) {
  return (dryRun?.tasks ?? [])
    .filter(task => task.command !== '<NONEXISTENT>')
    .map(task => task.taskId)
}

export function turboTaskCounts({ dryRun, runSummary } = {}) {
  const expected = expectedTurboTasks(dryRun)
  const ran = new Map((runSummary?.tasks ?? []).map(task => [task.taskId, task]))
  const present = expected.filter(id => ran.has(id))
  const failed = present.filter(id => ran.get(id).execution?.exitCode !== 0)
  return {
    expected: expected.length,
    executed: present.length,
    passed: present.length - failed.length,
    failed: failed.length,
  }
}

export function turboFindings({ legId, dryRun, runSummary, exitCode } = {}) {
  const findings = []
  if (!dryRun) return [finding('results-missing', legId, 'no turbo dry run')]
  if (!runSummary) return [finding('results-missing', legId, 'no turbo run summary')]
  const ran = new Map((runSummary.tasks ?? []).map(task => [task.taskId, task]))
  let failedTasks = 0
  for (const id of expectedTurboTasks(dryRun)) {
    const task = ran.get(id)
    if (!task) {
      const detail = `${id} is not in the run summary`
      findings.push({ ...finding('cancelled-or-missing', legId, detail), taskId: id })
    } else if (task.execution?.exitCode !== 0) {
      failedTasks += 1
      const code = task.execution?.exitCode ?? '<none>'
      findings.push({ ...finding('task-failed', legId, `${id} exited ${code}`), taskId: id })
    }
  }
  const e = runSummary.execution ?? {}
  if (e.attempted !== e.success + e.failed + e.cached) {
    const sum = `success ${e.success} + failed ${e.failed} + cached ${e.cached}`
    findings.push(finding('unaccounted-tasks', legId, `attempted ${e.attempted} != ${sum}`))
  }
  const hits = (runSummary.tasks ?? []).filter(task => task.cache?.status === 'HIT')
  const cached = Math.max(Number(e.cached) || 0, hits.length)
  if (cached > 0) {
    const ids = hits.map(task => task.taskId).join(', ')
    findings.push(finding('cached', legId, `${cached} cached task(s)${ids ? `: ${ids}` : ''}`))
  }
  if (turboTaskCounts({ dryRun, runSummary }).executed === 0) {
    findings.push(finding('zero-executed', legId, 'the turbo run executed 0 expected tasks'))
  }
  if (exitCode !== undefined && exitCode !== 0 && failedTasks === 0) {
    findings.push(finding('leg-exit-nonzero', legId, `exit code ${exitCode}`))
  }
  return findings
}

function setDifference(source, label, pinned, leg) {
  if (!Array.isArray(source)) return []
  const want = new Set(pinned)
  const have = new Set(source)
  const missing = [...want].filter(name => !have.has(name)).sort()
  const extra = [...have].filter(name => !want.has(name)).sort()
  if (missing.length === 0 && extra.length === 0) return []
  const parts = []
  if (missing.length > 0) parts.push(`missing ${missing.join(', ')}`)
  if (extra.length > 0) parts.push(`extra ${extra.join(', ')}`)
  return [finding('package-set-mismatch', leg, `${label}: ${parts.join('; ')}`)]
}

export function packageSetFindings({
  leg = 'workspace',
  pinned,
  pnpmMembers,
  dryRunPackages,
  testTaskPackages,
  vitestPackages,
} = {}) {
  if (!Array.isArray(pinned)) {
    return [finding('package-set-mismatch', leg, 'the pinned package list is unreadable')]
  }
  return [
    ...setDifference(pnpmMembers, 'pnpm workspace listing', pinned, leg),
    ...setDifference(dryRunPackages, 'turbo dry-run packages', pinned, leg),
    ...setDifference(testTaskPackages, 'run-summary #test task packages', pinned, leg),
    ...setDifference(vitestPackages, 'members with a vitest JSON', pinned, leg),
  ]
}

export function orderRootCause(findings = []) {
  const isBuildFailure = f => f.rule === 'task-failed' && String(f.taskId ?? '').endsWith('#build')
  const rootCause = findings.filter(isBuildFailure)
  return { findings: [...rootCause, ...findings.filter(f => !isBuildFailure(f))], rootCause }
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
