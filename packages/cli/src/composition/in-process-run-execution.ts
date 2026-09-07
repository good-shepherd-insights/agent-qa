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

import { asRunId, resolveEffectiveWorkers } from '@vostride/agent-qa-schema'
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
  REFUSED_RUN_REQUEST_FIELDS,
  RunRequestFieldRefusedError,
  buildRunAuditSink,
  buildRunMaskingContext,
  createRunInvocationCore,
  mapVerdictToExitCode,
  resolveMaskingHostKey,
  runSafetyScope,
  writeMaskingDigests,
} from '@vostride/agent-qa-agent-local'
import type {
  RunExecutionContext,
  RunInvocationCoreOptions,
  RunMaskingContext,
} from '@vostride/agent-qa-agent-local'

import { assembleCliRun } from './run-assembly.js'
import type { CurationWriterAuthority } from '../curation/curation-tail.js'
import {
  createPostVerdictStep,
  releaseUntakenPostVerdictLease,
  type PostVerdictHandoff,
} from '../curation/post-verdict-step.js'
import { attachRunSubscribers, buildRunSafetyHooks, createLivePauseController } from '../run-session-composition.js'
import {
  isMintedCliRunId,
  mintCliRunId,
  produceMembersFromPatterns,
  resolveRunInvocationInputs,
} from '../commands/run.js'
import type { ProducedCliRunMembers, RunInvocationInputs, RunOptions } from '../commands/run.js'

/**
 * The box a door reads when no post-verdict step was ever composed for this run — a denial, an
 * assembly that threw, or a core with no factory. It acquired nothing, so it hands back nothing.
 */
const UNCOMPOSED_POST_VERDICT: PostVerdictHandoff = Object.freeze({
  outcome: undefined,
  takeAcquiredLease: () => undefined,
  takeUnclaimedLease: () => undefined,
})

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
  /**
   * This run's post-verdict handoff box (404 D-10) — the writer lease for the chain the shell's
   * step decided this process would pump.
   *
   * A DOOR'S TAIL MUST TAKE IT RATHER THAN CONSULT THE LEASE AGAIN. The step decided the posture
   * inside the shell, before `runFinished`; a tail that called `acquireWriterLease` for itself
   * after taking the authority would be answered `held` by its OWN process and would hand its work
   * off to nobody (RESEARCH Pitfall 3). Route it to the pump —
   * `postRunTail.drain({ takeLease: () => postVerdict.takeAcquiredLease() })` — so acquire → pump
   * → release stays one lease.
   *
   * 2026-08-26: TAKING IT IS WHAT ACQUIRES IT. The step's decision comes from a non-acquiring read,
   * so a door with no tail — or a run that dies above one — mutates no lease file and has nothing
   * to release. See `post-verdict-step.ts`'s header for the measurement that moved it.
   *
   * 2026-08-27 (CR-01): AND A THUNK IS WHY IT IS SAFE. Because taking acquires, the take may not
   * happen where an exception can still skip the release — which is what evaluating it as the
   * argument did. `drain()` calls the thunk itself, after the knowledge root is resolved and
   * inside the try whose `finally` releases.
   */
  readonly postVerdict: PostVerdictHandoff
}

/** What one in-process run answers with. A non-zero `exitCode` is a real run, not an error. */
export interface CliRunOutcome {
  readonly runId: string
  readonly verdict: string
  readonly exitCode: number
  /**
   * The DETACHED post-processing leg, still in flight (404 D-06).
   *
   * Present only when the door supplied a `postRunTail`. It never rejects — the drive catches and
   * warns — so awaiting it is safe and not awaiting it is the point: `execute()` resolving before
   * this settles is exactly what keeps `run-settled` off the drain's clock (RESEARCH Pitfall 2).
   * When it resolves, the untaken-lease backstop has run and the masking context is disposed.
   */
  readonly settled?: Promise<void>
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
   * itself. That is a shipped contract rather than a nicety: a `runs.start` carries patterns and no
   * mode flag, so a request whose patterns resolve to a suite file runs a SUITE today, over the fn
   * door and the daemon door alike — as it did over the child port 401-10 deleted, which forwarded
   * the same patterns after a `--` operand separator. A single-test-shaped default would turn a live request into an input error.
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
  /**
   * What this door wants the shell's POST-VERDICT step to do about post-processing (404 D-05/D-09).
   *
   * TWO INDEPENDENT FIELDS, NOT A MODE, because they are answers to two different questions and no
   * door supplies both:
   *
   *   - `detach` — `agent-qa run --detach`. Skip the LEASE; the durable enqueue still happens
   *     (RESEARCH Pitfall 8: detaching asks this process not to SPEND itself on the work, never to
   *     forget the work exists). The run reads `detached`.
   *   - `writerAuthority` — the DAEMON door, which already holds this project's writer lease and
   *     heartbeats it for its own lifetime. Handing it over is what lets the step report `drained`
   *     (D-09: a daemon-launched run drained by the daemon's own pump is drained) without calling
   *     `acquireWriterLease` — which would be answered `held` by this very process and hand the
   *     chain off to nobody (Pitfall 3, Open Q2).
   *
   * ABSENT ⇒ the ordinary consult: a probe of the lease, and `drained`/`handedOff`/`detached` off
   * what it found. That is what every other door gets, and it is byte-identical to 404-01.
   */
  readonly postProcessing?: {
    readonly maxAblations?: number
    readonly detach?: true
    readonly writerAuthority?: CurationWriterAuthority
  }
  /**
   * The DETACHED post-processing leg, for doors whose `execute()` promise something else waits on.
   *
   * WHY DETACHED AND NOT AWAITED (D-06, RESEARCH Pitfall 2). `dashboard-server`'s in-process
   * backend emits `'run-settled'` — the db finalize, the Appium lease release, the handle cleanup —
   * when the `invokeRun` promise settles. A drain awaited inside `execute()` would hold all three
   * for up to `DRAIN_BUDGET_MS`, so the runs list would keep showing "running" for a minute after
   * the verdict and a leased device would stay leased. The run's lifecycle ends at `runFinished`;
   * curation is post-processing (D-07), and this option is where that sentence becomes code.
   *
   * WHY THE MASKER IS DISPOSED IN *ITS* `finally` AND NOT THE DRIVE'S (T-404-01). The fold this leg
   * runs emits candidate prose, and that prose crosses the same disclosure boundary every other run
   * output does. If the drive disposed the masking context on its way out, this leg would fold with
   * a dead masker — `masker-active` by declaration and a pass-through in fact. So the drive HANDS
   * OVER its dispose duty: the fold runs inside the masker's lifetime, and the masker is disposed
   * once the leg settles, whichever way it settled.
   *
   * IT RUNS AFTER `afterVerdict` HAS SETTLED, so a door supplying both gets them in that order and
   * never concurrently. A throw is caught and warned by name — post-processing may never cost the
   * verdict (JOBQ-06) — and the untaken-lease backstop still runs behind it.
   *
   * THE IN-FLIGHT PROMISE IS RETURNED on the outcome as `settled`, so a caller that DOES want to
   * wait (a cell; a host that later decides `run-settled` should include curation) can, without the
   * drive deciding that for everyone.
   */
  readonly postRunTail?: (context: CliRunVerdictContext) => Promise<void>
  /** Where a quarantine-fold warning goes. The door owns its rendering. */
  readonly warn?: (message: string) => void
  /**
   * An Appium the DOOR has already leased for this run (401-07, D-12 — INVK-01 truth 5).
   *
   * IT TAKES THE RUN ID, AND ONLY THIS SEAM CAN BIND IT. A door composes this port ONCE and serves
   * many runs through it, but a lease belongs to one run — so the door answers per run id and the
   * drive, which is the one place the id is decided (`request.runId ?? mintCliRunId()`), binds it
   * before handing the producer a zero-argument resolver. A producer that had to know about run ids
   * to ask about a device would be a producer that knows about the door's bookkeeping.
   *
   * THE OPTION LANDS IN THE SAME CHANGE AS ITS CONSUMER, deliberately (401-03's own reason for not
   * adding it: an option nothing reads is a stub with a type on it). Absent leaves the shipped
   * order — `AGENT_QA_APPIUM_URL`, then the bundled auto-start — byte for byte.
   */
  readonly resolveAppiumUrl?: (runId: string) => string | undefined
  /**
   * Per-run flags a door's own UI offers that `RunsStartInput` has no field for (401-07).
   *
   * EXACTLY ONE MEMBER TODAY, AND DELIBERATELY NOT `RunOptions`. The dashboard has shipped a
   * "no cache" checkbox since v1; it reached a run as the `--disable-cache` OPERAND of a spawned
   * `agent-qa run`, and there is no operand any more. Dropping it silently would give a person who
   * ticked that box a cached answer, which is worse than the box not existing.
   *
   * The wide type was refused on purpose: handing a door `RunOptions` would let it reach flags this
   * seam has no business honouring (`--trust-session` above all), and every one of them would be a
   * policy input arriving through a producer's back door. This grows one named field at a time, and
   * each addition is a decision somebody makes.
   *
   * The RIGHT long-term home is a field on `RunsStartInput` — the request is the contract, and a
   * per-run fact that travels beside the request is a second channel. That is a schema change with
   * an ack contract behind it, so it is filed rather than smuggled in here.
   */
  readonly resolveRunFlags?: (runId: string) => { readonly disableCache?: boolean } | undefined
  /**
   * Secrets the DOOR holds that every run through it must mask (402-06, T-402-04 / T-402-21).
   *
   * WHY A DOOR CAN HOLD A SECRET A RUN'S OWN PRODUCER CANNOT SEE. The masking context is seeded
   * from three channels: the run's `SecretStore` (its project's `.env.secrets.local`), the
   * name-based `sensitiveEnvSlice` of the environment, and captured auth state. A run-service
   * credential is in none of them. It is not in the project's secrets file — it is minted by an
   * operator and lives only in the environment — and `sensitiveEnvSlice` selects BY NAME SUFFIX,
   * so an operator who points `tokenEnvVar` at `MY_RUN_CRED` has named the one credential this
   * process is definitionally holding in a way the masker cannot recognise. The runs still execute
   * inside that process, so a hook or a shell step that echoes that variable prints it in the
   * clear. The host knows these values by DECLARATION, which is why it seeds them by declaration.
   *
   * A RESOLVER AND NOT A STORE, because the door's credentials are resolved AFTER the host that
   * runs runs is composed — `composeRunServicePorts` dereferences the environment, and the host it
   * hands its bridge to already exists by then. Read at run time, it cannot be stale; captured at
   * compose time, it would always be empty.
   *
   * IT IS ADDITIVE TO THE PRODUCER'S OWN SEED, never a replacement: both stores are walked, so a
   * door that holds credentials does not cost a run its project's secrets.
   */
  readonly maskingSecrets?: () => {
    forEachSecret(cb: (name: string, value: string) => void): void
  } | undefined
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
/**
 * Refuse the request fields this seam does not honour, BEFORE anything is read (401-05).
 *
 * THE CORE MAKES THIS CHECK TOO, and its own header explains why it is first there: a refused
 * request must leave nothing behind. That property is the core's to state but not the core's to
 * KEEP once something stands in front of it. Everything the drive does before composing the core
 * resolves the caller's project config, and `resolveRunInvocationInputs` LOADS AUTH PLUGINS —
 * third-party code executed on behalf of a request this seam was always going to refuse.
 *
 * Measured at the fn door rather than reasoned about: `agent-qa fn runs.start` carrying `scope`,
 * against a project declaring an auth plugin that is not installed, reported the PLUGIN's error
 * instead of the refusal. `__tests__/fn-command.test.ts` asserts both halves — the refusal's name
 * AND the absence of that plugin error — so the order cannot regress silently.
 *
 * EXPORTED because a door that reads its own preflight (the `inputs?` contract) does that read
 * before it calls in, so the drive's own call to this is too late for it. One function, one
 * constant, one error class, N call sites — never a second spelling of which fields are refused.
 */
export function refuseUnhonourableRequestFields(request: RunsStartInput): void {
  const refused = REFUSED_RUN_REQUEST_FIELDS.filter((field) => request[field] !== undefined)
  if (refused.length > 0) throw new RunRequestFieldRefusedError(refused)
}

/**
 * One store over several, in declaration order. Absent members contribute nothing.
 *
 * EXPORTED since 403-01, and not as a convenience: the dashboard run door now UNIONS every store
 * bound through `bindMaskingSecrets`, and it must use THIS union rather than a second one written
 * beside it — because the door's contract is exactly this function's three states (`undefined` for
 * zero stores, the store ITSELF for one, a walker for many), and the #224 cells pin both of the
 * first two by identity.
 */
export function mergedSecretStore(
  ...stores: readonly ({ forEachSecret(cb: (name: string, value: string) => void): void } | undefined)[]
): { forEachSecret(cb: (name: string, value: string) => void): void } | undefined {
  const present = stores.filter((store) => store !== undefined)
  if (present.length === 0) return undefined
  if (present.length === 1) return present[0]
  return {
    forEachSecret(cb) {
      for (const store of present) store.forEachSecret(cb)
    },
  }
}

export async function runInProcessCliRun(
  options: InProcessCliRunExecutionOptions,
  request: RunsStartInput,
): Promise<CliRunOutcome> {
  // (0) THE REFUSAL, BEFORE ANYTHING IS READ. See `refuseUnhonourableRequestFields`.
  refuseUnhonourableRequestFields(request)

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
        // The door's per-run resolver, BOUND to this run's id here — the one place the id is
        // decided. See `resolveAppiumUrl` on the options.
        ...(options.resolveAppiumUrl === undefined
          ? {}
          : { resolveAppiumUrl: (): string | undefined => options.resolveAppiumUrl!(runId) }),
        ...(options.resolveRunFlags === undefined
          ? {}
          : { opts: { ...options.resolveRunFlags(runId) } as RunOptions }),
      })
    : await options.produceMembers({
        request,
        configPath,
        runId,
        executionContext: options.executionContext,
        ...(options.inputs === undefined ? {} : { inputs: options.inputs }),
      })

  // HOISTED ABOVE THE MASKING CONTEXT (405-02): `persistMaskingDigests` below is defined the moment
  // the context exists, and it warns rather than throws, so its renderer has to already be here.
  const warnByName = options.warn ?? ((): void => { /* a door with no renderer drops the line */ })

  const maskingContext = buildRunMaskingContext({
    // THE PRODUCER'S SECRETS AND THE DOOR'S, walked as one store. `buildRunMaskingContext` takes a
    // single `secretStore`, and composing the two here rather than widening its signature keeps
    // the seed pipeline's one-call shape (`agent-local`'s `buildRunMaskingContext` doc) intact.
    secretStore: mergedSecretStore(produced.maskingSeed?.secretStore, options.maskingSecrets?.()),
    env: process.env,
    ...(produced.maskingSeed?.authStatePayloads === undefined
      ? {}
      : { authStatePayloads: [...produced.maskingSeed.authStatePayloads] }),
  })

  /**
   * Write this run's placeholder→keyed-digest sidecar (405-02, D-08).
   *
   * WHY IT EXISTS. The masking map is in-memory and run-scoped by spec (execution-safety §4), so
   * once this process ends nothing on disk says WHICH declared secret `<SECRET_3>` stood for. A
   * dashboard restarted after the run can therefore only count placeholders, and counting breaks
   * the moment the host's secret sources change shape. This sidecar records value IDENTITY —
   * `HMAC-SHA256(hostKey, value)` per placeholder — so a later reader can match a placeholder to a
   * value it can re-derive from its own current sources, without the tool ever writing the value.
   * `snapshotRegistered()` yields only SECRET rows; `<EMAIL_n>` is minted lazily inside `mask()`
   * from text no host source declared and can never be re-derived, so it is never here (D-10).
   *
   * CALLED TWICE, DELIBERATELY. Once the moment the run's SESSION starts, so a run killed
   * mid-flight still leaves its seeded registrations; once again in `closeOutRun` BEFORE
   * `dispose()` clears the map, so the auth values 362-06 registers lazily mid-run land too. The
   * map only ever grows and a placeholder's index never changes, so the second write is always a
   * superset and replaces the file whole. ONE HELPER RATHER THAN TWO CALL SITES SPELLED OUT: two
   * spellings of the same write is exactly how the second one drifts.
   *
   * WHY NOT EARLIER, DIRECTLY AFTER THE SEED — measured, not assumed. The core's identity check
   * (`run-invocation-core.ts` step 2, FREEDOM) refuses a caller-supplied runId whose run DIRECTORY
   * already exists, and this drive always supplies its id. A write between the seed and
   * `core.execute` therefore mints that directory itself and the run refuses to start with
   * `RunIdAlreadyInUseError` — the sidecar would have made the run impossible. `onSession` is the
   * earliest legal moment: the id has passed both refusals, the gate has allowed the run, and the
   * run dir exists because `runStarted` is already in it.
   *
   * A REFUSED OR DENIED RUN GETS NO SIDECAR. `closeOutRun` also runs on those paths, and a run
   * that never started has no run of its own to describe — so the write is gated on the session,
   * keeping the denial's artifact set exactly what the gate wrote.
   *
   * IT NEVER FAILS THE RUN (T-405-09, the T-367-17 idiom). The run's record is its event log; this
   * sidecar is display convenience for a later read. A host that cannot write it — read-only root,
   * full disk — still gets a complete run, and every placeholder simply degrades to a typed masked
   * chip. The warning is BYTES-FREE: it names the run and the failure, never a value or the key.
   *
   * ONLY THIS DOOR WRITES ONE. `buildRunMaskingContext` is also called by
   * `eval-session-composition.ts` and `commands/mcp.ts`; neither produces a dashboard-visible run
   * with a run directory to write beside, so neither gets a sidecar.
   */
  const persistMaskingDigests = (): void => {
    if (startedSession === undefined) return
    try {
      writeMaskingDigests({
        root: options.agentQaRoot,
        runId,
        key: resolveMaskingHostKey(options.agentQaRoot),
        entries: maskingContext
          .snapshotRegistered()
          .map(({ placeholder, value }) => ({ placeholder, value })),
      })
    } catch (error) {
      warnByName(
        `Run ${runId}: the masking digest sidecar was not written (`
        + `${error instanceof Error ? error.message : String(error)}`
        + '); masked values in this run will render as typed chips.',
      )
    }
  }
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
  /**
   * This run's post-verdict handoff box (404 D-10), captured when the core builds the step.
   *
   * ONE VARIABLE RATHER THAN A MAP KEYED BY RUN ID: this drive serves exactly one run — the id is
   * decided a few lines above and the core is constructed around it — so a keyed collection would
   * be a cache whose only entry is this run's, and nothing would ever evict it.
   *
   * `UNCOMPOSED_POST_VERDICT` is what a door reads if the run never reached assembly. It is not a
   * stub standing in for a real box: a run whose step was never built acquired no lease, so the
   * honest answer to "what did your step acquire" is `undefined` — and a required field beats an
   * optional one here, because a tail that forgot to take the lease is the defect this seam exists
   * to prevent, and an optional member is a member a door forgets.
   */
  let postVerdictHandoff: PostVerdictHandoff | undefined

  const core = createRunInvocationCore({
    configPath,
    agentQaRoot: options.agentQaRoot,
    executionContext: options.executionContext,
    mintRunId: mintCliRunId,
    // 401-20 (CR-04): the shape predicate, from the package that owns the mint. REQUIRED on the
    // core with no default, so this line is not a policy this door chose — its absence is a
    // compile error.
    isMintedRunId: isMintedCliRunId,
    auditSink,
    ...(options.trust === undefined ? {} : { trust: options.trust }),
    ...(options.confirm === undefined ? {} : { confirm: options.confirm }),
    ...(options.reader === undefined ? {} : { reader: options.reader }),
    // A CONFIG READ, NEVER A PROBE. The producer resolved the declared class before anything could
    // touch a target, and `buildRunRiskDescriptor` — not this door — decides what a class means.
    //
    // ONE RESOLUTION ANSWERS BOTH FIELDS (401-14). The names come off the SAME producer pass that
    // folded the class, so the disclosure a person approves on describes the members whose classes
    // decided the tier. This door composes no preview prose of its own — `buildRunDisclosure` in
    // `agent-local` is the one spelling, and the core is its one consumer.
    resolveTargetDeclaration: () => ({
      targetClass: produced.targetClass,
      targetNames: produced.targetNames,
    }),
    assembleRun: async (assemblyContext) => {
      const assembly = await assembleCliRun({
        runId: assemblyContext.runId,
        // 402-03 (D-12): THE ONE PLACE THE WORKER COUNT IS APPLIED, for every door.
        //
        // The formula is `@vostride/agent-qa-schema`'s and is called exactly here, on the pair the
        // PRODUCER read out of the resolved config and the member count the producer assembled.
        // A caller cannot reach it: `RunsStartInput` names neither field (strict, pinned in
        // `runs-start-input-posture.test.ts`) and nothing on this drive's options carries one, so
        // the only input to concurrency is a config the target's owner wrote.
        //
        // A producer that reported no pair — a door that brought its own members and read no
        // config — resolves to 1, which is the shipped sequential behaviour rather than a guess.
        workers: resolveEffectiveWorkers({
          ...(produced.concurrency ?? {}),
          memberCount: produced.members.length,
        }),
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
        memberProbeUrls: produced.memberProbeUrls,
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
      // 405-02 (D-08): the FIRST digest write, at the earliest legal moment — see
      // `persistMaskingDigests` for why "earliest legal" is here and not beside the seed.
      persistMaskingDigests()
      produced.bindSession(session)
      options.onSession?.(session)
      startedSubscribers = options.subscribers?.({ session, quarantined, maskingContext, live })
    },
    // 404 D-05/D-10: the post-verdict step, composed HERE and threaded by the core so no door can
    // forget it. It speaks writer-lease vocabulary `agent-local`'s runner seam may not name, which
    // is exactly why the core takes a factory rather than building one.
    //
    // The knowledge root is the producer's already-resolved value, not a second resolution: the
    // consult, the enqueue and the drain must address ONE root.
    postVerdict: () => {
      const step = createPostVerdictStep({
        ...(options.postProcessing?.maxAblations === undefined ? {} : { maxAblations: options.postProcessing.maxAblations }),
        runId,
        agentQaRoot: options.agentQaRoot,
        knowledgeRoot: produced.knowledgeRoot,
        // The PRODUCER's resolved config file, not the raw `configPath` this drive was handed: the
        // enqueue's host is composed against the project the run actually resolved, and the tail
        // composes its own host from the same value one layer up (D-05).
        configPath: produced.configFilePath,
        // Conditionally spread on this file's house rule — an absent posture is an ABSENT field,
        // so the step's own defaults live in exactly one place.
        ...(options.postProcessing?.detach === true ? { detach: true as const } : {}),
        ...(options.postProcessing?.writerAuthority === undefined
          ? {}
          : { writerAuthority: options.postProcessing.writerAuthority }),
        log: { warn: options.warn ?? (() => { /* a door with no renderer drops the line */ }) },
      })
      postVerdictHandoff = step.handoff
      return step.port
    },
  })


  /**
   * The detached post-processing leg, once started. `undefined` for every door without one.
   *
   * Its presence is what MOVES the close-out below out of the drive's `finally` and onto this
   * promise's own — the two must never both run, and which one does is decided exactly once.
   */
  let detachedTail: Promise<void> | undefined

  /**
   * Release whatever lease nobody took, then dispose the masker. Exactly once, whoever runs it.
   *
   * 404 D-10, the structural no-leak rule: any lease still in the box here is a lease "released
   * untaken". If the tail took it this is a no-op; if something filled the box ahead of a pump
   * that never came, the lease is released HERE and the fact is named, rather than left to expire
   * on its TTL while every reader of the wire believes somebody is draining.
   *
   * IT IS THE OUTERMOST THING, NOT SOMETHING AROUND `afterVerdict`, and the difference is a
   * measured one (404-01): a framework error re-thrown above `mapVerdictToExitCode` skips
   * `afterVerdict` entirely, and a release scoped to that call left the lease held for its whole
   * TTL — the very posture this rule exists to prevent, on the ONE path most likely to produce it.
   * It runs BEFORE the masker is disposed below, so its warning still masks.
   *
   * 2026-08-26: it ACQUIRES NOTHING to check. The step's acquisition is lazy, so that same
   * framework-error path now arrives here with an empty box and this call is silent — the
   * `released untaken` line stopped being ordinary run output, which is what
   * `run-parity.e2e.test.ts` measures. The backstop stays because the box can still be filled by a
   * host that supplies its own authority (the daemon door).
   *
   * 404 D-06: WHY IT IS A FUNCTION RATHER THAN A `finally` BODY. A door with a detached post-run
   * tail needs the masker ALIVE while that tail folds — the fold emits candidate prose across the
   * same disclosure boundary every other run output crosses (T-404-01) — and the drive returns
   * long before the tail settles. So the drive's `finally` runs this only when no tail was started,
   * and the tail's own `finally` runs it otherwise. Exactly one of the two, decided by
   * `detachedTail`'s presence at the moment the drive leaves.
   */
  const closeOutRun = (): void => {
    releaseUntakenPostVerdictLease({
      handoff: postVerdictHandoff ?? UNCOMPOSED_POST_VERDICT,
      knowledgeRoot: produced.knowledgeRoot,
      runId,
      log: { warn: warnByName },
    })
    // 405-02 (D-08): the SECOND digest write, here and not earlier, because `dispose()` on the very
    // next line clears the map and 362-06 registers lazily-loaded auth values mid-run. A write
    // after the dispose would record an empty run.
    persistMaskingDigests()
    // Dispose LAST, after `done`, finalize, the flush and any detached tail, so every late masker
    // still replaces.
    maskingContext.dispose()
  }

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
        const verdictContext: CliRunVerdictContext = {
          runId,
          verdict,
          exitCode,
          maskingContext,
          auditSink,
          configDir: produced.configDir,
          configFilePath: produced.configFilePath,
          postVerdict: postVerdictHandoff ?? UNCOMPOSED_POST_VERDICT,
        }
        const finalExitCode = options.afterVerdict === undefined
          ? exitCode
          : await options.afterVerdict(verdictContext)
        if (options.postRunTail === undefined) {
          return { runId, verdict, exitCode: finalExitCode }
        }
        // 404 D-06 / RESEARCH Pitfall 2: START it and RETURN. The dispose duty travels with it —
        // see `closeOutRun` and the `postRunTail` option's own doc for why the masker may not be
        // torn down before the fold that needs it.
        detachedTail = options.postRunTail(verdictContext)
          .catch((error: unknown) => {
            warnByName(
              `Run ${runId}: the post-run tail did not complete (`
              + `${error instanceof Error ? error.message : String(error)}`
              + '); queued work will resume on the next run or when the daemon drains it.',
            )
          })
          .finally(closeOutRun)
        return { runId, verdict, exitCode: finalExitCode, settled: detachedTail }
      } finally {
        // The close-out runs HERE unless the detached tail took ownership of it — see
        // `closeOutRun`'s own doc for why that hand-over is the whole of D-06's masker rule.
        if (detachedTail === undefined) closeOutRun()
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
