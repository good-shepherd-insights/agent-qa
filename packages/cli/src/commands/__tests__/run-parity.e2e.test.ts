// THE `agent-qa run` PARITY DIFFERENTIAL — the committed half (Phase 401 plan 11).
//
// WHY A CELL AND NOT A PROCEDURE. Plan 11 extracts the whole in-process run execution out of
// `run.ts`. A refactor that is supposed to change nothing observable has nothing to go red first,
// so its acceptance bar is a parity reading — and a parity reading that lives only in a plan's
// `<action>` and a SUMMARY table passes identically whether the measurement happened, was skipped,
// or was invented. Worse than a command that cannot fail: there is no command at all.
//
// The five pre-existing door suites this plan re-runs (`run-gate.e2e`, `run-gate-suite.e2e`,
// `run-markers`, `run-door-invocation-census`, `run-session-exit-codes`) range NONE of stderr
// bytes, reporter ordering, run-directory contents or the `--all` exit-code fold. A botched
// extraction on any of those axes would ship green without this file.
//
// THE GOLDEN IS THE PRE-EXTRACTION TREE. `__fixtures__/run-parity-golden.json` was captured by
// `node scripts/401-11-capture-parity.mjs --write` on a `pnpm build --force` dist built BEFORE a
// single line of the extraction was written, and committed in its own commit ahead of the refactor
// commit. If this cell reds, the extraction changed observable behaviour: fix the extraction.
// REGENERATING THE GOLDEN IS A PLAN-LEVEL FAILURE, not a fix.
//
// ONE SCRUBBER. The generator exports it and this file imports it (below), so a golden and a
// reading can never be scrubbed by two rules that quietly disagree.
//
// RUNS ON `dist`. Every `<verify>` line that includes this file runs `pnpm build --force` first: a
// reading taken on a stale dist compares two copies of the previous build and calls it a
// measurement.

import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import {
  CLI_DIST,
  PARITY_GOLDEN_PATH,
  PARITY_INVOCATIONS,
  assertGoldenNonVacuous,
  captureInvocation,
  scrubTranscript,
} from '../../../../../scripts/401-11-capture-parity.mjs'
import type { ParityGolden, ParityReading } from '../../../../../scripts/401-11-capture-parity.mjs'

/**
 * The golden is checked for non-vacuity ON LOAD rather than trusted for being a file: a golden
 * captured from a broken build (empty stdout, a run that never started) would make every
 * comparison below trivially true, which is the failure this whole instrument exists to prevent.
 */
const golden: ParityGolden = assertGoldenNonVacuous(
  JSON.parse(readFileSync(PARITY_GOLDEN_PATH, 'utf8')) as ParityGolden,
)

function goldenFor(id: string): ParityReading {
  const reading = golden.readings.find((entry) => entry.id === id)
  if (reading === undefined) throw new Error(`no golden reading for "${id}"`)
  return reading
}

describe('agent-qa run parity across the in-process extraction (401-11)', () => {
  it('the instrument itself is real: the shipped binary exists and the scrubber is the generator’s', () => {
    // Without this, a missing dist would make every reading below an identical empty transcript —
    // and a locally re-declared scrubber would make "byte-identical" a statement about two copies
    // of the same bug.
    expect(existsSync(CLI_DIST)).toBe(true)
    expect(typeof scrubTranscript).toBe('function')
    expect(
      scrubTranscript('ran in 1.25s under /tmp/x', {
        project: '/tmp/x',
        tmp: '/tmp',
        repoRoot: '/repo',
      }),
    ).toBe('ran in <DUR> under <PROJECT>')
  })

  for (const invocation of PARITY_INVOCATIONS) {
    it(
      `\`agent-qa run ${invocation.args.join(' ')}\` is byte-identical to the pre-extraction reading`,
      async () => {
        const expected = goldenFor(invocation.id)
        const actual = await captureInvocation(invocation)

        // Six discriminators, asserted separately so a red NAMES the axis that moved rather than
        // dumping one object diff. Exit code LAST is deliberate elsewhere in this phase (a code
        // alone is satisfiable by two different worlds); here the reporter transcript comes first
        // because it is the axis a person actually reads.
        expect(actual.stdout).toBe(expected.stdout)
        expect(actual.stderr).toBe(expected.stderr)
        expect(actual.eventTypes).toEqual([...expected.eventTypes])
        expect(actual.targetHits).toEqual([...expected.targetHits])
        expect(actual.runDirFiles).toEqual([...expected.runDirFiles])
        expect(actual.exitCode).toBe(expected.exitCode)
      },
      180_000,
    )
  }
})
