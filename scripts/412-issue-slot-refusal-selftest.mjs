#!/usr/bin/env node
// Exercise the real mutation leg and EXIT restoration only on self-owned temporary files.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, existsSync, lstatSync, readlinkSync, rmSync, writeFileSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const source = readFileSync(new URL('./412-issue-slot-mutation.sh', import.meta.url), 'utf8')
function definition(name, text = source) {
  const match = text.match(new RegExp(`^${name} \\(\\) \\{\\n.*?^\\}`, 'ms'))
  assert.ok(match, `missing real ${name} function`)
  return match[0]
}

const cases = [
  { name: 'existing regular file', subjects: '', created: 'existing.txt', refusal: 'already exists' },
  { name: 'later existing file in created list', subjects: '', created: 'new.txt\nexisting.txt', refusal: 'already exists' },
  { name: 'dangling link', subjects: '', created: 'dangling.txt', refusal: 'already exists' },
  { name: 'dirty subject before snapshots', subjects: 'subject.txt\ndirty.txt', created: 'existing.txt', refusal: 'dirty before the snapshot' },
  { name: 'empty created list cleanup', subjects: 'subject.txt', created: '', mutation: true },
  { name: 'owned subject and created path cleanup', subjects: 'subject.txt', created: 'new.txt', mutation: true },
]

function runCase(test, runLeg = definition('run_leg')) {
  const root = mkdtempSync(join(tmpdir(), 'issue-slot-refusal-'))
  try {
    for (const name of ['existing.txt', 'subject.txt', 'dirty.txt']) {
      writeFileSync(join(root, name), `original ${name}\n`)
    }
    symlinkSync('absent-target', join(root, 'dangling.txt'))
    // clean_gate is the controlled external dirty-state boundary. The real run_leg,
    // real cp snapshots and real restore_current execute in a separate Bash process.
    // apply_mutation is the controlled failure boundary; it only edits these owned files.
    const harness = `set -euo pipefail
REPO_ROOT="$1"
CURRENT_SUBJECTS=""
CURRENT_CREATED=""
CURRENT_REBUILD=""
snapshot_path () { printf '%s/snapshot-%s' "$REPO_ROOT" "$1"; }
clean_gate () {
  if [ "$1" = dirty.txt ]; then
    echo "FATAL: dirty.txt is dirty before the snapshot" >&2
    exit 1
  fi
}
apply_mutation () {
  printf 'changed by owned mutation\\n' > "$REPO_ROOT/subject.txt"
  if [ -n "$CURRENT_CREATED" ]; then
    printf 'created by owned mutation\\n' > "$REPO_ROOT/$CURRENT_CREATED"
  fi
  exit 77
}
${definition('restore_current')}
${runLeg}
trap restore_current EXIT
run_leg refusal-selftest owned-fixture runtime unused unused unused unused "" "$2" "$3"
`
    const result = spawnSync('/bin/bash', ['-c', harness, 'refusal-selftest', root, test.subjects, test.created], {
      encoding: 'utf8',
    })
    assert.ifError(result.error)
    assert.equal(result.status, test.mutation ? 77 : 1, `${test.name}: ${result.stderr}`)
    if (test.refusal) assert.ok(result.stderr.includes(test.refusal), `${test.name}: refusal missing`)
    for (const name of ['existing.txt', 'subject.txt', 'dirty.txt']) {
      assert.ok(existsSync(join(root, name)), `${test.name}: pre-existing ${name} was deleted`)
      assert.equal(readFileSync(join(root, name), 'utf8'), `original ${name}\n`, `${test.name}: ${name} changed`)
    }
    assert.equal(lstatSync(join(root, 'dangling.txt')).isSymbolicLink(), true, `${test.name}: link lost`)
    assert.equal(readlinkSync(join(root, 'dangling.txt')), 'absent-target')
    assert.equal(existsSync(join(root, 'new.txt')), false, `${test.name}: created path survived`)
    if (test.refusal) {
      assert.equal(existsSync(join(root, 'snapshot-subject.txt')), false, `${test.name}: snapshot preceded refusal`)
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

for (const test of cases) {
  runCase(test)
  console.log(`PASS: ${test.name}`)
}

// Reintroduce only the ownership-order defect in an in-memory copy. A green control
// would mean this instrument cannot detect the original destructive refusal.
const fixed = definition('run_leg')
const anchor = '  local subjects="$9" created="${10}"'
assert.ok(fixed.includes(anchor), 'ownership negative-control anchor missing')
const broken = fixed.replace(anchor, `${anchor}\n  CURRENT_SUBJECTS="$9"\n  CURRENT_CREATED="\${10}"`)
assert.throws(() => runCase(cases[0], broken), /pre-existing existing\.txt was deleted/)
console.log('PASS: old ownership ordering is rejected by the preservation assertion')
console.log('ISSUE_SLOT_REFUSAL_SELFTEST_OK controls=6 negative=1')
