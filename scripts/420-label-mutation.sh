#!/usr/bin/env bash
# 420 D-01/D-06/D-07/D-10/D-16: independent runtime + exact type mutation evidence.
# Node 24 must already be installed. No downloads, dist rebuilds, provider calls or
# operator roots. Every instrument imports its subjects directly from source.
# LABEL_MUTATION_SELFTEST=neutered must fail the first leg with stayed-green.
# fatal / SIGINT / SIGTERM / SIGHUP exercise cleanup immediately after a real edit.
# Raw per-leg logs, argv, exits, timings and sha256 ledger remain in the printed temp dir.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."
exec node --input-type=commonjs - <<'NODE'
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')
const { spawn, spawnSync } = require('node:child_process')
if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Node 24 or later required')
const root = process.cwd()
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-qa-label-mutation-'))
console.log(`Evidence: ${work}`)
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
const subjects = ['packages/eval/src/cassette/label-leg.ts',
  'packages/eval/src/labels/silver-sampling.ts', 'packages/eval/src/labels/calibration.ts']
const owned = new Map()
let child, cleanupActive = false
const mode = process.env.LABEL_MUTATION_SELFTEST ?? ''
if (!['', 'neutered', 'fatal', 'SIGINT', 'SIGTERM', 'SIGHUP'].includes(mode)) throw new Error('Unknown LABEL_MUTATION_SELFTEST')

function restoreFrom(repository, snapshots, report = true) {
  for (const [file, snapshot] of snapshots) {
    const bytes = fs.readFileSync(snapshot.path)
    if (sha(bytes) !== snapshot.hash) throw new Error(`snapshot corrupted: ${file}`)
    fs.writeFileSync(path.join(repository, file), bytes)
    if (sha(fs.readFileSync(path.join(repository, file))) !== snapshot.hash) throw new Error(`restore hash mismatch: ${file}`)
    if (report) console.log(`RESTORED ${file} sha256=${snapshot.hash}`)
  }
}
function restore() { restoreFrom(root, owned) }
function stopChild() {
  if (child?.pid) { try { process.kill(-child.pid, 'SIGTERM') } catch {} }
}
function fatal(reason) {
  console.error(`FATAL: ${reason}`)
  if (cleanupActive) process.exit(1)
  cleanupActive = true
  stopChild()
  try { restore() } catch (error) { console.error(`FATAL: cleanup failed: ${error.message}`) }
  process.exit(1)
}
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => fatal(`interrupted by ${signal}`))
process.on('uncaughtException', error => fatal(error.message))
process.on('unhandledRejection', error => fatal(error.message))
process.on('exit', () => {
  // Backstop for unexpected exit paths; retain snapshots and logs for recovery.
  if (!cleanupActive) { try { restore() } catch (error) { console.error(`FATAL: ${error.message}`); process.exitCode = 1 } }
})

function cleanGate(repository, file) {
  const result = spawnSync('git', ['status', '--porcelain', '--', file], { cwd: repository, encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`git status failed for ${file}`)
  if (result.stdout.trim()) throw new Error(`${file} is dirty before the snapshot — refusing to mutate it`)
}
function mustReject(name, action) {
  let rejected = false
  try { action() } catch { rejected = true }
  if (!rejected) throw new Error(`self-check accepted ${name}`)
  console.log(`CONTROL rejected: ${name}`)
}
function restorationControls() {
  const directory = fs.mkdtempSync(path.join(work, 'restore-control-'))
  const snapshot = path.join(directory, 'snapshot'), subject = path.join(directory, 'subject')
  fs.writeFileSync(snapshot, 'original')
  fs.writeFileSync(subject, 'changed')
  const snapshots = new Map([['subject', { path: snapshot, hash: sha('original') }]])
  if (sha(fs.readFileSync(subject)) === sha(fs.readFileSync(snapshot))) throw new Error('hash comparator accepted unequal bytes')
  restoreFrom(directory, snapshots, false)
  if (fs.readFileSync(subject, 'utf8') !== 'original') throw new Error('fixture restore failed')
  fs.writeFileSync(snapshot, 'corrupt')
  mustReject('corrupt snapshot', () => restoreFrom(directory, snapshots, false))
  fs.unlinkSync(snapshot)
  mustReject('missing snapshot', () => restoreFrom(directory, snapshots, false))
  fs.writeFileSync(snapshot, 'original')
  fs.unlinkSync(subject)
  fs.mkdirSync(subject)
  mustReject('failed restore write', () => restoreFrom(directory, snapshots, false))
}

const base = 'src/labels/__tests__/'
const families = {
  labels: ['label-closed-sets.test.ts', 'label-closed-sets.test-d.ts'],
  rerun: ['rerun-routing.test.ts', 'rerun-closed-sets.test-d.ts'],
  calibration: ['calibration.test.ts', 'calibration.test-d.ts'],
}
const legs = []
function arrayLegs(subject, constant, members, extra, family, title) {
  for (const member of members) legs.push({ id: `L${String(legs.length + 1).padStart(2, '0')}`,
    subject, constant, member, operation: 'remove', family, required: [title] })
  legs.push({ id: `L${String(legs.length + 1).padStart(2, '0')}`, subject, constant,
    member: extra, operation: 'add', family, required: [title] })
}
// Hand-spelled inventory. Never read a production value to decide which members must survive.
arrayLegs(subjects[0], 'LABEL_SOURCE_CHANNELS', ['recorded-verdict', 'user-mark', 'overturned-verdict', 'self-heal-pair'],
  'judge-panel', 'labels', '420 exact label channels')
arrayLegs(subjects[0], 'LABEL_TIERS', ['gold', 'near-gold', 'silver'], 'platinum', 'labels', '420 exact label tiers')
arrayLegs(subjects[1], 'SILVER_EXCLUSION_REASONS', ['test-not-passed', 'step-verdict-failed', 'self-heal-step',
  'evidence-incomplete', 'cap-exceeded', 'procedure-granularity', 'rerun-overturn-quarantined'],
  'illicit-exclusion', 'rerun', '420 exact silver exclusions')
arrayLegs(subjects[1], 'LABEL_QUARANTINE_MARKERS', ['rerun-overturned'], 'illicit-quarantine', 'rerun', '420 exact quarantine marker')
arrayLegs(subjects[2], 'LABEL_CALIBRATION_STATUSES', ['uncalibrated', 'calibrated'], 'illicit-status', 'calibration', '420 exact calibration status')
for (const member of ['recorded-verdict', 'self-heal-pair', 'user-mark', 'overturned-verdict', 'judge-panel']) {
  const operation = member === 'judge-panel' ? 'add-key' : 'remove-key'
  legs.push({ id: `L${String(legs.length + 1).padStart(2, '0')}`, subject: subjects[2],
    constant: 'CHANNEL_TO_ORIGIN_CLASS', member, operation, family: 'calibration',
    required: ['420 exact channel mapping', '420 exact channel mapping keys',
      ...(operation === 'remove-key' ? [`420 exact channel mapping value ${member}`] : [])] })
}
for (const member of ['recorded-verdict', 'self-heal-pair', 'user-mark', 'overturned-verdict']) {
  legs.push({ id: `L${String(legs.length + 1).padStart(2, '0')}`, subject: subjects[2],
    constant: 'CHANNEL_TO_ORIGIN_CLASS', member, operation: 'value', family: 'calibration',
    required: ['420 exact channel mapping', `420 exact channel mapping value ${member}`] })
}
if (legs.length !== 31) throw new Error('Mutation inventory must contain exactly 31 legs')

function mutate(text, leg) {
  const mapping = leg.constant === 'CHANNEL_TO_ORIGIN_CLASS'
  const pattern = new RegExp(`(export const ${leg.constant} = )(${mapping ? '\\{[\\s\\S]*?\\}' : '\\[[\\s\\S]*?\\]'})( as const)( satisfies [^\\n]+)?`)
  let count = 0
  const output = text.replace(pattern, (all, prefix, declaration, suffix, satisfies = '') => {
    count++
    let changed
    if (mapping) {
      if (leg.operation === 'add-key') changed = declaration.replace(/\}$/, "  'judge-panel': 'import',\n}")
      else {
        const entry = new RegExp(`^  '${leg.member}': '[^']+',\\n`, 'm')
        if (!entry.test(declaration)) throw new Error(`Missing mapping anchor ${leg.member}`)
        changed = declaration.replace(entry, leg.operation === 'value' ? `  '${leg.member}': 'import',\n` : '')
      }
    } else {
      const values = declaration.match(/'[^']*'/g) ?? []
      if (leg.operation === 'remove') {
        if (values.filter(value => value === `'${leg.member}'`).length !== 1) throw new Error(`Missing array anchor ${leg.member}`)
        changed = `[${values.filter(value => value !== `'${leg.member}'`).join(', ')}]`
      } else changed = `[${[...values, `'${leg.member}'`].join(', ')}]`
    }
    // Added illegal members deliberately bypass satisfies: independent type bars
    // must detect the widening even when that production guard is removed.
    return prefix + changed + suffix + ((leg.operation === 'add' || mapping) ? '' : satisfies)
  })
  if (count !== 1 || output === text) throw new Error(`Mutation anchor did not land: ${leg.id}`)
  return output
}

// Measured TypeScript 6.0.3 / Vitest 4.1.5 message + relative file:line:column blocks.
// L23/L24 include three exact source consequences, in addition to all three named assertion bars.
const measured = {
  "L01": {
    "count": 1,
    "digest": "d502e98f04d27ad6663e465cf6d8fa20e22003be94d64e841574eb00d79afdf8"
  },
  "L02": {
    "count": 1,
    "digest": "d502e98f04d27ad6663e465cf6d8fa20e22003be94d64e841574eb00d79afdf8"
  },
  "L03": {
    "count": 1,
    "digest": "d502e98f04d27ad6663e465cf6d8fa20e22003be94d64e841574eb00d79afdf8"
  },
  "L04": {
    "count": 1,
    "digest": "d502e98f04d27ad6663e465cf6d8fa20e22003be94d64e841574eb00d79afdf8"
  },
  "L05": {
    "count": 1,
    "digest": "c7a82b269b7412692ddee5d2d2f2ec2e6ba31bb683a0c08425f8194ff2d84c80"
  },
  "L06": {
    "count": 1,
    "digest": "9263e727eec96f6158fe62d4039e2aad63b13380ee2e98472ab857a478fe3b4a"
  },
  "L07": {
    "count": 1,
    "digest": "9263e727eec96f6158fe62d4039e2aad63b13380ee2e98472ab857a478fe3b4a"
  },
  "L08": {
    "count": 1,
    "digest": "9263e727eec96f6158fe62d4039e2aad63b13380ee2e98472ab857a478fe3b4a"
  },
  "L09": {
    "count": 1,
    "digest": "c736155518b8c84da53f1dd4f8f226799fb7fa47e7af4aa33260821d55fbedd0"
  },
  "L10": {
    "count": 1,
    "digest": "e6103095c42e6c02fedf7d21ad1b273eb3165f97b0c22ee4128b3f0c9fef1fed"
  },
  "L11": {
    "count": 1,
    "digest": "e6103095c42e6c02fedf7d21ad1b273eb3165f97b0c22ee4128b3f0c9fef1fed"
  },
  "L12": {
    "count": 1,
    "digest": "e6103095c42e6c02fedf7d21ad1b273eb3165f97b0c22ee4128b3f0c9fef1fed"
  },
  "L13": {
    "count": 1,
    "digest": "e6103095c42e6c02fedf7d21ad1b273eb3165f97b0c22ee4128b3f0c9fef1fed"
  },
  "L14": {
    "count": 1,
    "digest": "e6103095c42e6c02fedf7d21ad1b273eb3165f97b0c22ee4128b3f0c9fef1fed"
  },
  "L15": {
    "count": 1,
    "digest": "e6103095c42e6c02fedf7d21ad1b273eb3165f97b0c22ee4128b3f0c9fef1fed"
  },
  "L16": {
    "count": 1,
    "digest": "e6103095c42e6c02fedf7d21ad1b273eb3165f97b0c22ee4128b3f0c9fef1fed"
  },
  "L17": {
    "count": 1,
    "digest": "f3358c6f052fb70833e19d6a21563a449e037e90d2361f8f1e1ca1aee976a507"
  },
  "L18": {
    "count": 1,
    "digest": "b22615189d439bcf35225526204af9c18955834cbaad0ebe7a0e601ac4b2789f"
  },
  "L19": {
    "count": 1,
    "digest": "9ad8bd8c329a757ba3de956d9fb35eba8a706d67175f447ef8bfc505ab334b3d"
  },
  "L20": {
    "count": 1,
    "digest": "ccf7bbc423e6ff092b53041d33ce3d51bcd6d622d9cb72e4cb1101f68bfa58ad"
  },
  "L21": {
    "count": 1,
    "digest": "ccf7bbc423e6ff092b53041d33ce3d51bcd6d622d9cb72e4cb1101f68bfa58ad"
  },
  "L22": {
    "count": 1,
    "digest": "ae39fe0116838f7607d1ccba1143d324d0e8bfab85fb5cee73f4599f0eff3ec0"
  },
  "L23": {
    "count": 6,
    "digest": "785cf2b969b27e9356aa4fd2df7036b6bb44f97a5c5da43f3dbbf2480176be90"
  },
  "L24": {
    "count": 6,
    "digest": "4f258cb6c5b216bc9b9b60969442e872e2c2b7825e382bfc7a3e1d219aacc7d2"
  },
  "L25": {
    "count": 3,
    "digest": "695180799c24566bce7203e9052279cb3f7aef49f3a29b65f50fc372924fa63d"
  },
  "L26": {
    "count": 3,
    "digest": "0ac2e5f8069e10f177dab782df53a5635261e4cc1f4648f2037d64ab091ce1af"
  },
  "L27": {
    "count": 2,
    "digest": "b97dc22a0a6f0ef52784c636929d4a180de96941c9768fe78542172f89944b4a"
  },
  "L28": {
    "count": 2,
    "digest": "7bd74fe94b0e7c946dd043b9d7fce6dfc03e1715b8f722e2e8a202a4fc8d3c59"
  },
  "L29": {
    "count": 2,
    "digest": "ca497e9d842e68acb49442a7ce013fc3585cec2ab8bf490d500c33f08606031c"
  },
  "L30": {
    "count": 2,
    "digest": "32dbf1d86ad375304f92cd4d6b4230b0bf79e1731f1893eb3f56237e6750e8eb"
  },
  "L31": {
    "count": 2,
    "digest": "2b86acab822c3917780376cdf3fd2e96923c6ac8e7557ed9e2f34811b9b2ac1a"
  }
}

function parse(log) {
  const clean = log.replace(/\x1b\[[0-9;]*m/g, '')
  const runtime = [...clean.matchAll(/^ FAIL  (src\/[^ ]+\.test\.ts) > (.+)$/gm)].map(match => match[2]).sort()
  const typeTitles = [...clean.matchAll(/^ FAIL  src\/[^ ]+\.test-d\.ts > (.+)$/gm)].map(match => match[1]).sort()
  const diagnostics = [...clean.matchAll(/^(TypeCheckError:[\s\S]*?)^ ❯ (src\/[^\n]+:\d+:\d+)$/gm)]
    .map(match => ({ message: match[1].trim(), pointer: match[2] }))
  const selected = [...clean.matchAll(/^\s*[✓×] (?: TS  )?(src\/[^ ]+) > (.+?)(?: \d+ms)?$/gm)]
  const selectedTypes = [...clean.matchAll(/^\s*[✓×]  TS  src\/[^ ]+ > .+$/gm)].length
  return { clean, runtime, typeTitles, diagnostics, selected: selected.length,
    selectedTypes, digest: sha(JSON.stringify(diagnostics)) }
}
function checkRed(result, leg) {
  if (result.exit === 0) throw new Error(`the suite stayed green under the mutation — ${leg.id} measures nothing`)
  const parsed = parse(result.log)
  if (!parsed.selected || !parsed.selectedTypes || /No test files found|Tests\s+no tests/.test(parsed.clean)) throw new Error(`${leg.id} selected zero named runtime or type tests`)
  if (JSON.stringify(parsed.runtime) !== JSON.stringify([...leg.required].sort())) throw new Error(`${leg.id} unexpected runtime failures: ${JSON.stringify(parsed.runtime)}`)
  const typeTitles = leg.family !== 'calibration' ? leg.required.map(title => title + ' type bars')
    : leg.required.map(title => title === '420 exact channel mapping' || title === '420 exact calibration status' ? title : title + ' type bar')
  if (JSON.stringify(parsed.typeTitles) !== JSON.stringify(typeTitles.sort())) throw new Error(`${leg.id} unexpected named type failures: ${JSON.stringify(parsed.typeTitles)}`)
  const expected = measured[leg.id]
  if (!expected || parsed.digest !== expected.digest || parsed.diagnostics.length !== expected.count) throw new Error(`${leg.id} exact TypeCheckError blocks differ: ${JSON.stringify(parsed.diagnostics)}`)
  if (!parsed.diagnostics.some(block => block.pointer.startsWith(base + families[leg.family][1] + ':'))) throw new Error(`${leg.id} lacks its test-d assertion anchor`)
  if ((parsed.clean.match(/^TypeCheckError:/gm) ?? []).length !== parsed.diagnostics.length) throw new Error(`${leg.id} contains unparsed type diagnostics`)
  if (/^(?:Error|SyntaxError|ReferenceError|RangeError|TypeError):/m.test(parsed.clean)) throw new Error(`${leg.id} contains an unrelated unhandled error`)
  return parsed
}

async function instrument(family, label) {
  const cwd = path.join(root, 'packages/eval')
  const args = [path.join(root, 'node_modules/vitest/vitest.mjs'), 'run',
    ...families[family].map(file => base + file), '--typecheck', '--reporter=verbose', '--maxWorkers=4', '-t', '420 exact']
  const start = Date.now()
  const logPath = path.join(work, `${label}.log`)
  const fd = fs.openSync(logPath, 'wx')
  let timedOut = false
  const exit = await new Promise((resolve, reject) => {
    child = spawn(process.execPath, args, { cwd, detached: true, stdio: ['ignore', fd, fd],
      env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' } })
    let killTimer
    const timer = setTimeout(() => {
      timedOut = true
      stopChild()
      killTimer = setTimeout(() => { if (child?.pid) { try { process.kill(-child.pid, 'SIGKILL') } catch {} } }, 5000)
    }, 120000)
    child.on('error', error => { clearTimeout(timer); reject(error) })
    child.on('exit', (code, signal) => { clearTimeout(timer); clearTimeout(killTimer); child = undefined; resolve(code ?? `signal:${signal}`) })
  })
  fs.closeSync(fd)
  const record = { command: [process.execPath, ...args], cwd, exit, timedOut,
    elapsedMs: Date.now() - start, log: logPath }
  fs.writeFileSync(path.join(work, `${label}.json`), JSON.stringify(record, null, 2) + '\n')
  console.log(`${label}: exit=${exit} elapsedMs=${record.elapsedMs}`)
  if (timedOut) throw new Error(`${label} exceeded 120 seconds`)
  return { ...record, log: fs.readFileSync(logPath, 'utf8') }
}
function checkGreen(result, label) {
  const parsed = parse(result.log)
  if (result.exit !== 0 || !parsed.selected || !parsed.selectedTypes || parsed.runtime.length || parsed.diagnostics.length
    || /No test files found|Tests\s+no tests/.test(parsed.clean)) throw new Error(`${label} did not select and pass its named runtime/type tests`)
  if (!parsed.clean.includes('Type Errors  no errors')) throw new Error(`${label} did not finish typechecking`)
}

async function main() {
  // Refuse all subjects BEFORE owning any bytes. Dirty unrelated files are allowed.
  for (const subject of subjects) cleanGate(root, subject)
  restorationControls()
  for (const subject of subjects) {
    if (!fs.lstatSync(path.join(root, subject)).isFile()) throw new Error(`Non-regular subject: ${subject}`)
    const bytes = fs.readFileSync(path.join(root, subject))
    const snapshot = path.join(work, path.basename(subject) + '.snapshot')
    fs.writeFileSync(snapshot, bytes, { flag: 'wx' })
    owned.set(subject, { path: snapshot, hash: sha(bytes) })
  }
  fs.writeFileSync(path.join(work, 'subjects.json'), JSON.stringify(Object.fromEntries(owned), null, 2) + '\n')
  for (const family of Object.keys(families)) checkGreen(await instrument(family, `preflight-${family}`), family)
  const ledger = []
  for (const leg of legs) {
    console.log(`LEG ${leg.id} ${leg.operation} ${leg.constant} ${leg.member}`)
    const snapshot = owned.get(leg.subject)
    const original = fs.readFileSync(snapshot.path, 'utf8')
    if (mode !== 'neutered') fs.writeFileSync(path.join(root, leg.subject), mutate(original, leg))
    if (mode !== 'neutered' && sha(fs.readFileSync(path.join(root, leg.subject))) === snapshot.hash) throw new Error(`${leg.id} changed nothing`)
    if (mode === 'fatal') throw new Error(`intentional fatal after ${leg.id} mutation`)
    if (mode.startsWith('SIG')) { process.kill(process.pid, mode); await new Promise(resolve => setTimeout(resolve, 100)); throw new Error('Signal handler failed') }
    const result = await instrument(leg.family, `${leg.id}-red`)
    const parsed = checkRed(result, leg)
    // Prove the parser rejects misleading evidence on every leg. The last
    // control includes all measured collateral while deleting test assertions.
    mustReject(`${leg.id} truncated runtime title`, () => checkRed({ ...result,
      log: result.log.replace(` FAIL  ${base + families[leg.family][0]} > ${leg.required[0]}\n`,
        ` FAIL  ${base + families[leg.family][0]} > ${leg.required[0]} trailing\n`) }, leg))
    mustReject(`${leg.id} altered type diagnostic`, () => checkRed({ ...result,
      log: result.log.replace('TypeCheckError:', 'TypeCheckError: altered') }, leg))
    mustReject(`${leg.id} zero selected types`, () => checkRed({ ...result,
      log: result.log.replace(/^.*[✓×]  TS  .*$/gm, '') }, leg))
    mustReject(`${leg.id} collateral without assertion anchors`, () => checkRed({ ...result,
      log: result.log.replace(/^TypeCheckError:[\s\S]*?^ ❯ src\/labels\/__tests__\/[^\n]+$/gm, '') }, leg))
    ledger.push({ ...leg, exit: result.exit, runtime: parsed.runtime, diagnostics: parsed.diagnostics, digest: parsed.digest })
    fs.writeFileSync(path.join(work, 'ledger.json'), JSON.stringify(ledger, null, 2) + '\n')
    console.log(`NAMED RED ${leg.id}: ${parsed.runtime.join(' | ')}; TypeCheckError sha256=${parsed.digest}`)
    restore()
    checkGreen(await instrument(leg.family, `${leg.id}-restored-green`), leg.id)
  }
  restore()
  owned.clear()
  console.log(`PASS: ${ledger.length}/31 legs; named runtime RED, exact type RED, byte-identical restoration and fresh GREEN`)
}
main().catch(error => fatal(error.message))
NODE
