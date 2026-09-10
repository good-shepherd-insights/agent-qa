#!/usr/bin/env bash
# Source-only, serial mutation proof. Installed Node 24 and workspace tools are required.
# AGENT_QA_PANEL_MUTATION_SELFTEST is exactly empty, neutered, fatal, SIGINT, SIGTERM or SIGHUP.
# No downloads, builds, provider calls, or persistent constitution changes.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
exec node --input-type=commonjs - <<'NODE'
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')
const { spawn, spawnSync } = require('node:child_process')
const mode = process.env.AGENT_QA_PANEL_MUTATION_SELFTEST ?? ''
if (!['', 'neutered', 'fatal', 'SIGINT', 'SIGTERM', 'SIGHUP'].includes(mode)) {
  console.error('FATAL: Unknown AGENT_QA_PANEL_MUTATION_SELFTEST')
  process.exit(1)
}
if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Node 24 or later required')
const root = process.cwd()
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-qa-panel-mutation-'))
console.log(`Evidence: ${work}`)
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
const subjects = ['packages/eval/src/judge/panel.ts', 'packages/eval/src/match/score.ts',
  'packages/eval/src/judge/config.ts']
const owned = new Map()
let child, cleanupActive = false
function restore() {
  for (const [file, snapshot] of owned) {
    const bytes = fs.readFileSync(snapshot.path)
    if (sha(bytes) !== snapshot.hash) throw new Error(`snapshot corrupted: ${file}`)
    fs.writeFileSync(path.join(root, file), bytes)
    if (sha(fs.readFileSync(path.join(root, file))) !== snapshot.hash) throw new Error(`restore hash mismatch: ${file}`)
    console.log(`RESTORED ${file} sha256=${snapshot.hash}`)
  }
}
function stopChild(signal = 'SIGTERM') {
  if (child?.pid) { try { process.kill(-child.pid, signal) } catch {} }
}
function fatal(reason) {
  console.error(`FATAL: ${reason}`)
  if (cleanupActive) process.exit(1)
  cleanupActive = true
  stopChild('SIGKILL')
  try { restore() } catch (error) { console.error(`FATAL: cleanup failed: ${error.message}`) }
  process.exit(1)
}
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => fatal(`interrupted by ${signal}`))
process.on('uncaughtException', error => fatal(error.message))
process.on('unhandledRejection', error => fatal(error.message))
process.on('exit', () => {
  if (!cleanupActive) try { restore() } catch (error) {
    console.error(`FATAL: ${error.message}`)
    process.exitCode = 1
  }
})

const runtime = 'src/judge/__tests__/panel-closed-sets.test.ts'
const types = 'src/judge/__tests__/panel-closed-sets.test-d.ts'
const config = 'src/judge/__tests__/config.test.ts'
const hashTitle = 'JUDGE_CONFIG > requires every material change to carry a pinned judge-version bump'
const legs = []
function inventory(subject, type, list, members, title) {
  for (const target of ['list', 'type']) {
    for (const member of members) legs.push({ subject, type, list, target, member, operation: 'remove', title })
    legs.push({ subject, type, list, target, member: 'illicit-panel-member', operation: 'add', title })
  }
}
// Independent inventory: never derive the surviving vocabulary from a production declaration.
inventory(subjects[0], 'PanelPoolingMode', 'PANEL_POOLING_MODES', ['max', 'avg'], 'panel pooling modes exact')
inventory(subjects[1], 'JudgeAbstentionCause', 'JUDGE_ABSTENTION_CAUSES', [
  'unsure-verdict', 'below-threshold', 'swap-disagreement', 'candidate-overflow',
  'missing-evidence', 'residual-tie', 'below-quorum', 'panel-disagreement',
], 'panel abstention causes exact')
legs.push({ subject: subjects[2], target: 'constitution', operation: 'perturb', title: hashTitle })
legs.forEach((leg, index) => { leg.id = `P${String(index + 1).padStart(2, '0')}` })
if (legs.length !== 25) throw new Error('Expected exactly 25 mutation legs')

function mutate(text, leg) {
  if (leg.target === 'constitution') {
    const anchor = "scorePoolingReservation: 'avg is reserved; no scored judge question has a live producer'"
    if (text.split(anchor).length !== 2) throw new Error('Missing constitution anchor')
    return text.replace(anchor, anchor.replace('no scored', 'no current scored'))
  }
  const pattern = leg.target === 'list'
    ? new RegExp(`(export const ${leg.list} = )(\\[[\\s\\S]*?\\])( as const satisfies readonly ${leg.type}\\[\\])`)
    : new RegExp(`(export type ${leg.type} =)([^\\n]*(?:\\n  \\|[^\\n]*)*)`)
  let count = 0
  const output = text.replace(pattern, (all, prefix, declaration, suffix = '') => {
    count++
    const values = declaration.match(/'[^']*'/g) ?? []
    const quoted = `'${leg.member}'`
    if (leg.operation === 'remove' && values.filter(value => value === quoted).length !== 1) throw new Error(`Missing member ${leg.member}`)
    const changed = leg.operation === 'remove' ? values.filter(value => value !== quoted) : [...values, quoted]
    // Remove satisfies only for list-addition legs: the independent type instrument must fire.
    return leg.target === 'list' ? prefix + `[${changed.join(', ')}]` +
      (leg.operation === 'add' ? ' as const' : suffix) : prefix + ' ' + changed.join(' | ')
  })
  if (count !== 1 || output === text) throw new Error(`Mutation anchor did not land: ${leg.id}`)
  return output
}

// Measured Vitest 4.1.5 / TypeScript 6.0.3 diagnostic text and source pointers.
// Named independent test assertions are required in addition to these exact collateral hashes.
const measured = {
  "P01": {
    "count": 2,
    "digest": "56f59267ae201c0cb73ff9d7b9606a754b4b6ce315bff1c89272be5b6d8701c5"
  },
  "P02": {
    "count": 2,
    "digest": "6ccf797bdc20f036481ac8d9c42f4a1daa0c22a181b4138774fde3eb05946a80"
  },
  "P03": {
    "count": 2,
    "digest": "d53869611cc358482ac7b4da137623527f31aa3c06fc4e67dc005aa4255e413c"
  },
  "P04": {
    "count": 5,
    "digest": "0dea03bbfdcc436f9bedadec488a11754195230ab92d82bdf93f6ad94a5ed553"
  },
  "P05": {
    "count": 5,
    "digest": "770674489f8882b90a546bf71d71a67fa826235724074f2773e53678b54dea95"
  },
  "P06": {
    "count": 2,
    "digest": "b50ea9d8430bba9d0968a765ac7a787d120e0215c1dc719e8de13919f0cf3358"
  },
  "P07": {
    "count": 2,
    "digest": "c7d116c93979bbefd0189ca4631f31af782fc0995fcb7d2abdac0891a7ff62fc"
  },
  "P08": {
    "count": 2,
    "digest": "64d5754e04d8fe4b1d6c668662e5d6e360ae3259c9f1f7771dfdcb6326999838"
  },
  "P09": {
    "count": 2,
    "digest": "68fd26023ad0f10ff9617d6a18297c7f1fad8b2ad6c69b4bdf98ca0c00c03767"
  },
  "P10": {
    "count": 2,
    "digest": "73844865e5ef436f48cdcf2d053692384236ab3522ff953710b080a5303c126b"
  },
  "P11": {
    "count": 2,
    "digest": "edd89d297df1ed7af031b11f1776be9484cd055dd02e5079decf9fea0ac38b06"
  },
  "P12": {
    "count": 2,
    "digest": "6557ba5f77dc72801c845cdfc82cbbba8ef503891d8d543abbda99439ec1de46"
  },
  "P13": {
    "count": 2,
    "digest": "1ac4d7873ccf70b5fdead516098d113e7cefcefeb6798ad5f9e16ca35689401c"
  },
  "P14": {
    "count": 2,
    "digest": "398d6d123f1607e6ae9ef6330d3561f18a2c78f41eb16b8ab9fbb778410b92f8"
  },
  "P15": {
    "count": 2,
    "digest": "14b35590b6ebda648f1a55a150e9dc3ecb651cfe85635175f31ae4f28ce9e1d9"
  },
  "P16": {
    "count": 7,
    "digest": "2f432c3e22cbdbfcd1f4d37da234ca4840b2a13d1acd4fc66f2be26a4f81768b"
  },
  "P17": {
    "count": 6,
    "digest": "f93acbefa8d659e3ab958f71b8ce1f32cc73f230347bfd8e071f4cf754fd6c79"
  },
  "P18": {
    "count": 7,
    "digest": "2079688606728fb3d7485d52d28f2d7b115b2269a108e400cda9088d0d2d7577"
  },
  "P19": {
    "count": 5,
    "digest": "118948a35d5f1db9871eb3e6ec02e2fb5384d42a417f2a739cdbd015c7bd29f8"
  },
  "P20": {
    "count": 11,
    "digest": "4e4c3f9b902ea87db34ab44fc131fb8ecea71962fa323caca992fac9a7a908c0"
  },
  "P21": {
    "count": 7,
    "digest": "8ddf46625375f0117002066d3ad2394c5f30a5634959e131341329c5d20444f3"
  },
  "P22": {
    "count": 11,
    "digest": "627bf87d51f7dc385b059df4d72d551e707741f363742dd825d13a32166ddcb3"
  },
  "P23": {
    "count": 7,
    "digest": "95f0db6acf98b5d71af8a124cbc978cedb1fb6e72f982943935fd25a8e5775db"
  },
  "P24": {
    "count": 2,
    "digest": "02161dc44e87e3b1d6ea07db84ca2d2fe171952f63ff85efbd77dc5bde0beb1b"
  },
  "P25": {
    "count": 0,
    "digest": "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945"
  }
}

function parse(log) {
  const clean = log.replace(/\x1b\[[0-9;]*m/g, '')
  const failures = [...clean.matchAll(/^ FAIL  (src\/[^ ]+) > (.+)$/gm)]
    .map(match => ({ file: match[1], title: match[2] }))
  const diagnostics = [...clean.matchAll(/^(TypeCheckError:[\s\S]*?)^ ❯ (src\/[^\n]+:\d+:\d+)$/gm)]
    .map(match => ({ message: match[1].trim(), pointer: match[2] }))
  const selected = [...clean.matchAll(/^\s*[✓×] (?: TS  )?(src\/[^ ]+) > (.+?)(?: \d+ms)?$/gm)]
  if (!selected.length || /No test files found|Tests\s+no tests/.test(clean)) throw new Error('No selected named tests')
  if ((clean.match(/^TypeCheckError:/gm) ?? []).length !== diagnostics.length) throw new Error('Unparsed type diagnostic')
  if (/^(?:Error|SyntaxError|ReferenceError|RangeError|TypeError):/m.test(clean)) throw new Error('Unrelated tool error')
  const selectedTypes = selected.filter(row => row[1] === types).length
  return { clean, failures, diagnostics, selected: selected.length, selectedTypes, digest: sha(JSON.stringify(diagnostics)) }
}
function checkGreen(result) {
  const parsed = parse(result.log)
  if (result.exit !== 0 || parsed.selected !== (result.withTypes ? 5 : 1) || parsed.failures.length || parsed.diagnostics.length ||
    (result.withTypes && (parsed.selectedTypes !== 3 || !parsed.clean.includes('Type Errors  no errors')))) throw new Error('Preflight/restored instrument did not pass')
}
function checkRed(result, leg) {
  if (result.exit === 0) throw new Error('suite stayed green')
  if (result.exit !== 1) throw new Error(`Unexpected tool exit ${result.exit}`)
  const parsed = parse(result.log)
  if (parsed.selected !== (result.withTypes ? 5 : 1)) throw new Error('Missing selected runtime/type cells')
  const expected = leg.target === 'constitution' ? [{ file: config, title: hashTitle }]
    : [...(leg.target === 'list' ? [{ file: runtime, title: leg.title }] : []),
      { file: types, title: leg.title + ' type bars' }]
  const key = rows => [...new Set(rows.map(row => `${row.file} > ${row.title}`))].sort().join('\n')
  if (key(parsed.failures) !== key(expected)) throw new Error(`Unexpected named failures: ${key(parsed.failures)}`)
  const pin = measured[leg.id]
  if (!pin || pin.count !== parsed.diagnostics.length || pin.digest !== parsed.digest) throw new Error(`Unknown compiler diagnostics: ${leg.id} ${parsed.digest}`)
  if (leg.target !== 'constitution') {
    if (parsed.selectedTypes !== 3) throw new Error('Missing selected type cells')
    if (!parsed.diagnostics.some(row => row.pointer.startsWith(types + ':'))) throw new Error('Missing intended type assertion')
    for (const diagnostic of parsed.diagnostics) {
      if (diagnostic.pointer.startsWith(types + ':')) {
        if (!/^TypeCheckError: (Type .* does not satisfy the constraint|This expression is not callable\.)/s.test(diagnostic.message)) throw new Error('Unknown assertion diagnostic')
      }
    }
  } else if (parsed.diagnostics.length) throw new Error('Unexpected constitution type error')
  return parsed
}
async function instrument(leg, label) {
  const withTypes = leg.target !== 'constitution'
  const args = [path.join(root, 'node_modules/vitest/vitest.mjs'), 'run',
    ...(withTypes ? [runtime, types, '--typecheck'] : [config, '--typecheck.enabled=false']),
    '--reporter=verbose', '--maxWorkers=1', '-t', withTypes ? 'panel ' : 'requires every material change to carry a pinned judge-version bump']
  const logPath = path.join(work, `${label}.log`)
  const fd = fs.openSync(logPath, 'wx')
  const start = Date.now()
  let timedOut = false
  const exit = await new Promise((resolve, reject) => {
    child = spawn(process.execPath, args, { cwd: path.join(root, 'packages/eval'), detached: true,
      stdio: ['ignore', fd, fd], env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' } })
    const timer = setTimeout(() => { timedOut = true; stopChild('SIGKILL') }, 120000)
    child.on('error', error => { clearTimeout(timer); reject(error) })
    child.on('exit', (code, signal) => { clearTimeout(timer); child = undefined; resolve(code ?? `signal:${signal}`) })
  })
  fs.closeSync(fd)
  const record = { command: [process.execPath, ...args], exit, withTypes, elapsedMs: Date.now() - start, logPath }
  fs.writeFileSync(path.join(work, `${label}.json`), JSON.stringify(record, null, 2) + '\n')
  console.log(`${label}: exit=${exit} elapsedMs=${record.elapsedMs}`)
  if (timedOut) throw new Error('Instrument timed out')
  return { ...record, log: fs.readFileSync(logPath, 'utf8') }
}
function mustReject(name, fn) {
  let rejected = false
  try { fn() } catch { rejected = true }
  if (!rejected) throw new Error(`Parser accepted ${name}`)
  console.log(`CONTROL rejected: ${name}`)
}
async function main() {
  // Check every subject before owning any bytes; never discard unrelated edits.
  for (const file of subjects) {
    const status = spawnSync('git', ['status', '--porcelain', '--', file], { cwd: root, encoding: 'utf8' })
    if (status.status !== 0 || status.stdout.trim()) throw new Error(`${file} is dirty or untracked — refusing mutation`)
    if (!fs.lstatSync(file).isFile()) throw new Error(`Non-regular subject: ${file}`)
  }
  for (const file of subjects) {
    const bytes = fs.readFileSync(file)
    const snapshot = path.join(work, path.basename(file) + '.snapshot')
    fs.writeFileSync(snapshot, bytes, { flag: 'wx' })
    owned.set(file, { path: snapshot, hash: sha(bytes) })
  }
  fs.writeFileSync(path.join(work, 'subjects.json'), JSON.stringify(Object.fromEntries(owned), null, 2) + '\n')
  checkGreen(await instrument(legs[0], 'preflight-vocabulary'))
  checkGreen(await instrument(legs[24], 'preflight-constitution'))
  const ledger = []
  for (const leg of legs) {
    console.log(`LEG ${leg.id} ${leg.target} ${leg.operation} ${leg.member ?? 'constitution'}`)
    const snapshot = owned.get(leg.subject)
    if (mode !== 'neutered') {
      fs.writeFileSync(leg.subject, mutate(fs.readFileSync(snapshot.path, 'utf8'), leg))
      if (sha(fs.readFileSync(leg.subject)) === snapshot.hash) throw new Error('Mutation changed no bytes')
    }
    if (mode === 'fatal') throw new Error(`intentional fatal after ${leg.id} mutation`)
    if (mode.startsWith('SIG')) {
      process.kill(process.pid, mode)
      await new Promise(resolve => setTimeout(resolve, 100))
      throw new Error('Signal handler failed')
    }
    const result = await instrument(leg, `${leg.id}-red`)
    const parsed = checkRed(result, leg)
    mustReject('tool crash', () => checkRed({ ...result, exit: 2 }, leg))
    mustReject('unrelated error', () => checkRed({ ...result, log: result.log + '\nError: unrelated\n' }, leg))
    mustReject('wrong named cell', () => checkRed({ ...result,
      log: result.log.replace(/^( FAIL  src\/[^ ]+ > .+)$/m, '$1 trailing') }, leg))
    if (leg.target !== 'constitution') mustReject('missing type assertion', () => checkRed({ ...result,
      log: result.log.replace(/^TypeCheckError:[\s\S]*?^ ❯ src\/judge\/__tests__\/panel-closed-sets.test-d.ts:[^\n]+$/gm, '') }, leg))
    if (leg.target !== 'constitution') mustReject('altered compiler diagnostic', () => checkRed({ ...result,
      log: result.log.replace('TypeCheckError:', 'TypeCheckError: altered') }, leg))
    ledger.push({ ...leg, exit: result.exit, failures: parsed.failures, diagnostics: parsed.diagnostics, digest: parsed.digest })
    fs.writeFileSync(path.join(work, 'ledger.json'), JSON.stringify(ledger, null, 2) + '\n')
    console.log(`NAMED RED ${leg.id}: ${parsed.failures.map(row => row.title).join(' | ')}; diagnostics=${parsed.digest}`)
    restore()
    checkGreen(await instrument(leg, `${leg.id}-restored-green`))
  }
  restore()
  owned.clear()
  console.log(`PANEL_MUTATION_OK legs=${ledger.length} named-red=25 byte-identical-restoration=25`)
}
main().catch(error => fatal(error.message))
NODE
