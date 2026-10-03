'use strict'
// The 432 mutation map, held to its two instruments (432-43, PXH-SAFE-05; EDGE-16).
//
// THREE SPELLINGS OF ONE TABLE. The phase's mutation map has 94 rows: 78 removed members (A01..A78)
// and 16 retained behaviours (B01..B16), each with one mutation target and one exact RED cell. The
// driver (`432-approval-permission-mutation.sh`) declares them, the selftest
// (`432-approval-permission-mutation-selftest.sh`) re-spells them, and THIS file spells them a third
// time from the map itself. A row dropped, doubled, re-aimed or re-pointed in either script reds here.
//
// KEYED, NEVER POSITIONAL. Every comparison below joins by row id. A table that matched by position
// would agree with any reordering — and a reordering is exactly how a missing member hides behind the
// one after it — so the order-independence cells permute the driver's inventory and require every
// single-row loss to be named whatever the order.
//
// No byte is owned here: the driver lists its inventory and the selftest writes its expected table to a
// temporary file, and neither runs a leg.
//
// 2026-10-03 (quick-261003-tsr, IN-41): `pnpm run validate:arch` runs this file (and the engine's
// restore cells beside it), so the forced gate and every pre-commit check hold the map.

const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { test } = require('node:test')

const ROOT = path.resolve(__dirname, '..', '..')
const DRIVER = 'scripts/432-approval-permission-mutation.sh'
const SELFTEST = 'scripts/432-approval-permission-mutation-selftest.sh'
const P = 'packages/'

// ---- the map, spelled from 432-MUTATION-MAP.md ---------------------------------------------------
// Each row: the map's mutation target (and, for the five public returns, every dependent path), and
// the exact RED cell. Corrections the code forced are recorded: B02 is `cli/src/commands/run.ts`
// (432-03), B11 is the promotion-gate line (432-10 #1), A64 is observed through the rebuilt binary
// (432-42 #4).

const MAP = {
  A01: [`${P}cli/src/composition/local-agent-host.ts`],
  A02: [`${P}cli/src/commands/chat.ts`],
  A03: [`${P}cli/src/commands/chat.ts`],
  A04: [`${P}cli/src/commands/knowledge-maintain.ts`],
  A05: [`${P}cli/src/commands/cache.ts`],
  A06: [`${P}cli/src/commands/knowledge-maintain.ts`],
  A07: [`${P}dashboard-server/src/chat/chat-routes.ts`],
  A08: [`${P}dashboard-server/src/chat/chat-routes.ts`],
  A09: [`${P}dashboard-ui/src/components/run-confirm-dialog.tsx`],
  A10: [`${P}dashboard-ui/src/components/run-detail/feedback-approval.tsx`],
  A11: [`${P}dashboard-server/src/chat/confirm-registry.ts`],
  A12: [`${P}safety/src/policy/gate.ts`],
  A13: [`${P}safety/src/policy/gate.ts`],
  A14: [`${P}safety/src/policy/gate.ts`],
  A15: [`${P}safety/src/policy/gate-hook.ts`],
  A16: [`${P}safety/src/ports/policy-ports.ts`],
  A17: [`${P}safety-local/src/readline-confirm.ts`],
  A18: [`${P}agent/src/functions/registry.ts`],
  A19: [`${P}agent/src/functions/registry.ts`],
  A20: [`${P}knowledge-local/src/grants/ledger.ts`],
  A21: [`${P}knowledge-local/src/grants/reader.ts`],
  A22: [`${P}schema/src/safety/standing-approval.ts`],
  A23: [`${P}schema/src/safety/protected-classes.ts`],
  A24: [`${P}schema/src/safety/protected-classes.ts`],
  ...Object.fromEntries(Array.from({ length: 10 }, (_, index) => [`A${25 + index}`, [`${P}agent/src/functions/registry.ts`]])),
  ...Object.fromEntries(Array.from({ length: 6 }, (_, index) => [`A${35 + index}`, [`${P}mcp/src/mapping.ts`]])),
  A41: [`${P}schema/src/proposal/envelope.ts`],
  A42: [`${P}knowledge-local/src/review/proposals-store.ts`],
  A43: [`${P}knowledge-local/src/review/proposals-inbox.ts`],
  A44: [`${P}cli/src/commands/proposals.ts`],
  A45: [`${P}agent/src/functions/spec.ts`],
  ...Object.fromEntries(Array.from({ length: 7 }, (_, index) => [`A${46 + index}`, [`${P}schema/src/functions/function-scope.ts`]])),
  A53: [`${P}agent/src/functions/spec.ts`],
  A54: [`${P}schema/src/functions/function-caller.ts`],
  A55: [`${P}schema/src/functions/function-caller.ts`],
  A56: [`${P}schema/src/functions/function-caller.ts`],
  A57: [`${P}schema/src/functions/function-caller.ts`],
  A58: [`${P}mcp/src/visibility.ts`],
  A59: [`${P}core/src/schema/services-schema.ts`, `${P}schema/src/config/mcp.ts`, `${P}schema/src/config/index.ts`, `${P}schema/src/index.ts`],
  A60: [`${P}cli/src/commands/mcp.ts`],
  A61: [`${P}core/src/schema/services-schema.ts`, `${P}schema/src/config/run-service.ts`, `${P}schema/src/config/index.ts`, `${P}schema/src/index.ts`],
  A62: [`${P}dashboard-server/src/run-service/run-service-routes.ts`],
  A63: [`${P}core/src/schema/services-schema.ts`, `${P}schema/src/config/mcp.ts`, `${P}schema/src/config/index.ts`, `${P}schema/src/index.ts`],
  A64: [`${P}cli/src/commands/run.ts`],
  A65: [`${P}core/src/schema/config-schema.ts`],
  A66: [`${P}safety/src/policy/execution-context.ts`],
  A67: [`${P}agent/src/chat/turn-engine.ts`],
  A68: [`${P}agent/src/chat/pin-overlay.ts`],
  A69: [`${P}schema/src/safety/remedies.ts`],
  A70: [`${P}schema/src/safety/remedies.ts`],
  A71: [`${P}schema/src/safety/remedies.ts`],
  A72: [`${P}schema/src/safety/remedies.ts`],
  A73: [`${P}cli/src/commands/receipt-line.ts`],
  A74: [`${P}dashboard-ui/src/components/run-detail/denial-block.tsx`],
  A75: [`${P}safety/src/policy/lexicon.ts`],
  A76: [`${P}safety-local/src/jsonl-audit-sink.ts`],
  A77: [`${P}safety/src/ports/audit-sink.ts`],
  A78: [`${P}cli/src/composition/local-agent-host.ts`],
  B01: [`${P}agent-local/src/composition/run-invocation-core.ts`],
  B02: [`${P}cli/src/commands/run.ts`],
  B03: [`${P}dashboard-server/src/live-editor/live-session.ts`],
  B04: [`${P}knowledge-local/src/curator/knowledge-store.ts`],
  B05: [`${P}knowledge-local/src/curator/author-contract.ts`],
  B06: [`${P}cli/src/gates/feedback-host.ts`],
  B07: [`${P}dashboard-server/src/config/config-manager.ts`],
  B08: [`${P}agent/src/authoring/loop.ts`],
  B09: [`${P}schema/src/config/masking.ts`],
  B10: [`${P}dashboard-ui/src/pages/config.tsx`],
  B11: [`${P}schema/src/knowledge/promotion-gate.ts`],
  B12: [`${P}cli/src/commands/mcp.ts`],
  B13: [`${P}cli/src/commands/mcp.ts`],
  B14: [`${P}dashboard-server/src/server/routes.ts`],
  B15: [`${P}dashboard-server/src/run-service/run-service-routes.ts`],
  B16: [`${P}safety-local/src/jsonl-audit-sink.ts`],
}

/** The exact RED cell of each B row, and the file that holds it (map, "Retained behavior"). */
const B_RED = {
  B01: ['src/composition/__tests__/432-production-boundary.test.ts', 'C432-PRODUCTION-BEFORE-EFFECTS'],
  B02: ['src/composition/__tests__/432-production-producers.test.ts', 'C432-MIXED-SUITE-PRODUCTION'],
  B03: ['src/__tests__/432-editor-production.test.ts', 'C432-EDITOR-PRODUCTION'],
  B04: ['src/review/__tests__/432-direct-review.test.ts', 'C432-EXPLICIT-ALL-CONTEXTS'],
  B05: ['src/curator/__tests__/disposition.test.ts', 'C432-CURATION-CONTEXT'],
  B06: ['src/gates/__tests__/feedback-host.test.ts', 'C432-MARK-RETRY-ONCE'],
  B07: ['src/composition/__tests__/432-direct-config.test.ts', 'C432-CONFIG-OUTSIDE-EDIT'],
  B08: ['src/__tests__/authoring-loop.e2e.test.ts', 'C432-TEST-WRITE-DISPOSITION'],
  B09: ['src/__tests__/config-schema-leaves.test.ts', 'C432-CONFIG-LEAVES-92'],
  B10: ['src/pages/__tests__/config-page.schema-coverage.test.tsx', 'C432-CONFIG-WRITABLE-88'],
  B11: ['src/review/__tests__/gate-inconsistency.test.ts', 'C432-INCONSISTENCY-HOLD'],
  B12: ['src/__tests__/mcp-mark-credential.test.ts', 'C432-RETAINED-HOST'],
  B13: ['src/__tests__/mcp-mark-credential.test.ts', 'C432-RETAINED-ORIGIN'],
  B14: ['src/__tests__/dashboard-door-security.test.ts', 'C432-RETAINED-CROSS-SITE'],
  B15: ['src/__tests__/live-view-masking.test.ts', 'C432-RETAINED-LIVE-LINK'],
  B16: ['src/__tests__/jsonl-audit-sink.test.ts', 'C432-GUARDRAIL-AUDIT-RETAINED'],
}

const CENSUS = 'src/__tests__/432-approval-permission-deleted.test.ts'
const IDS = [
  ...Array.from({ length: 78 }, (_, index) => `A${String(index + 1).padStart(2, '0')}`),
  ...Array.from({ length: 16 }, (_, index) => `B${String(index + 1).padStart(2, '0')}`),
]

/** The row's exact RED cell, as the map names it. */
function redCellOf(id) {
  return id.startsWith('A') ? [CENSUS, `C432-RETURN-${id}`] : B_RED[id]
}

/** Every path a leg touches, as its inventory spells them. */
const pathsOf = leg => leg.paths ?? [leg.subject]

function listDriver() {
  const listed = spawnSync('bash', [DRIVER], { cwd: ROOT, encoding: 'utf8', timeout: 60_000,
    env: { ...process.env, AGENT_QA_432_APPROVAL_PERMISSION_MUTATION_LIST: '1' } })
  assert.equal(listed.status, 0, listed.stderr)
  return JSON.parse(listed.stdout)
}

function selftestExpected() {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-qa-432-map-')), 'expected.json')
  const run = spawnSync('bash', [SELFTEST], { cwd: ROOT, encoding: 'utf8', timeout: 60_000,
    env: { ...process.env, AGENT_QA_432_APPROVAL_PERMISSION_MUTATION_SELFTEST_EXPECTED: out } })
  assert.equal(run.status, 0, run.stderr)
  const expected = JSON.parse(fs.readFileSync(out, 'utf8'))
  fs.rmSync(path.dirname(out), { recursive: true, force: true })
  return expected
}

/**
 * Join the map to an inventory BY ID. Returns what the inventory lacks, doubles, adds, re-points (a
 * target or dependent path that is not the map's) or re-aims (a first RED that is not the row's cell).
 */
function joinMap(inventory) {
  const byId = new Map()
  for (const leg of inventory) byId.set(leg.id, [...(byId.get(leg.id) ?? []), leg])
  const one = id => (byId.get(id) ?? []).length === 1 ? byId.get(id)[0] : undefined
  const aimed = (leg, id) => {
    const [file, name] = redCellOf(id)
    return leg.reds.length > 0 && leg.reds.every(red => red.startsWith(`${file} > ${name}`))
  }
  return {
    missing: IDS.filter(id => (byId.get(id) ?? []).length === 0),
    duplicated: IDS.filter(id => (byId.get(id) ?? []).length > 1),
    foreign: [...byId.keys()].filter(id => !IDS.includes(id)),
    repointed: IDS.filter(id => one(id) !== undefined && JSON.stringify(pathsOf(one(id))) !== JSON.stringify(MAP[id])),
    misaimed: IDS.filter(id => one(id) !== undefined && !aimed(one(id), id)),
  }
}
const CLEAN = { missing: [], duplicated: [], foreign: [], repointed: [], misaimed: [] }

test('C432-MUTATION-ALL-MEMBERS: the map has 94 rows, 78 members and 16 behaviours, each with a target and a RED', () => {
  assert.equal(IDS.length, 94)
  assert.deepEqual(Object.keys(MAP).sort(), [...IDS].sort())
  for (const id of IDS) {
    assert.ok(MAP[id].length > 0, `${id} has no target`)
    assert.ok(redCellOf(id) !== undefined, `${id} has no RED`)
  }
  const reds = IDS.map(id => redCellOf(id).join(' > '))
  assert.equal(new Set(reds).size, reds.length, 'two rows share one RED cell')
})

test('C432-MUTATION-ALL-MEMBERS: the driver registers exactly the map, keyed by row id', () => {
  const inventory = listDriver()
  assert.equal(inventory.length, 94)
  assert.deepEqual(joinMap(inventory), CLEAN)
  // Unique mapping both ways: no two legs require the same RED, and every required RED is a row's.
  const required = inventory.flatMap(leg => leg.reds.map(red => `${leg.id} ${red.replace(/ \[.*\]$/, '')}`))
  const cells = required.map(entry => entry.slice(4))
  assert.equal(new Set(cells).size, cells.length, `a RED cell is required by two legs:\n${required.join('\n')}`)
  console.log(`MAP legs=${inventory.length} reds=${cells.length}`)
})

test('C432-MUTATION-ALL-MEMBERS: registration order cannot hide a missing, doubled or re-pointed member (EDGE-16)', () => {
  const inventory = listDriver()
  const rotate = (list, by) => [...list.slice(by), ...list.slice(0, by)]
  const orders = [
    inventory,
    [...inventory].reverse(),
    rotate(inventory, 41),
    [...inventory].sort((a, b) => a.subject.localeCompare(b.subject) || b.id.localeCompare(a.id)),
    [...inventory.filter((_, index) => index % 3 === 2), ...inventory.filter((_, index) => index % 3 !== 2)],
  ]
  for (const order of orders) {
    assert.deepEqual(joinMap(order), CLEAN, 'a reordered registration changed the join')
    for (const [index, leg] of order.entries()) {
      const without = [...order.slice(0, index), ...order.slice(index + 1)]
      assert.deepEqual(joinMap(without).missing, [leg.id], `dropping ${leg.id} was not seen`)
      assert.deepEqual(joinMap([...order, leg]).duplicated, [leg.id], `doubling ${leg.id} was not seen`)
      const elsewhere = order.map(entry => entry === leg ? { ...entry, subject: `${P}nowhere.ts`, paths: [`${P}nowhere.ts`] } : entry)
      assert.deepEqual(joinMap(elsewhere).repointed, [leg.id], `re-pointing ${leg.id} was not seen`)
    }
  }
})

test('C432-MUTATION-ALL-MEMBERS: the five public returns pin their declarations, dependent paths and rebuilt dist', () => {
  const byId = Object.fromEntries(listDriver().map(leg => [leg.id, leg]))
  const PARSER = 'the public parser accepts the removed member ('
  const pins = {
    A59: { crossing: '@vostride/agent-qa-core', message: `${PARSER}services.mcp.tokens)` },
    A61: { crossing: '@vostride/agent-qa-core', message: `${PARSER}services.dashboard.runServiceTokens)` },
    A63: { crossing: '@vostride/agent-qa-core', message: `${PARSER}services.mcp.stdio)` },
    A64: { crossing: 'agent-qa', message: 'the run command registers the trust flag again' },
    A65: { crossing: '@vostride/agent-qa-core', message: `${PARSER}safety)` },
  }
  for (const [id, pin] of Object.entries(pins)) {
    assert.deepEqual(pathsOf(byId[id]), MAP[id], `${id} touches other files than its declaration set`)
    assert.equal(byId[id].crossing, pin.crossing, `${id} does not rebuild ${pin.crossing}`)
    assert.deepEqual(byId[id].reds, [`${CENSUS} > C432-RETURN-${id} [${pin.message}]`], `${id} does not name its parser or Commander assertion`)
  }
  // Exactly these five A legs cross a dist; every other A leg is observed in source.
  assert.deepEqual(Object.values(byId).filter(leg => leg.id.startsWith('A') && leg.crossing !== null).map(leg => leg.id), Object.keys(pins))
})

test('C432-MUTATION-ALL-MEMBERS: every created path is a deleted module the census names, and every edited path is tracked', () => {
  const census = fs.readFileSync(path.join(ROOT, 'packages/arch', CENSUS), 'utf8')
  const atHead = file => spawnSync('git', ['cat-file', '-e', `HEAD:${file}`], { cwd: ROOT }).status === 0
  const created = new Set()
  for (const leg of listDriver()) {
    for (const file of pathsOf(leg)) {
      if (atHead(file)) {
        assert.ok(fs.existsSync(path.join(ROOT, file)), `${leg.id}: ${file} is tracked but missing on disk`)
        continue
      }
      // A path the leg creates: absent on disk and at HEAD, a module the phase deleted, and named by
      // the census's deleted-module inventory, so its return reds C432-DELETED-SYMBOLS as well.
      assert.ok(leg.id.startsWith('A'), `${leg.id}: a retained-behaviour leg creates ${file}`)
      assert.ok(!fs.existsSync(path.join(ROOT, file)), `${leg.id}: ${file} already exists`)
      assert.ok(census.includes(`'${file.slice(P.length)}',`), `${leg.id}: ${file} is not in the census's deleted-module inventory`)
      created.add(file)
    }
  }
  assert.equal(created.size, 22, `created modules: ${[...created].join(', ')}`)
  console.log(`MAP created-modules=${created.size}`)
})

test('C432-MUTATION-SELFTEST: the selftest spells every leg, target and RED itself, equal to the map and the driver', () => {
  const expected = selftestExpected()
  assert.equal(expected.length, 94)
  assert.deepEqual(joinMap(expected), CLEAN, 'the selftest table disagrees with the map')
  const inventory = listDriver()
  const project = leg => ({ id: leg.id, claim: leg.claim, subject: leg.subject, reds: leg.reds,
    crossing: leg.crossing ?? null, ...(leg.paths === undefined ? {} : { paths: leg.paths }) })
  const byId = list => Object.fromEntries(list.map(leg => [leg.id, project(leg)]))
  assert.deepEqual(byId(expected), byId(inventory), 'the selftest and the driver spell a leg differently')
})

test('C432-MUTATION-SELFTEST: the selftest is independent of the driver and carries the full restoration contract', () => {
  const selftest = fs.readFileSync(path.join(ROOT, SELFTEST), 'utf8')
  const scripts = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).scripts
  assert.equal(scripts['validate:432-approval-permission-mutation'], `bash ${DRIVER}`)
  assert.equal(scripts['validate:432-approval-permission-mutation-selftest'], `bash ${SELFTEST}`)
  // It spells its rows (one literal per id) and never reads the driver's table to build them.
  for (const id of IDS) assert.ok(selftest.includes(`'${id}'`), `the selftest does not spell ${id}`)
  assert.ok(!/require\([^)]*432-approval-permission-mutation\.sh/.test(selftest), 'the selftest imports the driver')
  assert.ok(!selftest.includes('_MUTATION_LIST'), 'the selftest builds its table from the driver listing')
  assert.ok(selftest.includes('runSelftest('), 'the selftest does not run the shared restoration contract')
  // The shared contract it runs: every leg neutered, the four interruptions, a dirty subject refused,
  // invalid knobs refused before ownership, and runner failures never read as RED.
  const engine = fs.readFileSync(path.join(ROOT, 'scripts/423-mutation-engine.cjs'), 'utf8')
  for (const clause of [
    "for (const mode of ['fatal', 'SIGINT', 'SIGTERM', 'SIGHUP'])",
    'a dirty subject is refused and left exactly as found',
    'FATALs when ${leg.claim} stays green',
    'invalid knobs refuse before any byte is owned',
    "mustReject('a tool crash'",
    "mustReject('no JSON verdicts'",
    "mustReject('a missing named cell'",
    "mustReject('a red without its named assertion'",
    'a suite file failed to load',
    'instrument timed out',
  ]) assert.ok(engine.includes(clause), `the engine lost: ${clause}`)
})
