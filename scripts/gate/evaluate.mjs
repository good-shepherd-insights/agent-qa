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

export function classifyNodeTest(report, rootDir) {
  const cells = (report?.tests ?? []).map(test => ({
    file: rootDir ? relativeTo(rootDir, test.file) : baseName(test.file),
    name: test.name,
    fullName: test.fullName ?? test.name,
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

export function nodeTestFindings(report, { pinnedFiles, onDiskFiles, exitCode, rootDir } = {}) {
  const leg = 'node-test'
  const mismatch = 'node-test-files-mismatch'
  const findings = []
  const counts = classifyNodeTest(report, rootDir)
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
      findings.push(finding('test-failed', leg, `${cell.file} > ${cell.fullName}`))
    }
  }
  const { cells, ...totals } = counts
  return { counts: totals, cells, findings }
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

const VITEST_COLUMNS = { passed: 'passed', failed: 'failed', skipped: 'skipped', todo: 'todo' }
const MAX_MESSAGE = 500

function relativeTo(rootDir, file) {
  const name = String(file ?? '')
  const prefix = `${String(rootDir ?? '').replace(/[\\/]+$/, '')}/`
  return name.startsWith(prefix) ? name.slice(prefix.length) : name
}

export function classifyVitest(json, rootDir) {
  const cells = []
  const fileFailures = []
  for (const file of json?.testResults ?? []) {
    const rel = relativeTo(rootDir, file.name)
    const assertions = file.assertionResults ?? []
    if (file.status !== 'passed') {
      const hasFailedAssertion = assertions.some(a => a.status === 'failed')
      const message = String(file.message ?? '').slice(0, MAX_MESSAGE)
      fileFailures.push({ file: rel, status: file.status, message, hasFailedAssertion })
    }
    for (const a of assertions) {
      const fullName = a.fullName ?? [...(a.ancestorTitles ?? []), a.title].join(' ')
      cells.push({ file: rel, fullName, status: VITEST_COLUMNS[a.status] ?? 'notRun' })
    }
  }
  const count = status => cells.filter(cell => cell.status === status).length
  const passed = count('passed')
  const failed = count('failed')
  return {
    success: json?.success === true,
    executed: passed + failed,
    passed,
    failed,
    skipped: count('skipped'),
    todo: count('todo'),
    notRun: count('notRun'),
    fileFailures,
    cells,
  }
}

export function vitestFindings(member, classified, leg = 'turbo-test') {
  const name = typeof member === 'string' ? member : member?.name
  if (!classified) return [finding('results-missing', leg, `${name}: no vitest JSON`)]
  const findings = []
  if (classified.executed === 0) {
    findings.push(finding('zero-executed', leg, `${name}: 0 tests executed`))
  }
  for (const file of classified.fileFailures) {
    if (!file.hasFailedAssertion) {
      const detail = `${name}: ${file.file} (${file.status}): ${file.message || '<no message>'}`
      findings.push(finding('file-failed', leg, detail))
    }
  }
  for (const cell of classified.cells) {
    if (cell.status === 'failed') {
      findings.push(finding('test-failed', leg, `${name}: ${cell.file} > ${cell.fullName}`))
    }
  }
  const explained = findings.some(f => f.rule === 'test-failed' || f.rule === 'file-failed')
  if (!classified.success && !explained) {
    findings.push(finding('success-false', leg, `${name}: vitest reported success: false`))
  }
  return findings
}

export function staleResultFindings(results = [], legStartMs, leg = 'turbo-test') {
  return results
    .filter(entry => Number.isFinite(entry.mtimeMs) && entry.mtimeMs < legStartMs)
    .map(entry => {
      const detail = `${entry.member}: ${entry.file} was written before the leg started`
      return finding('stale-results', leg, detail)
    })
}

const RUNNER_LEGS = { vitest: 'turbo-test', 'node-test': 'node-test' }
const REGISTER_KINDS = new Set(['skipped', 'todo', 'notRun'])
const EXECUTED = new Set(['passed', 'failed'])

function nonEmpty(value) {
  return typeof value === 'string' && value.trim() !== ''
}

function cellKey({ runner, file, fullName }) {
  return `${runner}\u0000${file}\u0000${fullName}`
}

function identity({ runner, file, fullName }) {
  return { runner, file, fullName }
}

function cellLabel({ runner, file, fullName }) {
  return `${runner} ${file} > ${fullName}`
}

function kindOf(status) {
  return status === 'cancelled' ? 'notRun' : status
}

function identityProblems(entry) {
  const problems = []
  if (!Object.hasOwn(RUNNER_LEGS, entry.runner)) problems.push(`unknown runner ${entry.runner}`)
  if (!nonEmpty(entry.file)) problems.push('missing file')
  if (!nonEmpty(entry.fullName)) problems.push('missing fullName')
  return problems
}

function registerEntryProblems(entry) {
  const problems = identityProblems(entry)
  if (!REGISTER_KINDS.has(entry.kind)) problems.push(`unknown kind ${entry.kind}`)
  if (!nonEmpty(entry.reason)) problems.push('missing reason')
  if (!nonEmpty(entry.condition)) problems.push('missing condition')
  if (typeof entry.conditional !== 'boolean') problems.push('conditional is not a boolean')
  return problems
}

function screenList(list, field, problemsOf) {
  if (list?.schemaVersion !== 1 || !Array.isArray(list?.[field])) {
    return { readable: false, valid: [], invalid: [] }
  }
  const seen = new Set()
  const valid = []
  const invalid = []
  list[field].forEach((entry, index) => {
    const problems = entry && typeof entry === 'object' ? problemsOf(entry) : ['not an object']
    if (problems.length === 0 && seen.has(cellKey(entry))) problems.push('duplicate entry')
    if (problems.length > 0) {
      invalid.push({ index, entry, problems })
    } else {
      seen.add(cellKey(entry))
      valid.push(entry)
    }
  })
  return { readable: true, valid, invalid }
}

function screenFindings(screened, { rule, leg, field }) {
  if (!screened.readable) {
    const detail = `the ${leg} input is unreadable or not schemaVersion 1 with a ${field} array`
    return [finding(rule, leg, detail)]
  }
  return screened.invalid.map(({ index, entry, problems }) => {
    const label = entry && typeof entry === 'object' ? ` (${cellLabel(entry)})` : ''
    return finding(rule, leg, `${field}[${index}]${label}: ${problems.join(', ')}`)
  })
}

function judgedCells(cells, legsRan) {
  const ran = new Set(legsRan ?? [])
  const judged = runner => ran.has(RUNNER_LEGS[runner])
  const byKey = new Map()
  for (const cell of cells ?? []) {
    if (!judged(cell.runner)) continue
    const key = cellKey(cell)
    byKey.set(key, [...(byKey.get(key) ?? []), cell])
  }
  return { judged, byKey }
}

export function validateRegister(register) {
  const screened = screenList(register, 'entries', registerEntryProblems)
  const rule = 'register-entry-invalid'
  return screenFindings(screened, { rule, leg: 'register', field: 'entries' })
}

export function registerFindings({ cells = [], register, legsRan = [] } = {}) {
  const { judged, byKey } = judgedCells(cells, legsRan)
  const screened = screenList(register, 'entries', registerEntryProblems)
  const entries = screened.valid.filter(entry => judged(entry.runner))
  const listed = new Map(entries.map(entry => [cellKey(entry), entry]))
  const findings = []
  const stale = []
  const unlisted = []
  let matched = 0
  let conditionalRan = 0
  const markStale = (entry, why) => {
    stale.push({ ...identity(entry), why })
    const detail = `${cellLabel(entry)} is listed as ${entry.kind} but ${why}`
    findings.push(finding('stale-register-entry', RUNNER_LEGS[entry.runner], detail))
  }

  for (const group of byKey.values()) {
    for (const cell of group) {
      const kind = kindOf(cell.status)
      if (EXECUTED.has(kind)) continue
      const entry = listed.get(cellKey(cell))
      if (entry && entry.kind === kind) {
        matched += 1
      } else if (entry) {
        markStale(entry, `was reported ${kind}`)
      } else {
        unlisted.push({ ...identity(cell), kind, ...(cell.member ? { member: cell.member } : {}) })
        const owner = cell.member ? `${cell.member}: ` : ''
        const detail = `${owner}${cell.file} > ${cell.fullName} (${kind})`
        findings.push(finding('unlisted-skip', RUNNER_LEGS[cell.runner], detail))
      }
    }
  }

  for (const entry of entries) {
    const found = byKey.get(cellKey(entry)) ?? []
    const executed = found.filter(cell => EXECUTED.has(cell.status))
    if (found.length === 0) {
      markStale(entry, `is no longer in the ${RUNNER_LEGS[entry.runner]} results`)
    } else if (executed.length > 0 && !entry.conditional) {
      markStale(entry, `ran (${executed.map(cell => cell.status).join(', ')})`)
    } else if (executed.length > 0 && executed.every(cell => cell.status === 'passed')) {
      conditionalRan += 1
    }
  }

  return {
    findings,
    register: {
      entries: Array.isArray(register?.entries) ? register.entries.length : 0,
      matched,
      conditionalRan,
      stale,
      unlisted,
    },
  }
}

function regressionEntryProblems(entry) {
  const problems = identityProblems(entry)
  if (!nonEmpty(entry.origin)) problems.push('missing origin')
  return problems
}

export function validateRegressions(list) {
  const screened = screenList(list, 'cells', regressionEntryProblems)
  const rule = 'regression-entry-invalid'
  return screenFindings(screened, { rule, leg: 'regressions', field: 'cells' })
}

export function regressionFindings({ cells = [], list, legsRan = [] } = {}) {
  const { judged, byKey } = judgedCells(cells, legsRan)
  const screened = screenList(list, 'cells', regressionEntryProblems)
  const findings = []
  const missing = []
  const notPassed = []
  let passed = 0
  for (const entry of screened.valid.filter(cell => judged(cell.runner))) {
    const leg = RUNNER_LEGS[entry.runner]
    const found = byKey.get(cellKey(entry)) ?? []
    const unpassed = found.find(cell => cell.status !== 'passed')
    const label = `${cellLabel(entry)} [${entry.origin}]`
    if (found.length === 0) {
      missing.push({ ...identity(entry), origin: entry.origin })
      findings.push(finding('named-cell-missing', leg, `${label} is not in the ${leg} results`))
    } else if (unpassed) {
      const status = kindOf(unpassed.status)
      notPassed.push({ ...identity(entry), origin: entry.origin, status })
      findings.push(finding('named-cell-not-passed', leg, `${label} did not pass (${status})`))
    } else {
      passed += 1
    }
  }
  return {
    findings,
    regressions: {
      cells: Array.isArray(list?.cells) ? list.cells.length : 0,
      passed,
      missing,
      notPassed,
    },
  }
}

function executedBy(summaries, rows) {
  const table = {}
  summaries.forEach((summary, index) => {
    for (const [name, executed] of rows(summary)) {
      table[name] ??= summaries.map(() => null)
      table[name][index] = executed ?? null
    }
  })
  return table
}

export function compareRuns(summaries = []) {
  const leg = 'repeat'
  const findings = []
  summaries.forEach((summary, index) => {
    if (summary?.exitCode !== 0) {
      const code = summary?.exitCode ?? '<none>'
      findings.push(finding('repeat-run-red', leg, `run ${index + 1} exited ${code}`))
    }
  })
  const shas = summaries.map(summary => summary?.sha ?? null)
  if (new Set(shas).size > 1 || shas.includes(null)) {
    const listed = shas.map(sha => sha ?? '<unresolved>').join(', ')
    findings.push(finding('repeat-sha-mismatch', leg, `the runs measured ${listed}`))
  }
  const perPackageExecuted = executedBy(summaries, summary =>
    (summary?.packages ?? []).map(entry => [entry.name, entry.executed]),
  )
  const perLegExecuted = executedBy(summaries, summary =>
    (summary?.legs ?? []).map(entry => [entry.id, entry.executed]),
  )
  let identical = true
  for (const [label, table] of [
    ['member', perPackageExecuted],
    ['leg', perLegExecuted],
  ]) {
    for (const [name, values] of Object.entries(table)) {
      if (new Set(values).size <= 1) continue
      identical = false
      const listed = values.map(value => value ?? '<absent>').join(', ')
      findings.push(finding('repeat-count-mismatch', leg, `${label} ${name} executed ${listed}`))
    }
  }
  return {
    perPackageExecuted,
    perLegExecuted,
    identical,
    findings,
    exitCode: findings.length > 0 ? 1 : 0,
  }
}

const TURBO_BUILT_IN_ENV = new Set(['CI'])

function declaredEnv(turboJson) {
  const names = new Set(turboJson?.globalEnv ?? [])
  for (const name of turboJson?.globalPassThroughEnv ?? []) names.add(name)
  for (const task of Object.values(turboJson?.tasks ?? {})) {
    for (const name of [...(task.env ?? []), ...(task.passThroughEnv ?? [])]) names.add(name)
  }
  return names
}

export function turboEnvDisposition({ turboJson, envMode, gateEnv = {} } = {}) {
  const declared = declaredEnv(turboJson)
  const disposition = {}
  for (const name of Object.keys(gateEnv)) {
    if (envMode !== 'strict') disposition[name] = `passed (${envMode ?? 'unknown'} env mode)`
    else if (declared.has(name)) disposition[name] = 'passed (declared in turbo.json)'
    else if (TURBO_BUILT_IN_ENV.has(name)) disposition[name] = 'passed (turbo built-in)'
    else disposition[name] = 'stripped (strict env mode; not declared in turbo.json)'
  }
  return disposition
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
