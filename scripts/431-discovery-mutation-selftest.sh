#!/usr/bin/env bash
# The discovery mutation instrument's own test (431-13). Every declared leg is run NEUTERED — the
# mutation withheld — and must FATAL with "<leg>: suite stayed green" after an actual green child of
# its own suite. The interruption modes (fatal, SIGINT, SIGTERM, SIGHUP) must mutate every subject
# and hand back the exact bytes and mtimes, then rebuild; a dirty subject must be refused and left
# as found; invalid knobs, an unknown group and an occupied evidence path refuse before ownership.
#
# THE INVENTORY BELOW IS WRITTEN OUT, NOT DERIVED. A leg silently dropped, re-aimed, renamed or moved
# to another group in 431-discovery-mutation.sh reddens HERE instead of shrinking both in step.
#
# Runs in place on the real tree. Slow; a phase gate, not a per-commit sample.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
exec node --test-reporter=tap --input-type=commonjs - <<'NODE'
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const assert = require('node:assert/strict')
const { test } = require('node:test')
const { spawnSync } = require('node:child_process')
const { runSelftest } = require(path.join(process.cwd(), 'scripts/423-mutation-engine.cjs'))

const GATE = 'scripts/431-discovery-mutation.sh'
const PREFIX = 'AGENT_QA_431_DISCOVERY_MUTATION'
const BANNER = 'DISCOVERY_MUTATION_OK'

const MAPPING_SRC = 'packages/mcp/src/mapping.ts'
const COMPOSE_SRC = 'packages/agent-local/src/composition/compose-local-agent.ts'
const FLOOR_SRC = 'packages/knowledge-local/src/embedder-floor.ts'

const GUARD = 'src/__tests__/mapping-bump-guard.test.ts'
const PROJECTION = 'src/__tests__/431-knowledge-projection.test.ts'
const COLD_SCOPE = 'src/composition/__tests__/431-overview-cold-scope.test.ts'
const COLD_RUNTIME = 'src/__tests__/431-mcp-no-embedder.test.ts'

const expected = [
  { id: 'D01', claim: 'MCP-NAMES-EXACT', subject: MAPPING_SRC,
    reds: [`${GUARD} > MCP-NAMES-EXACT`, `${GUARD} > shares no name with the live catalogue`] },
  { id: 'D02', claim: 'MCP-NAMES-EXACT', subject: MAPPING_SRC,
    reds: [`${GUARD} > MCP-NAMES-EXACT`, `${GUARD} > MCP-PARTITION`] },
  { id: 'D03', claim: 'MCP-OPS-EXACT', subject: MAPPING_SRC,
    reds: [`${GUARD} > MCP-OPS-EXACT`, `${GUARD} > advertises exactly the declared arms, in the declared order`] },
  { id: 'D04', claim: 'MCP-ADJUDICATIONS', subject: MAPPING_SRC, reds: [`${GUARD} > MCP-ADJUDICATIONS`] },
  { id: 'D05', claim: 'MCP-ADJUDICATIONS', subject: MAPPING_SRC, reds: [`${GUARD} > MCP-ADJUDICATIONS`] },
  { id: 'D06', claim: 'MCP-PARTITION', subject: MAPPING_SRC, reds: [`${GUARD} > MCP-PARTITION`] },
  { id: 'D07', claim: 'REGISTRY-NO-SEARCH', subject: MAPPING_SRC,
    reds: [`${PROJECTION} > registers no search op and projects no search tool`] },
  { id: 'D08', claim: 'OVERVIEW-COLD-SCOPE', subject: COMPOSE_SRC,
    reds: [
      `${COLD_SCOPE} > pins the cold read-scope allowlist to exactly six stored-text reads`,
      `${COLD_SCOPE} > masks declared secrets in the cold overview and keeps the rest readable`,
      `${COLD_SCOPE} > opens the scope for the overview and not for an unrelated read`,
    ] },
  { id: 'D09', claim: 'COLD-MCP-NO-RUNTIME', subject: FLOOR_SRC, crossing: '@vostride/agent-qa-knowledge-local',
    reds: [
      `${COLD_RUNTIME} > the stdio \`agent-qa mcp\` door starts, lists and answers every populated read with no runtime load`,
      `${COLD_RUNTIME} > the dashboard co-hosted MCP door answers every read and both evidence arms with no runtime load`,
    ] },
]

const GROUPS = {
  D01: 'contracts', D02: 'contracts', D03: 'contracts', D04: 'contracts', D05: 'contracts',
  D06: 'contracts', D07: 'contracts', D08: 'contracts', D09: 'contracts',
}

runSelftest({
  slug: '431-discovery-mutation',
  gateScript: GATE,
  envPrefix: PREFIX,
  idPrefix: 'D', banner: BANNER,
  registration: {
    'validate:431-discovery-mutation': 'bash scripts/431-discovery-mutation.sh',
    'validate:431-discovery-mutation-selftest': 'bash scripts/431-discovery-mutation-selftest.sh',
  },
  expected,
})

// ---- groups, and the evidence path the gate reserves ------------------------------------------
const root = process.cwd()
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-qa-431-discovery-mutation-selftest-owned-'))
const subjects = [...new Set(expected.map(leg => leg.subject))]
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const stateOf = () => subjects.map(file => ({ file, hash: sha(path.join(root, file)),
  mtimeMs: Math.round(fs.statSync(path.join(root, file)).mtimeMs) }))
const gitClean = () => {
  const status = spawnSync('git', ['status', '--porcelain', '--', ...subjects], { cwd: root, encoding: 'utf8' })
  assert.equal(status.status, 0)
  assert.equal(status.stdout, '', 'every subject must be clean in git after the run')
}
function run(label, args, env) {
  const childEnv = { ...process.env }
  for (const key of Object.keys(childEnv)) if (key.startsWith(`${PREFIX}_`)) delete childEnv[key]
  Object.assign(childEnv, env)
  const log = path.join(scratch, `${label}.log`)
  const fd = fs.openSync(log, 'wx')
  const result = spawnSync('bash', [GATE, ...args], { cwd: root, env: childEnv, stdio: ['ignore', fd, fd], timeout: 3_600_000 })
  fs.closeSync(fd)
  assert.equal(result.error, undefined, `${label}: child tool failure`)
  assert.equal(result.signal, null, `${label}: uncontrolled child signal`)
  return { status: result.status, output: fs.readFileSync(log, 'utf8') }
}
const fatalLines = output => output.match(/^FATAL: .+$/gm) ?? []

test('431-discovery-mutation: every leg sits in its written-out group', () => {
  const listed = spawnSync('bash', [GATE], { cwd: root, encoding: 'utf8', env: { ...process.env, [`${PREFIX}_LIST`]: '1' } })
  assert.equal(listed.status, 0, listed.stderr)
  const inventory = JSON.parse(listed.stdout)
  assert.deepEqual(Object.fromEntries(inventory.map(leg => [leg.id, leg.group])), GROUPS)
  console.log(`SELFTEST groups legs=${inventory.length}`)
})

test('431-discovery-mutation: an unknown group or argument refuses before ownership', () => {
  const before = stateOf()
  for (const [label, args, env, reason] of [
    ['unknown-group', ['--group', 'bogus'], {}, 'Unknown group: bogus'],
    ['group-without-value', ['--group'], {}, 'Missing value for --group'],
    ['unknown-argument', ['--bogus'], {}, 'Unknown argument: --bogus'],
  ]) {
    const result = run(label, args, env)
    assert.equal(result.status, 1, result.output)
    assert.deepEqual(fatalLines(result.output), [`FATAL: ${reason}`], result.output)
    assert.ok(!/ARRIVAL |RESTORED |MUTATED /.test(result.output), result.output)
    console.log(`SELFTEST ${label} exit=1 before-ownership=1`)
  }
  assert.deepEqual(stateOf(), before)
  gitClean()
})

test('431-discovery-mutation: an occupied evidence path is refused and its contents survive', () => {
  const before = stateOf()
  const occupied = path.join(scratch, 'occupied-evidence')
  fs.mkdirSync(occupied)
  const sentinel = path.join(occupied, 'OWNER')
  fs.writeFileSync(sentinel, 'owned by another run; the gate must not touch this\n')
  const result = run('occupied-evidence', [], { [`${PREFIX}_EVIDENCE`]: occupied })
  assert.equal(result.status, 1, result.output)
  assert.deepEqual(fatalLines(result.output), [`FATAL: ${occupied} is occupied — refusing a scratch path this run did not create`], result.output)
  assert.ok(!/ARRIVAL |RESTORED |MUTATED /.test(result.output), result.output)
  assert.deepEqual(fs.readdirSync(occupied), ['OWNER'])
  assert.equal(fs.readFileSync(sentinel, 'utf8'), 'owned by another run; the gate must not touch this\n')
  assert.deepEqual(stateOf(), before)
  gitClean()
  console.log('SELFTEST occupied-evidence exit=1 foreign-contents-kept=1')
})

test('431-discovery-mutation: a fatal run reserves the named evidence path and restores every subject', () => {
  const before = stateOf()
  const evidence = path.join(scratch, 'reserved-evidence')
  const result = run('reserved-evidence', [], { [`${PREFIX}_EVIDENCE`]: evidence, [`${PREFIX}_SELFTEST`]: 'fatal' })
  assert.equal(result.status, 1, result.output)
  assert.deepEqual(fatalLines(result.output), ['FATAL: intentional fatal after D01 mutation'], result.output)
  assert.match(result.output, new RegExp(`^Evidence: ${evidence.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'))
  const owned = JSON.parse(fs.readFileSync(path.join(evidence, 'subjects.json'), 'utf8'))
  assert.deepEqual(Object.keys(owned).sort(), [...subjects].sort())
  for (const entry of before) {
    assert.equal(owned[entry.file].hash, entry.hash)
    assert.ok(result.output.includes(`RESTORED ${entry.file} sha256=${entry.hash}`), `${entry.file} restoration line`)
  }
  assert.match(result.output, /^REBUILT workspace \(pnpm turbo run build --force\) exit=0$/m)
  assert.deepEqual(stateOf(), before)
  gitClean()
  console.log(`SELFTEST reserved-evidence exit=1 restored=${subjects.length} rebuilt=1`)
})
NODE
