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
import { gzipSync } from 'node:zlib'
import {
  REQUIRED_LEGS,
  classifyVitest,
  evaluateGate,
  nodeTestFindings,
  orderRootCause,
  packageSetFindings,
  staleResultFindings,
  turboEnvDisposition,
  turboFindings,
  turboTaskCounts,
  vitestFindings,
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
const DEFAULT_SOURCE = resolve(GATE_DIR, '..', '..')
const TURBO_LEGS = new Set(['turbo-build-typecheck', 'turbo-test'])
const NODE_TEST_DIR = 'scripts/__tests__'
const NODE_TEST_PIN = 'scripts/gate/inputs/node-tests.json'
const PACKAGE_PIN = 'scripts/gate/inputs/packages.json'
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
  return parsed
}

function turboArgv(tasks, flags) {
  return ['pnpm', 'exec', 'turbo', 'run', ...tasks, ...flags]
}

export function buildGateLegs({ root, runDir, nodeTestFiles = [], turboConcurrency } = {}) {
  const concurrency = turboConcurrency ? [`--concurrency=${turboConcurrency}`] : []
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
  ]
}

function defaultRun(command, args, { cwd, logPath }) {
  return new Promise(settle => {
    const started = Date.now()
    const log = createWriteStream(logPath)
    let done = false
    const finish = exitCode => {
      if (done) return
      done = true
      log.end(() => settle({ exitCode, durationMs: Date.now() - started }))
    }
    const child = defaultSpawn(command, args, {
      cwd,
      env: gateEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    child.stdout.pipe(log, { end: false })
    child.stderr.pipe(log, { end: false })
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
  for (const result of results) {
    const { member } = result
    const classified = result.json ? classifyVitest(result.json, result.realRoot) : null
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

function evaluateLeg(leg, step, { root, onDisk }) {
  if (leg.kind === 'node-test') {
    const pin = readJson(join(root, NODE_TEST_PIN))
    return nodeTestFindings(existsSync(leg.raw) ? readJson(leg.raw) : null, {
      pinnedFiles: pin?.files,
      onDiskFiles: onDisk,
      exitCode: step.exitCode,
    })
  }
  return {
    counts: {},
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
  }
  if (!leg.vitest) return result
  const ctx = { root: leg.cwd, runDir, members: members ?? [], pinned, legStartMs }
  const tested = vitestLeg(result.leg, runSummary, ctx)
  return { ...result, leg: tested.leg, packages: tested.packages }
}

export async function runGate(options, deps = {}) {
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

  const runDir = join(options.out, sha ?? 'unresolved', runDirName({ mode, now: started, pid }))
  mkdirSync(join(runDir, 'logs'), { recursive: true })
  mkdirSync(join(runDir, 'raw'), { recursive: true })
  const logPath = id => join(runDir, 'logs', `${id.replace(/[^A-Za-z0-9._-]/g, '_')}.log`)

  const steps = []
  const runStep = async (id, argv, cwd) => {
    const result = await run(argv[0], argv.slice(1), { cwd, logPath: logPath(id) })
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
    if (plan.some(leg => leg.kind === 'turbo')) {
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

    for (const leg of plan) {
      if (leg.kind === 'turbo') {
        const result = await runTurboLeg(leg, { exec, runStep, runDir, pinned, members })
        legs.push(result.leg)
        runSummaries.push(result.runSummary)
        if (result.packages) packages = result.packages
        continue
      }
      const step = await runStep(leg.id, leg.argv, leg.cwd)
      const { counts, findings } = evaluateLeg(leg, step, { root, onDisk })
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
    gate: 'agent-qa-local-gate',
    mode,
    record: mode === 'clone' && !partial && !legMissing,
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
