// The CLI door's SUITE path denies fail-closed too (Phase 401 plan 04, D-02 / D-16, T-401-11).
//
// SINCE 432-13 (D-01/D-14/D-18) the suite path, like the test path, refuses only an un-opted-in
// production target. The gate row (a), its remedies and `--trust-session` are gone; the cells were
// re-spelled onto the production refusal, which keeps artifacts (b)–(d) and the exit code 2. The
// history below is kept as written.
//
// Plan 03 gated `agent-qa run <test>`. This file is about the other half of the same door:
// `agent-qa run <suite>`, which until plan 04 assembled and started a run of its own with no gate
// anywhere near it. The elevation-of-privilege threat the phase registers (T-401-11, severity high)
// is exactly "the suite path bypasses the gate", and it is not answered by the single-test cells —
// a run that begins on the other path is a run that began.
//
// THE ASSERTION SURFACE IS FIVE ARTIFACTS, NEVER AN EXIT CODE ALONE. This is plan 03's Mutation-B
// finding applied here: hoisting assembly above the gate left the denial FULLY INTACT — right audit
// `outcome`, right stderr, right exit code — while the refused run had already consumed a durable
// build ordinal and knocked on the target. Only the ordering assertions caught it. So each denial
// leg below asserts:
//
//   (a) the execution-audit ROW the gate writes on every decision, on its `outcome` FIELD
//       (`fail-closed-denied`) — never on a message substring;
//   (b) NO run events. `runStarted` is seq 1 of any run that began at all;
//   (c) NO `build-ordinals.json` — the durable assembly side effect. A denial that still bumped the
//       counter would mean assembly ran, the probe with it;
//   (d) ZERO requests at the target, measured on the target's own side;
//   (e) the stderr a person reads carries THE ROW'S OWN REASON plus the CLI-renderable remedies.
//       The expected text is not typed into this file: (e) reads the reason back off artifact (a),
//       which is what pins the door to RENDERING the gate's decision rather than composing a
//       sentence of its own.
//
// …and the exit code last, and never alone: `2` is "no verdict was produced", and `1` would be "the
// tests failed", which a denied run must never be mistaken for because nothing ran.
//
// THE ALLOW CONTROLS ARE THE SAME DOOR WITH ONE FIELD CHANGED. Without them a `run` command that
// denied EVERYTHING would pass every denial cell above. Two of them: the target declared `local`,
// and the SAME shared target with `--trust-session`.
//
// THE RED BASELINE, measured on the pre-migration binary (submodule bb9a4192, `pnpm build --force`)
// with this exact fixture and this exact invocation, before a line of the migration was written:
//
//                     pre-migration                    post-migration
//   audit rows        []  (no gate decision at all)    1 row, fail-closed-denied
//   run events        runStarted … runFinished         []
//   build-ordinals    present                          absent
//   probeHits         ["/suite-thing", "/suite-thing"] []
//   exit              1  ("the tests failed")          2  ("no verdict was produced")
//
// Every leg of every denial cell below is red on that build, and red for the RIGHT reason: artifact
// (a) fails first with `expected [] to have a length of 1` — the `run:start` row does not exist,
// because the suite path never asked. An exit-code assertion alone would have been satisfied by a
// pre-migration build too, for a reason with nothing to do with authorization.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { rmSync } from 'node:fs'

import {
  auditRows,
  buildOrdinalsExist,
  CountingTarget,
  createSuiteFixture,
  eventTypes,
  runCli,
  type FixtureEnvironment,
  type SuiteFixture,
} from './suite-run-fixture.js'

const target = new CountingTarget()
let fixtures: SuiteFixture[] = []

beforeAll(async () => { await target.listen() })
afterAll(async () => { await target.close() })

beforeEach(() => {
  target.reset()
  fixtures = []
})

afterEach(() => {
  for (const fixture of fixtures) rmSync(fixture.project, { recursive: true, force: true })
})

function fixtureFor(environment: FixtureEnvironment): SuiteFixture {
  const fixture = createSuiteFixture({ origin: target.origin, environment })
  fixtures.push(fixture)
  return fixture
}

describe('the CLI suite path refuses an un-opted-in production run and it never starts (D-16, D-18)', () => {
  // RE-SPELLED 2026-09-30 (432-13): was a no-tty suite run against a shared or undeclared target
  // refused by the run gate. Those start now; production is the class that still refuses.
  it('a no-tty suite run against a production target with no opt-in is refused before anything happens', async () => {
    const fixture = fixtureFor('production')

    const result = await runCli(fixture, fixture.suitePattern)

    // (a) no decision row: the production refusal is not a gate decision
    expect(auditRows(fixture)).toEqual([])
    // (b) no run began
    expect(eventTypes(fixture)).toEqual([])
    // (c) no assembly
    expect(buildOrdinalsExist(fixture)).toBe(false)
    // (d) and nobody knocked
    expect(target.hits).toEqual([])
    // (e) the person saw the refusal, naming the target and the opt-in
    expect(result.stderr).toContain('Run denied')
    expect(result.stderr).toContain('"suite-thing"')
    expect(result.stderr).toContain('allowProduction: true')
    expect(result.stderr).not.toMatch(/--trust-session|re-run on an interactive terminal/)
    expect(result.status).toBe(2)
  }, 180_000)

  it.each<[string, FixtureEnvironment]>([
    ['local-declared', 'local'],
    ['shared-declared', 'shared'],
    ['undeclared', undefined],
  ])('the allow control: a no-tty suite run against a %s target starts', async (_label, environment) => {
    const fixture = fixtureFor(environment)

    const result = await runCli(fixture, fixture.suitePattern)

    expect(auditRows(fixture).filter((row) => row.action === 'run:start')).toEqual([])
    expect(eventTypes(fixture)[0]).toBe('runStarted')
    expect(buildOrdinalsExist(fixture)).toBe(true)
    expect(target.hits).toContain('/suite-thing')
    expect(result.stderr).not.toContain('Run denied')
  }, 180_000)
})

// ---------------------------------------------------------------------------------------------
// --dry-run: the disposition RESEARCH Open Q2 records under D-02, measured rather than asserted.
//
// "Stops BEFORE invoking the core" is an ORDERING claim, and briefing §C's rule is that an ordering
// claim is proven by the ABSENCE of the downstream side effects, not by the absence of output. So
// this cell asserts the same five artifacts the denial legs do — with one difference that matters:
// there is no audit row EITHER. A dry run is not a refused run; it is a question about what would
// run, and a decision about nothing has nothing to record.
//
// AND IT IS A REAL BEHAVIOUR FIX. On the pre-migration binary this exact invocation EXECUTED THE
// SUITE: `probeHits: ["/suite-thing","/suite-thing"]`, `build-ordinals.json` present, a full
// `runStarted…runFinished` event log, a handoff, exit 1. The suite path simply had no `--dry-run`
// handling; only the single-test path did. Every assertion below is red on that build.
describe('--dry-run stops before the core on the suite path (RESEARCH Open Q2 / D-02)', () => {
  it('reports the suite and its members, and starts nothing — not even a gate decision', async () => {
    const fixture = fixtureFor('local')

    const result = await runCli(fixture, fixture.suitePattern, '--dry-run')

    // It reported. (An "absence" cell that never proved the command did its job would pass on a
    // command that crashed at argv parsing.)
    expect(result.stdout).toContain('Found 1 suite(s), 1 test(s):')
    expect(result.stdout).toContain('the gated suite')
    expect(result.stdout).toContain('tests/member.yaml')
    expect(result.status).toBe(0)

    // No gate decision — the run was never a candidate, so there was nothing to authorize.
    expect(auditRows(fixture).filter((row) => row.action === 'run:start')).toEqual([])
    // No run.
    expect(eventTypes(fixture)).toEqual([])
    // No assembly: no ordinal…
    expect(buildOrdinalsExist(fixture)).toBe(false)
    // …and no knock at the target.
    expect(target.hits).toEqual([])
  }, 180_000)
})
