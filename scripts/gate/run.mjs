import { spawn as defaultSpawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir as defaultTmpdir } from 'node:os'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync, gzipSync } from 'node:zlib'
import {
  REQUIRED_LEGS,
  auditFindings,
  classifyVitest,
  compareRuns,
  conformanceFindings,
  evaluateGate,
  namespaceLintFindings,
  nodeTestFindings,
  nodeValidatorFindings,
  orderRootCause,
  packageSetFindings,
  registerFindings,
  regressionFindings,
  staleResultFindings,
  turboEnvDisposition,
  turboFindings,
  turboTaskCounts,
  validateRegister,
  validateRegressions,
  vitestFindings,
  vitestValidatorFindings,
} from './evaluate.mjs'
import {
  GATE_ENV,
  chromiumCheck,
  defaultExec,
  describeEnvironment,
  machineSnapshot,
  preflight,
} from './host.mjs'

const GATE_DIR = dirname(fileURLToPath(import.meta.url))
const GATE_NAME = 'agent-qa-local-gate'
const DEFAULT_SOURCE = resolve(GATE_DIR, '..', '..')
const TURBO_LEGS = new Set(['turbo-build-typecheck', 'turbo-test'])
const NODE_TEST_DIR = 'scripts/__tests__'
const NODE_TEST_PIN = 'scripts/gate/inputs/node-tests.json'
const PACKAGE_PIN = 'scripts/gate/inputs/packages.json'
const REGISTER = 'scripts/gate/inputs/register.json'
const REGRESSIONS = 'scripts/gate/inputs/regressions.json'
const TURBO_RUNS_DIR = '.turbo/runs'
const TURBO_RUN_FLAGS = ['--force', '--continue', '--summarize', '--log-order=grouped']
const VITEST_RESULTS = 'test-results/gate-vitest.json'
const VITEST_ARGS = [
  '--reporter=default',
  '--reporter=json',
  '--outputFile.json=test-results/gate-vitest.json',
]
const VITEST_CONFIGS = ['ts', 'mts', 'cts', 'js', 'mjs', 'cjs'].map(ext => `vitest.config.${ext}`)
const COUNT_COLUMNS = ['executed', 'passed', 'failed', 'skipped', 'todo', 'notRun']
const MAX_PLAIN_LOG_BYTES = 2 * 1024 * 1024

function gateEnv() {
  return { ...process.env, ...GATE_ENV }
}

function readValue(argv, index, flag) {
  const value = argv[index + 1]
  if (value === undefined || value.startsWith('--')) throw new Error(`missing ${flag} value`)
  return value
}

export function parseGateArgs(argv = []) {
  const parsed = { source: DEFAULT_SOURCE, only: null, inPlace: false, keepClone: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--') {
      continue
    } else if (arg === '--out') {
      parsed.out = resolve(readValue(argv, index, '--out'))
      index += 1
    } else if (arg === '--sha') {
      parsed.sha = readValue(argv, index, '--sha')
      index += 1
    } else if (arg === '--source') {
      parsed.source = resolve(readValue(argv, index, '--source'))
      index += 1
    } else if (arg === '--only') {
      const ids = readValue(argv, index, '--only')
        .split(',')
        .map(id => id.trim())
        .filter(Boolean)
      for (const id of ids) if (!REQUIRED_LEGS.includes(id)) throw new Error(`unknown leg: ${id}`)
      parsed.only = ids
      index += 1
    } else if (arg === '--turbo-concurrency') {
      const value = readValue(argv, index, '--turbo-concurrency')
      if (!/^[1-9]\d*$/.test(value)) throw new Error(`invalid --turbo-concurrency: ${value}`)
      parsed.turboConcurrency = Number(value)
      index += 1
    } else if (arg === '--repeat') {
      const value = readValue(argv, index, '--repeat')
      if (!/^\d+$/.test(value) || Number(value) < 2) {
        throw new Error(`invalid --repeat: ${value} (an integer >= 2)`)
      }
      parsed.repeat = Number(value)
      index += 1
    } else if (arg === '--in-place') {
      parsed.inPlace = true
    } else if (arg === '--keep-clone') {
      parsed.keepClone = true
    } else {
      throw new Error(`unknown argument: ${arg}`)
    }
  }
  if (!parsed.out) throw new Error('missing --out')
  if (parsed.inPlace && parsed.sha) throw new Error('--in-place cannot be combined with --sha')
  if (parsed.inPlace && parsed.repeat) {
    throw new Error('--repeat cannot be combined with --in-place')
  }
  return parsed
}

function turboArgv(tasks, flags) {
  return ['pnpm', 'exec', 'turbo', 'run', ...tasks, ...flags]
}

const NODE_VALIDATORS = {
  'validate:skills': 'skills',
  'validate:agents': 'agents',
  'validate:publish': 'publish',
  'validate:431-discovery-imports': '431-discovery-imports',
}
const CONFORMANCE_SCRIPT = 'scripts/396-conformance.sh'

function nodeValidatorLeg(script, { root }) {
  return {
    id: script,
    kind: 'count-validator',
    validator: NODE_VALIDATORS[script],
    needsBuild: true,
    cwd: root,
    argv: ['pnpm', 'run', script],
  }
}

function vitestValidatorLeg(script, { root, runDir }) {
  const raw = join(runDir, 'raw', `${script.replace(/:/g, '-')}.json`)
  return {
    id: script,
    kind: 'vitest-validator',
    script,
    needsBuild: true,
    cwd: root,
    argv: ['pnpm', 'run', script, ...VITEST_ARGS.slice(0, 2), `--outputFile.json=${raw}`],
    raw,
  }
}

export function buildGateLegs({
  root = '.',
  runDir = '.',
  nodeTestFiles = [],
  turboConcurrency,
} = {}) {
  const concurrency = turboConcurrency ? [`--concurrency=${turboConcurrency}`] : []
  const paths = { root, runDir }
  return [
    {
      id: 'turbo-build-typecheck',
      kind: 'turbo',
      needsBuild: false,
      cwd: root,
      dryRunArgv: turboArgv(['build', 'typecheck'], ['--dry-run=json']),
      argv: turboArgv(['build', 'typecheck'], [...TURBO_RUN_FLAGS, ...concurrency]),
    },
    {
      id: 'turbo-test',
      kind: 'turbo',
      vitest: true,
      needsBuild: false,
      cwd: root,
      dryRunArgv: turboArgv(['test'], ['--dry-run=json', '--', ...VITEST_ARGS]),
      argv: turboArgv(['test'], [...TURBO_RUN_FLAGS, ...concurrency, '--', ...VITEST_ARGS]),
    },
    nodeValidatorLeg('validate:skills', paths),
    nodeValidatorLeg('validate:agents', paths),
    nodeValidatorLeg('validate:publish', paths),
    vitestValidatorLeg('validate:tools', paths),
    vitestValidatorLeg('validate:arch', paths),
    vitestValidatorLeg('validate:safety', paths),
    nodeValidatorLeg('validate:431-discovery-imports', paths),
    {
      id: 'lint:namespace',
      kind: 'namespace-lint',
      needsBuild: true,
      cwd: root,
      argv: ['pnpm', 'run', 'lint:namespace'],
    },
    {
      id: 'node-test',
      kind: 'node-test',
      needsBuild: true,
      cwd: root,
      argv: [
        'node',
        '--test',
        '--test-reporter=spec',
        '--test-reporter-destination=stdout',
        `--test-reporter=${join(root, 'scripts/gate/node-test-json.mjs')}`,
        `--test-reporter-destination=${join(runDir, 'raw', 'node-test.json')}`,
        ...nodeTestFiles.map(file => `${NODE_TEST_DIR}/${file}`),
      ],
      raw: join(runDir, 'raw', 'node-test.json'),
    },
    {
      id: 'conformance-selftest',
      kind: 'conformance',
      needsBuild: false,
      cwd: root,
      argv: ['bash', CONFORMANCE_SCRIPT, '--selftest'],
    },
    {
      id: 'conformance',
      kind: 'conformance',
      needsBuild: false,
      cwd: root,
      argv: ['bash', CONFORMANCE_SCRIPT],
    },
    {
      id: 'audit',
      kind: 'audit',
      needsBuild: false,
      cwd: root,
      argv: ['pnpm', 'audit', '--prod', '--audit-level', 'high', '--json'],
      stdoutPath: join(runDir, 'raw', 'audit.json'),
    },
  ]
}

function defaultRun(command, args, { cwd, logPath, stdoutPath }) {
  return new Promise(settle => {
    const started = Date.now()
    const log = createWriteStream(logPath)
    const stdout = stdoutPath ? [] : null
    let done = false
    const finish = exitCode => {
      if (done) return
      done = true
      if (stdout) writeFileSync(stdoutPath, Buffer.concat(stdout))
      log.end(() => settle({ exitCode, durationMs: Date.now() - started }))
    }
    const child = defaultSpawn(command, args, {
      cwd,
      env: gateEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    child.stdout.pipe(log, { end: false })
    child.stderr.pipe(log, { end: false })
    if (stdout) child.stdout.on('data', chunk => stdout.push(chunk))
    child.on('error', error => {
      log.write(`${error.message}\n`)
      finish(127)
    })
    child.on('close', code => finish(code ?? 1))
  })
}

function stamp(now) {
  return now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
}

export function runDirName({ mode, now, pid }) {
  return `${mode}-${stamp(now)}-${pid}`
}

export function shouldRemoveClone({ exitCode, keepClone = false }) {
  return exitCode === 0 && !keepClone
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

function parseJson(text) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function realOrResolved(path) {
  const absolute = resolve(path)
  try {
    return realpathSync(absolute)
  } catch {
    const parent = dirname(absolute)
    return parent === absolute ? absolute : join(realOrResolved(parent), basename(absolute))
  }
}

export function workspaceMembers(root, exec = defaultExec) {
  const listing = exec('pnpm', ['ls', '-r', '--depth', '-1', '--json'], { cwd: root })
  const entries = listing.status === 0 ? parseJson(listing.stdout) : null
  if (!Array.isArray(entries)) return null
  const realRoot = realOrResolved(root)
  return entries
    .filter(entry => realOrResolved(entry.path) !== realRoot)
    .map(entry => ({ name: entry.name, dir: relative(realRoot, realOrResolved(entry.path)) }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
}

function writeGz(path, content) {
  writeFileSync(path, gzipSync(content))
}

function listRuns(dir) {
  return existsSync(dir) ? readdirSync(dir).filter(file => file.endsWith('.json')) : []
}

function safeName(name) {
  return name.replace(/[^A-Za-z0-9._-]/g, '_')
}

function workerLimits(root, members) {
  const limits = {}
  for (const member of members ?? []) {
    for (const config of VITEST_CONFIGS) {
      const path = join(root, member.dir, config)
      if (!existsSync(path)) continue
      const match = readFileSync(path, 'utf8').match(/maxWorkers:\s*(\d+)/)
      if (match) limits[member.name] = Number(match[1])
      break
    }
  }
  return limits
}

function collectVitestResults(root, members, runDir) {
  const realRoot = realOrResolved(root)
  return members.map(member => {
    const resultsFile = join(member.dir, VITEST_RESULTS)
    const path = join(root, resultsFile)
    if (!existsSync(path)) return { member, resultsFile: null, mtimeMs: null, json: null }
    const bytes = readFileSync(path)
    writeGz(join(runDir, 'raw', `vitest-${safeName(member.name)}.json.gz`), bytes)
    return {
      member,
      resultsFile,
      mtimeMs: statSync(path).mtimeMs,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      json: parseJson(bytes.toString('utf8')),
      realRoot,
    }
  })
}

function vitestLeg(record, runSummary, { root, runDir, members, pinned, legStartMs }) {
  const results = collectVitestResults(root, members, runDir)
  const findings = []
  const packages = []
  const cells = []
  for (const result of results) {
    const { member } = result
    const classified = result.json ? classifyVitest(result.json, result.realRoot) : null
    for (const cell of classified?.cells ?? []) {
      cells.push({ runner: 'vitest', member: member.name, ...cell })
    }
    if (result.resultsFile && !result.json) {
      const detail = `${member.name}: ${result.resultsFile} is not valid JSON`
      findings.push({ rule: 'results-missing', leg: record.id, detail })
    } else {
      findings.push(...vitestFindings(member.name, classified, record.id))
    }
    const counts = Object.fromEntries(COUNT_COLUMNS.map(key => [key, classified?.[key] ?? 0]))
    packages.push({
      name: member.name,
      dir: member.dir,
      ...counts,
      success: classified?.success ?? false,
      fileFailures: (classified?.fileFailures ?? []).map(({ file, status, message }) => ({
        file,
        status,
        message,
      })),
      resultsFile: result.resultsFile,
      resultsSha256: result.sha256 ?? null,
    })
  }
  const stale = results.map(({ member, resultsFile, mtimeMs }) => ({
    member: member.name,
    file: resultsFile,
    mtimeMs,
  }))
  findings.push(...staleResultFindings(stale, legStartMs, record.id))
  const testTaskPackages = runSummary
    ? (runSummary.tasks ?? [])
        .filter(task => String(task.taskId).endsWith('#test'))
        .map(task => task.taskId.slice(0, -'#test'.length))
    : undefined
  const vitestPackages = results.filter(result => result.json).map(result => result.member.name)
  findings.push(
    ...packageSetFindings({ leg: record.id, pinned, testTaskPackages, vitestPackages }),
  )
  const totals = Object.fromEntries(
    COUNT_COLUMNS.map(key => [key, packages.reduce((sum, entry) => sum + entry[key], 0)]),
  )
  return {
    leg: {
      ...record,
      tasksExecuted: record.executed,
      tasksFailed: record.failed,
      ...totals,
      findings: [...record.findings, ...findings],
    },
    packages,
    cells,
  }
}

function listNodeTestFiles(root) {
  return readdirSync(join(root, NODE_TEST_DIR))
    .filter(file => file.endsWith('.test.mjs'))
    .sort()
}

function writeAtomic(path, content) {
  const tmp = `${path}.tmp`
  writeFileSync(tmp, content)
  renameSync(tmp, path)
}

function compressLargeLog(log) {
  if (!existsSync(log) || statSync(log).size <= MAX_PLAIN_LOG_BYTES) return log
  const gz = `${log}.gz`
  writeFileSync(gz, gzipSync(readFileSync(log)))
  unlinkSync(log)
  return gz
}

function failure(step, rule) {
  step.findings.push({ rule, leg: step.id, detail: `exit ${step.exitCode}` })
}

export function validatorScriptFiles(root, script, members) {
  const text = readJson(join(root, 'package.json'))?.scripts?.[script]
  if (typeof text !== 'string') return null
  const tokens = text.split(/\s+/)
  const at = tokens.indexOf('--filter')
  const member = at >= 0 ? members?.find(entry => entry.name === tokens[at + 1]) : null
  if (!member) return null
  return tokens
    .filter(token => /^src\/.*\.test\.ts$/.test(token))
    .map(token => realOrResolved(join(root, member.dir, token)))
}

function vitestValidatorResult(leg, step, { root, members, register }) {
  const written = existsSync(leg.raw) ? readJson(leg.raw) : null
  const json = written && {
    ...written,
    testResults: (written.testResults ?? []).map(file => ({
      ...file,
      name: realOrResolved(file.name),
    })),
  }
  const result = vitestValidatorFindings({
    legId: leg.id,
    json,
    expectedFiles: validatorScriptFiles(root, leg.script, members),
    rootDir: realOrResolved(root),
    exitCode: step.exitCode,
    register,
  })
  const counts = { ...result.counts, register: result.register }
  return { counts, cells: [], findings: result.findings }
}

function namespaceLintResult(leg, step, { root, exec }) {
  const listing = exec('git', ['-C', root, 'ls-files', '-z', '--', 'packages'])
  const trackedFiles = listing.status === 0 ? listing.stdout.split('\0').filter(Boolean) : null
  const result = namespaceLintFindings({ legId: leg.id, exitCode: step.exitCode, trackedFiles })
  return { ...result, cells: [] }
}

function readLog(path) {
  if (!path || !existsSync(path)) return ''
  const bytes = readFileSync(path)
  return (path.endsWith('.gz') ? gunzipSync(bytes) : bytes).toString('utf8')
}

function auditResult(leg, step) {
  const raw = leg.stdoutPath
  const stdout = existsSync(raw) ? readFileSync(raw, 'utf8') : ''
  if (existsSync(raw)) {
    writeGz(`${raw}.gz`, stdout)
    unlinkSync(raw)
  }
  return { ...auditFindings({ exitCode: step.exitCode, stdout }), cells: [] }
}

function evaluateLeg(leg, step, context) {
  const { root, onDisk } = context
  if (leg.kind === 'vitest-validator') return vitestValidatorResult(leg, step, context)
  if (leg.kind === 'namespace-lint') return namespaceLintResult(leg, step, context)
  if (leg.kind === 'audit') return auditResult(leg, step)
  if (leg.kind === 'count-validator') {
    const output = readLog(step.log)
    const input = { legId: leg.id, validatorId: leg.validator, exitCode: step.exitCode, output }
    return { ...nodeValidatorFindings(input), cells: [] }
  }
  if (leg.kind === 'conformance') {
    const output = readLog(step.log)
    return { ...conformanceFindings({ legId: leg.id, exitCode: step.exitCode, output }), cells: [] }
  }
  if (leg.kind === 'node-test') {
    const pin = readJson(join(root, NODE_TEST_PIN))
    const result = nodeTestFindings(existsSync(leg.raw) ? readJson(leg.raw) : null, {
      pinnedFiles: pin?.files,
      onDiskFiles: onDisk,
      exitCode: step.exitCode,
      rootDir: realOrResolved(root),
    })
    const cells = result.cells.map(({ file, fullName, status }) => ({
      runner: 'node-test',
      file,
      fullName,
      status,
    }))
    return { ...result, cells }
  }
  return {
    counts: {},
    cells: [],
    findings: [{ rule: 'results-missing', leg: leg.id, detail: `no evaluator for ${leg.kind}` }],
  }
}

async function runTurboLeg(leg, { exec, runStep, runDir, pinned, members }) {
  const dry = exec(leg.dryRunArgv[0], leg.dryRunArgv.slice(1), { cwd: leg.cwd })
  const dryRun = dry.status === 0 ? parseJson(dry.stdout) : null
  if (dryRun) writeGz(join(runDir, 'raw', `${leg.id}-dry-run.json.gz`), dry.stdout)

  const runsDir = join(leg.cwd, TURBO_RUNS_DIR)
  const before = new Set(listRuns(runsDir))
  if (leg.vitest) {
    for (const member of members ?? []) {
      rmSync(join(leg.cwd, member.dir, VITEST_RESULTS), { force: true })
    }
  }
  const legStartMs = Date.now()
  const step = await runStep(leg.id, leg.argv, leg.cwd)
  const fresh = listRuns(runsDir).filter(file => !before.has(file))
  const summaryFile = fresh.length === 1 ? join(runsDir, fresh[0]) : null
  const runSummary = summaryFile ? readJson(summaryFile) : null
  if (runSummary) {
    writeGz(join(runDir, 'raw', `${leg.id}-summary.json.gz`), readFileSync(summaryFile))
  }

  const findings = []
  if (!dryRun) {
    const detail = `turbo dry run exited ${dry.status} or printed no JSON`
    findings.push({ rule: 'results-missing', leg: leg.id, detail })
  } else if (!runSummary) {
    const detail = `expected one new run summary in ${TURBO_RUNS_DIR}, found ${fresh.length}`
    findings.push({ rule: 'results-missing', leg: leg.id, detail })
  } else {
    findings.push(...turboFindings({ legId: leg.id, dryRun, runSummary, exitCode: step.exitCode }))
  }
  if (dryRun) {
    const dryRunPackages = dryRun.packages ?? []
    findings.push(...packageSetFindings({ leg: leg.id, pinned, dryRunPackages }))
  }
  const counts = turboTaskCounts({ dryRun, runSummary })
  const result = {
    leg: {
      id: leg.id,
      argv: leg.argv,
      dryRunArgv: leg.dryRunArgv,
      cwd: leg.cwd,
      exitCode: step.exitCode,
      durationMs: step.durationMs,
      log: step.log,
      expectedTasks: counts.expected,
      executed: counts.executed,
      passed: counts.passed,
      failed: counts.failed,
      findings,
    },
    runSummary: {
      leg: leg.id,
      file: summaryFile,
      envMode: runSummary?.envMode ?? null,
      execution: runSummary?.execution ?? null,
    },
    packages: null,
    cells: [],
  }
  if (!leg.vitest) return result
  const ctx = { root: leg.cwd, runDir, members: members ?? [], pinned, legStartMs }
  const tested = vitestLeg(result.leg, runSummary, ctx)
  return { ...result, leg: tested.leg, packages: tested.packages, cells: tested.cells }
}

async function runRepeat(options, deps) {
  const exec = deps.exec ?? defaultExec
  const now = deps.now ?? (() => new Date())
  const pid = deps.pid ?? process.pid
  const output = deps.output ?? process.stdout
  const say = line => output.write?.(`${line}\n`)

  const wanted = options.sha ?? 'HEAD'
  const { source } = options
  const revParse = exec('git', ['-C', source, 'rev-parse', '--verify', `${wanted}^{commit}`])
  const sha = revParse.stdout.trim()
  if (revParse.status !== 0 || !/^[0-9a-f]{40}$/.test(sha)) {
    throw new Error(`cannot resolve ${wanted} in ${source}: ${revParse.stderr.trim()}`)
  }
  const repeatDir = join(options.out, sha, runDirName({ mode: 'repeat', now: now(), pid }))
  const summaries = []
  for (let index = 1; index <= options.repeat; index += 1) {
    say(`[gate] repeat run ${index} of ${options.repeat} at ${sha}`)
    const runDir = join(repeatDir, `run-${index}`)
    summaries.push(await runGate({ ...options, repeat: undefined, sha, runDir }, deps))
  }
  const repeatSummary = {
    schemaVersion: 1,
    sha,
    gate: summaries[0]?.gate ?? null,
    n: options.repeat,
    record: summaries.every(summary => summary.record === true),
    runs: summaries.map(({ runDir, exitCode, startedAt, finishedAt, durationMs }) => ({
      runDir,
      exitCode,
      startedAt,
      finishedAt,
      durationMs,
    })),
    ...compareRuns(summaries),
  }
  const summaryPath = join(repeatDir, 'repeat-summary.json')
  mkdirSync(repeatDir, { recursive: true })
  writeAtomic(summaryPath, `${JSON.stringify(repeatSummary, null, 2)}\n`)

  for (const f of repeatSummary.findings) say(`[gate] ${f.rule} (${f.leg}): ${f.detail}`)
  const verdict = repeatSummary.exitCode === 0 ? 'green' : 'red'
  say(`repeat ${verdict}: ${options.repeat} run(s), ${repeatSummary.findings.length} finding(s)`)
  if (!repeatSummary.record) say('repeat: NOT A RECORD')
  say(`repeat summary: ${summaryPath}`)
  return repeatSummary
}

export async function runGate(options, deps = {}) {
  if (options.repeat) return runRepeat(options, deps)
  const exec = deps.exec ?? defaultExec
  const run = deps.run ?? defaultRun
  const now = deps.now ?? (() => new Date())
  const pid = deps.pid ?? process.pid
  const output = deps.output ?? process.stdout
  const tmpdir = deps.tmpdir ?? defaultTmpdir
  const buildLegs = deps.buildGateLegs ?? buildGateLegs
  const host = { preflight, chromiumCheck, describeEnvironment, machineSnapshot, ...deps.host }
  const say = line => output.write?.(`${line}\n`)

  const started = now()
  const machineStart = host.machineSnapshot({ exec, selfPid: pid })
  const partial = Array.isArray(options.only)
  const selected = partial ? options.only : REQUIRED_LEGS
  const inPlace = options.inPlace === true
  const mode = inPlace ? 'in-place' : 'clone'
  const source = options.source

  const checks = host.preflight({ exec, cwd: source })
  const preflightRecord = { required: [...checks.required], optional: [...checks.optional] }
  if (!checks.ok) for (const line of checks.message.split('\n')) say(`[gate] preflight: ${line}`)

  const wanted = options.sha ?? 'HEAD'
  const revParse = exec('git', ['-C', source, 'rev-parse', '--verify', `${wanted}^{commit}`])
  let sha = revParse.stdout.trim()
  if (revParse.status !== 0 || !/^[0-9a-f]{40}$/.test(sha)) {
    if (checks.ok) {
      throw new Error(`cannot resolve ${wanted} in ${source}: ${revParse.stderr.trim()}`)
    }
    sha = null
  }

  const warnings = []
  const status = exec('git', ['-C', source, 'status', '--porcelain'])
  const dirtyPaths = status.stdout.split('\n').filter(line => line.trim() !== '').length
  const sourceDirty = status.status === 0 ? dirtyPaths > 0 : null
  if (sourceDirty === null) warnings.push('could not read the source checkout status')
  if (!inPlace && sourceDirty) {
    warnings.push(
      `source checkout has ${dirtyPaths} uncommitted path(s) the clone did not include`,
    )
  }
  const gateStatus = exec('git', ['-C', GATE_DIR, 'status', '--porcelain', '--', '.'])
  const gateDirty = gateStatus.status === 0 ? gateStatus.stdout.trim() !== '' : null
  if (gateDirty === null) warnings.push('could not read the gate files status')
  const gateHead = exec('git', ['-C', GATE_DIR, 'rev-parse', 'HEAD']).stdout.trim()
  const gateSha = /^[0-9a-f]{40}$/.test(gateHead) ? gateHead : null

  const runName = runDirName({ mode, now: started, pid })
  const runDir = options.runDir ?? join(options.out, sha ?? 'unresolved', runName)
  mkdirSync(join(runDir, 'logs'), { recursive: true })
  mkdirSync(join(runDir, 'raw'), { recursive: true })
  const logPath = id => join(runDir, 'logs', `${id.replace(/[^A-Za-z0-9._-]/g, '_')}.log`)

  const steps = []
  const runStep = async (id, argv, cwd, extra = {}) => {
    const result = await run(argv[0], argv.slice(1), { cwd, logPath: logPath(id), ...extra })
    const { exitCode, durationMs } = result
    const log = compressLargeLog(logPath(id))
    say(`[gate] ${id}: exit ${exitCode} (${durationMs} ms)`)
    return { id, argv, cwd, exitCode, durationMs, log, findings: [] }
  }

  let root = source
  let parent = null
  let ready = checks.ok
  let environment = null
  if (ready && !inPlace) {
    parent = realpathSync(mkdtempSync(join(tmpdir(), 'agent-qa-gate-')))
    root = join(parent, 'agent-qa')
    const clone = await runStep(
      'clone',
      ['git', 'clone', '--quiet', '--no-checkout', source, root],
      parent,
    )
    steps.push(clone)
    let head = ''
    if (clone.exitCode === 0) {
      const checkout = exec('git', ['-C', root, 'checkout', '--quiet', '--detach', sha])
      if (checkout.status === 0) head = exec('git', ['-C', root, 'rev-parse', 'HEAD']).stdout.trim()
    }
    if (head !== sha) {
      clone.findings.push({
        rule: 'clone-sha-mismatch',
        leg: 'clone',
        detail: `clone HEAD ${head || '<none>'} is not ${sha}`,
      })
      ready = false
    }
  }

  const legs = []
  const runSummaries = []
  let members = null
  let packages = []
  let registerRecord = null
  let regressionsRecord = null
  if (ready) {
    let installed = true
    if (inPlace) {
      steps.push({ id: 'install', skipped: 'in-place', findings: [] })
    } else {
      const install = await runStep('install', ['pnpm', 'install', '--frozen-lockfile'], root)
      if (install.exitCode !== 0) failure(install, 'install-failed')
      installed = install.exitCode === 0
      steps.push(install)
    }

    let chromium = null
    if (installed) {
      const browser = host.chromiumCheck({ root })
      preflightRecord.required.push(browser.required)
      preflightRecord.optional.push(...browser.optional)
      chromium = browser.chromium
      if (!browser.required.ok) {
        say(`[gate] preflight: Playwright Chromium is missing: ${browser.required.hint}`)
        ready = false
      }
    } else {
      warnings.push('the Playwright Chromium check was skipped because the install failed')
    }
    const clonePath = inPlace ? null : root
    environment = host.describeEnvironment({ root, exec, sha, clonePath, chromium })
  }

  if (ready) {
    const onDisk = listNodeTestFiles(root)
    const plan = buildLegs({
      root,
      runDir,
      nodeTestFiles: onDisk,
      turboConcurrency: options.turboConcurrency,
    }).filter(leg => selected.includes(leg.id))
    const turboSelected = plan.some(leg => TURBO_LEGS.has(leg.id))
    if (!turboSelected && plan.some(leg => leg.needsBuild)) {
      const build = await runStep('prepare-build', ['pnpm', 'build'], root)
      if (build.exitCode !== 0) failure(build, 'prepare-build-failed')
      steps.push(build)
    }

    const pinned = readJson(join(root, PACKAGE_PIN))?.members
    if (plan.some(leg => leg.kind === 'turbo' || leg.kind === 'vitest-validator')) {
      members = workspaceMembers(root, exec)
      const workspace = { id: 'workspace', members: members?.length ?? null, findings: [] }
      if (members === null) {
        const detail = 'pnpm ls -r --depth -1 --json failed or printed no JSON'
        workspace.findings.push({ rule: 'package-set-mismatch', leg: 'workspace', detail })
      } else {
        const pnpmMembers = members.map(member => member.name)
        workspace.findings.push(...packageSetFindings({ pinned, pnpmMembers }))
      }
      steps.push(workspace)
    }

    const register = readJson(join(root, REGISTER))
    const cells = []
    for (const leg of plan) {
      if (leg.kind === 'turbo') {
        const result = await runTurboLeg(leg, { exec, runStep, runDir, pinned, members })
        legs.push(result.leg)
        runSummaries.push(result.runSummary)
        cells.push(...result.cells)
        if (result.packages) packages = result.packages
        continue
      }
      const extra = leg.stdoutPath ? { stdoutPath: leg.stdoutPath } : {}
      const step = await runStep(leg.id, leg.argv, leg.cwd, extra)
      const evaluated = evaluateLeg(leg, step, { root, onDisk, members, exec, register })
      const { counts, findings } = evaluated
      cells.push(...evaluated.cells)
      legs.push({
        id: leg.id,
        argv: leg.argv,
        cwd: leg.cwd,
        exitCode: step.exitCode,
        durationMs: step.durationMs,
        log: step.log,
        ...counts,
        findings,
      })
    }

    const legsRan = legs.map(leg => leg.id)
    const judged = registerFindings({ cells, register, legsRan })
    registerRecord = judged.register
    steps.push({
      id: 'register',
      entries: judged.register.entries,
      findings: [...validateRegister(register), ...judged.findings],
    })

    const list = readJson(join(root, REGRESSIONS))
    const named = regressionFindings({ cells, list, legsRan })
    regressionsRecord = named.regressions
    steps.push({
      id: 'regressions',
      cells: named.regressions.cells,
      findings: [...validateRegressions(list), ...named.findings],
    })
  }

  const machineEnd = host.machineSnapshot({ exec, selfPid: pid })
  const verdict = evaluateGate({ legs, steps, partial, selected, preflight: preflightRecord })
  const { findings, rootCause } = orderRootCause(verdict.findings)
  const legMissing = findings.some(f => f.rule === 'leg-missing')
  const removable = shouldRemoveClone({ exitCode: verdict.exitCode, keepClone: options.keepClone })
  const cloneRemoved = parent !== null && removable
  const finished = now()
  const envMode = runSummaries.find(entry => entry.envMode)?.envMode ?? null
  const turboConcurrency = options.turboConcurrency ?? 'default'
  const summary = {
    schemaVersion: 1,
    gate: { name: GATE_NAME, sha: gateSha, dirty: gateDirty },
    mode,
    record:
      mode === 'clone' && !partial && !legMissing && gateDirty === false && sourceDirty === false,
    partial,
    only: options.only,
    sha,
    sourceDir: source,
    sourceDirty,
    warnings,
    clonePath: inPlace ? null : root,
    cloneRemoved,
    runDir,
    startedAt: started.toISOString(),
    finishedAt: finished.toISOString(),
    durationMs: finished.getTime() - started.getTime(),
    environment,
    machine: {
      cpus: machineStart.cpus,
      loadStart: machineStart.load,
      loadEnd: machineEnd.load,
      processesStart: machineStart.processes,
      processesEnd: machineEnd.processes,
    },
    preflight: preflightRecord,
    steps: steps.map(({ findings, ...step }) => step),
    members,
    turbo: {
      envMode,
      envDisposition: envMode
        ? turboEnvDisposition({
            turboJson: readJson(join(root, 'turbo.json')),
            envMode,
            gateEnv: { CI: GATE_ENV.CI, DO_NOT_TRACK: GATE_ENV.DO_NOT_TRACK },
          })
        : null,
      concurrency: turboConcurrency,
      runSummaries,
    },
    concurrency: {
      turbo: turboConcurrency,
      workerLimits: members ? workerLimits(root, members) : null,
    },
    legs,
    packages,
    register: registerRecord,
    regressions: regressionsRecord,
    rootCause,
    findings,
    exitCode: verdict.exitCode,
  }
  const summaryPath = join(runDir, 'summary.json')
  writeAtomic(summaryPath, `${JSON.stringify(summary, null, 2)}\n`)
  if (cloneRemoved) rmSync(parent, { recursive: true, force: true })

  for (const warning of warnings) say(`[gate] warning: ${warning}`)
  for (const f of findings) say(`[gate] ${f.rule} (${f.leg}): ${f.detail}`)
  say(`gate ${verdict.exitCode === 0 ? 'green' : 'red'}: ${findings.length} finding(s)`)
  if (inPlace) say('in-place run: NOT A RECORD')
  if (partial) say(`partial run (${options.only.join(',')}): NOT A RECORD`)
  if (gateDirty) say('gate files dirty: NOT A RECORD')
  if (sourceDirty) say('source checkout dirty: NOT A RECORD')
  say(`summary: ${summaryPath}`)
  return summary
}

export async function runCli(argv = process.argv.slice(2), options = {}) {
  let parsed
  try {
    parsed = parseGateArgs(argv)
  } catch (error) {
    const errorOutput = options.errorOutput ?? process.stderr
    errorOutput.write?.(`${error.message}\n`)
    return 2
  }
  const summary = await runGate(parsed, options)
  return summary.exitCode
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
  runCli()
    .then(code => {
      process.exitCode = code
    })
    .catch(error => {
      console.error(error.message)
      process.exitCode = 1
    })
}
