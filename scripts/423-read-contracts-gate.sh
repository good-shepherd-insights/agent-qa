#!/usr/bin/env bash
# 423-read-contracts-gate.sh — the complete Phase 423 acceptance gate on a restored build (423-25).
#
# WHAT THIS PROVES. Phase 423 shipped evidence, usage, curation, feedback-read and rung contracts
# across schema, runner, model, knowledge, agent, dashboard, CLI and MCP. Each owning plan ran its
# own cells. This gate runs ALL of them together, in one order, on one tree, and refuses to print
# GATE-423-COMPLETE unless every required command actually ran and passed:
#
#   preflight          Node >= 24, pnpm 10.6.1, installed dependencies, a clean agent-qa tree. Read-only.
#   build-initial      forced workspace build, then dist freshness for every built package
#   census             every mandated closed-set family has counted runtime AND counted type cells
#   focused            every 423-* runtime and .test-d.ts file, per package, with --typecheck;
#                      the synthetic finalized-v3 row-budget measurements must print
#   typecheck          forced root typecheck
#   validate-*         validate:arch, validate:skills, validate:publish, lint:namespace
#   suite-noncli       every non-CLI package test task, forced (no cache replay)
#   suite-cli          the CLI partition; knowledge-tab-dom runs isolated below
#   mutation legs      inherited 412 issue-slot, 404 chip teardown, 405 run-detail/debris/failure-banner,
#                      every 423 gate and its selftest, and this gate's own census legs (normal and
#                      neutered), strictly serially; each is followed by a forced build, a freshness
#                      check, a clean-tree check and the demo/init fingerprint check
#   isolated           knowledge-tab-dom, mark-parity and rung-label-parity on the restored build
#   golden/catalog     397 and 398 writers in diff mode must report nothing to change
#   final-build        forced workspace build, freshness, clean tree
#
# A full-parallel red is classified only after an isolated rerun of its file (or package): a cell
# that passes alone is reported PARALLEL-ONLY, never silently dropped; a cell that fails alone fails
# the gate. Zero selected tests, a missing marker, a skipped required step, an unrestored byte or a
# failed final build is a nonzero exit. A change under the super-repository's demo/init during any
# step aborts the gate without cleanup, because that tree is the owner's uncommitted work.
#
# MODES
#   bash scripts/423-read-contracts-gate.sh                  # the complete gate (validate:423-read-contracts)
#   bash scripts/423-read-contracts-gate.sh --census         # counted closed-set census only (TAP)
#   bash scripts/423-read-contracts-gate.sh --census-mutation
#                                                            # this gate's census legs G01..G02 (423 engine)
#   bash scripts/423-read-contracts-gate.sh --reconciliation # the scoped 423 planning reconciliation checks
#   bash scripts/423-read-contracts-gate.sh --list           # the step inventory
#
# KNOBS
#   AGENT_QA_423_GATE_LOG_DIR                  where step logs and gate-record.json go (default: a temp dir)
#   AGENT_QA_423_GATE_CENSUS_MUTATION_SELFTEST neutered|fatal|SIGINT|SIGTERM|SIGHUP (engine knob)
#   AGENT_QA_423_GATE_CENSUS_MUTATION_LEG      G01|G02 (engine knob)
#
# No installs, fetches, provider calls, golden or catalog writes. Run from anywhere; it changes to
# the agent-qa root itself.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
exec node --input-type=commonjs - "$@" <<'NODE'
'use strict'
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')
const { spawn, spawnSync } = require('node:child_process')

const ROOT = process.cwd()
const argv = process.argv.slice(2)
const MODES = ['--full', '--census', '--census-mutation', '--reconciliation', '--list']
const mode = argv.length === 0 ? '--full' : argv[0]
if (argv.length > 1 || !MODES.includes(mode)) {
  console.error(`FATAL: unknown argument: ${argv.join(' ')}`)
  process.exit(2)
}
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
const git = (cwd, args) => spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 })
const SUPER = (() => {
  const result = git(ROOT, ['rev-parse', '--show-superproject-working-tree'])
  return result.status === 0 && result.stdout.trim() ? result.stdout.trim() : undefined
})()
const PHASE_DIR_NAME = '423-evidence-usage-and-feedback-read-contracts'

// ---- the closed-set census --------------------------------------------------------------------
const T = file => `src/__tests__/${file}`
const READ = T('423-read-contracts.test.ts'), READ_D = T('423-read-contracts.test-d.ts')
const USAGE = T('423-model-usage.test.ts'), USAGE_D = T('423-model-usage.test-d.ts')
const CUR = T('423-curation-contracts.test.ts'), CUR_D = T('423-curation-contracts.test-d.ts')
const STAGE = T('423-stage-contracts.test.ts'), STAGE_D = T('423-stage-contracts.test-d.ts')
const FEED = T('423-feedback-contracts.test.ts'), FEED_D = T('423-feedback-contracts.test-d.ts')
const RUNG = T('423-rung-contracts.test.ts'), RUNG_D = T('423-rung-contracts.test-d.ts')
const AUTH = T('423-usage-authority.test.ts'), AUTH_D = T('423-usage-authority.test-d.ts')
const BINDINGS = 'src/functions/__tests__/optional-dep-keys.test.ts'
const BINDINGS_D = 'src/functions/__tests__/port-split.test-d.ts'
const RECEIPT = T('423-curation-recovery.test.ts')

const CENSUS_RUNS = [
  { id: 'schema', pkg: 'packages/schema', typecheck: true,
    files: [READ, READ_D, USAGE, USAGE_D, CUR, CUR_D, STAGE, STAGE_D, FEED, FEED_D, RUNG, RUNG_D] },
  { id: 'model', pkg: 'packages/model', typecheck: true, files: [AUTH, AUTH_D] },
  { id: 'agent', pkg: 'packages/agent', typecheck: true, files: [BINDINGS, BINDINGS_D] },
  { id: 'knowledge-local', pkg: 'packages/knowledge-local', typecheck: false, files: [RECEIPT] },
]
const INHERITED_ARMS = 'C423-FEEDBACK-RESULTS-EXACT > pins the inherited quarantine classes and prior dispositions the preview arms carry'
const USAGE_ARMS = 'C423-MODEL-USAGE-ARMS-EXACT'
// One row per mandated family. `runtime`/`type` name the file and the cell token that must pass there.
const FAMILIES = [
  { id: 'evidence-kinds', run: 'schema', runtime: [READ, 'C423-KINDS-EXACT'], type: [READ_D, 'C423-KINDS-EXACT'] },
  { id: 'evidence-absence', run: 'schema', runtime: [READ, 'C423-ABSENCE-EXACT'], type: [READ_D, 'C423-ABSENCE-EXACT'] },
  { id: 'evidence-refs', run: 'schema', runtime: [READ, 'C423-REFS-EXACT'], type: [READ_D, 'C423-REFS-EXACT'] },
  { id: 'evidence-presence', run: 'schema', runtime: [READ, 'C423-PRESENCE-EXACT'], type: [READ_D, 'C423-PRESENCE-EXACT'] },
  { id: 'evidence-variables', run: 'schema', runtime: [READ, 'C423-VARIABLES'], type: [READ_D, 'C423-VARIABLES'] },
  { id: 'network-credential-headers', run: 'schema', runtime: [READ, 'C423-HEADERS-EXACT'], type: [READ_D, 'C423-HEADERS-EXACT'] },
  { id: 'network-body-content-types', run: 'schema', runtime: [READ, 'C423-CONTENT-TYPES-EXACT'], type: [READ_D, 'C423-CONTENT-TYPES-EXACT'] },
  { id: 'usage-roles', run: 'schema', runtime: [USAGE, 'C423-MODEL-ROLES-EXACT'], type: [USAGE_D, 'C423-MODEL-ROLES-EXACT'] },
  { id: 'usage-arms', run: 'schema', type: [USAGE_D, USAGE_ARMS] },
  { id: 'usage-observation', run: 'model', runtime: [AUTH, 'C423-OBSERVATION-EXACT'], type: [AUTH_D, 'C423-OBSERVATION-EXACT'] },
  { id: 'curation-buckets', run: 'schema', runtime: [CUR, 'C423-BUCKETS-EXACT'], type: [CUR_D, 'C423-BUCKETS-EXACT'] },
  { id: 'curation-snapshot-arms', run: 'schema', runtime: [CUR, 'SNAPSHOT-DISCRIMINANTS'], type: [CUR_D, 'SNAPSHOT-COUNTS-EXACT'] },
  { id: 'curation-stages', run: 'schema', runtime: [STAGE, 'C423-STAGES-EXACT'], type: [STAGE_D, 'C423-STAGES-EXACT'] },
  { id: 'curation-receipt', run: 'knowledge-local', runtime: [RECEIPT, 'EFFECT-RECEIPT-ROUNDTRIP'] },
  { id: 'feedback-results', run: 'schema', runtime: [FEED, 'C423-FEEDBACK-RESULTS-EXACT'], type: [FEED_D, 'C423-FEEDBACK-RESULTS-EXACT'] },
  { id: 'feedback-inherited-arms', run: 'schema', runtime: [FEED, INHERITED_ARMS] },
  { id: 'feedback-bindings', run: 'agent', runtime: [BINDINGS, 'C423-FEEDBACK-BINDINGS-EXACT'], type: [BINDINGS_D, 'C423-FEEDBACK-BINDINGS-EXACT'] },
  { id: 'rung-reasons', run: 'schema', runtime: [RUNG, 'C423-RUNG-REASONS-EXACT'], type: [RUNG_D, 'C423-RUNG-REASONS-EXACT'] },
]

function tokenMatches(token, cell) {
  const describes = cell.ancestors.filter(name => !/\.test(?:-d)?\.tsx?$/.test(name))
  const segments = [...describes, cell.title]
  if (token.includes(' > ')) return segments.join(' > ') === token || segments.join(' > ').startsWith(`${token} `)
  return segments.some(segment => segment === token || segment.startsWith(`${token} `) || segment.startsWith(`${token}:`))
}

// ---- process helpers --------------------------------------------------------------------------
let logDir
function ensureLogDir() {
  if (logDir === undefined) {
    logDir = process.env.AGENT_QA_423_GATE_LOG_DIR
      ? path.resolve(process.env.AGENT_QA_423_GATE_LOG_DIR)
      : fs.mkdtempSync(path.join(os.tmpdir(), 'agent-qa-423-gate-'))
    fs.mkdirSync(logDir, { recursive: true })
  }
  return logDir
}
let activeChild
function killActive(signal) {
  if (activeChild?.pid) { try { process.kill(-activeChild.pid, signal) } catch {} }
}
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    killActive(signal)
    console.error(`FATAL: interrupted by ${signal}; a running mutation child restores its own subjects`)
    process.exit(1)
  })
}

function spawnLogged(label, file, args, { cwd = ROOT, env = {}, timeoutMs = 90 * 60_000 } = {}) {
  const logPath = path.join(ensureLogDir(), `${label}.log`)
  const fd = fs.openSync(logPath, 'w')
  const started = Date.now()
  return new Promise((resolve, reject) => {
    let timedOut = false
    activeChild = spawn(file, args, {
      cwd, detached: true, stdio: ['ignore', fd, fd],
      env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0', ...env },
    })
    const timer = setTimeout(() => { timedOut = true; killActive('SIGKILL') }, timeoutMs)
    activeChild.on('error', error => { clearTimeout(timer); fs.closeSync(fd); reject(error) })
    activeChild.on('exit', (code, signal) => {
      clearTimeout(timer)
      activeChild = undefined
      fs.closeSync(fd)
      const text = fs.readFileSync(logPath, 'utf8').replace(/\x1b\[[0-9;]*m/g, '')
      resolve({ exit: timedOut ? 'timeout' : (code ?? `signal:${signal}`), secs: Math.round((Date.now() - started) / 100) / 10, logPath, text })
    })
  })
}
const shell = (label, command, options) => spawnLogged(label, 'bash', ['-c', command], options)

async function vitest(label, pkg, files, { typecheck, extra = [], env } = {}) {
  const report = path.join(ensureLogDir(), `${label}.report.json`)
  fs.rmSync(report, { force: true })
  const args = [path.join(ROOT, 'node_modules/vitest/vitest.mjs'), 'run', ...files,
    ...(typecheck === undefined ? [] : [typecheck ? '--typecheck' : '--typecheck.enabled=false']),
    '--reporter=verbose', '--reporter=json', `--outputFile.json=${report}`, ...extra]
  const result = await spawnLogged(label, process.execPath, args, { cwd: path.join(ROOT, pkg), env })
  let json
  try { json = JSON.parse(fs.readFileSync(report, 'utf8')) } catch {}
  const cells = []
  const loadFailures = []
  for (const file of json?.testResults ?? []) {
    const relative = path.relative(path.join(ROOT, pkg), file.name)
    if ((file.assertionResults ?? []).length === 0 || (file.message ?? '') !== '') {
      loadFailures.push(`${relative}: ${(file.message || 'no cells').split('\n')[0]}`)
    }
    for (const assertion of file.assertionResults ?? []) {
      cells.push({ file: relative, title: assertion.title, ancestors: assertion.ancestorTitles ?? [], status: assertion.status })
    }
  }
  const passed = cells.filter(cell => cell.status === 'passed')
  return {
    ...result, reported: json !== undefined, cells, loadFailures,
    failed: cells.filter(cell => cell.status === 'failed'),
    runtimePassed: passed.filter(cell => !cell.file.endsWith('.test-d.ts')).length,
    typePassed: passed.filter(cell => cell.file.endsWith('.test-d.ts')).length,
  }
}
const cellId = cell => [cell.file, ...cell.ancestors.filter(name => !/\.test(?:-d)?\.tsx?$/.test(name)), cell.title].join(' > ')

// ---- census ---------------------------------------------------------------------------------
async function census(prefix = 'census') {
  const runs = {}
  for (const run of CENSUS_RUNS) runs[run.id] = await vitest(`${prefix}-${run.id}`, run.pkg, run.files, { typecheck: run.typecheck, extra: ['--maxWorkers=1'] })
  const lines = []
  let runtime = 0, type = 0
  for (const run of CENSUS_RUNS) {
    const result = runs[run.id]
    runtime += result.runtimePassed
    type += result.typePassed
    const ok = result.exit === 0 && result.reported && result.loadFailures.length === 0 && result.failed.length === 0 && result.cells.length > 0
    lines.push({ ok, name: `CENSUS run ${run.id}: exit=${result.exit} cells=${result.cells.length} runtime=${result.runtimePassed} type=${result.typePassed} failed=${result.failed.length}${result.loadFailures.length ? ` load=${result.loadFailures.join(' | ')}` : ''}` })
  }
  for (const family of FAMILIES) {
    const result = runs[family.run]
    const count = ([file, token]) => result.cells.filter(cell => cell.file === file && cell.status === 'passed' && tokenMatches(token, cell)).length
    const r = family.runtime ? count(family.runtime) : undefined
    const t = family.type ? count(family.type) : undefined
    const ok = (r === undefined || r > 0) && (t === undefined || t > 0)
    const need = [family.runtime ? 'runtime>=1' : '', family.type ? 'type>=1' : ''].filter(Boolean).join(' ')
    lines.push({ ok, name: `CENSUS ${family.id}: runtime=${r ?? '-'} type=${t ?? '-'} (required ${need})` })
  }
  const tap = ['TAP version 13', `1..${lines.length}`,
    ...lines.map((line, index) => `${line.ok ? 'ok' : 'not ok'} ${index + 1} - ${line.name}`),
    `# tests ${lines.length}`, `# pass ${lines.filter(line => line.ok).length}`, `# fail ${lines.filter(line => !line.ok).length}`]
  const failed = lines.filter(line => !line.ok).length
  const ok = failed === 0 && runtime > 0 && type > 0
  return { ok, tap: tap.join('\n'), runtime, type, families: FAMILIES.length, failed,
    summary: `CENSUS-423 families=${FAMILIES.length} runtime=${runtime} type=${type} failed=${failed}` }
}

// ---- this gate's own census legs (shared 423 engine) -------------------------------------------
function censusMutation() {
  const { runGate, cell } = require(path.join(ROOT, 'scripts/423-mutation-engine.cjs'))
  const MODEL_USAGE = 'packages/schema/src/run/model-usage.ts'
  const FEEDBACK = 'packages/schema/src/functions/feedback.ts'
  const instruments = {
    'usage-walls': { pkg: 'packages/schema', files: [USAGE, USAGE_D], typecheck: true, count: 10 },
    'feedback-runtime': { pkg: 'packages/schema', files: [FEED], typecheck: false, count: 6 },
  }
  const u = (file, name) => cell('usage-walls', file, name)
  const f = name => cell('feedback-runtime', FEED, `C423-FEEDBACK-RESULTS-EXACT > ${name}`)
  const legs = [
    {
      subject: MODEL_USAGE, instrument: 'usage-walls', claim: USAGE_ARMS,
      operation: 'widen the persisted call counters with a retried arm',
      edits: [{ from: '  calls: z.object({ started: count, succeeded: count, failed: count }).strict(),\n',
        to: '  calls: z.object({ started: count, succeeded: count, failed: count, retried: count.optional() }).strict(),\n' }],
      reds: [u(USAGE_D, USAGE_ARMS)],
      allowed: [],
      greens: [u(USAGE_D, 'C423-MODEL-ROLES-EXACT'), u(USAGE, 'C423-MODEL-ROLES-EXACT'),
        u(USAGE_D, 'MODEL-USAGE-OPTIONAL: bus and persisted step share the schema-owned optional contracts')],
    },
    {
      subject: FEEDBACK, instrument: 'feedback-runtime', claim: 'C423-FEEDBACK-RESULTS-EXACT',
      operation: 'widen the quarantined preview arm with a fourth class',
      edits: [{ from: '    class: z.enum(MARK_QUARANTINE_CLASSES),\n  }).strict().superRefine(refineLatestBasis),\n',
        to: "    class: z.enum([...MARK_QUARANTINE_CLASSES, 'product-bug']),\n  }).strict().superRefine(refineLatestBasis),\n" }],
      reds: [f('pins the inherited quarantine classes and prior dispositions the preview arms carry')],
      allowed: [],
      greens: [f('pins the preview outcome arms: runtime list, schema arms and parser'),
        f('pins the preview refusals as exactly runs.mark refusal arms, and keeps the runs.mark and MARKS sets')],
    },
  ]
  runGate({
    slug: '423-read-contracts-gate-census', envPrefix: 'AGENT_QA_423_GATE_CENSUS_MUTATION', idPrefix: 'G',
    instruments, legs, expectedLegs: 2, banner: 'GATE_CENSUS_MUTATION_OK',
  })
}

// ---- tree guards --------------------------------------------------------------------------------
function demoInitFingerprint() {
  if (SUPER === undefined || !fs.existsSync(path.join(SUPER, 'demo/init'))) return 'no-super-demo-init'
  const diff = git(SUPER, ['diff', '--binary', 'HEAD', '--', 'demo/init'])
  const untracked = git(SUPER, ['ls-files', '--others', '--exclude-standard', '-z', '--', 'demo/init'])
  if (diff.status !== 0 || untracked.status !== 0) return `unreadable:${diff.stderr}${untracked.stderr}`
  const hash = crypto.createHash('sha256').update(diff.stdout)
  for (const file of untracked.stdout.split('\0').filter(Boolean).sort()) {
    hash.update(file)
    try { hash.update(sha(fs.readFileSync(path.join(SUPER, file)))) } catch { hash.update('unreadable') }
  }
  return hash.digest('hex')
}
function agentQaDirty() {
  return git(ROOT, ['status', '--porcelain']).stdout.trim()
}
function newestSource(dir) {
  let newest
  const walk = current => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) { walk(full); continue }
      if (!entry.isFile() || !/\.(?:ts|tsx|mts|cts|js|mjs|cjs|json|css)$/.test(entry.name)) continue
      if (/\.test(?:-d)?\.[cm]?tsx?$/.test(entry.name)) continue
      const { mtimeMs } = fs.statSync(full)
      if (newest === undefined || mtimeMs > newest.mtimeMs) newest = { full, mtimeMs }
    }
  }
  walk(dir)
  return newest
}
function freshness() {
  const stale = [], missing = []
  let checked = 0
  for (const name of fs.readdirSync(path.join(ROOT, 'packages'))) {
    const pkg = path.join(ROOT, 'packages', name)
    if (!fs.existsSync(path.join(pkg, 'dist')) || !fs.existsSync(path.join(pkg, 'src'))) continue
    const artifact = path.join(pkg, 'dist', name === 'cli' ? 'cli.js' : name === 'dashboard-ui' ? 'index.html' : 'index.js')
    if (!fs.existsSync(artifact)) { missing.push(path.relative(ROOT, artifact)); continue }
    checked++
    const newest = newestSource(path.join(pkg, 'src'))
    if (newest && newest.mtimeMs > fs.statSync(artifact).mtimeMs) stale.push(`${path.relative(ROOT, newest.full)} is newer than ${path.relative(ROOT, artifact)}`)
  }
  return { checked, stale, missing }
}

// ---- the complete gate --------------------------------------------------------------------------
const MUTATIONS = [
  ['mut-issue-slot', 'pnpm run validate:issue-slot-mutation', /^PASS — /m],
  ['mut-chip-teardown', 'bash scripts/404-chip-teardown-mutation.sh', /^PASS — /m],
  ['mut-run-detail', 'pnpm run validate:run-detail-mutation', /^PASS — /m],
  ['mut-debris', 'pnpm run validate:debris-mutation', /^PASS — /m],
  ['mut-failure-banner', 'pnpm run validate:failure-banner-mutation', /^PASS — /m],
  ...['evidence', 'usage', 'curation', 'feedback-read', 'rung', 'read-sinks'].flatMap(name => {
    const banner = `${name.toUpperCase().replace(/-/g, '_')}_MUTATION_OK`
    return [
      [`mut-423-${name}`, `pnpm run validate:423-${name}-mutation`, new RegExp(`^${banner} legs=(\\d+) named-red=\\1 byte-identical-restoration=\\d+$`, 'm')],
      [`mut-423-${name}-selftest`, `pnpm run validate:423-${name}-mutation-selftest`, new RegExp(`^${banner}_SELFTEST_OK legs=(\\d+) subjects=\\d+$`, 'm')],
    ]
  }),
  ['mut-gate-census', 'bash scripts/423-read-contracts-gate.sh --census-mutation', /^GATE_CENSUS_MUTATION_OK legs=(2) named-red=2 byte-identical-restoration=\d+$/m],
]
const STEP_IDS = ['preflight', 'build-initial', 'census', 'focused', 'typecheck', 'validate-arch', 'validate-skills',
  'validate-publish', 'lint-namespace', 'suite-noncli', 'suite-cli',
  ...MUTATIONS.map(([id]) => id), 'mut-gate-census-neutered-G01', 'mut-gate-census-neutered-G02',
  'isolated-knowledge-tab-dom', 'isolated-mark-rung-parity', 'golden-diff', 'catalog-diff', 'final-build']

async function full() {
  ensureLogDir()
  console.log(`GATE-423 logs: ${logDir}`)
  const results = []
  const totals = { runtime: 0, type: 0, mutationLegs: 0, parallelOnly: [] }
  let abort
  const demoBefore = demoInitFingerprint()
  const record = (id, status, detail) => {
    results.push({ id, status, detail })
    console.log(`STEP ${id} ${status}${detail ? ` — ${detail}` : ''}`)
    fs.writeFileSync(path.join(logDir, 'gate-record.json'), JSON.stringify({ root: ROOT, results, totals }, null, 2) + '\n')
  }
  const guard = id => {
    const demo = demoInitFingerprint()
    if (demo !== demoBefore) { abort = `${id}: the super-repository demo/init tree changed during this step; stopping without cleanup`; return false }
    return true
  }
  const buildCheck = async id => {
    const build = await shell(id, 'pnpm turbo run build --force')
    const tasks = build.text.match(/Tasks:\s+(\d+) successful, (\d+) total/)
    const fresh = freshness()
    const ok = build.exit === 0 && tasks && tasks[1] === tasks[2] && fresh.stale.length === 0 && fresh.missing.length === 0 && fresh.checked > 0
    return { ok, detail: `exit=${build.exit} tasks=${tasks ? `${tasks[1]}/${tasks[2]}` : 'unparsed'} fresh=${fresh.checked - fresh.stale.length}/${fresh.checked}${fresh.stale.length ? ` stale=${fresh.stale.join(' | ')}` : ''}${fresh.missing.length ? ` missing=${fresh.missing.join(' | ')}` : ''} ${build.secs}s` }
  }

  // preflight (read-only)
  {
    const problems = []
    if (Number(process.versions.node.split('.')[0]) < 24) problems.push(`node ${process.versions.node} < 24`)
    const pnpm = spawnSync('pnpm', ['--version'], { cwd: ROOT, encoding: 'utf8' })
    if (pnpm.status !== 0 || pnpm.stdout.trim() !== '10.6.1') problems.push(`pnpm --version: ${(pnpm.stdout || pnpm.stderr || '').trim() || `exit ${pnpm.status}`} (need 10.6.1)`)
    for (const required of ['node_modules/.pnpm', 'node_modules/vitest/vitest.mjs', 'node_modules/.bin/turbo']) {
      if (!fs.existsSync(path.join(ROOT, required))) problems.push(`missing installed dependency: ${required}`)
    }
    const dirty = agentQaDirty()
    if (dirty) problems.push(`agent-qa working tree is not clean:\n${dirty}`)
    if (demoBefore.startsWith('unreadable')) problems.push(`demo/init fingerprint unreadable: ${demoBefore}`)
    const head = git(ROOT, ['rev-parse', 'HEAD']).stdout.trim()
    if (problems.length > 0) {
      record('preflight', 'BLOCKED', problems.join('; '))
      console.log('GATE-423-INCOMPLETE preflight blocked; nothing else ran')
      process.exit(1)
    }
    record('preflight', 'PASS', `node ${process.versions.node} pnpm 10.6.1 head=${head} demo-init=${demoBefore.slice(0, 12)}`)
  }

  const steps = []
  steps.push(['build-initial', async () => buildCheck('build-initial')])
  steps.push(['census', async () => {
    const result = await census('census')
    fs.writeFileSync(path.join(logDir, 'census.tap'), result.tap + '\n')
    console.log(result.tap)
    return { ok: result.ok, detail: result.summary }
  }])
  steps.push(['focused', async () => {
    const byPackage = new Map()
    const visit = dir => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === 'dist') continue
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) visit(full)
        else if (/^423-.*\.(?:test\.tsx?|test-d\.ts)$/.test(entry.name) && full.includes(`${path.sep}__tests__${path.sep}`)) {
          const pkg = path.relative(ROOT, full).split(path.sep).slice(0, 2).join('/')
          byPackage.set(pkg, [...(byPackage.get(pkg) ?? []), path.relative(path.join(ROOT, pkg), full)])
        }
      }
    }
    visit(path.join(ROOT, 'packages'))
    const parts = []
    let ok = byPackage.size > 0
    for (const [pkg, files] of [...byPackage].sort()) {
      files.sort()
      const typecheck = files.some(file => file.endsWith('.test-d.ts'))
      const run = await vitest(`focused-${pkg.split('/')[1]}`, pkg, files, { typecheck, extra: ['--maxWorkers=1', '--silent=false'] })
      totals.runtime += run.runtimePassed
      totals.type += run.typePassed
      const pass = run.exit === 0 && run.reported && run.failed.length === 0 && run.loadFailures.length === 0
        && run.cells.length > 0 && new Set(run.cells.map(cell => cell.file)).size === files.length
      let extra = ''
      if (pkg === 'packages/dashboard-server') {
        const cells = ['ROW-BUDGET-LOGICAL', 'ROW-BUDGET-PAGES', 'ROW-BUDGET-PAYLOAD', 'ROW-BUDGET-NETWORK-OFF-ROW']
        const missing = cells.filter(name => !run.cells.some(cell => cell.status === 'passed' && cell.title.startsWith(`${name}:`))
          || !new RegExp(`^${name} \\{"label":"SYNTHETIC`, 'm').test(run.text))
        if (missing.length > 0) { ok = false; extra = ` row-budget-missing=${missing.join(',')}` }
        else {
          const lines = cells.map(name => run.text.match(new RegExp(`^${name} (\\{.*\\})$`, 'm'))[1])
          fs.writeFileSync(path.join(logDir, 'row-budget-measurements.jsonl'), lines.join('\n') + '\n')
          extra = ' row-budget=4/4'
        }
      }
      if (!pass) ok = false
      parts.push(`${pkg.split('/')[1]}:${pass ? 'pass' : 'FAIL'} files=${files.length} runtime=${run.runtimePassed} type=${run.typePassed} failed=${run.failed.length}${run.loadFailures.length ? ` load=${run.loadFailures.length}` : ''}${extra}`)
    }
    return { ok, detail: parts.join('; ') }
  }])
  steps.push(['typecheck', async () => {
    const run = await shell('typecheck', 'pnpm exec turbo run typecheck --force')
    const tasks = run.text.match(/Tasks:\s+(\d+) successful, (\d+) total/)
    return { ok: run.exit === 0 && Boolean(tasks) && tasks[1] === tasks[2], detail: `exit=${run.exit} tasks=${tasks ? `${tasks[1]}/${tasks[2]}` : 'unparsed'} ${run.secs}s` }
  }])
  steps.push(['validate-arch', async () => {
    const run = await shell('validate-arch', 'pnpm run validate:arch')
    const tests = run.text.match(/Tests\s+(\d+) passed \((\d+)\)/)
    return { ok: run.exit === 0 && Boolean(tests) && tests[1] === tests[2] && Number(tests[1]) > 0, detail: `exit=${run.exit} tests=${tests ? `${tests[1]}/${tests[2]}` : 'unparsed'} ${run.secs}s` }
  }])
  for (const [id, script] of [['validate-skills', 'validate:skills'], ['validate-publish', 'validate:publish'], ['lint-namespace', 'lint:namespace']]) {
    steps.push([id, async () => {
      const run = await shell(id, `pnpm run ${script}`)
      return { ok: run.exit === 0, detail: `exit=${run.exit} ${run.secs}s` }
    }])
  }
  steps.push(['suite-noncli', async () => {
    const run = await shell('suite-noncli', "pnpm exec turbo run test --force --concurrency=1 --continue=dependencies-successful --filter='!agent-qa'")
    const tasks = run.text.match(/Tasks:\s+(\d+) successful, (\d+) total/)
    let passed = 0
    for (const match of run.text.matchAll(/:test:\s+Tests\s+(?:\d+ failed \| )?(\d+) passed/g)) passed += Number(match[1])
    totals.runtime += passed
    if (run.exit === 0 && tasks && tasks[1] === tasks[2]) return { ok: true, detail: `tasks=${tasks[1]}/${tasks[2]} tests-passed=${passed} ${run.secs}s` }
    const failedTasks = [...new Set([...run.text.matchAll(/^\s*Failed:\s+(.+)$/gm)].flatMap(match => match[1].split(',').map(item => item.trim())).filter(Boolean))]
    const reruns = []
    let ok = failedTasks.length > 0
    for (const task of failedTasks) {
      const pkg = task.replace(/#test$/, '')
      if (!task.endsWith('#test')) { ok = false; reruns.push(`${task}: not a test task`); continue }
      const again = await shell(`suite-noncli-isolated-${pkg.replace(/[^a-z0-9]+/gi, '-')}`, `pnpm --filter '${pkg}' exec vitest run --maxWorkers=1`)
      if (again.exit === 0) { totals.parallelOnly.push(`${task} (package rerun alone passed)`); reruns.push(`${task}: PARALLEL-ONLY`) }
      else { ok = false; reruns.push(`${task}: FAILS ALONE exit=${again.exit}`) }
    }
    return { ok, detail: `exit=${run.exit} tasks=${tasks ? `${tasks[1]}/${tasks[2]}` : 'unparsed'} ${reruns.join('; ') || 'no failed task parsed'} ${run.secs}s` }
  }])
  steps.push(['suite-cli', async () => {
    const run = await vitest('suite-cli', 'packages/cli', [], { extra: ['--exclude', 'src/__tests__/conformance/knowledge-tab-dom.test.ts'] })
    totals.runtime += run.runtimePassed
    totals.type += run.typePassed
    const base = `exit=${run.exit} cells=${run.cells.length} runtime=${run.runtimePassed} type=${run.typePassed} failed=${run.failed.length} ${run.secs}s`
    if (!run.reported || run.cells.length === 0) return { ok: false, detail: `${base} no counted report` }
    if (run.exit === 0 && run.failed.length === 0 && run.loadFailures.length === 0) return { ok: true, detail: base }
    if (run.loadFailures.length > 0) return { ok: false, detail: `${base} load=${run.loadFailures.join(' | ')}` }
    const classified = []
    let ok = run.failed.length > 0
    for (const file of [...new Set(run.failed.map(cell => cell.file))]) {
      const again = await vitest(`suite-cli-isolated-${file.replace(/[^a-z0-9]+/gi, '-')}`, 'packages/cli', [file], { extra: ['--maxWorkers=1'] })
      for (const failure of run.failed.filter(cell => cell.file === file)) {
        const alone = again.cells.find(cell => cellId(cell) === cellId(failure))
        if (alone?.status === 'passed') { totals.parallelOnly.push(cellId(failure)); classified.push(`PARALLEL-ONLY ${cellId(failure)}`) }
        else { ok = false; classified.push(`FAILS-ALONE ${cellId(failure)} (${alone?.status ?? 'not selected'})`) }
      }
    }
    return { ok, detail: `${base} ${classified.join(' | ')}` }
  }])
  for (const [id, command, marker] of MUTATIONS) {
    steps.push([id, async () => {
      const run = await shell(id, command)
      const match = run.text.match(marker)
      if (match?.[1]) totals.mutationLegs += Number(match[1]) * (id.endsWith('-selftest') ? 0 : 1)
      if (match && !match[1]) totals.mutationLegs += 1
      return { ok: run.exit === 0 && Boolean(match), detail: `exit=${run.exit} marker=${match ? match[0].slice(0, 160) : 'MISSING'} ${run.secs}s`, mutation: true }
    }])
  }
  for (const leg of ['G01', 'G02']) {
    steps.push([`mut-gate-census-neutered-${leg}`, async () => {
      const run = await shell(`mut-gate-census-neutered-${leg}`, 'bash scripts/423-read-contracts-gate.sh --census-mutation',
        { env: { AGENT_QA_423_GATE_CENSUS_MUTATION_SELFTEST: 'neutered', AGENT_QA_423_GATE_CENSUS_MUTATION_LEG: leg } })
      const fatal = run.text.includes(`FATAL: ${leg}: suite stayed green`)
      return { ok: run.exit === 1 && fatal && !run.text.includes('GATE_CENSUS_MUTATION_OK'), detail: `exit=${run.exit} neutered-fatal=${fatal} ${run.secs}s`, mutation: true }
    }])
  }
  steps.push(['isolated-knowledge-tab-dom', async () => {
    const run = await vitest('isolated-knowledge-tab-dom', 'packages/cli', ['src/__tests__/conformance/knowledge-tab-dom.test.ts'], { extra: ['--maxWorkers=1'] })
    totals.runtime += run.runtimePassed
    return { ok: run.exit === 0 && run.reported && run.cells.length > 0 && run.failed.length === 0 && run.loadFailures.length === 0, detail: `exit=${run.exit} passed=${run.runtimePassed}/${run.cells.length} ${run.secs}s` }
  }])
  steps.push(['isolated-mark-rung-parity', async () => {
    const files = ['src/__tests__/mark-parity.test.ts', 'src/__tests__/rung-label-parity.test.ts']
    const run = await vitest('isolated-mark-rung-parity', 'packages/cli', files, { extra: ['--maxWorkers=1'] })
    totals.runtime += run.runtimePassed
    const both = new Set(run.cells.map(cell => cell.file)).size === 2
    return { ok: run.exit === 0 && both && run.failed.length === 0 && run.loadFailures.length === 0, detail: `exit=${run.exit} passed=${run.runtimePassed}/${run.cells.length} files=${both ? 2 : 'MISSING'} ${run.secs}s` }
  }])
  steps.push(['golden-diff', async () => {
    const run = await shell('golden-diff', 'VITEST_MAX_WORKERS=1 bash scripts/397-regen-golden.sh')
    const same = run.text.includes('the committed ledger already matches the tree — nothing to change')
    return { ok: run.exit === 0 && same, detail: `exit=${run.exit} nothing-to-change=${same} ${run.secs}s` }
  }])
  steps.push(['catalog-diff', async () => {
    const run = await shell('catalog-diff', 'VITEST_MAX_WORKERS=1 bash scripts/398-regen-catalog.sh')
    const same = run.text.includes('the committed catalog already matches the tree — nothing to change')
    return { ok: run.exit === 0 && same, detail: `exit=${run.exit} nothing-to-change=${same} ${run.secs}s` }
  }])

  for (const [id, run] of steps) {
    let outcome
    try { outcome = await run() } catch (error) { outcome = { ok: false, detail: `threw: ${error.message}` } }
    record(id, outcome.ok ? 'PASS' : 'FAIL', outcome.detail)
    if (outcome.mutation) {
      const build = await buildCheck(`${id}-rebuild`)
      const dirty = agentQaDirty()
      record(`${id}-rebuild`, build.ok && !dirty ? 'PASS' : 'FAIL', `${build.detail}${dirty ? ` UNRESTORED: ${dirty.split('\n').join(', ')}` : ' tree-clean'}`)
      if (dirty) abort = `${id}: the agent-qa tree is not clean after the mutation step; stopping`
    }
    if (!guard(id) || abort) break
  }
  if (abort === undefined) {
    const build = await buildCheck('final-build')
    const dirty = agentQaDirty()
    record('final-build', build.ok && !dirty ? 'PASS' : 'FAIL', `${build.detail}${dirty ? ` DIRTY: ${dirty.split('\n').join(', ')}` : ' tree-clean'}`)
    guard('final-build')
  }

  const ran = new Set(results.map(result => result.id))
  const skipped = STEP_IDS.filter(id => !ran.has(id))
  const failed = results.filter(result => result.status !== 'PASS').map(result => result.id)
  console.log('\n==== GATE-423 SUMMARY ====')
  for (const result of results) console.log(`${result.status.padEnd(7)} ${result.id}`)
  if (totals.parallelOnly.length > 0) console.log(`PARALLEL-ONLY (classified after isolated rerun): ${totals.parallelOnly.join(' | ')}`)
  const complete = abort === undefined && failed.length === 0 && skipped.length === 0 && totals.runtime > 0 && totals.type > 0 && totals.mutationLegs > 0
  fs.writeFileSync(path.join(logDir, 'gate-record.json'), JSON.stringify({ root: ROOT, results, totals, skipped, failed, abort, complete }, null, 2) + '\n')
  if (complete) {
    console.log(`GATE-423-COMPLETE steps=${results.length} runtime-tests=${totals.runtime} type-tests=${totals.type} mutation-legs=${totals.mutationLegs} parallel-only=${totals.parallelOnly.length} logs=${logDir}`)
    process.exit(0)
  }
  console.log(`GATE-423-INCOMPLETE failed=${failed.join(',') || '-'} skipped=${skipped.join(',') || '-'}${abort ? ` abort=${abort}` : ''} logs=${logDir}`)
  process.exit(1)
}

// ---- reconciliation --------------------------------------------------------------------------
function reconciliation() {
  const problems = []
  if (SUPER === undefined) {
    console.error('FATAL: --reconciliation needs the super-repository planning tree')
    process.exit(1)
  }
  const phaseDir = path.join(SUPER, '.planning/phases', PHASE_DIR_NAME)
  const read = file => {
    try { return fs.readFileSync(file, 'utf8') } catch { problems.push(`missing file: ${path.relative(SUPER, file)}`); return '' }
  }
  const block = (label, text) => {
    const match = text.match(/<!-- RECONCILIATION-423:start -->([\s\S]*?)<!-- RECONCILIATION-423:end -->/)
    if (!match) { problems.push(`${label}: no RECONCILIATION-423 block`); return '' }
    if (!/\b2026-\d\d-\d\d\b/.test(match[1])) problems.push(`${label}: the block carries no date`)
    return match[1]
  }
  const testSources = (() => {
    const found = []
    const visit = dir => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (['node_modules', 'dist', '.turbo'].includes(entry.name)) continue
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) visit(full)
        else if (/\.test(?:-d)?\.tsx?$/.test(entry.name)) found.push(full)
      }
    }
    visit(path.join(ROOT, 'packages'))
    return found
  })()
  let sourceText
  const inSources = token => {
    sourceText ??= testSources.map(file => fs.readFileSync(file, 'utf8')).join('\n')
    return sourceText.includes(token)
  }
  // An evidence line cites at least one existing owning SUMMARY and one named cell found in a cited
  // SUMMARY or a test source.
  const evidence = (label, line) => {
    const summaries = [...line.matchAll(/\b(423-\d\d)-SUMMARY\.md\b/g)].map(match => `${match[1]}-SUMMARY.md`)
    const cells = [...line.matchAll(/`([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+)`/g)].map(match => match[1])
    if (summaries.length === 0) { problems.push(`${label}: cites no owning 423 SUMMARY`); return false }
    const texts = []
    for (const summary of summaries) {
      const file = path.join(phaseDir, summary)
      if (!fs.existsSync(file)) problems.push(`${label}: cited ${summary} does not exist`)
      else texts.push(fs.readFileSync(file, 'utf8'))
    }
    if (cells.length === 0) { problems.push(`${label}: names no acceptance cell`); return false }
    const resolved = cells.filter(token => texts.some(text => text.includes(token)) || inSources(token))
    if (resolved.length === 0) { problems.push(`${label}: none of ${cells.join(', ')} resolves to a cited SUMMARY or a test source`); return false }
    return true
  }
  const itemsOf = text => text.split(/\n(?=\s*(?:\d+\.|[-*]) )/).map(item => item.trim()).filter(Boolean)
  const DECISIONS = ['D-02', 'D-03', 'D-08', 'D-13', 'D-14', 'D-15', 'D-22']
  let decisions = 0
  for (const [label, file] of [['REQUIREMENTS.md', path.join(SUPER, '.planning/REQUIREMENTS.md')], ['PROJECT.md', path.join(SUPER, '.planning/PROJECT.md')]]) {
    const text = block(label, read(file))
    if (!text) continue
    const items = itemsOf(text)
    for (const id of DECISIONS) {
      const owning = items.filter(item => new RegExp(`\\b${id}\\b`).test(item))
      if (owning.length === 0) { problems.push(`${label}: ${id} is not reconciled`); continue }
      if (owning.every(item => evidence(`${label} ${id}`, item))) decisions++
    }
    for (const debt of ['D-23', 'D-25']) {
      if (!items.some(item => new RegExp(`\\b${debt}\\b`).test(item) && /\b(open|debt|deferred|not closed)\b/i.test(item))) {
        problems.push(`${label}: ${debt} is not preserved as open debt`)
      }
    }
    for (const owner of ['424', '425', '426', '427', '430', '431']) {
      if (!new RegExp(`\\b${owner}\\b`).test(text)) problems.push(`${label}: later ownership of Phase ${owner} is not named`)
    }
  }
  // WINDOWS: the prose block sits below the ledger's JSON (the ledger writer preserves it).
  const windowsText = read(path.join(SUPER, '.planning/WINDOWS.md'))
  const windowsBlock = block('WINDOWS.md', windowsText)
  let ledger = []
  try {
    const fence = windowsText.lastIndexOf('````json')
    const close = windowsText.indexOf('\n````', fence + 8)
    ledger = JSON.parse(windowsText.slice(fence + 8, close))
  } catch { problems.push('WINDOWS.md: the ledger JSON block does not parse') }
  const statusOf = id => ledger.find(entry => entry.id === id)?.status
  const windowItems = itemsOf(windowsBlock)
  const itemFor = id => windowItems.find(item => new RegExp(`#${id}\\b`).test(item))
  for (const id of [302, 303, 304, 313]) {
    const item = itemFor(id)
    if (!item) { problems.push(`WINDOWS.md: WIN #${id} is not reconciled`); continue }
    if (!/\bfixed\b/i.test(item)) problems.push(`WINDOWS.md: WIN #${id} is not stated fixed`)
    evidence(`WINDOWS.md #${id}`, item)
    if (statusOf(id) !== 'fixed') problems.push(`WINDOWS.md: ledger status of #${id} is ${statusOf(id)}, not fixed`)
  }
  {
    const item = itemFor(285)
    if (!item) problems.push('WINDOWS.md: WIN #285 is not reconciled')
    else {
      if (!/contract-side/i.test(item)) problems.push('WINDOWS.md: WIN #285 is not stated contract-side')
      evidence('WINDOWS.md #285', item)
      if (statusOf(285) !== 'open') problems.push(`WINDOWS.md: ledger status of #285 is ${statusOf(285)}; its UI half is not closed here`)
    }
  }
  for (const id of [284, 286, 289, 300, 308]) {
    const item = itemFor(id)
    if (!item) problems.push(`WINDOWS.md: preserved WIN #${id} is not named`)
    else if (/\bfixed\b/i.test(item.replace(/not fixed/gi, ''))) problems.push(`WINDOWS.md: preserved WIN #${id} is claimed fixed`)
    if (statusOf(id) !== 'open') problems.push(`WINDOWS.md: ledger status of preserved #${id} is ${statusOf(id)}`)
  }
  // The four owner decisions recorded across the phase stay open.
  const OWNER = [['runs.marks.history', 'cold-read masking allowlist'], ['agent-qa proposals', 'run-detail review controls'],
    ['runs.evidence', 'catalog row wording'], ['MX_MAX_TOOLS', 'MCP tool ceiling']]
  for (const [token, name] of OWNER) {
    const holders = [block('REQUIREMENTS.md(owner)', read(path.join(SUPER, '.planning/REQUIREMENTS.md')))].flatMap(itemsOf)
      .filter(item => item.includes(token) && /owner/i.test(item))
    if (holders.length === 0) problems.push(`REQUIREMENTS.md: owner decision on the ${name} (${token}) is not recorded`)
    else if (!holders.every(item => /\b(open|pending|needs owner|owner review|owner sign-off)\b/i.test(item))) {
      problems.push(`REQUIREMENTS.md: owner decision on the ${name} is not recorded as open`)
    }
  }
  const deletion = block('DELETION-INVENTORY.md', read(path.join(ROOT, 'DELETION-INVENTORY.md')))
  if (deletion) {
    if (!/405-debris-deleted/.test(deletion)) problems.push('DELETION-INVENTORY.md: the 405-debris-deleted fence is not cited')
    if (!/no retired (?:v1 )?(?:DDL|table)[\s\S]*route/i.test(deletion)) problems.push('DELETION-INVENTORY.md: no statement that no retired DDL or route returned')
    evidence('DELETION-INVENTORY.md', deletion.replace(/\n/g, ' '))
  }
  if (problems.length > 0) {
    for (const problem of problems) console.error(`RECONCILIATION problem: ${problem}`)
    console.error(`RECONCILIATION-423-INCOMPLETE problems=${problems.length}`)
    process.exit(1)
  }
  console.log(`RECONCILIATION-423 decisions=${decisions} windows-fixed=4 windows-contract-side=1 preserved=5 owner-open=4 files=4`)
}

// ---- dispatch --------------------------------------------------------------------------------
if (mode === '--list') {
  console.log(JSON.stringify({ steps: STEP_IDS, families: FAMILIES.map(family => family.id) }, null, 2))
} else if (mode === '--census') {
  census('census').then(result => {
    console.log(result.tap)
    console.log(result.summary)
    process.exit(result.ok ? 0 : 1)
  }, error => { console.error(`FATAL: ${error.message}`); process.exit(1) })
} else if (mode === '--census-mutation') {
  censusMutation()
} else if (mode === '--reconciliation') {
  reconciliation()
} else {
  full().catch(error => { console.error(`FATAL: ${error.stack ?? error.message}`); process.exit(1) })
}
NODE
