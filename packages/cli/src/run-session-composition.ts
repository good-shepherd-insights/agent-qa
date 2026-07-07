// The CLI composition-root helper for `startRun` (Phase 361, Plan 10 — D-04/D-09/D-18/D-20).
//
// This module keeps the ~2800-line run.ts churn contained: it resolves everything the runner
// shell's `RunConfig` needs BEFORE `startRun` is called — config digests (the ONE mint feeding
// both the cache path and the handoff header), the run execution context, the identity masking
// seam, the runner-local persistence ports + buildOrdinal, the lazy suite-lifecycle manager, and
// the member-executor closure that wraps core's `executeSuiteMember` behind the injected
// `MemberTestExecutor` port. `startRun` itself never discovers or resolves (D-04): the composition
// root owns all of it. Phase 362 seeds the real MaskingContext at `buildIdentityMasking`; Phase
// 363 dissolves the executor port's core side. A future cloud RPC surface reuses this same
// resolved-config shape.
//
// The CLI is a surface / composition root with full host access (spec §4), so this module uses
// node builtins directly and constructs the runner-local fs stores.

import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { detectExecutionContext } from '@vostride/agent-qa-safety-local'
import { FsEventLog, FsHandoffStore, nextBuildOrdinal } from '@vostride/agent-qa-runner-local'
import type {
  ConfigDigests,
  EventLogPort,
  HandoffStorePort,
  MemberTestExecutor,
  MemberTestRunContext,
  RunMemberDescriptor,
  TestResult,
} from '@vostride/agent-qa-runner'

// ---- Local structural types -----------------------------------------------------------------
// The CLI does not take a `@vostride/agent-qa-schema` dependency purely to name these injected
// seam types — the local shapes structurally satisfy the runner `RunConfig` fields (the run.ts
// IdentityMaskingContext idiom). ExecutionContext mirrors the schema union exactly.

/** Structural copy of schema's browser-safe MaskingContext (identity pre-362). */
export type IdentityMaskingContext = { mask(text: string): string; unmask(text: string): string }

/** Mirror of schema's ExecutionContext union (safety-local's detectExecutionContext returns it). */
export type RunExecutionContext = 'local-interactive' | 'local-headless' | 'ci' | 'cloud'

// ---- (1) computeRunConfigDigests — the ONE digest mint (D-20) --------------------------------

/** One member's file inputs to the digest mint. `suiteFileContent` is absent on the single-test path. */
export interface RunDigestMemberInput {
  testFileContent: string
  suiteFileContent?: string
}

/**
 * The per-member cache pair AND the run-level handoff pair, both produced by the SINGLE call
 * below (D-20). The cache-key threading consumes `perMember[i]`; the handoff header carries
 * `runLevel`. Because both draw from one mint, run identity and handoff identity cannot fork.
 */
export interface RunConfigDigests {
  runLevel: ConfigDigests
  perMember: ConfigDigests[]
}

/** 16-hex SHA-256 digest of a UTF-8 string (the 356 A5 `sha256hex16` value; node:crypto here). */
function digest16(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex').slice(0, 16)
}

/**
 * Mint the run's config digests ONCE (D-20; RESEARCH A1 pinning).
 *
 * - Per-member cache pair:
 *     suiteConfigDigest = sha256hex16(configContent + '\n' + (suiteFileContent ?? ''))
 *     testConfigDigest  = sha256hex16(testFileContent)
 * - Run-level handoff pair:
 *     suiteConfigDigest = sha256hex16(ordered DISTINCT per-member suite digests joined by '\n')
 *     testConfigDigest  = sha256hex16(ordered per-member test digests joined by '\n')
 *   A single-member run collapses the run-level pair to the member's values.
 *
 * Both consumers (per-member cache, run-level handoff) draw from this one call — identities
 * cannot fork. This is the ONLY digest computation in the composition layer.
 */
export function computeRunConfigDigests(input: {
  configContent: string
  members: readonly RunDigestMemberInput[]
}): RunConfigDigests {
  const perMember: ConfigDigests[] = input.members.map((m) => ({
    suiteConfigDigest: digest16(input.configContent + '\n' + (m.suiteFileContent ?? '')),
    testConfigDigest: digest16(m.testFileContent),
  }))

  if (perMember.length === 1) {
    // Single-member runs collapse the run-level pair to the member values.
    return { runLevel: { ...perMember[0] }, perMember }
  }

  const distinctSuiteDigests: string[] = []
  const seen = new Set<string>()
  for (const pair of perMember) {
    if (!seen.has(pair.suiteConfigDigest)) {
      seen.add(pair.suiteConfigDigest)
      distinctSuiteDigests.push(pair.suiteConfigDigest)
    }
  }

  const runLevel: ConfigDigests = {
    suiteConfigDigest: digest16(distinctSuiteDigests.join('\n')),
    testConfigDigest: digest16(perMember.map((p) => p.testConfigDigest).join('\n')),
  }

  return { runLevel, perMember }
}

// ---- (2) resolveRunExecutionContext — canonical resolver (D-04) ------------------------------

/**
 * Resolve the run's execution context via safety-local's canonical `detectExecutionContext`
 * (RESEARCH Q1.4 recommendation (a) — already tested; an explicit override wins). Carried into
 * `RunConfig.executionContext` and the handoff header.
 */
export function resolveRunExecutionContext(override?: RunExecutionContext): RunExecutionContext {
  return detectExecutionContext(override) as RunExecutionContext
}

// ---- (3) buildIdentityMasking — unconditional (D-09, Pitfall 2) ------------------------------

/**
 * Construct the identity MaskingContext for a run. Constructed UNCONDITIONALLY — decoupled from
 * cache enablement (D-09; the Pitfall-2 anti-pattern is closed): the masking seam exists cache-on
 * and cache-off. Phase 362 seeds the real run-scope redactor at this exact injection point with
 * zero further wiring. There is intentionally NO cache-enablement parameter or branch.
 */
export function buildIdentityMasking(): IdentityMaskingContext {
  return { mask: (t: string) => t, unmask: (t: string) => t }
}

// ---- (4) buildRunPorts + buildOrdinal — runner-local persistence tier (D-06/D-17/D-18) -------

/** The durable run ports the shell wires behind `RunConfig.ports` (event log + handoff store). */
export interface RunPersistencePorts {
  eventLog: EventLogPort
  handoffStore: HandoffStorePort
}

/**
 * Construct the runner-local persistence ports rooted at the run's `.agent-qa` runtime dir (the
 * FsActionCache rooting idiom). `FsEventLog`/`FsHandoffStore` both write under
 * `<configDir>/.agent-qa/runs/<slug(runId)>/…`.
 */
export function buildRunPorts(input: { configDir: string; runId: string }): RunPersistencePorts {
  const root = resolve(input.configDir, '.agent-qa')
  return {
    eventLog: new FsEventLog({ root, runId: input.runId }),
    handoffStore: new FsHandoffStore({ root, runId: input.runId }),
  }
}

/**
 * Advance the per-product buildOrdinal counter under the same `.agent-qa` root (D-18). Async
 * (the runner-local counter reads → increments → atomic-renames). The resolved value rides
 * `RunConfig.buildOrdinal` into the handoff header.
 */
export function resolveRunBuildOrdinal(input: { configDir: string; product: string }): Promise<number> {
  return nextBuildOrdinal({ root: resolve(input.configDir, '.agent-qa'), product: input.product })
}

// ---- (5) createSuiteLifecycle — lazy per-suite setup/teardown --------------------------------

/** The setup/teardown pair a suite runs when it first becomes active / when it is torn down. */
export interface SuiteLifecycleHooks {
  /** Suite-level setup: setup hooks + adapter.setup + suite-URL navigation. */
  setup(): Promise<void>
  /** Suite-level teardown: teardown hooks + auth-state capture (when all passed) + adapter.cleanup. */
  teardown(): Promise<void>
}

export interface SuiteLifecycle {
  /**
   * Ensure `suiteKey` is the active suite before running a member. On the FIRST member of a suite
   * this runs the suite's setup; crossing a suite boundary first tears down the previous suite.
   * Idempotent within a suite (repeat calls for the active key are no-ops).
   */
  ensureReady(suiteKey: string, hooks: SuiteLifecycleHooks): Promise<void>
  /** Tear down the last active suite (if any). Called once at run end after `session.done`. */
  finalize(): Promise<void>
}

/**
 * A lazy suite-lifecycle manager (the Q1.2 "pre/post-run CLI composition" rows). It tracks the
 * active suite: `ensureReady` sets up a suite on its first member and tears down the previous
 * suite when a member crosses a boundary; `finalize` tears down the last active suite. A wholly
 * SKIPPED suite never sets up — the shell only invokes the executor (hence `ensureReady`) for
 * non-skipped members, so a suite whose members are all fail-fast/cancel skips is never touched.
 */
export function createSuiteLifecycle(): SuiteLifecycle {
  let activeKey: string | undefined
  let activeTeardown: (() => Promise<void>) | undefined

  return {
    async ensureReady(suiteKey, hooks) {
      if (activeKey === suiteKey) return
      if (activeTeardown) await activeTeardown()
      await hooks.setup()
      activeKey = suiteKey
      activeTeardown = hooks.teardown
    },
    async finalize() {
      if (activeTeardown) await activeTeardown()
      activeKey = undefined
      activeTeardown = undefined
    },
  }
}

// ---- (6) buildSuiteMemberExecutor — the MemberTestExecutor closure (D-01) ---------------------

/**
 * One prepared suite member: its suite key + lifecycle hooks (setup runs on the first member of
 * that suite) and a `run(ctx)` that builds the member's bound `SuiteMemberInput` around core's
 * per-test machinery and returns `executeSuiteMember(...)` with the shell-provided ctx seams
 * (abortSignal, events, per-member configDigests) threaded in.
 */
export interface SuiteMemberBinding {
  suiteKey: string
  hooks: SuiteLifecycleHooks
  run(ctx: MemberTestRunContext): Promise<TestResult>
}

/**
 * Build the injected `MemberTestExecutor` (D-01). Per member the closure looks up the prepared
 * binding by the shell-derived `testIndex` (array position — authoritative), calls
 * `lifecycle.ensureReady(...)` to lazily set up / cross-boundary tear down the member's suite,
 * then runs the member behind `executeSuiteMember`. Wrapping ONE audited function instead of
 * replicating the loop body.
 */
export function buildSuiteMemberExecutor(input: {
  lifecycle: SuiteLifecycle
  bindings: readonly SuiteMemberBinding[]
}): MemberTestExecutor {
  return async (member: RunMemberDescriptor, ctx: MemberTestRunContext): Promise<TestResult> => {
    const binding = input.bindings[ctx.testIndex]
    if (!binding) {
      throw new Error(`No suite-member binding for testIndex ${ctx.testIndex} (testId ${member.testId})`)
    }
    await input.lifecycle.ensureReady(binding.suiteKey, binding.hooks)
    return binding.run(ctx)
  }
}
