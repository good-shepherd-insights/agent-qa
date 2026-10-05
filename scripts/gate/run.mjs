import { spawn as defaultSpawn, spawnSync as defaultSpawnSync } from 'node:child_process'
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
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import { REQUIRED_LEGS, evaluateGate, nodeTestFindings } from './evaluate.mjs'

const GATE_DIR = dirname(fileURLToPath(import.meta.url))
const DEFAULT_SOURCE = resolve(GATE_DIR, '..', '..')
const GATE_ENV = { CI: 'true', DO_NOT_TRACK: '1' }
const TURBO_LEGS = new Set(['turbo-build-typecheck', 'turbo-test'])
const NODE_TEST_DIR = 'scripts/__tests__'
const NODE_TEST_PIN = 'scripts/gate/inputs/node-tests.json'
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

export function buildGateLegs({ root, runDir, nodeTestFiles = [] } = {}) {
  return [
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

function defaultExec(command, args, { cwd } = {}) {
  const result = defaultSpawnSync(command, args, {
    cwd,
    env: gateEnv(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  })
  return {
    status: result.error ? 127 : result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.error ? result.error.message : result.stderr ?? '',
  }
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

export async function runGate(options, deps = {}) {
  const exec = deps.exec ?? defaultExec
  const run = deps.run ?? defaultRun
  const now = deps.now ?? (() => new Date())
  const pid = deps.pid ?? process.pid
  const output = deps.output ?? process.stdout
  const tmpdir = deps.tmpdir ?? defaultTmpdir
  const buildLegs = deps.buildGateLegs ?? buildGateLegs
  const say = line => output.write?.(`${line}\n`)

  const started = now()
  const partial = Array.isArray(options.only)
  const selected = partial ? options.only : REQUIRED_LEGS
  const inPlace = options.inPlace === true
  const mode = inPlace ? 'in-place' : 'clone'
  const source = options.source

  const wanted = options.sha ?? 'HEAD'
  const revParse = exec('git', ['-C', source, 'rev-parse', '--verify', `${wanted}^{commit}`])
  const sha = revParse.stdout.trim()
  if (revParse.status !== 0 || !/^[0-9a-f]{40}$/.test(sha)) {
    throw new Error(`cannot resolve ${wanted} in ${source}: ${revParse.stderr.trim()}`)
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

  const runDir = join(options.out, sha, runDirName({ mode, now: started, pid }))
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
  let ready = true
  if (!inPlace) {
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
  if (ready) {
    if (inPlace) {
      steps.push({ id: 'install', skipped: 'in-place', findings: [] })
    } else {
      const install = await runStep('install', ['pnpm', 'install', '--frozen-lockfile'], root)
      if (install.exitCode !== 0) failure(install, 'install-failed')
      steps.push(install)
    }

    const onDisk = listNodeTestFiles(root)
    const plan = buildLegs({ root, runDir, nodeTestFiles: onDisk }).filter(leg =>
      selected.includes(leg.id),
    )
    const turboSelected = plan.some(leg => TURBO_LEGS.has(leg.id))
    if (!turboSelected && plan.some(leg => leg.needsBuild)) {
      const build = await runStep('prepare-build', ['pnpm', 'build'], root)
      if (build.exitCode !== 0) failure(build, 'prepare-build-failed')
      steps.push(build)
    }

    for (const leg of plan) {
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

  const verdict = evaluateGate({ legs, steps, partial, selected, preflight: null })
  const legMissing = verdict.findings.some(f => f.rule === 'leg-missing')
  const removable = shouldRemoveClone({ exitCode: verdict.exitCode, keepClone: options.keepClone })
  const cloneRemoved = parent !== null && removable
  const finished = now()
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
    environment: null,
    machine: null,
    preflight: null,
    steps: steps.map(({ findings, ...step }) => step),
    legs,
    packages: [],
    findings: verdict.findings,
    exitCode: verdict.exitCode,
  }
  const summaryPath = join(runDir, 'summary.json')
  writeAtomic(summaryPath, `${JSON.stringify(summary, null, 2)}\n`)
  if (cloneRemoved) rmSync(parent, { recursive: true, force: true })

  for (const warning of warnings) say(`[gate] warning: ${warning}`)
  for (const f of verdict.findings) say(`[gate] ${f.rule} (${f.leg}): ${f.detail}`)
  say(`gate ${verdict.exitCode === 0 ? 'green' : 'red'}: ${verdict.findings.length} finding(s)`)
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
