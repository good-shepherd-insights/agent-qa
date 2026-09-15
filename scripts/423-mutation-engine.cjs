'use strict'
// The shared instrument behind 423-evidence-mutation.sh and 423-usage-mutation.sh.
//
// WHAT A LEG PROVES. Each leg plants one semantic mutation in the PRODUCTION source a named cell
// exists to measure, runs that cell's own suite, and requires the RED to be the cells named before
// anything ran: every REQUIRED cell fails, every GREEN control passes, and nothing outside
// REQUIRED + ALLOWED fails. Then it restores the subject byte-identically and requires the same
// suite green again. A green suite under a mutation is a failure of the instrument, never a pass.
//
// THE TWO FAILURES THAT LOOK IDENTICAL (the 422-22 lesson). A mutation that reds nothing either
// met a vacuous wall, or never reached the suite at all. The second is ruled out BEFORE a byte is
// owned: a source-only leg's subject must lie in the relative-import closure of its instrument's
// files; a dist-crossing leg must name the workspace package its instrument imports, rebuild that
// package, and find its own arrival marker in the rebuilt dist.
//
// A TYPE WALL IS PROVED BY THE WALL. A required cell in a `.test-d.ts` counts only when a
// TypeCheckError points INTO that file — a compile error in the mutated production file must not
// impersonate the never-bar. A suite file that fails to LOAD is refused outright: an incidental
// build/transform failure is not a measurement.
//
// COUNTED SELECTION. Every instrument declares how many cells it selects. A run that selects a
// different number — a renamed cell, a dropped `it.each` row, a mistyped path — is refused rather
// than read as a verdict.
//
// RESTORATION ON EVERY PATH. Subjects are snapshotted (bytes and mtime) before the first mutation
// and restored on success, FATAL, uncaught error and SIGINT/SIGTERM/SIGHUP alike; each restore is
// verified by sha256. A dist rebuilt from mutated source is rebuilt again from the restored tree,
// and any run that owned a mutated byte ends with a forced workspace build, because a restored
// source is a turbo cache hit and the spawned-binary suites compare source mtimes against dist.

const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')
const { spawn, spawnSync } = require('node:child_process')

const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
const MODES = ['', 'neutered', 'fatal', 'SIGINT', 'SIGTERM', 'SIGHUP']

/**
 * A cell reference: an exact title, or every title starting with an ID token, counted. A name
 * containing ' > ' is matched against the describe path instead (`Describe > title`), so a cell
 * whose ID lives on its describe block is still named exactly.
 */
function cell(instrument, file, name, count = 1) {
  return { instrument, file, name, count }
}

function titleMatches(spec, title) {
  if (title === spec.name) return true
  if (!title.startsWith(spec.name)) return false
  return /^[\s:]/.test(title.slice(spec.name.length))
}

function cellMatches(spec, title, ancestors = []) {
  // Typecheck verdicts prefix their describe path with the file itself; that is not a describe.
  const describes = ancestors.filter(name => !/\.test(?:-d)?\.tsx?$/.test(name))
  if (spec.name.includes(' > ')) return titleMatches(spec, [...describes, title].join(' > '))
  return titleMatches(spec, title)
}

function describeCell(spec) {
  return `${spec.file} > ${spec.name}${spec.count === 1 ? '' : ` (x${spec.count})`}`
}

/** Every hunk's anchor must occur exactly once, and the result must differ from the input. */
function applyEdits(text, leg) {
  let output = text
  for (const [index, edit] of leg.edits.entries()) {
    if (output.split(edit.from).length !== 2) {
      throw new Error(`Mutation anchor is not unique or is missing: ${leg.id} (hunk ${index + 1})`)
    }
    output = output.replace(edit.from, () => edit.to)
  }
  if (output === text) throw new Error(`Mutation anchor did not land: ${leg.id}`)
  return output
}

function runGate(spec) {
  const root = path.resolve(__dirname, '..')
  process.chdir(root)
  const modeKey = `${spec.envPrefix}_SELFTEST`
  const legKey = `${spec.envPrefix}_LEG`
  const listKey = `${spec.envPrefix}_LIST`

  const legs = spec.legs.map((leg, index) => ({ ...leg, id: `${spec.idPrefix}${String(index + 1).padStart(2, '0')}` }))
  if (legs.length !== spec.expectedLegs) {
    console.error(`FATAL: Expected exactly ${spec.expectedLegs} mutation legs, declared ${legs.length}`)
    process.exit(1)
  }

  if (process.env[listKey] === '1') {
    process.stdout.write(JSON.stringify(legs.map(leg => ({
      id: leg.id, subject: leg.subject, operation: leg.operation, claim: leg.claim,
      reds: leg.reds.map(describeCell), greens: (leg.greens ?? []).map(describeCell),
      crossing: leg.crossing?.pkg ?? null,
    })), null, 2) + '\n')
    process.exit(0)
  }

  const mode = process.env[modeKey] ?? ''
  if (!MODES.includes(mode)) {
    console.error(`FATAL: Unknown ${modeKey}`)
    process.exit(1)
  }
  if (Number(process.versions.node.split('.')[0]) < 24) {
    console.error('FATAL: Node 24 or later required')
    process.exit(1)
  }

  const work = fs.mkdtempSync(path.join(os.tmpdir(), `agent-qa-${spec.slug}-`))
  console.log(`Evidence: ${work}`)

  const subjects = [...new Set(legs.map(leg => leg.subject))]
  const owned = new Map()
  const crossedBuilt = new Set()
  let child
  let cleanupActive = false
  let ownedAny = false

  function restore() {
    for (const [file, snapshot] of owned) {
      const target = path.join(root, file)
      const bytes = fs.readFileSync(snapshot.path)
      if (sha(bytes) !== snapshot.hash) throw new Error(`snapshot corrupted: ${file}`)
      if (sha(fs.readFileSync(target)) !== snapshot.hash) {
        fs.writeFileSync(target, bytes)
        fs.utimesSync(target, snapshot.atimeMs / 1000, snapshot.mtimeMs / 1000)
      }
      if (sha(fs.readFileSync(target)) !== snapshot.hash) throw new Error(`restore hash mismatch: ${file}`)
      console.log(`RESTORED ${file} sha256=${snapshot.hash}`)
    }
  }

  function buildPackage(pkg, label) {
    const log = path.join(work, `${label}.log`)
    const result = spawnSync('pnpm', ['--filter', pkg, 'build'], { cwd: root, encoding: 'utf8' })
    fs.writeFileSync(log, `${result.stdout ?? ''}${result.stderr ?? ''}`)
    console.log(`${label}: pnpm --filter ${pkg} build exit=${result.status}`)
    if (result.status !== 0) throw new Error(`${label}: build of ${pkg} failed — see ${log}`)
  }

  function finalBuild() {
    const log = path.join(work, 'final-build.log')
    const result = spawnSync('pnpm', ['turbo', 'run', 'build', '--force'], { cwd: root, encoding: 'utf8' })
    fs.writeFileSync(log, `${result.stdout ?? ''}${result.stderr ?? ''}`)
    console.log(`REBUILT workspace (pnpm turbo run build --force) exit=${result.status}`)
    if (result.status !== 0) throw new Error(`the restored workspace build failed — see ${log}`)
  }

  function cleanup() {
    restore()
    for (const pkg of crossedBuilt) buildPackage(pkg, `restore-build-${pkg.replace(/[^a-z0-9]+/gi, '-')}`)
    crossedBuilt.clear()
    if (ownedAny) finalBuild()
    ownedAny = false
  }

  function stopChild(signal = 'SIGTERM') {
    if (child?.pid) { try { process.kill(-child.pid, signal) } catch {} }
  }

  function fatal(reason) {
    console.error(`FATAL: ${reason}`)
    if (cleanupActive) process.exit(1)
    cleanupActive = true
    stopChild('SIGKILL')
    try { cleanup() } catch (error) { console.error(`FATAL: cleanup failed: ${error.message}`) }
    process.exit(1)
  }

  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(signal, () => fatal(`interrupted by ${signal}`))
  }
  process.on('uncaughtException', error => fatal(error.message))
  process.on('unhandledRejection', error => fatal(error instanceof Error ? error.message : String(error)))

  const target = process.env[legKey]
  if (target !== undefined && (!['', 'neutered'].includes(mode) || !legs.some(leg => leg.id === target))) {
    fatal(`Invalid ${legKey}: requires a declared ID and a normal or neutered run`)
  }
  const activeLegs = target === undefined ? legs : legs.filter(leg => leg.id === target)

  // ---- arrival --------------------------------------------------------------------------------
  function relativeClosure(pkg, files) {
    const seen = new Set()
    const stack = files.map(file => path.join(root, pkg, file))
    while (stack.length > 0) {
      const file = stack.pop()
      if (seen.has(file)) continue
      seen.add(file)
      let text
      try { text = fs.readFileSync(file, 'utf8') } catch { continue }
      for (const match of text.matchAll(/(?:from|import)\s*\(?\s*'(\.[^']*)'/g)) {
        const specifier = match[1].replace(/\.js$/, '')
        for (const candidate of [`${specifier}.ts`, `${specifier}.tsx`, path.join(specifier, 'index.ts')]) {
          const resolved = path.resolve(path.dirname(file), candidate)
          if (fs.existsSync(resolved) && fs.lstatSync(resolved).isFile()) {
            stack.push(resolved)
            break
          }
        }
      }
    }
    return seen
  }

  function proveArrival() {
    const closures = new Map()
    for (const leg of legs) {
      const instrument = spec.instruments[leg.instrument]
      if (instrument === undefined) throw new Error(`${leg.id}: unknown instrument ${leg.instrument}`)
      for (const ref of [...leg.reds, ...(leg.greens ?? []), ...(leg.allowed ?? [])]) {
        if (ref.instrument !== leg.instrument) throw new Error(`${leg.id}: ${describeCell(ref)} is not measured by ${leg.instrument}`)
        if (!instrument.files.includes(ref.file)) throw new Error(`${leg.id}: ${ref.file} is not selected by ${leg.instrument}`)
      }
      if (leg.crossing !== undefined) {
        const manifest = JSON.parse(fs.readFileSync(path.join(root, instrument.pkg, 'package.json'), 'utf8'))
        const declared = { ...manifest.dependencies, ...manifest.devDependencies }
        if (declared[leg.crossing.pkg] === undefined) {
          throw new Error(`${leg.id}: ${instrument.pkg} does not depend on ${leg.crossing.pkg}`)
        }
        if (!leg.subject.startsWith(`${leg.crossing.dir}/src/`)) {
          throw new Error(`${leg.id}: ${leg.subject} is not source of ${leg.crossing.pkg}`)
        }
        const imports = instrument.files.some(file =>
          fs.readFileSync(path.join(root, instrument.pkg, file), 'utf8').includes(`'${leg.crossing.pkg}'`))
        if (!imports) throw new Error(`${leg.id}: no ${leg.instrument} file imports ${leg.crossing.pkg}`)
        if (!leg.edits.some(edit => edit.to.includes(leg.crossing.marker))) {
          throw new Error(`${leg.id}: the arrival marker is not planted by any hunk`)
        }
        console.log(`ARRIVAL ${leg.id}: ${leg.subject} crosses into ${leg.instrument} through the rebuilt ${leg.crossing.pkg} dist`)
        continue
      }
      if (!leg.subject.startsWith(`${instrument.pkg}/`)) {
        throw new Error(`${leg.id}: ${leg.subject} is outside ${instrument.pkg} and declares no dist crossing`)
      }
      if (!closures.has(leg.instrument)) closures.set(leg.instrument, relativeClosure(instrument.pkg, instrument.files))
      if (!closures.get(leg.instrument).has(path.join(root, leg.subject))) {
        throw new Error(`${leg.id}: ${leg.subject} is not in the relative-import closure of ${leg.instrument} — a green would measure nothing`)
      }
      console.log(`ARRIVAL ${leg.id}: ${leg.subject} is in the ${leg.instrument} import closure`)
    }
  }

  function proveDistArrival(leg) {
    const dist = path.join(root, leg.crossing.dir, 'dist')
    const files = []
    const visit = dir => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name)
        if (entry.isDirectory()) visit(file)
        else if (/\.(?:m?js|cjs)$/.test(entry.name)) files.push(file)
      }
    }
    visit(dist)
    if (!files.some(file => fs.readFileSync(file, 'utf8').includes(leg.crossing.marker))) {
      throw new Error(`${leg.id}: the rebuilt ${leg.crossing.pkg} dist does not carry the mutation`)
    }
    console.log(`ARRIVAL ${leg.id}: rebuilt ${leg.crossing.pkg} dist carries ${leg.crossing.marker}`)
  }

  // ---- reading a run --------------------------------------------------------------------------
  function parse(result) {
    const clean = result.log.replace(/\x1b\[[0-9;]*m/g, '')
    if (result.report === undefined) throw new Error(`${result.label}: no JSON verdicts — the suite never reported`)
    const instrument = spec.instruments[result.instrument]
    const cells = []
    const loadFailures = []
    for (const file of result.report.testResults ?? []) {
      const relative = path.relative(path.join(root, instrument.pkg), file.name)
      if ((file.assertionResults ?? []).length === 0 || (file.message ?? '') !== '') {
        loadFailures.push(`${relative}: ${(file.message ?? 'no cells').split('\n')[0]}`)
      }
      for (const assertion of file.assertionResults ?? []) {
        if (!['passed', 'failed'].includes(assertion.status)) continue
        cells.push({ file: relative, title: assertion.title, ancestors: assertion.ancestorTitles ?? [],
          id: [relative, ...assertion.ancestorTitles, assertion.title].join(' > '), status: assertion.status })
      }
    }
    if (cells.length === 0 || /No test files found/.test(clean)) throw new Error(`${result.label}: No selected named tests`)
    if (loadFailures.length > 0) throw new Error(`${result.label}: a suite file failed to load: ${loadFailures.join(' | ')}`)
    if (cells.length !== instrument.count) {
      throw new Error(`${result.label}: selected ${cells.length} cells, the instrument declares ${instrument.count}`)
    }
    const diagnostics = [...clean.matchAll(/^(TypeCheckError:[\s\S]*?)^ ❯ (src\/[^\n]+:\d+:\d+)$/gm)]
      .map(match => ({ message: match[1].trim().split('\n')[0], pointer: match[2] }))
    return { clean, cells, failures: cells.filter(item => item.status === 'failed').map(item => item.id).sort(), diagnostics }
  }

  function matched(parsed, ref) {
    return parsed.cells.filter(item => item.file === ref.file && cellMatches(ref, item.title, item.ancestors))
  }

  function namedFor(instrumentName) {
    return legs.filter(leg => leg.instrument === instrumentName)
      .flatMap(leg => [...leg.reds, ...(leg.greens ?? [])])
  }

  function checkGreen(result) {
    const parsed = parse(result)
    if (result.exit !== 0 || parsed.failures.length > 0) {
      throw new Error(`${result.label}: preflight/restored instrument did not pass: ${parsed.failures.join(' | ')}`)
    }
    for (const ref of namedFor(result.instrument)) {
      if (matched(parsed, ref).length !== ref.count) throw new Error(`Named cell not selected: ${describeCell(ref)}`)
    }
    return parsed
  }

  function checkRed(result, leg) {
    if (result.exit === 0) throw new Error(`${leg.id}: suite stayed green`)
    if (result.exit !== 1) throw new Error(`${leg.id}: unexpected tool exit ${result.exit}`)
    const parsed = parse(result)
    for (const ref of [...leg.reds, ...(leg.greens ?? [])]) {
      if (matched(parsed, ref).length !== ref.count) throw new Error(`Named cell not selected: ${describeCell(ref)}`)
    }
    for (const ref of leg.reds) {
      const standing = matched(parsed, ref).filter(item => item.status !== 'failed')
      if (standing.length > 0) throw new Error(`${leg.id}: did not red its named cell: ${standing.map(item => item.id).join(' | ')}`)
    }
    for (const ref of leg.greens ?? []) {
      const moved = matched(parsed, ref).filter(item => item.status !== 'passed')
      if (moved.length > 0) throw new Error(`${leg.id}: red an expected non-catcher: ${moved.map(item => item.id).join(' | ')}`)
    }
    const admitted = [...leg.reds, ...(leg.allowed ?? [])]
    for (const failure of parsed.cells.filter(item => item.status === 'failed')) {
      if (!admitted.some(ref => ref.file === failure.file && cellMatches(ref, failure.title, failure.ancestors))) {
        throw new Error(`${leg.id}: red a cell outside its allowed list: ${failure.id}`)
      }
    }
    for (const file of [...new Set(leg.reds.map(ref => ref.file).filter(file => file.endsWith('.test-d.ts')))]) {
      if (!parsed.diagnostics.some(row => row.pointer.startsWith(`${file}:`))) {
        throw new Error(`${leg.id}: missing intended type assertion in ${file}`)
      }
    }
    return parsed
  }

  function mustReject(name, fn) {
    let rejected = false
    try { fn() } catch { rejected = true }
    if (!rejected) throw new Error(`the verdict reader accepted ${name}`)
    console.log(`CONTROL rejected: ${name}`)
  }

  async function runInstrument(name, label) {
    const instrument = spec.instruments[name]
    const reportPath = path.join(work, `${label}.json-report.json`)
    const args = [path.join(root, 'node_modules/vitest/vitest.mjs'), 'run', ...instrument.files,
      instrument.typecheck ? '--typecheck' : '--typecheck.enabled=false',
      '--reporter=verbose', '--reporter=json', `--outputFile.json=${reportPath}`, '--maxWorkers=1']
    const logPath = path.join(work, `${label}.log`)
    const fd = fs.openSync(logPath, 'wx')
    const started = Date.now()
    let timedOut = false
    const exit = await new Promise((resolve, reject) => {
      child = spawn(process.execPath, args, {
        cwd: path.join(root, instrument.pkg), detached: true, stdio: ['ignore', fd, fd],
        env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
      })
      const timer = setTimeout(() => { timedOut = true; stopChild('SIGKILL') }, 600_000)
      child.on('error', error => { clearTimeout(timer); reject(error) })
      child.on('exit', (code, signal) => {
        clearTimeout(timer)
        child = undefined
        resolve(code ?? `signal:${signal}`)
      })
    })
    fs.closeSync(fd)
    const record = { label, instrument: name, cwd: instrument.pkg, command: [process.execPath, ...args], exit,
      elapsedMs: Date.now() - started, logPath }
    fs.writeFileSync(path.join(work, `${label}.json`), JSON.stringify(record, null, 2) + '\n')
    console.log(`${label}: exit=${exit} elapsedMs=${record.elapsedMs}`)
    if (timedOut) throw new Error(`${label}: instrument timed out`)
    let report
    try { report = JSON.parse(fs.readFileSync(reportPath, 'utf8')) } catch {}
    return { ...record, report, log: fs.readFileSync(logPath, 'utf8') }
  }

  function writeSubject(leg, text) {
    fs.writeFileSync(path.join(root, leg.subject), text)
    ownedAny = true
  }

  async function main() {
    for (const file of subjects) {
      const tracked = spawnSync('git', ['ls-files', '--error-unmatch', '--', file], { cwd: root, encoding: 'utf8' })
      const status = spawnSync('git', ['status', '--porcelain', '--ignored', '--', file], { cwd: root, encoding: 'utf8' })
      if (tracked.status !== 0 || status.status !== 0 || status.stdout.trim()) {
        throw new Error(`${file} is dirty or untracked — refusing mutation`)
      }
      if (!fs.lstatSync(path.join(root, file)).isFile()) throw new Error(`Non-regular subject: ${file}`)
    }
    for (const leg of legs) applyEdits(fs.readFileSync(path.join(root, leg.subject), 'utf8'), leg)
    proveArrival()
    for (const file of subjects) {
      const target = path.join(root, file)
      const bytes = fs.readFileSync(target)
      const stat = fs.statSync(target)
      const snapshot = path.join(work, `${file.replace(/\//g, '_')}.snapshot`)
      fs.writeFileSync(snapshot, bytes, { flag: 'wx' })
      owned.set(file, { path: snapshot, hash: sha(bytes), atimeMs: stat.atimeMs, mtimeMs: stat.mtimeMs })
    }
    fs.writeFileSync(path.join(work, 'subjects.json'), JSON.stringify(Object.fromEntries(owned), null, 2) + '\n')

    // Interruption controls own EVERY subject before the interruption, so the restoration claim is
    // measured over the whole owned set rather than over one file.
    if (mode === 'fatal' || mode.startsWith('SIG')) {
      for (const file of subjects) {
        const leg = legs.find(candidate => candidate.subject === file)
        writeSubject(leg, applyEdits(fs.readFileSync(owned.get(file).path, 'utf8'), leg))
        const digest = sha(fs.readFileSync(path.join(root, file)))
        if (digest === owned.get(file).hash) throw new Error(`Interruption control changed no bytes: ${file}`)
        console.log(`MUTATED ${file} sha256=${digest}`)
      }
      if (mode === 'fatal') throw new Error(`intentional fatal after ${legs[0].id} mutation`)
      process.kill(process.pid, mode)
      await new Promise(resolve => setTimeout(resolve, 1000))
      throw new Error('Signal handler failed')
    }

    const used = [...new Set(activeLegs.map(leg => leg.instrument))]
    for (const name of used) checkGreen(await runInstrument(name, `preflight-${name}`))

    const ledger = []
    for (const leg of activeLegs) {
      console.log(`LEG ${leg.id} ${leg.claim} — ${leg.operation}`)
      const snapshot = owned.get(leg.subject)
      if (mode !== 'neutered') {
        writeSubject(leg, applyEdits(fs.readFileSync(snapshot.path, 'utf8'), leg))
        if (sha(fs.readFileSync(path.join(root, leg.subject))) === snapshot.hash) throw new Error('Mutation changed no bytes')
        if (leg.crossing !== undefined) {
          crossedBuilt.add(leg.crossing.pkg)
          buildPackage(leg.crossing.pkg, `${leg.id}-mutated-build`)
          proveDistArrival(leg)
        }
      }
      const result = await runInstrument(leg.instrument, `${leg.id}-red`)
      const parsed = checkRed(result, leg)
      mustReject('a green suite', () => checkRed({ ...result, exit: 0 }, leg))
      mustReject('a tool crash', () => checkRed({ ...result, exit: 2 }, leg))
      mustReject('no JSON verdicts', () => checkRed({ ...result, report: undefined }, leg))
      mustReject('a missing named cell', () => checkRed({ ...result, report: { ...result.report,
        testResults: result.report.testResults.map(file => ({ ...file,
          assertionResults: file.assertionResults.filter(item =>
            !cellMatches(leg.reds[0], item.title, item.ancestorTitles ?? [])) })) } }, leg))
      if (leg.reds.some(ref => ref.file.endsWith('.test-d.ts'))) {
        mustReject('a missing type assertion', () => checkRed({ ...result,
          log: result.log.replace(/TypeCheckError:/g, 'TypeCheck:') }, leg))
      }
      const entry = {
        id: leg.id, subject: leg.subject, instrument: leg.instrument, claim: leg.claim, operation: leg.operation,
        exit: result.exit, failures: parsed.failures, diagnostics: parsed.diagnostics,
        originalDigest: snapshot.hash, mutatedDigest: sha(fs.readFileSync(path.join(root, leg.subject))),
      }
      ledger.push(entry)
      fs.writeFileSync(path.join(work, 'ledger.json'), JSON.stringify(ledger, null, 2) + '\n')
      console.log(`NAMED RED ${leg.id}: ${leg.reds.map(describeCell).join(' | ')}; failed=${parsed.failures.length}`)
      for (const failure of parsed.failures) console.log(`  red ${failure}`)
      for (const ref of leg.greens ?? []) console.log(`  GREEN control held: ${describeCell(ref)}`)

      restore()
      if (leg.crossing !== undefined && crossedBuilt.has(leg.crossing.pkg)) {
        buildPackage(leg.crossing.pkg, `${leg.id}-restored-build`)
        crossedBuilt.delete(leg.crossing.pkg)
      }
      const green = checkGreen(await runInstrument(leg.instrument, `${leg.id}-restored-green`))
      entry.restoredDigest = sha(fs.readFileSync(path.join(root, leg.subject)))
      entry.restoredSelected = green.cells.length
      if (entry.restoredDigest !== entry.originalDigest) throw new Error(`${leg.id}: restored digest differs`)
      fs.writeFileSync(path.join(work, 'ledger.json'), JSON.stringify(ledger, null, 2) + '\n')
    }
    restore()
    if (ownedAny) finalBuild()
    ownedAny = false
    owned.clear()
    console.log(`${spec.banner} legs=${ledger.length} named-red=${ledger.length} byte-identical-restoration=${subjects.length}`)
  }

  main().catch(error => fatal(error.message))
}


// ---- the instrument's own test ----------------------------------------------------------------
// Runs IN PLACE on the real tree (the dist-crossing legs resolve workspace dists that a copied
// slice would not own). Every mode that owns a byte is required to hand back the exact bytes and
// mtime it found, and the subjects' git status is asserted clean after every run.
//
// THE INVENTORY IS WRITTEN OUT BY THE CALLER, NOT DERIVED. A total read off the gate agrees with
// the gate however it changes; a leg silently dropped or re-aimed there reddens here instead.
function runSelftest(spec) {
  const assert = require('node:assert/strict')
  const { test } = require('node:test')
  const root = path.resolve(__dirname, '..')
  process.chdir(root)
  const modeKey = `${spec.envPrefix}_SELFTEST`
  const legKey = `${spec.envPrefix}_LEG`
  const listKey = `${spec.envPrefix}_LIST`
  const work = fs.mkdtempSync(path.join(os.tmpdir(), `agent-qa-${spec.slug}-selftest-`))
  console.log(`Selftest evidence: ${work}`)

  const subjects = [...new Set(spec.expected.map(leg => leg.subject))]
  // Millisecond mtime: a restored timestamp round-trips through a float, so sub-millisecond digits
  // are not a claim this instrument makes.
  const stateOf = () => subjects.map(file => {
    const target = path.join(root, file)
    return { file, hash: sha(fs.readFileSync(target)), mtimeMs: Math.round(fs.statSync(target).mtimeMs) }
  })
  const gitClean = () => {
    const status = spawnSync('git', ['status', '--porcelain', '--', ...subjects], { cwd: root, encoding: 'utf8' })
    assert.equal(status.status, 0)
    assert.equal(status.stdout, '', 'every subject must be clean in git after the run')
  }

  function gate(label, env) {
    const childEnv = { ...process.env }
    delete childEnv[modeKey]
    delete childEnv[legKey]
    delete childEnv[listKey]
    Object.assign(childEnv, env)
    const log = path.join(work, `${label}.log`)
    const fd = fs.openSync(log, 'wx')
    const started = Date.now()
    const result = spawnSync('bash', [spec.gateScript], { cwd: root, env: childEnv, stdio: ['ignore', fd, fd], timeout: 3_600_000 })
    fs.closeSync(fd)
    const output = fs.readFileSync(log, 'utf8')
    fs.writeFileSync(path.join(work, `${label}.json`), JSON.stringify({ label, env, status: result.status,
      signal: result.signal, elapsedMs: Date.now() - started }, null, 2) + '\n')
    assert.equal(result.error, undefined, `${label}: child tool failure`)
    assert.equal(result.signal, null, `${label}: uncontrolled child signal`)
    return { status: result.status, output }
  }
  const fatalLines = output => output.match(/^FATAL: .+$/gm) ?? []

  test(`${spec.slug}: registration and written-out inventory`, () => {
    const scripts = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).scripts
    for (const [name, command] of Object.entries(spec.registration)) {
      assert.equal(scripts[name], command, `${name} must be registered exactly`)
    }
    const listed = spawnSync('bash', [spec.gateScript], { cwd: root, encoding: 'utf8',
      env: { ...process.env, [listKey]: '1' } })
    assert.equal(listed.status, 0, listed.stderr)
    const inventory = JSON.parse(listed.stdout)
    assert.equal(inventory.length, spec.expected.length, 'declared leg total')
    assert.deepEqual(inventory.map(leg => ({ id: leg.id, claim: leg.claim, subject: leg.subject, reds: leg.reds,
      crossing: leg.crossing })), spec.expected.map(leg => ({ crossing: null, ...leg })))
    console.log(`SELFTEST inventory legs=${inventory.length}`)
  })

  test(`${spec.slug}: the anchor guard refuses a no-op or missing hunk`, () => {
    assert.throws(() => applyEdits('same text', { id: 'NOOP', edits: [{ from: 'same', to: 'same' }] }),
      /Mutation anchor did not land: NOOP/)
    assert.throws(() => applyEdits('text', { id: 'GONE', edits: [{ from: 'absent', to: 'x' }] }),
      /Mutation anchor is not unique or is missing: GONE/)
    assert.throws(() => applyEdits('a a', { id: 'TWICE', edits: [{ from: 'a', to: 'b' }] }),
      /Mutation anchor is not unique or is missing: TWICE/)
    console.log('SELFTEST anchor-guard no-op=refused missing=refused duplicate=refused')
  })

  test(`${spec.slug}: invalid knobs refuse before any byte is owned`, () => {
    const before = stateOf()
    for (const [label, env, reason] of [
      ['invalid-mode', { [modeKey]: 'bogus' }, `Unknown ${modeKey}`],
      ['unknown-leg', { [modeKey]: 'neutered', [legKey]: `${spec.idPrefix}99` }, `Invalid ${legKey}: requires a declared ID and a normal or neutered run`],
      ['leg-with-fatal', { [modeKey]: 'fatal', [legKey]: spec.expected[0].id }, `Invalid ${legKey}: requires a declared ID and a normal or neutered run`],
    ]) {
      const run = gate(label, env)
      assert.equal(run.status, 1, run.output)
      assert.deepEqual(fatalLines(run.output), [`FATAL: ${reason}`], run.output)
      assert.ok(!/ARRIVAL |RESTORED |MUTATED /.test(run.output), run.output)
      console.log(`SELFTEST ${label} exit=1 before-ownership=1`)
    }
    assert.deepEqual(stateOf(), before)
    gitClean()
  })

  for (const leg of spec.expected) {
    test(`${spec.slug}: neutered ${leg.id} FATALs when ${leg.claim} stays green`, () => {
      const before = stateOf()
      const run = gate(`neutered-${leg.id}`, { [modeKey]: 'neutered', [legKey]: leg.id })
      assert.equal(run.status, 1, run.output)
      assert.deepEqual(fatalLines(run.output), [`FATAL: ${leg.id}: suite stayed green`], run.output)
      // The refusal must follow an ACTUAL green child of the leg's own instrument.
      assert.match(run.output, new RegExp(`^${leg.id}-red: exit=0 `, 'm'))
      assert.deepEqual(run.output.match(/^LEG [A-Z]\d+ /gm), [`LEG ${leg.id} `])
      assert.ok(!run.output.includes('MUTATED ') && !run.output.includes(spec.banner), run.output)
      assert.deepEqual(stateOf(), before, `${leg.id}: a neutered run owns no byte and moves no mtime`)
      gitClean()
      console.log(`SELFTEST neutered-${leg.id} exit=1 selected-green-child=0`)
    })
  }

  test(`${spec.slug}: a dirty subject is refused and left exactly as found`, () => {
    const file = subjects[0]
    const target = path.join(root, file)
    const original = fs.readFileSync(target)
    const stat = fs.statSync(target)
    const dirt = '\n// selftest: an uncommitted edit the instrument must refuse to own\n'
    try {
      fs.appendFileSync(target, dirt)
      const run = gate('dirty-subject', {})
      assert.equal(run.status, 1, run.output)
      assert.deepEqual(fatalLines(run.output), [`FATAL: ${file} is dirty or untracked — refusing mutation`], run.output)
      assert.ok(!/ARRIVAL |RESTORED |MUTATED /.test(run.output), run.output)
      assert.ok(fs.readFileSync(target, 'utf8').endsWith(dirt), 'the refused subject keeps its dirt')
    } finally {
      fs.writeFileSync(target, original)
      fs.utimesSync(target, stat.atimeMs / 1000, stat.mtimeMs / 1000)
    }
    gitClean()
    console.log('SELFTEST dirty-subject exit=1 refused-without-modifying=1')
  })

  for (const mode of ['fatal', 'SIGINT', 'SIGTERM', 'SIGHUP']) {
    test(`${spec.slug}: ${mode} restores every owned subject and rebuilds`, () => {
      const before = stateOf()
      const run = gate(`mode-${mode}`, { [modeKey]: mode })
      assert.equal(run.status, 1, run.output)
      const reason = mode === 'fatal' ? `intentional fatal after ${spec.expected[0].id} mutation` : `interrupted by ${mode}`
      assert.deepEqual(fatalLines(run.output), [`FATAL: ${reason}`], run.output)
      const mutated = [...run.output.matchAll(/^MUTATED (.+) sha256=([a-f0-9]{64})$/gm)]
      assert.deepEqual(mutated.map(row => row[1]), subjects, `${mode}: every subject must change before the interruption`)
      for (const [index, row] of mutated.entries()) assert.notEqual(row[2], before[index].hash)
      for (const entry of before) {
        assert.ok(run.output.includes(`RESTORED ${entry.file} sha256=${entry.hash}`), `${mode}: ${entry.file} restoration line`)
      }
      assert.match(run.output, /^REBUILT workspace \(pnpm turbo run build --force\) exit=0$/m)
      assert.ok(!run.output.includes(spec.banner), run.output)
      assert.deepEqual(stateOf(), before, `${mode}: exact bytes and mtimes handed back`)
      gitClean()
      console.log(`SELFTEST ${mode} exit=1 restored=${subjects.length} rebuilt=1`)
    })
  }

  test(`${spec.slug}: selftest complete`, () => {
    console.log(`${spec.banner}_SELFTEST_OK legs=${spec.expected.length} subjects=${subjects.length}`)
  })
}

module.exports = { runGate, runSelftest, cell, applyEdits, titleMatches, cellMatches }
