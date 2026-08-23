// The one policy-gated in-process run invocation core (Phase 401, D-02).
//
// WHAT THIS FILE IS. Every local run trigger — `agent-qa run`, the chat/MCP `runs.start` op, the
// daemon drainer, the dashboard's run button — resolves to ONE function here. It owns the ORDER a
// run is started in, and the order is the whole point:
//
//   refuse unhonourable request fields
//     → resolve the run id
//     → resolve the target's declared class (a config read; no network)
//     → build the risk descriptor
//     → THE ONE evaluate()
//     → deny ⇒ throw RunDeniedError and touch NOTHING else
//     → allow ⇒ persistence ports → assemble → startRun → onSession → await the run
//
// THE GATE DECIDES BEFORE ANYTHING TOUCHES THE TARGET. Assembly is where the run-start baseline
// probe lives (it fetches the target URL) and where the build-ordinal counter is advanced (a
// durable write), and assembly is called from exactly one line below — after the verdict. A denied
// run therefore leaves no probe, no ordinal bump, no run directory events and no browser: the only
// trace it leaves is its execution-audit row, which is the trace a denial is supposed to leave.
// This is a STRUCTURAL property rather than a promise — `assembleRun` is a port this file calls
// once, and `run-invocation-core.test.ts` asserts a recording assembler is never invoked on deny.
//
// EXACTLY ONE evaluate() CALL-SITE, AND THE BUILD ENFORCES IT. This file is the third entry in
// `packages/arch/src/lint/evaluate-pin.ts`'s named set (FUNC-02 / D-12 / SC2): a fourth file in
// this workspace that acquires the gate fails `pnpm validate:arch`, and an entry that stops
// acquiring it fails as stale. The pin polices which FILES may hold gate power; the count of
// call-sites INSIDE this file is pinned by the core's own suite.
//
// IT NEVER READS AMBIENT CONTEXT (D-07). There is no `resolveRunExecutionContext()` call here, no
// `getActiveExecutionContext`, no ALS read, no `process.env` sniff for who is asking. The door
// that knows supplies `executionContext`, the confirm port, and the trust — because that is what
// keeps this seam RPC-shaped for 402's authed service, and because a core that resolved its own
// context would answer "am I interactive?" for a machine rather than for a caller. A daemon
// serving a browser and a terminal on the same machine need different answers.

import { dirname } from 'node:path'

import { evaluate } from '@vostride/agent-qa-safety'
import type { AuditSink, ConfirmPort, StandingApprovalReader } from '@vostride/agent-qa-safety'
import { STANDING_APPROVAL_SCOPE } from '@vostride/agent-qa-schema'
import type {
  GateRemedy,
  RunId,
  RunSession,
  RunsStartInput,
  TrustCredential,
} from '@vostride/agent-qa-schema'
import { startRun } from '@vostride/agent-qa-runner'
import type { RunConfig } from '@vostride/agent-qa-runner'

import { buildRunAuditSink, buildRunPorts } from './run-composition.js'
import type { RunExecutionContext, RunPersistencePorts } from './run-composition.js'
import { buildRunDisclosure, buildRunRiskDescriptor } from './run-risk.js'
import type { RunTargetClass } from './run-risk.js'

/**
 * The assembler port's own vocabulary, re-exported from the module that DECLARES the port.
 *
 * IT PASSES THROUGH HERE RATHER THAN THROUGH THE BARREL because the composition carveout admits
 * `@vostride/agent-qa-runner` only under `composition/` — the rule that keeps the job store proper
 * lean. A host writing a `RunAssembler` needs the types a `RunConfig` is made of; naming the runner
 * package itself would put a surface through the firewall (FUNC-02) for the vocabulary of a port
 * this file defined. Types only: erased before anything runs, granting no reach.
 */
export type {
  BaselineProbeResult,
  ConfigDigests,
  MemberTestExecutor,
  RunConfig,
  RunMemberDescriptor,
} from '@vostride/agent-qa-runner'

/**
 * The request fields this seam refuses, and the reason is not the one the CLI host had.
 *
 * `createCliRunExecution` refused these because the `run` COMMAND had no argv to express them
 * (`local-agent-host.ts`). This core can express both — and honouring either would be the defect
 * RESEARCH Pitfall 7 names:
 *
 *   `executionContext` — a caller that could name the context its own run is evaluated in could
 *     claim `local-interactive` from a CI job and walk past the fail-closed arm. The gate's context
 *     comes from the composition (D-07) and from nowhere else. The FIELD survives on the contract
 *     as the label a run RECORDS, and it is refused here until some door has a use for recording a
 *     label that differs from the context it was decided in.
 *
 *   `scope` — resolves from the config's own target/product resolution. Accepting an override
 *     would let a caller address one product's run ledger while running another's.
 *
 * Read OFF the request rather than enumerated positively, so a field added to `RunsStartInput`
 * with no plan for carrying it shows up here as a refusal instead of as a silent drop.
 */
export const REFUSED_RUN_REQUEST_FIELDS = [
  'scope',
  'executionContext',
] as const satisfies readonly (keyof RunsStartInput)[]

/**
 * The request named a field this seam refuses, so the request is refused rather than reshaped.
 *
 * The successor to `UnsupportedRunRequestError` (cli `local-agent-host.ts`), which dies with the
 * spawn port in 401-05. Same class of refusal, different rationale: that one could not express the
 * fields, this one declines to.
 */
export class RunRequestFieldRefusedError extends Error {
  constructor(readonly refusedFields: readonly string[]) {
    super(
      `agent-qa cannot start a run with: ${refusedFields.join(', ')}. ` +
        'scope resolves from the config the run is started against, and executionContext is ' +
        'supplied by the composition that owns the door — a caller-named execution context ' +
        'would be a caller naming the terms of its own authorization.',
    )
    this.name = 'RunRequestFieldRefusedError'
  }
}

/**
 * The policy gate refused this run, carrying the decision's own three fields.
 *
 * REASON, REMEDIES AND NEUTRAL REASON TRAVEL TOGETHER, on `FunctionDeniedError`'s shape (400 D-15).
 * The reason is the canonical prose that also lands in the execution-audit row; the remedies are
 * structured data each door projects for its own reader (`remediesRenderableBy`), and the neutral
 * reason is the same decision said without naming any surface's affordance. A door renders; it
 * never composes a denial sentence of its own, or Phase 399's defect returns — one surface's
 * instructions shown to a reader on another.
 */
export class RunDeniedError extends Error {
  constructor(
    readonly runId: string,
    readonly reason: string,
    readonly remedies: readonly GateRemedy[],
    readonly neutralReason: string,
  ) {
    super(reason)
    this.name = 'RunDeniedError'
  }
}

/**
 * What one resolution of this request's targets answers (401-14).
 *
 * THE CLASS AND THE NAMES COME BACK TOGETHER because they are two renderings of ONE pass over the
 * run's members: `targetClass` is the most-restrictive fold that decides the tier, `targetNames`
 * the declared names of the members it folded over. A door that answered them from two passes
 * could hand the gate a tier resolved from one reading of the config and a preview resolved from
 * another, and the person approving would be reading a sentence about a different run.
 */
export interface RunTargetDeclaration {
  /** The DECLARED class the gate classifies — a config read, never a probe (D-06). */
  readonly targetClass: RunTargetClass
  /**
   * The distinct declared target names, in first-appearance member order.
   *
   * DISPLAY-ONLY (T-401-G3b). It reaches the classifier through nothing: the descriptor carries it
   * inside `disclosure`, which `RiskActionDescriptor`'s own schema law puts outside classification.
   * Members that declare no target contribute nothing, which is how an all-undeclared run arrives
   * here as an empty list rather than as a list of invented names.
   */
  readonly targetNames: readonly string[]
}

/** What the assembler is handed: everything the core resolved, and nothing it did not. */
export interface RunAssemblyContext {
  /** The run's identity, already resolved. The core starts the run under THIS id and no other. */
  readonly runId: string
  /** The caller's request, refused fields already rejected. */
  readonly request: RunsStartInput
  /** The context the gate decided in — the same value, so a run cannot record a different one. */
  readonly executionContext: RunExecutionContext
  /** The per-run stamped audit sink the gate wrote its row to. ONE sink per run, not two. */
  readonly auditSink: AuditSink
  /** The durable ports, rooted at `<configDir>/.agent-qa` (Pitfall 5 — the evidence check's root). */
  readonly ports: RunPersistencePorts
  /** `dirname(agentQaRoot)` — the project directory the config sits in. */
  readonly configDir: string
  /** The config file this run resolves against (request override honoured). */
  readonly configPath: string
  /** The declared class the gate classified. Handed over so an assembler need not re-resolve it. */
  readonly targetClass: RunTargetClass
}

/**
 * Build the `RunConfig` the runner shell starts.
 *
 * A PORT rather than shared code, on `RunExecutionPort`'s own argument: members, executor,
 * reporters and masking are decisions a host answers differently. What crosses into the core is
 * the type; what stays with the door is the assembly. The core supplies the identity fields
 * (`runId` and the markers) over whatever the assembler returns, so a door cannot start a run
 * under an id the caller was not acknowledged with.
 *
 * EVERYTHING WITH A SIDE EFFECT BELONGS HERE, not in the door's pre-flight: the baseline probe
 * (network), the build-ordinal advance (a durable write), the quarantine fold. This function is
 * called after the verdict, so a denial costs the target nothing.
 */
export type RunAssembler = (context: RunAssemblyContext) => Promise<RunConfig> | RunConfig

export interface RunInvocationCoreOptions {
  /** The config file runs resolve against unless the request names another. */
  readonly configPath: string
  /** The project's runtime root, i.e. `<configDir>/.agent-qa`. */
  readonly agentQaRoot: string
  /**
   * The context every gate decision at this door is taken in (D-07).
   *
   * CALLER-RESOLVED, NEVER SNIFFED. The CLI resolves its TTY posture, the dashboard host claims
   * interactive only while a confirm channel is live (Pitfall 3), CI passes its own. A core that
   * detected this itself would be answering a question about the machine when the question is
   * about the door.
   */
  readonly executionContext: RunExecutionContext
  /**
   * Resolve what this request's targets DECLARE (D-06; names added 401-14).
   *
   * INJECTED BECAUSE THE CONFIG LIVES BEHIND THE DOOR, not because any of it is negotiable. Target
   * resolution needs the CLI's `resolveTarget`/`AgentQaConfig` vocabulary, which this package may
   * not name. The resolver's `targetClass` is a bare `'local' | 'shared' | undefined` — it cannot
   * name a risk TIER, and `buildRunRiskDescriptor` (not the door) decides what a class means.
   * `undefined` is undeclared and classifies shared.
   *
   * ONE RESOLUTION, TWO FIELDS, AND THAT IS THE POINT OF THE SHAPE. `targetNames` is DISPLAY-ONLY
   * — it reaches the descriptor through `disclosure`, which the classifier never reads — but it
   * must describe the same members the class was folded over, so it travels back from the same
   * pass rather than from a second call a door made later. Two resolutions of "what is this run
   * about to drive" are free to disagree, and a preview that disagreed with the tier a person is
   * being asked about is worse than no preview at all.
   *
   * Must not touch the target, and must not probe. A resolver that read a URL would put a network
   * call before the gate, which is the one ordering this file exists to hold.
   */
  readonly resolveTargetDeclaration: (
    request: RunsStartInput,
  ) => RunTargetDeclaration | Promise<RunTargetDeclaration>
  /** Build the `RunConfig`. Called ONLY on an allow verdict. */
  readonly assembleRun: RunAssembler
  /**
   * Mint a run id when the request carries none.
   *
   * REQUIRED rather than defaulted: the id generator lives in `@vostride/agent-qa-ids` (via core),
   * which this package does not depend on, and a locally invented id shape would be a second
   * spelling of a run's identity. Every shipped door already holds `generateRunId`.
   */
  readonly mintRunId: () => string
  /**
   * Session trust for this invocation. `trustMode` is `--trust-session`/`config.safety.trustMode`
   * parity; `credential` is the POLICY-FUT-01 parameter 402's authed service fills in.
   */
  readonly trust?: { readonly trustMode?: boolean; readonly credential?: TrustCredential }
  /**
   * How this door asks a person. ABSENT LEAVES THE GATE'S `DENY_CONFIRM` DEFAULT, which is the
   * correct behaviour for a door with nobody at it — the conditional-spread idiom below is what
   * keeps "no confirm port" from becoming "confirm port that is undefined".
   */
  readonly confirm?: ConfirmPort
  /** The standing-approval read side. The D-08 dispatch-grant overlay slots in here (plan 08). */
  readonly reader?: StandingApprovalReader
  /**
   * The per-run audit sink. Absent ⇒ built here from the run's own dir, so the gate's row lands
   * beside the run's events. A door that already built one (the CLI needs it for `runSafetyScope`
   * before it calls in) passes the SAME instance rather than making a second one.
   */
  readonly auditSink?: AuditSink
  /**
   * Notified with the started session, synchronously, before the core awaits it (D-09's bridge
   * hook). Subscribers attach here; the bus replays from seq 1, so nothing is missed.
   */
  readonly onSession?: (session: RunSession) => void
}

/**
 * The one policy-gated in-process execution core.
 *
 * Returns a `RunExecutionPort` (the shape `createLocalRunInvocation` binds `runs.start` over), so
 * the op's evidence check — read the run's own event log back, refuse an empty one — applies to
 * this seam unchanged.
 *
 * NO DEFENSIVE CATCH ANYWHERE (D-03). A run that crashes hard takes its host with it, on purpose:
 * crash-through surfaces bugs instead of absorbing them, and the runner's budget/abort machinery
 * is the orderly containment. The only `throw`s this file introduces are the two refusals above,
 * which are decisions rather than faults.
 */
export function createRunInvocationCore(
  options: RunInvocationCoreOptions,
): { execute(request: RunsStartInput): Promise<{ runId: RunId }> } {
  const configDir = dirname(options.agentQaRoot)

  return {
    async execute(request: RunsStartInput): Promise<{ runId: RunId }> {
      // (1) The refusal, first — before an id is minted or a config is read. A refused request
      // must not leave a run id behind that a caller could later ask about.
      const refused = REFUSED_RUN_REQUEST_FIELDS.filter((field) => request[field] !== undefined)
      if (refused.length > 0) throw new RunRequestFieldRefusedError(refused)

      // (2) Identity. A caller-supplied id carries exactly the trust the old `AGENT_QA_RUN_ID`
      // child environment variable carried — the door minting it is the door running it — and is
      // codec-validated by `RunsStartInputSchema` before it reaches here.
      const runId = request.runId ?? options.mintRunId()

      // (3) The declaration, from the config itself. Cheap, and it must stay cheap: this is the
      // last thing that happens before the gate. The class decides the tier; the names only
      // describe it to whoever is asked.
      const declaration = await options.resolveTargetDeclaration(request)
      const targetClass = declaration.targetClass

      const auditSink =
        options.auditSink ??
        buildRunAuditSink({
          configDir,
          runId,
          executionContext: options.executionContext,
        })

      // (4) THE ONE GATE CALL. Mirrors `invoke.ts`'s shipped call-site down to the conditional
      // spreads, with the one difference D-07 requires: the context is the composition's, never a
      // resolver this file reached for. `actionScope` is the pinned constant both the grant mint
      // and this call read — a caller-named scope could widen any grant into a match.
      const policy = await evaluate(
        // 401-14 (W-1): the descriptor carries a DISCLOSURE. This parameter had exactly one
        // production call-site — this one — and it passed nothing, so every run:start ever put
        // in front of a person said `run:start` and no more: approve a run against a shared
        // target, without being told which target. The preview the browser renders IS this
        // string (`confirm-registry.ts` — the frame's `preview` is the action's `disclosure`).
        buildRunRiskDescriptor(targetClass, buildRunDisclosure(targetClass, declaration.targetNames)),
        options.executionContext,
        {
          actionScope: STANDING_APPROVAL_SCOPE,
          ...(options.trust?.trustMode === undefined ? {} : { trustMode: options.trust.trustMode }),
          ...(options.trust?.credential === undefined
            ? {}
            : { credential: options.trust.credential }),
        },
        {
          auditSink,
          ...(options.reader === undefined ? {} : { reader: options.reader }),
          ...(options.confirm === undefined ? {} : { confirm: options.confirm }),
        },
      )
      if (policy.verdict === 'deny') {
        throw new RunDeniedError(runId, policy.reason, policy.remedies, policy.neutralReason)
      }

      // (5) Assembly — the first line that may touch the target, and it is below the verdict.
      const ports = buildRunPorts({ configDir, runId })
      const assembled = await options.assembleRun({
        runId,
        request,
        executionContext: options.executionContext,
        auditSink,
        ports,
        configDir,
        configPath: request.configPath ?? options.configPath,
        targetClass,
      })

      // (6) Start. The markers ride straight from the request onto the RunConfig — the chain that
      // used to be request → port → argv → command flag → RunConfig is now request → RunConfig,
      // and only the literal `true` carries (a `false` is a refusal, not a synonym for absence).
      // `runId` is stamped over whatever the assembler returned so the id this call acknowledges
      // is provably the id the run was started under.
      const session = startRun({
        ...assembled,
        runId: runId as RunId,
        ...(request.gateRun === true ? { gateRun: true as const } : {}),
        ...(request.excludedFromOutcomes === true
          ? { excludedFromOutcomes: true as const }
          : {}),
      })

      options.onSession?.(session)

      // The handoff is assembled and persisted before `done` resolves (runner shell's terminal
      // sequence), so awaiting it is awaiting the run AND its durable record.
      await session.done

      return { runId: runId as RunId }
    },
  }
}
