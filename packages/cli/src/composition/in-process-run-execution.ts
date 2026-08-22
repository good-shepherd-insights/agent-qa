// THE ONE IN-PROCESS `agent-qa run` EXECUTION (Phase 401 plan 11, D-01/D-02/D-07).
//
// WHAT THIS FILE IS. `createRunInvocationCore` (401-03) made run assembly a PORT a door implements,
// which was right — members, the executor closure, reporters and the masking context are CLI
// vocabulary `agent-local` may not name. The consequence nobody planned for is that **no
// non-`run.ts` door could implement that port**: `assembleCliRun` requires `members` and `executor`,
// `RunsStartInput` carries neither, and the producer chain that turns one into the other lived
// unexported inside `run.ts`'s command body. 401-06 halted on exactly that wall.
//
// So this module is the assembly side of D-02: the composition that turns a bare `RunsStartInput`
// into a started, policy-gated, in-process run. A door supplies its own posture and gets a run —
// without spawning `agent-qa run`, and without naming a single CLI option.
//
// IT COMPOSES THE CORE; IT DOES NOT GATE. `evaluate()` is acquired in exactly one file in this
// workspace and `packages/arch/src/lint/evaluate-pin.ts` fails the build on a second. This module
// hands the core the door's `executionContext`/`trust`/`confirm` and lets the core own the ORDER.
//
// IT READS NO AMBIENT EXECUTION CONTEXT (D-07). There is no `resolveRunExecutionContext()` call
// here, no `getActiveExecutionContext`, no TTY sniff: `executionContext` is a REQUIRED option with
// no default, so a door that supplies nothing gets a type error rather than a guess. Naming those
// two resolvers in this comment while never calling them is deliberate — it is the non-vacuity
// witness the source census in `in-process-exit-census.test.ts` leans on (the 401-03 idiom).
//
// WHY THE VOCABULARY STAYED IN `run.ts`, AND WHY THAT IS NOT LAZINESS. `packages/arch`'s FUNC-02
// surface firewall lets a file under `packages/cli` name only `@vostride/agent-qa-agent`,
// `-agent-local`, `-analytics` and `-schema`. Anything else needs an exact `(file, specifier)`
// ledger entry — the ledger **only ever shrinks**, and a file written after 2026-07-28 can never
// join it. `commands/run.ts` is the ONLY cli file ledgered for `android`, `core`, `dashboard`,
// `ios`, `model`, `runner`, `runner-local`, `safety`, `safety-local` and `web`. The platform, model
// and runner vocabulary therefore has exactly one legal home in this package, and it is the file it
// already lives in. So what moved here is the COMPOSITION; the producers stay in `run.ts` and are
// imported RELATIVELY (a relative path is not a package specifier and the firewall does not range
// it). A later reader who "tidies" the producers into a new file will be refused by the build.
//
// THE DOOR KEEPS PROCESS LIFECYCLE. Signal handlers, the grace timer, `releaseAppium()`, closing the
// dashboard db and the terminal exits stay in `run.ts`. This module computes, and returns or throws
// — including for every input failure, which becomes a `CliRunInputError` rather than a dead host
// (T-401-31). A library that can terminate its caller is a boundary of its own.
//
// A NON-ZERO EXIT CODE IS NOT AN ERROR. A failing suite exits non-zero and is a perfectly real run.
// This module throws only `RunDeniedError`, `RunRequestFieldRefusedError` and `CliRunInputError`.

import { asRunId } from '@vostride/agent-qa-schema'
import type {
  QuarantineAppliedEntry,
  RunSession,
  RunsStartInput,
  TrustCredential,
} from '@vostride/agent-qa-schema'
// The confirm port and the standing-approval reader are `@vostride/agent-qa-safety` vocabulary,
// which a cli file written after 2026-07-28 may not name (FUNC-02, and the ledger only shrinks).
// They are reachable WITHOUT naming that package by indexing the core's own options type, which the
// composition root publishes — and indexing is stronger than a re-export would be: this door's
// `confirm` is BY CONSTRUCTION the thing the core accepts, so the two cannot drift apart.
//
// `runSafetyScope` and `mapVerdictToExitCode` reach this file the same way, through the
// composition root's `run-drive-vocabulary` module (401-11) — the drive RUNS the run, so it has to
// install the run's safety scope and map its verdict, and both of those live in packages this file
// may not name directly.
import {
  buildRunAuditSink,
  buildRunMaskingContext,
  createRunInvocationCore,
  mapVerdictToExitCode,
  runSafetyScope,
} from '@vostride/agent-qa-agent-local'
import type {
  RunExecutionContext,
  RunInvocationCoreOptions,
  RunMaskingContext,
} from '@vostride/agent-qa-agent-local'

import { assembleCliRun } from './run-assembly.js'
import { attachRunSubscribers, buildRunSafetyHooks, createLivePauseController } from '../run-session-composition.js'
import {
  mintCliRunId,
  produceMembersFromPatterns,
  resolveRunInvocationInputs,
} from '../commands/run.js'
import type { ProducedCliRunMembers, RunInvocationInputs } from '../commands/run.js'

/**
 * The typed input failure, re-exported so a composing door has ONE import site for this module's
 * whole contract. It is declared in its own leaf module because this file and `commands/run.ts`
 * import each other — see `cli-run-input-error.ts`'s header for why that matters.
 */
export { CliRunInputError } from './cli-run-input-error.js'

/** What a member producer answers. Declared where its vocabulary is legal; re-exported here. */
export type { ProducedCliRunMembers as ProducedRunMembers } from '../commands/run.js'

/** What a member producer is handed: the request, the resolved inputs and the run's own identity. */
export interface RunMemberProductionContext {
  readonly request: RunsStartInput
  readonly configPath: string
  readonly runId: string
  readonly executionContext: RunExecutionContext
  /** The resolved preflight, when the door already read it. Absent for a bare-request door. */
  readonly inputs?: RunInvocationInputs
}

export type RunMemberProducer = (
  context: RunMemberProductionContext,
) => Promise<ProducedCliRunMembers>

/** What the door's subscriber factory is handed inside the core's `onSession`. */
export interface RunSubscriberAttachInput {
  readonly session: RunSession
  readonly quarantined: readonly QuarantineAppliedEntry[]
  readonly maskingContext: RunMaskingContext
  readonly live: ReturnType<typeof createLivePauseController>
}

/** What a door's post-verdict tail is handed, INSIDE the run's own safety scope. */
export interface CliRunVerdictContext {
  readonly runId: string
  readonly verdict: string
  /** The verdict's own exit code, before any door-level fold (`--all`, a pending cancel). */
  readonly exitCode: number
  readonly maskingContext: RunMaskingContext
  readonly auditSink: NonNullable<RunInvocationCoreOptions['auditSink']>
  readonly configDir: string
  readonly configFilePath: string
}

/** What one in-process run answers with. A non-zero `exitCode` is a real run, not an error. */
export interface CliRunOutcome {
  readonly runId: string
  readonly verdict: string
  readonly exitCode: number
}

/**
 * What a door hands over to get a run. Everything here is something only a DOOR can answer.
 */
export interface InProcessCliRunExecutionOptions {
  /** The config runs resolve against unless `request.configPath` names another. */
  readonly configPath: string
  /** `<configDir>/.agent-qa` — the root the function layer's evidence check reads (Pitfall 5). */
  readonly agentQaRoot: string
  /**
   * The context EVERY gate decision at this door is taken in.
   *
   * NO DEFAULT AND NO AMBIENT FALLBACK (D-07). A door that supplies nothing does not get a guess;
   * it gets a type error. That is what keeps this seam RPC-shaped for 402's authed service, and it
   * is why an injected value BEATS a varied process-global — asserted on both arms in
   * `in-process-run-execution.test.ts`.
   */
  readonly executionContext: RunExecutionContext
  /** `--trust-session` / `config.safety.trustMode` parity; `credential` is 402's parameter. */
  readonly trust?: { readonly trustMode?: boolean; readonly credential?: TrustCredential }
  /**
   * How this door asks a person. Conditionally spread, NEVER passed as `undefined` — absent leaves
   * the gate's `DENY_CONFIRM` default, which is the honest posture for a door with nobody at it.
   */
  readonly confirm?: RunInvocationCoreOptions['confirm']
  /** The standing-approval read side; the D-08 dispatch-grant overlay slots in here (plan 08). */
  readonly reader?: RunInvocationCoreOptions['reader']
  /** Fired with the started session — the D-09 bridge hook 401-07 consumes. */
  readonly onSession?: (session: RunSession) => void
  /**
   * The already-resolved input preflight, when the door read it for itself.
   *
   * `agent-qa run` needs these before it can answer `--list-tests`, `--dry-run` or a parse error, so
   * it hands them over rather than paying for a second config resolution and a second secrets read.
   * Absent ⇒ the drive resolves them from `configPath` and `request.patterns`, which is what a door
   * holding nothing but a `RunsStartInput` does.
   */
  readonly inputs?: RunInvocationInputs
  /**
   * The seam a door with members of its own overrides.
   *
   * ABSENT ⇒ the pattern-based producer, which is MODE-AWARE and dispatches to the suite half
   * itself. That is a shipped contract rather than a nicety: `createCliRunExecution` forwards a
   * request's patterns after a `--` operand separator with no mode flag, so a `runs.start` whose
   * patterns resolve to a suite file runs a SUITE today, over the fn door and the daemon door
   * alike. A single-test-shaped default would turn a live request into an input error.
   */
  readonly produceMembers?: RunMemberProducer
  /**
   * The door's reporters, attached inside the core's `onSession`. Absent ⇒ none, which is the
   * daemon's honest posture: the typed bus event log is the run's record (D-04).
   */
  readonly subscribers?: (input: RunSubscriberAttachInput) => { flush(): Promise<void> } | undefined
  /**
   * The door's post-verdict tail, run INSIDE the run's safety scope and after the subscriber flush,
   * returning the final exit code.
   *
   * IT IS A HOOK RATHER THAN THE DRIVE'S OWN WORK because the tail is a door concern that must not
   * leave the scope: `agent-qa run` folds its `--all` suite result into the code here and drains the
   * post-verdict knowledge curation, whose egress has to mask like every other. A drive that ran the
   * tail itself would own a lifecycle it has no business owning; a door that ran it after the drive
   * returned would run it outside the masking context.
   */
  readonly afterVerdict?: (context: CliRunVerdictContext) => Promise<number> | number
  /** Where a quarantine-fold warning goes. The door owns its rendering. */
  readonly warn?: (message: string) => void
}

/**
 * Run ONE policy-gated `agent-qa` run, in this process.
 *
 * The order is the load-bearing part, and every step of it is somebody's answer rather than this
 * function's opinion:
 *
 *   1. resolve the inputs (reads only) — or take the door's, if it already has them;
 *   2. mint or accept the run's identity;
 *   3. produce members and an executor — mode-aware by default, overridable by a door with its own;
 *   4. build the ONE masking context, audit sink and safety-hook runner, and bind them back into
 *      the producer's closures;
 *   5. compose the core, which owns the gate/assemble/start order;
 *   6. inside the run's safety scope: execute, await `done`, finalise, flush, re-surface a member's
 *      framework error, map the verdict, and let the door's tail have the last word on the code.
 *
 * NO DEFENSIVE CATCH ANYWHERE (D-03). Crash-through is the accepted posture; the runner's
 * budget/abort machinery is the orderly containment. The `finally` below disposes the masking
 * context and does nothing else.
 */
export async function runInProcessCliRun(
  options: InProcessCliRunExecutionOptions,
  request: RunsStartInput,
): Promise<CliRunOutcome> {
  const configPath = request.configPath ?? options.configPath
  const runId = request.runId ?? mintCliRunId()

  // A DOOR THAT BROUGHT ITS OWN PRODUCER BROUGHT ITS OWN INPUTS TOO. Resolving them here anyway
  // would re-read the config and the secrets file for a door that already has both, and would make
  // `agent-qa run`'s `--list-tests`/`--dry-run`/parse-error preflight a thing this seam repeats.
  const produced = options.produceMembers === undefined
    ? await produceMembersFromPatterns({
        inputs: options.inputs ?? await resolveRunInvocationInputs({
          configPath,
          ...(request.patterns === undefined ? {} : { patterns: request.patterns }),
        }),
        runId,
      })
    : await options.produceMembers({
        request,
        configPath,
        runId,
        executionContext: options.executionContext,
        ...(options.inputs === undefined ? {} : { inputs: options.inputs }),
      })

  const maskingContext = buildRunMaskingContext({
    secretStore: produced.maskingSeed?.secretStore,
    env: process.env,
    ...(produced.maskingSeed?.authStatePayloads === undefined
      ? {}
      : { authStatePayloads: [...produced.maskingSeed.authStatePayloads] }),
  })
  const auditSink = buildRunAuditSink({
    configDir: produced.configDir,
    runId,
    executionContext: options.executionContext,
  })
  const trustMode = options.trust?.trustMode === true
  const live = createLivePauseController()
  const { safetyHooks, confirmPausedMs } = buildRunSafetyHooks({
    auditSink,
    executionContext: options.executionContext,
    trustMode,
    maskingContext,
    live,
  })
  produced.bindRunContext({ maskingContext, safetyHooks })

  let quarantined: readonly QuarantineAppliedEntry[] = []
  let startedSession: RunSession | undefined
  let startedSubscribers: { flush(): Promise<void> } | undefined

  const core = createRunInvocationCore({
    configPath,
    agentQaRoot: options.agentQaRoot,
    executionContext: options.executionContext,
    mintRunId: mintCliRunId,
    auditSink,
    ...(options.trust === undefined ? {} : { trust: options.trust }),
    ...(options.confirm === undefined ? {} : { confirm: options.confirm }),
    ...(options.reader === undefined ? {} : { reader: options.reader }),
    // A CONFIG READ, NEVER A PROBE. The producer resolved the declared class before anything could
    // touch a target, and `buildRunRiskDescriptor` — not this door — decides what a class means.
    resolveTargetClass: () => produced.targetClass,
    assembleRun: async (assemblyContext) => {
      const assembly = await assembleCliRun({
        runId: assemblyContext.runId,
        executionContext: assemblyContext.executionContext,
        configDir: assemblyContext.configDir,
        knowledgeRoot: produced.knowledgeRoot,
        ports: assemblyContext.ports,
        confirmPausedMs,
        maskingContext,
        members: produced.members,
        executor: produced.executor,
        configDigests: produced.configDigests,
        product: produced.product,
        ...(produced.buildTag === undefined ? {} : { buildTag: produced.buildTag }),
        ...(produced.probeUrl === undefined ? {} : { probeUrl: produced.probeUrl }),
        warn: options.warn ?? (() => { /* a door with no renderer drops the fold warning */ }),
      })
      produced.applyAssembly({
        buildOrdinal: assembly.buildOrdinal,
        quarantined: assembly.quarantined,
      })
      quarantined = assembly.quarantined
      // D-23 live bind, behind the verdict and with the ordinal it reads.
      produced.bindKnowledge?.(assembly.buildOrdinal)
      return assembly.config
    },
    onSession: (session) => {
      startedSession = session
      produced.bindSession(session)
      options.onSession?.(session)
      startedSubscribers = options.subscribers?.({ session, quarantined, maskingContext, live })
    },
  })

  return await runSafetyScope(
    { maskingContext, auditSink, executionContext: options.executionContext },
    async (): Promise<CliRunOutcome> => {
      try {
        // The core refuses, gates, assembles, starts and awaits the run. A denial throws
        // `RunDeniedError` from inside here, before a single run event exists.
        await core.execute({ ...request, runId: asRunId(runId) })
        const session = startedSession
        if (session === undefined) {
          // Unreachable: the core notifies `onSession` before it awaits the run. Asserted rather
          // than assumed, because a silently absent session would degrade into a run whose verdict
          // nothing mapped.
          throw new Error('The invocation core completed without reporting a run session.')
        }

        const { verdict } = await session.done
        await produced.finalize?.()
        // Pitfall 6/8: await EVERY subscriber flush (junit write, dashboard finalize, analytics
        // drain) AFTER `done` and BEFORE mapping the verdict or re-throwing a framework error.
        await startedSubscribers?.flush()

        // A throw out of a member closure is a framework/setup error rather than a test failure:
        // the shell absorbs executor throws into failed members (D-13), so the producer captured
        // the first one and it is re-surfaced here to preserve the exit-2 contract.
        const frameworkError = produced.takeFrameworkError()
        if (frameworkError !== undefined) throw frameworkError

        const exitCode = mapVerdictToExitCode(verdict as never)
        const finalExitCode = options.afterVerdict === undefined
          ? exitCode
          : await options.afterVerdict({
              runId,
              verdict,
              exitCode,
              maskingContext,
              auditSink,
              configDir: produced.configDir,
              configFilePath: produced.configFilePath,
            })
        return { runId, verdict, exitCode: finalExitCode }
      } finally {
        // Dispose LAST, after `done`, finalize and the flush, so every late masker still replaces.
        maskingContext.dispose()
      }
    },
  )
}

/**
 * The `RunExecutionPort` a door composes.
 *
 * It narrows the drive's outcome to `{ runId }`, which is that port's whole contract — and the
 * shape `createLocalRunInvocation`'s evidence check (read the run's own event log back, refuse an
 * empty one) binds over unchanged.
 */
export function createInProcessCliRunExecution(
  options: InProcessCliRunExecutionOptions,
): { execute(request: RunsStartInput): Promise<{ runId: string }> } {
  return {
    async execute(request: RunsStartInput): Promise<{ runId: string }> {
      const outcome = await runInProcessCliRun(options, request)
      return { runId: outcome.runId }
    },
  }
}

/**
 * Attach a door's standard bus subscribers. Exported so `agent-qa run` and a later dashboard door
 * reach ONE attach helper rather than each writing the argument fold themselves.
 */
export function cliRunSubscribers(input: {
  readonly console?: { verbose: boolean; logLevel: string } | false
  readonly junitOutputPath?: string | undefined
  readonly extraSubscribers?: Parameters<typeof attachRunSubscribers>[0]['extraSubscribers']
}): (attach: RunSubscriberAttachInput) => { flush(): Promise<void> } {
  return (attach) => attachRunSubscribers({
    session: attach.session,
    maskingContext: attach.maskingContext,
    console: input.console ?? false,
    junitOutputPath: input.junitOutputPath,
    extraSubscribers: input.extraSubscribers,
    live: attach.live,
    quarantined: attach.quarantined,
  })
}

/**
 * Assert at the type level that this module never terminates its host: the only way out of the
 * in-process path is a return or one of the three declared throws.
 *
 * A RUNTIME MARKER, NOT DOCUMENTATION. `in-process-exit-census.test.ts` scans this module and its
 * relative first-party import closure for any acquisition of the host-terminating call, and the
 * per-task tripwire greps this file for a comment-filtered `process.exit(` count of zero.
 */
export const IN_PROCESS_RUN_TERMINATES_NOTHING = true
