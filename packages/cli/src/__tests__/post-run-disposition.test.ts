// LIFE-02's posture cells, measured on the SHIPPED BINARY (Phase 404 plan 01, D-09/D-12).
//
// WHY A SPAWNED RUN AND NOT A UNIT MAPPING. `runFinished.disposition` is decided inside the runner
// shell, by a step composed at a CLI composition root, threaded through the invocation core, over a
// writer lease that lives on disk. A unit test of the decision function is blind to every one of
// those hops — and the defect this phase exists to retire is precisely a door that never calls the
// step at all (D-12: "a unit-level mapping test [is] blind to a door that never calls the
// post-verdict step"). So the assertion is made against `events.jsonl` — the run's own permanent
// record — after `node dist/cli.js run` has exited.
//
// RED BASELINE, measured 2026-08-26 against the version-0.2 checkout at 6ec921b2 with the same
// hermetic fixture this cell builds:
//
//     5 runFinished {"aggregateVerdict":"cancelled","disposition":"detached","finalSeq":5}
//
// The literal was hardcoded in `shell.ts`, so a run with no daemon anywhere reported that nobody
// would drain it while it was about to drain itself. Forcing that literal back reds this file.
//
// THE FIXTURE FAILS FAST ON PURPOSE. `hermeticEnv` points `HOME` into the temp project, so the
// spawned CLI resolves no browser and the single member ends `skipped` in milliseconds. That is
// enough for this claim: the terminal sequence — verdict, then the post-verdict step, then
// `runFinished` — runs identically whatever the members did, and a cell that drove a real browser
// would be measuring Chromium's availability rather than the run's disposition.
//
// NO DAEMON IS STARTED HERE, which is what makes the expected posture `drained`: nothing holds the
// writer lease, so the step takes it and the run says so. 404-04 extends this file with the
// `handedOff` leg (a real `agent-qa daemon` holding the lease), the `--detach` leg and the gate-run
// leg — the three that complete D-12's set.

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  ANCHORED_BUILDS,
  buildFreshness,
  cleanupTempRoots,
  CLI_ENTRY,
  REBUILD_INSTRUCTION,
  spawnCollecting,
  trackTempRoot,
} from './conformance/spawned-chat.js'

const describePosix = process.platform === 'win32' ? describe.skip : describe

/** The id shape the parser accepts: `t_` plus ten id-agent words. */
const PROBE_TEST_ID = 't_ponent-toa-base-fred-click-sigma-lad-agen-report-sticky'

/**
 * A project a real `agent-qa run` completes against, with NOTHING it does not need.
 *
 * `fixtureProject` in the conformance harness serves the chat/MCP anchors and declares no target,
 * no hooks file and no env files — a `run` refuses on each of those in turn before it reaches a
 * verdict. This builds the minimum a run accepts: one unreachable local target, one member, and the
 * three empty files the config resolver requires to exist.
 *
 * Exported so 404-04's added legs and the LIFE-01 sequence cells drive the SAME project rather than
 * a second one that could differ in a way nobody notices.
 */
export function runFixtureProject(label: string, memberCount = 1): {
  root: string
  configPath: string
} {
  const root = trackTempRoot(mkdtempSync(join(tmpdir(), `agent-qa-404-${label}-`)))
  writeFileSync(
    join(root, 'agent-qa.config.yaml'),
    [
      'workspace:',
      '  testMatch:',
      '    - tests/**/*.yaml',
      '  testPathIgnore: []',
      '  suiteMatch:',
      '    - suites/**/*.suite.yaml',
      '  hooksFile: hooks.yaml',
      '  envFile: .env',
      '  secretsFile: .env.secrets.local',
      'use:',
      '  mobile:',
      '    appState: preserve',
      'registry:',
      '  targets:',
      '    probe:',
      '      platform: web',
      // Port 9 is the discard protocol — reserved, never listening, and refused instantly rather
      // than left to a connect timeout.
      '      url: http://127.0.0.1:9/unreachable',
      '      environment: local',
      '',
    ].join('\n'),
    'utf8',
  )
  writeFileSync(join(root, 'hooks.yaml'), 'hooks: []\n', 'utf8')
  writeFileSync(join(root, '.env'), '', 'utf8')
  writeFileSync(join(root, '.env.secrets.local'), '', 'utf8')
  mkdirSync(join(root, 'tests'), { recursive: true })
  mkdirSync(join(root, '.agent-qa'), { recursive: true })
  for (let i = 0; i < memberCount; i += 1) {
    writeFileSync(
      join(root, 'tests', `probe-${String(i)}.yaml`),
      [
        // Every member carries the SAME explicit test-id: the parser only judges its shape, and a
        // per-member id would make the fixture's member count a second thing to keep in step.
        `test-id: ${PROBE_TEST_ID}`,
        `name: disposition probe ${String(i)}`,
        'target: probe',
        'steps:',
        '  - Verify the page says "nothing"',
        '',
      ].join('\n'),
      'utf8',
    )
  }
  return { root, configPath: join(root, 'agent-qa.config.yaml') }
}

/**
 * The run's own event log, parsed.
 *
 * The run directory is DISCOVERED rather than derived: the CLI mints the id itself and does not
 * print it on the passing path, and re-deriving `slugBranch(runId)` here would be a second spelling
 * of the runs-dir layout. A fixture that ran exactly one run has exactly one directory, and this
 * refuses rather than guesses if that is ever untrue.
 */
export function readRunEvents(root: string): {
  runId: string
  events: { seq: number; type: string; payload: Record<string, unknown> }[]
} {
  const runsDir = join(root, '.agent-qa', 'runs')
  const dirs = readdirSync(runsDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
  if (dirs.length !== 1) {
    throw new Error(
      `expected exactly one run directory under ${runsDir}, found ${JSON.stringify(dirs)}`,
    )
  }
  const runDir = dirs[0]
  const raw = readFileSync(join(runsDir, runDir, 'events.jsonl'), 'utf8')
  const events = raw
    .split('\n')
    .filter(line => line.trim() !== '')
    .map(line => JSON.parse(line) as { seq: number; type: string; payload: Record<string, unknown> })
  return { runId: runDir, events }
}

afterEach(() => {
  cleanupTempRoots()
})

describePosix('LIFE-02: runFinished.disposition on the shipped binary (D-09/D-12)', () => {
  it('a real `agent-qa run` with no daemon holding the writer lease writes disposition: drained, after its own verdict', async () => {
    const freshness = buildFreshness(ANCHORED_BUILDS)
    expect(
      { missing: freshness.missing, stale: freshness.stale },
      `this cell drives the built CLI: ${REBUILD_INSTRUCTION}`,
    ).toEqual({ missing: [], stale: [] })

    const { root } = runFixtureProject('drained')
    const outcome = await spawnCollecting(root, [CLI_ENTRY, 'run', 'tests/probe-0.yaml'])
    expect(
      outcome.signal,
      `the run must exit on its own, not on a signal (stderr: ${outcome.stderr})`,
    ).toBeNull()

    const { events } = readRunEvents(root)
    const finishes = events.filter(event => event.type === 'runFinished')
    const verdicts = events.filter(event => event.type === 'verdict')
    expect(finishes, 'runFinished is published exactly once per run').toHaveLength(1)
    expect(verdicts, 'verdict is published exactly once per run').toHaveLength(1)

    const finished = finishes[0]
    expect(
      finished.payload.disposition,
      'no daemon holds the lease, so THIS process took it and will pump — the wire must say drained',
    ).toBe('drained')
    expect(
      finished.payload.finalSeq,
      'finalSeq is runFinished\'s own seq (the next seq the bus stamps)',
    ).toBe(finished.seq)
    expect(
      verdicts[0].seq,
      'the verdict lands before the post-verdict step and therefore before runFinished',
    ).toBeLessThan(finished.seq)
  }, 300_000)
})
