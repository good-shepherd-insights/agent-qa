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

import type {
  QuarantineAppliedEntry,
  RunSession,
  RunsStartInput,
  TrustCredential,
} from '@vostride/agent-qa-schema'
// The confirm port and the standing-approval reader are `@vostride/agent-qa-safety` vocabulary,
// which a cli file written after 2026-07-28 may not name (FUNC-02, and the ledger only shrinks).
// They are reachable WITHOUT naming that package by indexing the core's own options type, which
// the composition root publishes — and indexing is stronger than a re-export would be: this door's
// `confirm` is BY CONSTRUCTION the thing the core accepts, so the two cannot drift apart.
import type {
  ConfigDigests,
  MemberTestExecutor,
  RunExecutionContext,
  RunInvocationCoreOptions,
  RunMemberDescriptor,
  RunSubscriberHandle,
  RunTargetClass,
} from '@vostride/agent-qa-agent-local'

/**
 * The typed input failure, re-exported so a composing door has ONE import site for this module's
 * whole contract. It is declared in its own leaf module because this file and `commands/run.ts`
 * import each other — see `cli-run-input-error.ts`'s header for why that matters.
 */
export { CliRunInputError } from './cli-run-input-error.js'

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
   * The seam a door with members of its own overrides.
   *
   * ABSENT ⇒ the pattern-based producer, which is MODE-AWARE and dispatches to the suite half
   * itself. That is a shipped contract rather than a nicety: `createCliRunExecution` forwards a
   * request's patterns after a `--` operand separator with no mode flag, so a `runs.start` whose
   * patterns resolve to a suite file runs a SUITE today, over the fn door and the daemon door
   * alike. A single-test-shaped default would turn a live request into an input error.
   */
  readonly produceMembers?: RunMemberProducer
  /** The door's reporters, attached inside the core's `onSession`. Absent ⇒ none (the daemon). */
  readonly subscribers?: (input: RunSubscriberAttachInput) => RunSubscriberHandle[]
  /** Where a quarantine-fold warning goes. The door owns its rendering. */
  readonly warn?: (message: string) => void
}

/** What a member producer is handed: the resolved request and the config it resolved against. */
export interface RunMemberProductionContext {
  readonly request: RunsStartInput
  readonly configPath: string
}

/** What a member producer answers: everything `assembleCliRun` needs that only a door can build. */
export interface ProducedRunMembers {
  readonly members: readonly RunMemberDescriptor[]
  readonly executor: MemberTestExecutor
  readonly configDigests: ConfigDigests
  readonly product: string
  readonly configDir: string
  readonly configFilePath: string
  readonly knowledgeRoot: string
  readonly targetClass: RunTargetClass
  readonly probeUrl?: string
  readonly buildTag?: string
  /** Called after `session.done` — the suite half finalises its lifecycle here. */
  readonly finalize?: () => Promise<void>
  /** The first framework/setup error a member closure threw, if any (re-surfaced by the drive). */
  readonly takeFrameworkError?: () => unknown | undefined
  /** Called by the drive with the started session, so a producer can route cancellation. */
  readonly onSession?: (session: RunSession) => void
}

export type RunMemberProducer = (
  context: RunMemberProductionContext,
) => Promise<ProducedRunMembers>

/** What the door's subscriber factory is handed inside the core's `onSession`. */
export interface RunSubscriberAttachInput {
  readonly session: RunSession
  readonly quarantined: readonly QuarantineAppliedEntry[]
}

/** What one in-process run answers with. A non-zero `exitCode` is a real run, not an error. */
export interface CliRunOutcome {
  readonly runId: string
  readonly verdict: string
  readonly exitCode: number
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
