'use strict'
// The shared mutation engine hands back every subject it owns (2026-10-03, quick-261003-tsr WR-14).
//
// Two created files under one directory the run had to make used to abort the restore at the first
// file: the directory was not empty yet, the loop threw, and every later subject stayed mutated.
// These cells plant that shape twice: directly against `restoreSubjects`, and end to end through
// `runGate` interrupted (fatal and SIGTERM) in a throwaway Git repository with a copy of the engine.
// `ENGINE_UNDER_TEST` points the end-to-end cells at another engine file, so a pre-fix copy can be
// driven through the same cells.

const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { test } = require('node:test')

const ENGINE = process.env.ENGINE_UNDER_TEST ?? path.join(__dirname, '..', '423-mutation-engine.cjs')
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex')

function tempRoot(t, prefix) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return root
}

function ownEdited(root, work, file) {
  const target = path.join(root, file)
  const bytes = fs.readFileSync(target)
  const stat = fs.statSync(target)
  const snapshot = path.join(work, `${file.replace(/\//g, '_')}.snapshot`)
  fs.writeFileSync(snapshot, bytes)
  return { path: snapshot, hash: sha(bytes), atimeMs: stat.atimeMs, mtimeMs: stat.mtimeMs }
}

function unitScene(t) {
  const root = tempRoot(t, 'agent-qa-engine-restore-')
  const work = path.join(root, '.work')
  fs.mkdirSync(path.join(root, 'pkg', 'src'), { recursive: true })
  fs.mkdirSync(work)
  for (const file of ['pkg/src/first.ts', 'pkg/src/kept.ts']) fs.writeFileSync(path.join(root, file), `export const ${path.basename(file, '.ts')} = 1\n`)
  const created = ['pkg/src/gone/inner/a.ts', 'pkg/src/gone/b.ts']
  const owned = new Map(['pkg/src/first.ts', 'pkg/src/kept.ts'].map(file => [file, ownEdited(root, work, file)]))
  const dirs = [path.join(root, 'pkg/src/gone'), path.join(root, 'pkg/src/gone/inner')]
  const ownedAbsent = new Map([
    ['pkg/src/gone/inner/a.ts', { dirs }],
    ['pkg/src/gone/b.ts', { dirs: [dirs[0]] }],
  ])
  // First-touch order puts an edited subject BEFORE and AFTER the two created files.
  const allPaths = ['pkg/src/first.ts', ...created, 'pkg/src/kept.ts']
  const before = Object.fromEntries([...owned].map(([file, entry]) => [file, entry.hash]))
  for (const file of created) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
    fs.writeFileSync(path.join(root, file), 'export const back = 1\n')
  }
  for (const file of owned.keys()) fs.writeFileSync(path.join(root, file), 'export const mutated = 2\n')
  return { root, allPaths, owned, ownedAbsent, created, before }
}

test('C261003-TSR-ENGINE-RESTORE: two created files in one new directory are removed, the directories with them, and every edited subject is handed back', t => {
  const { restoreSubjects } = require(ENGINE)
  assert.equal(typeof restoreSubjects, 'function', 'the engine exports restoreSubjects')
  const scene = unitScene(t)
  const lines = []
  restoreSubjects({ ...scene, log: line => lines.push(line) })
  for (const file of scene.created) assert.equal(fs.existsSync(path.join(scene.root, file)), false, `${file} left behind`)
  assert.equal(fs.existsSync(path.join(scene.root, 'pkg/src/gone')), false, 'the created directory was left behind')
  for (const [file, hash] of Object.entries(scene.before)) {
    assert.equal(sha(fs.readFileSync(path.join(scene.root, file))), hash, `${file} was not handed back`)
  }
  assert.deepEqual(lines.filter(line => line.endsWith(' absent')).sort(), scene.created.map(file => `RESTORED ${file} absent`).sort())
})

test('C261003-TSR-ENGINE-RESTORE: a failed step does not stop the rest, and every failure is reported', t => {
  const { restoreSubjects } = require(ENGINE)
  const scene = unitScene(t)
  // One snapshot is corrupted, and a file the run did not create sits in the created directory.
  fs.writeFileSync(scene.owned.get('pkg/src/first.ts').path, 'tampered\n')
  fs.writeFileSync(path.join(scene.root, 'pkg/src/gone/foreign.ts'), 'not ours\n')
  assert.throws(
    () => restoreSubjects({ ...scene, log: () => {} }),
    error => {
      assert.match(error.message, /snapshot corrupted: pkg\/src\/first\.ts/)
      assert.match(error.message, /restore left a created directory behind: pkg\/src\/gone/)
      return true
    },
  )
  assert.equal(sha(fs.readFileSync(path.join(scene.root, 'pkg/src/kept.ts'))), scene.before['pkg/src/kept.ts'],
    'the subject after the failure was not handed back')
  for (const file of scene.created) assert.equal(fs.existsSync(path.join(scene.root, file)), false, `${file} left behind`)
  assert.equal(fs.existsSync(path.join(scene.root, 'pkg/src/gone/inner')), false, 'the emptied inner directory was left behind')
  assert.equal(fs.readFileSync(path.join(scene.root, 'pkg/src/gone/foreign.ts'), 'utf8'), 'not ours\n', 'a file the run did not create was touched')
})

// ---- end to end: an interrupted gate in a throwaway repository ------------------------------

const KEPT = 'export const kept = 1\n'

function fixtureRepository(t) {
  const root = tempRoot(t, 'agent-qa-engine-fixture-')
  const write = (file, text) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
    fs.writeFileSync(path.join(root, file), text)
  }
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true })
  fs.copyFileSync(ENGINE, path.join(root, 'scripts', '423-mutation-engine.cjs'))
  write('packages/fx/src/kept.ts', KEPT)
  // The instrument imports the edited subject and names both created modules, so both arrive.
  write('packages/fx/src/__tests__/x.test.ts', [
    "import { kept } from '../kept'",
    "export const absent = ['fx/src/gone/a.ts', 'fx/src/gone/b.ts', kept]",
    '',
  ].join('\n'))
  write('scripts/fixture-gate.cjs', `'use strict'
const path = require('node:path')
const { runGate, cell } = require(path.join(__dirname, '423-mutation-engine.cjs'))
const red = cell('fx', 'src/__tests__/x.test.ts', 'x')
runGate({
  slug: 'engine-restore-fixture', envPrefix: 'FX', idPrefix: 'X', explicitIds: true, expectedLegs: 2, banner: 'FX_OK',
  instruments: { fx: { pkg: 'packages/fx', files: ['src/__tests__/x.test.ts'], typecheck: false, count: 1 } },
  legs: [
    { id: 'X1', claim: 'GONE', instrument: 'fx', operation: 'two modules return to a deleted directory',
      subject: 'packages/fx/src/gone/a.ts', create: 'export const a = 1\\n',
      also: [{ subject: 'packages/fx/src/gone/b.ts', create: 'export const b = 1\\n' }],
      reds: [red], allowed: [], greens: [] },
    { id: 'X2', claim: 'KEPT', instrument: 'fx', operation: 'the kept module changes its value',
      subject: 'packages/fx/src/kept.ts', edits: [{ from: 'kept = 1', to: 'kept = 2' }],
      reds: [red], allowed: [], greens: [] },
  ],
})
`)
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' })
    assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`)
    return result.stdout
  }
  git('init', '-q')
  git('add', '.')
  git('-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'fixture')
  // The final rebuild is a stub here: this repository has nothing to build.
  const bin = path.join(root, '.bin')
  write('.bin/pnpm', '#!/bin/sh\nexit 0\n')
  fs.chmodSync(path.join(bin, 'pnpm'), 0o755)
  return { root, git, bin }
}

for (const mode of ['fatal', 'SIGTERM']) {
  test(`C261003-TSR-ENGINE-RESTORE: an interrupted gate (${mode}) hands back both created files, their directory and the edited subject after them`, t => {
    const { root, git, bin } = fixtureRepository(t)
    const result = spawnSync(process.execPath, ['scripts/fixture-gate.cjs'], {
      cwd: root,
      encoding: 'utf8',
      timeout: 60_000,
      env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, FX_SELFTEST: mode, FX_EVIDENCE: path.join(root, '.evidence') },
    })
    const output = `${result.stdout}${result.stderr}`
    assert.equal(result.status, 1, output)
    assert.equal((output.match(/^MUTATED /gm) ?? []).length, 3, output)
    assert.equal(fs.readFileSync(path.join(root, 'packages/fx/src/kept.ts'), 'utf8'), KEPT, `the edited subject stayed mutated\n${output}`)
    assert.equal(fs.existsSync(path.join(root, 'packages/fx/src/gone')), false, `the created directory was left behind\n${output}`)
    const reason = mode === 'fatal' ? 'intentional fatal after X1 mutation' : `interrupted by ${mode}`
    assert.deepEqual(output.match(/^FATAL: .+$/gm), [`FATAL: ${reason}`], output)
    for (const line of ['RESTORED packages/fx/src/gone/a.ts absent', 'RESTORED packages/fx/src/gone/b.ts absent']) {
      assert.ok(output.includes(line), `${line}\n${output}`)
    }
    assert.match(output, /^REBUILT workspace \(pnpm turbo run build --force\) exit=0$/m)
    assert.equal(git('status', '--porcelain', '--', 'packages'), '', 'the fixture tree is not clean')
  })
}
