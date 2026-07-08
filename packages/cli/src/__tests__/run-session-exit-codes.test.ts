// Phase 361 Plan 11 (D-09 / D-14 · T-361-08 · T-361-02): the CLI-side regression lock that BOTH run
// invocation shapes (the suite path AND the single-test path) exit through `mapVerdictToExitCode`
// and construct the identity `MaskingContext` UNCONDITIONALLY (decoupled from cache enablement).
//
// Source-anchored where full execution is impractical (the wm-flush delegate-anchor convention:
// readFileSync + pattern assertions over run.ts / run-session-composition.ts), direct-map pins where
// a unit assertion IS possible (the imported D-14 map called for every verdict). Plan 12's phase
// roll-call delegates the D-09/D-14 CLI-boundary proof to this suite — a new run path or a
// cache-conditioned masking regression cannot ship without tripping these anchors.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { mapVerdictToExitCode } from '@vostride/agent-qa-runner'

const runSource = readFileSync(fileURLToPath(new URL('../commands/run.ts', import.meta.url)), 'utf8')
const compositionSource = readFileSync(
  fileURLToPath(new URL('../run-session-composition.ts', import.meta.url)),
  'utf8',
)

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1
}

// (c) The D-14 table re-pinned at the CLI import — called directly for all five verdicts. This is
// the CI-gate contract (T-361-08): the mapping the whole CLI now funnels through.
describe('D-14 exit map re-pinned at the CLI boundary', () => {
  it('passed and healed map to 0 (healed is ratified as a pass — the annotation is not the exit code)', () => {
    expect(mapVerdictToExitCode('passed')).toBe(0)
    expect(mapVerdictToExitCode('healed')).toBe(0)
  })

  it('failed and timeout map to 1', () => {
    expect(mapVerdictToExitCode('failed')).toBe(1)
    expect(mapVerdictToExitCode('timeout')).toBe(1)
  })

  it('cancelled maps to 130 (the existing SIGINT convention)', () => {
    expect(mapVerdictToExitCode('cancelled')).toBe(130)
  })
})

// (a) Source anchors: BOTH composition paths compose startRun and derive the exit code from the
// verdict — the ad-hoc `hasFailed ? 1 : 0` boolean aggregation is gone from the single-test path.
describe('both CLI run paths exit through the verdict map (T-361-08)', () => {
  it('composes startRun in both the suite path and the single-test path', () => {
    expect(count(runSource, 'startRun({')).toBeGreaterThanOrEqual(2)
  })

  it('maps the verdict to the exit code in both paths — no ad-hoc hasFailed boolean survives', () => {
    expect(count(runSource, 'mapVerdictToExitCode(')).toBeGreaterThanOrEqual(2)
    expect(runSource).not.toContain('hasFailed')
  })
})

// (b) 362-06 SEAM-01/03 — the suite (multi-member) path activates the seams: it seeds a real run
// MaskingContext, wraps the run body in `runSafetyScope`, threads the per-run SafetyHookRunner into
// the member executor, wires `--trust-session`, and disposes the context LAST (Pitfall 8). The
// identity mint (`buildIdentityMasking()`) no longer feeds the suite path's RunConfig.masking.
describe('the suite path seeds a real run MaskingContext inside runSafetyScope (SEAM-01/03, 362-06)', () => {
  it('registers the --trust-session flag and reads config.safety?.trustMode', () => {
    expect(runSource).toContain('--trust-session')
    expect(runSource).toContain('config.safety?.trustMode')
  })

  it('wraps at least one run body in runSafetyScope with a real seeded run MaskingContext', () => {
    expect(count(runSource, 'runSafetyScope(')).toBeGreaterThanOrEqual(1)
    expect(count(runSource, 'buildRunMaskingContext(')).toBeGreaterThanOrEqual(1)
    // The suite RunConfig masking is the run context, not the identity mint.
    expect(runSource).toContain('masking: maskingContext')
  })

  it('threads the per-run SafetyHookRunner into the suite member executor', () => {
    expect(count(runSource, 'buildRunSafetyHooks(')).toBeGreaterThanOrEqual(1)
    expect(count(runSource, 'safetyHooks:')).toBeGreaterThanOrEqual(1)
  })

  it('disposes the run MaskingContext inside a finally, lexically after lifecycle.finalize()', () => {
    const finalizeIdx = runSource.indexOf('await lifecycle.finalize()')
    const disposeIdx = runSource.indexOf('maskingContext.dispose()')
    expect(finalizeIdx).toBeGreaterThan(0)
    expect(disposeIdx).toBeGreaterThan(finalizeIdx)
    // A `finally {` opens between finalize and dispose — dispose is the last statement in the scope.
    expect(runSource.slice(finalizeIdx, disposeIdx)).toContain('finally {')
  })
})

// (e) SESSION-04 force-exit backstop (Plan 361-13 Task 3): BOTH handleShutdown paths arm a bounded
// `process.exit(130)` grace timer after cancel, and BOTH clear it after `await session.done`, so a
// genuinely un-settleable run still exits 130 (live Ctrl+C can never hang) and a clean completion
// never leaks the timer. Source-anchored per this file's convention.
describe('both handleShutdown paths arm + clear a bounded force-exit backstop (SESSION-04)', () => {
  it('arms a bounded process.exit(130) grace timer in both handleShutdown sites', () => {
    expect(count(runSource, 'setTimeout(() => process.exit(130), cancelGraceMs())')).toBe(2)
  })

  it('unrefs the grace timer in both sites so it never keeps the loop alive on its own', () => {
    expect(count(runSource, 'grace.unref?.()')).toBe(2)
  })

  it('clears the grace timer after session.done in both paths so a clean completion never leaks it', () => {
    expect(count(runSource, 'clearTimeout(graceTimer)')).toBe(2)
  })

  it('reads the grace window from an env-overridable constant, defaulting to 3000ms', () => {
    expect(runSource).toContain("Number(process.env.AGENT_QA_CANCEL_GRACE_MS ?? 3000)")
  })
})

// (d) The config/setup exit-2 convention is untouched (D-14): exit 2 stays reserved for
// config/setup errors and is NOT produced by the verdict map.
describe('the config/setup exit-2 convention survives the cutover (D-14)', () => {
  it('retains process.exit(2) config-error sites in run.ts', () => {
    expect(count(runSource, 'process.exit(2)')).toBeGreaterThanOrEqual(1)
  })

  it('mapVerdictToExitCode never yields 2 for any verdict', () => {
    for (const verdict of ['passed', 'healed', 'failed', 'timeout', 'cancelled'] as const) {
      expect(mapVerdictToExitCode(verdict)).not.toBe(2)
    }
  })
})
