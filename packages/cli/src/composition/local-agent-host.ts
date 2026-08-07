// The CLI's half of the local host (Phase 384 plan 01, superseded in place by 385 plan 09, D-15).
//
// What used to live here — the runs reader, the knowledge listing binding and the registry
// assembly — moved to `composeLocalAgent()` in `@vostride/agent-qa-agent-local`, which 386's daemon
// calls too. What stays is what only THIS host can answer: who the caller is, how a configuration
// file is resolved and masked, which model a job would author with, and — since 385 plan 10 — how
// a run is executed. Each of those is a port the composition takes, so the two hosts share a
// composition rather than each writing one.
//
// The run executor lives HERE rather than in a file of its own for the reason plan 09's model
// binding did: minting a run id needs `@vostride/agent-qa-core`, the FUNC-02 firewall forbids a
// surface naming it without a ledger entry, and the ledger only ever SHRINKS — new surface code
// can never join it. This file already carries that entry, so the placement mints none.

import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'

import type {
  ConfigReaderPort,
  JobModelCapability,
  StartedRun,
} from '@vostride/agent-qa-agent'
import { composeLocalAgent } from '@vostride/agent-qa-agent-local'
import type { CandidateProsePosture, ComposeLocalAgentInput, LocalAgentHost, RunExecutionPort } from '@vostride/agent-qa-agent-local'
import { KNOWLEDGE_PROPOSAL_APPLY_FUNCTION_ID } from '@vostride/agent-qa-agent'
import {
  AgentQaConfigSchema,
  generateRunId,
  resolveKnowledgeRoot,
  workspaceRelativeIdentityPath,
} from '@vostride/agent-qa-core'
import type { ApplyDelegate, ApplyReviewResult } from '@vostride/agent-qa-agent-local'
import { KnowledgeApplyOutcomeSchema } from '@vostride/agent-qa-schema'
import type { FunctionCaller, RunId, RunsStartInput } from '@vostride/agent-qa-schema'

import { loadConfigFile, loadEnvOverrides, resolveConfig } from '../config.js'
import { invokeViaDaemon } from '../daemon/client.js'
import { resolveCliAnalysisTokenBudget, resolveCliJobModel } from '../llm-utils.js'
import { buildConfigVisibilityOracle } from './config-visibility.js'
import { buildMaskedResolvedConfig } from './masked-config.js'

/**
 * The CLI's caller record.
 *
 * Full local grants: an operator at their own terminal already has every power the CLI can
 * exercise, so withholding a scope here would be theatre. `knowledge-write` (387-08) joins on
 * exactly that reasoning and no other: the operator can already edit the knowledge root with a
 * text editor, so the scope's job here is to make the CAPABILITY's cost legible in the catalogue
 * and in the audit row, not to withhold it from the person who owns the machine. Grant ISSUANCE — who may mint which
 * scopes, and how a remote caller proves them — is the M5 run-invocation / cloud-auth model's job;
 * this constant is the local composition's minting site.
 */
export const CLI_FUNCTION_CALLER: FunctionCaller = {
  surface: 'cli',
  // 391 D-06: `approval-write` joins because the CLI is where a person accepts a proposal and
  // revokes a standing grant. The scope is the POWER; the origin below is who may exercise it,
  // and this host is the only one that mints both.
  grantedScopes: ['read', 'run', 'config-write', 'knowledge-write', 'approval-write'],
  safeMode: false,
  // A person typed the command. This is the mint the whole self-grant rule turns on, so it is
  // stated here rather than defaulted anywhere: the origin is a property of the composition,
  // never of the call, and nothing downstream may set it.
  origin: 'human',
}

/**
 * The `config.get` binding, and the T-384-07 / T-384-17 mitigation site.
 *
 * The resolved configuration is flattened and masked HERE, so the only configuration value that
 * ever crosses into the function layer is already masked. `loadAuthPlugins: false` keeps the read a
 * read: resolving a capability must not load and execute plugin code.
 *
 * This is also where the disclosure rule gets its authority. `AgentQaConfigSchema` is walked ONCE,
 * here at the composition root, into the visibility oracle the masker consults per entry — so the
 * masker decides what is secret by what the schema declares free-form rather than by a list of
 * paths it would have to keep correct.
 */
export function createMaskedConfigReader(configPath: string): ConfigReaderPort {
  const visibility = buildConfigVisibilityOracle(AgentQaConfigSchema)
  return {
    async getMasked() {
      const resolved = await resolveConfig({ configPath, loadAuthPlugins: false })
      return buildMaskedResolvedConfig({
        configPath,
        resolved,
        visibility,
        // Ascending precedence, mirroring `resolveConfig`'s own merge order. `cli-flag` is
        // absent because the `fn` invoker passes no configuration flags; `test-file` never
        // participates in a project-level config read.
        layers: [
          { source: 'config-file', values: await loadConfigFile(configPath) },
          { source: 'env', values: loadEnvOverrides() },
        ],
      })
    },
  }
}

// ---- how THIS host executes a run (Phase 385 plan 10 — D-16) --------------------------------
//
// `runs.start` is bound at the composition root; what the composition refuses to decide is the
// process model, because that is the thing a daemon answers differently (plan 08's dissection
// rule). This is the terminal host's answer, and it is deliberately the SHORTEST one that
// is honest: it runs the project's own `agent-qa run` — the one run path, with its config
// resolution, its secrets, its hooks, its reporters, its signal discipline and its curation
// tail — in a child process, naming the run through `AGENT_QA_RUN_ID` so the composition knows
// which run to read back.
//
// Why a child and not an in-process call: `agent-qa run` ends in `process.exit`, and a second
// in-process orchestration assembled beside it would be a second run path. Two paths that
// both claim to start a run is exactly the host-divergence bug class the dual-host proof
// exists to exclude, and it would diverge here first — the function-layer path would quietly
// lack whatever the command grew last. D-22 puts the run command's re-derivation with the
// run-invocation work; until then, delegating to it is how the two agree by construction.
//
// What this file does NOT do is paper over the request fields the command cannot honour. A
// scope override, an execution-context override and both durable markers are declared on the
// op's input contract for later phases to wire (schema/functions/runs.ts). Accepting one and
// dropping it would make the acknowledgment a lie in exactly the way its own contract warns
// about, so an unhonourable field is a typed refusal instead.

/** The request named a field this host cannot honour, so the request is refused rather than reshaped. */
export class UnsupportedRunRequestError extends Error {
  constructor(readonly unsupportedFields: readonly string[]) {
    super(
      `agent-qa cannot start a run with: ${unsupportedFields.join(', ')}. ` +
        'These fields are declared on the runs.start contract for the phases that wire them ' +
        '(gateRun: 393, excludedFromOutcomes: 388, scope and executionContext: the run-invocation ' +
        'work). Accepting one now would drop it silently and acknowledge a run of a different kind.',
    )
    this.name = 'UnsupportedRunRequestError'
  }
}

/** The child that should have executed the run could not be started at all. */
export class RunChildSpawnError extends Error {
  constructor(readonly detail: string) {
    super(`agent-qa could not start the run child process: ${detail}`)
    this.name = 'RunChildSpawnError'
  }
}

/**
 * Launch one child and resolve its exit code.
 *
 * Injected so a test can drive the whole composition — gate, binding, evidence check,
 * acknowledgment — without a browser and a model behind it. The DEFAULT is the real thing, and
 * the default is what the demo artifact exercises.
 */
export type RunChildLauncher = (input: {
  readonly argv: readonly string[]
  readonly env: NodeJS.ProcessEnv
}) => Promise<number>

/** The daemon-owned facts available only after its piped run child has closed. */
export interface PipedRunChildClose {
  readonly runId: string
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

/** Persist captured child output before the launcher's numeric completion becomes observable. */
export type PipedRunChildCloseSink = (
  closed: PipedRunChildClose,
) => void | Promise<void>

export interface CreateCliRunExecutionInput {
  /** The configuration file this invocation resolves against. */
  readonly configPath: string
  /** The `agent-qa` entry to re-enter. Defaults to the script this process was started from. */
  readonly cliEntry?: string
  readonly launchChild?: RunChildLauncher
  /** Mints the run id the child is told to use. Injected for determinism in tests. */
  readonly newRunId?: () => string
}

/**
 * The fields the `run` command has no way to express. Read off the request rather than
 * enumerated positively, so a field added to the input contract without a plan for carrying it
 * shows up here as a refusal instead of as a silent drop.
 */
const UNSUPPORTED_REQUEST_FIELDS = [
  'scope',
  'executionContext',
  'gateRun',
  'excludedFromOutcomes',
] as const satisfies readonly (keyof RunsStartInput)[]

function defaultLaunchChild(entry: string): RunChildLauncher {
  return ({ argv, env }) => new Promise<number>((resolve, reject) => {
    const child = spawn(process.execPath, [entry, ...argv], { stdio: 'inherit', env })
    child.on('error', (error: Error) => reject(new RunChildSpawnError(error.message)))
    // A signalled child never produced an exit code; reporting one would claim an ordinary
    // termination. 130 is the conventional SIGINT code and reads as "interrupted" downstream.
    child.on('close', (code, signal) => resolve(code ?? (signal === null ? 1 : 130)))
  })
}

/**
 * Build the daemon's real child launcher.
 *
 * Unlike the terminal launcher above, this process has no operator terminal to inherit. Its
 * streams are captured into run-scoped files by the supplied close sink, and that sink completes
 * before the launcher exposes the child's numeric exit code to the run-execution port.
 */
export function createPipedLaunchChild(
  entry: string,
  onClose: PipedRunChildCloseSink,
): RunChildLauncher {
  return ({ argv, env }) => new Promise<number>((resolveLaunch, rejectLaunch) => {
    const runId = env.AGENT_QA_RUN_ID
    if (entry.trim().length === 0) {
      rejectLaunch(new RunChildSpawnError('the CLI entry path is empty'))
      return
    }
    if (runId === undefined || runId.length === 0) {
      rejectLaunch(new RunChildSpawnError('AGENT_QA_RUN_ID is missing from the child environment'))
      return
    }

    let child: ReturnType<typeof spawn>
    try {
      child = spawn(process.execPath, [entry, ...argv], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env,
      })
    } catch (error) {
      rejectLaunch(new RunChildSpawnError(error instanceof Error ? error.message : String(error)))
      return
    }

    let stdout = ''
    let stderr = ''
    let settled = false
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => { stdout += chunk })
    child.stderr?.on('data', (chunk: string) => { stderr += chunk })
    child.on('error', (error: Error) => {
      if (settled) return
      settled = true
      rejectLaunch(new RunChildSpawnError(error.message))
    })
    child.on('close', (code, signal) => {
      if (settled) return
      settled = true
      const exitCode = code ?? (signal === null ? 1 : 130)
      void (async () => {
        await onClose({ runId, exitCode, stdout, stderr })
        resolveLaunch(exitCode)
      })().catch(rejectLaunch)
    })
  })
}

/**
 * Build the terminal host's run-execution port.
 *
 * The run id is minted HERE, with the same generator the run command uses, and handed to the
 * child through `AGENT_QA_RUN_ID` — the variable the command already prefers over minting one
 * of its own. That is what makes the run addressable by the caller who asked for it.
 *
 * The child's exit code is deliberately NOT the verdict on whether a run happened: a failing
 * suite exits non-zero and is a perfectly real run. What decides is the durable evidence the
 * composition reads back, which no exit code can fake.
 */
export function createCliRunExecution(input: CreateCliRunExecutionInput): RunExecutionPort {
  const entry = input.cliEntry ?? process.argv[1] ?? ''
  const launchChild = input.launchChild ?? defaultLaunchChild(entry)
  const newRunId = input.newRunId ?? generateRunId

  return {
    async execute(request: RunsStartInput): Promise<StartedRun> {
      const unsupported = UNSUPPORTED_REQUEST_FIELDS.filter(
        (field) => request[field] !== undefined,
      )
      if (unsupported.length > 0) {
        throw new UnsupportedRunRequestError(unsupported)
      }
      if (input.launchChild === undefined && entry === '') {
        throw new RunChildSpawnError('this process has no resolvable agent-qa entry script')
      }

      const runId = newRunId()
      await launchChild({
        argv: [
          '--config',
          request.configPath ?? input.configPath,
          'run',
          // The operand separator, and it is load-bearing. `patterns` is caller-controlled and
          // unconstrained, and `run` takes its patterns in a VARIADIC OPERAND position — so
          // without this token a pattern that begins with a dash is parsed as one of `run`'s own
          // options rather than carried as a pattern. That is the inverse of the refusal the
          // field check above exists to make: a field this host cannot honour is a typed
          // refusal, and a field the request never declared at all must not be reachable.
          // `--trust-session` is the one that decides it — it treats every ask-tier policy
          // decision in the session as trusted — but the separator closes the whole class
          // (`--junit-output`, `--screenshot-dir`, `--var`, `--dry-run`, `--detach`) at once,
          // and closes it without reshaping the request the caller sent.
          '--',
          ...(request.patterns ?? []),
        ],
        env: { ...process.env, AGENT_QA_RUN_ID: runId },
      })
      return { runId: runId as RunId }
    },
  }
}

export interface ComposeCliLocalAgentInput {
  /** The project's runtime root, i.e. `<configDir>/.agent-qa`. */
  agentQaRoot: string
  /** The configuration file this invocation resolves against. */
  configPath: string
  /**
   * How this invocation executes a run (D-16). Defaults to re-entering `agent-qa run`; a test
   * substitutes the child launcher so the whole path — gate, binding, evidence, acknowledgment
   * — is exercised without a browser and a provider behind it.
   */
  runExecution?: RunExecutionPort
  /**
   * How an apply reaches the writer-lease holder when one is alive (387-08 D-18).
   *
   * Defaults to the 386 `/invoke` transport, VERBATIM — no new protocol, no new route, and no
   * change on the daemon side, because `/invoke → invokeFunction` already reaches the op. A test
   * substitutes it to exercise the routing without a socket.
   */
  applyDelegate?: ApplyDelegate
  /**
   * The queue's model capability. Defaults to the project's configured job model.
   *
   * Overridable because the post-run tail (388-02) opens the queue for work that authors
   * through no provider at all, and eagerly resolving credentials it will never use would
   * make "no LLM configured" mean "no post-run chain".
   */
  model?: () => JobModelCapability | Promise<JobModelCapability>
  /**
   * The analyze-run author's compaction budget factory (389-06). Defaults to the SAME
   * named-config profile resolution the job model rides (`resolveCliAnalysisTokenBudget`
   * — one source of truth, 386 D-15), resolved once at queue open by the shared
   * composition. Overridable for the same reason `model` is: a harness substitutes it to
   * exercise the ladder without a configuration file.
   */
  analysisTokenBudget?: ComposeLocalAgentInput['analysisTokenBudget']
  /**
   * What the post-run chain's real handlers may do (388 D-01).
   *
   * A passthrough, deliberately: `curateRun` needs the writer lease, a knowledge root, a
   * guardrail policy and the run's curation author, and the only place in this process where
   * all four already meet is the run tail that holds them. Composing one here would be a
   * second assembly of the same four facts.
   */
  postRun?: {
    curateRun: (input: {
      readonly runId: string
      readonly executionContext: unknown
      readonly deadlineMs?: number
    }) => Promise<{
      readonly curated: number
      readonly deprecated: number
      /** The fold's own completeness, carried rather than dropped (WR-03). */
      readonly complete: boolean
    }>
    /**
     * REQUIRED wherever the binding is supplied (388-10, UF-388-01): what this binding does
     * with candidate prose. Passed through untouched — the shared composition owns what the
     * posture MEANS (see `CandidateProsePosture`), and this host only carries the caller's
     * declaration to it.
     */
    candidateProse: CandidateProsePosture
  }
}

/**
 * Compose the local host as the CLI supplies it.
 *
 * The four arguments are the four host decisions the shared composition refuses to make on a
 * host's behalf: which configuration is in force and how it is masked, where knowledge is served
 * from, which model a job authors with, and how a run is executed. Everything else — the runs
 * reader, the knowledge listing, the registry, the queue, the store — is the shared function, so
 * the CLI and 386's daemon cannot drift.
 *
 * The fourth is what makes `runs.start` BOUND in this host (D-16). Withhold it and the very same
 * composition lists the capability as `unbound` and refuses it by name, which is D-09's visible
 * state expressed as a fact about a host rather than as a literal on a spec.
 */
/**
 * The quarantine ledger's identity mint, pre-bound to one workspace's config directory (390-12).
 *
 * The committed `quarantine.jsonl` keys entries on a workspace-relative `filePath` and every reader
 * compares it with `===`, so the two human write verbs need the SAME recipe the run path mints with
 * — `workspaceRelativeIdentityPath`, resolved against the checkout root. The verbs cannot know that
 * root, so it is bound here, once, by the layer that does.
 *
 * IT LIVES IN THIS FILE ON PURPOSE, and the reason is the one this module's head already states for
 * the run-id minting beside it: the mint needs `@vostride/agent-qa-core`, the FUNC-02 surface
 * firewall forbids a `packages/cli` file naming core without an exact (file, specifier) ledger
 * entry, and that ledger only ever SHRINKS — new surface code can never join it. This file already
 * carries the entry (`surface-firewall-ledger.ts`, cleared by 395), so the placement mints no new
 * debt. The daemon host reaches it through the same deferred import it already uses for the run
 * executor, which also keeps the CLI composition graph out of a configPath-less legacy host.
 *
 * The returned closure throws for a path that escapes the config directory — the mint's own
 * contract — and the verbs surface that as `QuarantineIdentityRefusedError`.
 */
export function createQuarantineIdentityMint(configPath: string): (filePath: string) => string {
  // The same derivation the `knowledgeRoot` closure below performs, spelled once per call site.
  const configDir = dirname(resolve(configPath))
  return (filePath: string) => workspaceRelativeIdentityPath(configDir, filePath)
}

export function composeCliLocalAgent(input: ComposeCliLocalAgentInput): LocalAgentHost {
  const knowledgeRoot = async (): Promise<string> => {
    const config = await resolveConfig({ configPath: input.configPath, loadAuthPlugins: false })
    return resolveKnowledgeRoot(config.knowledge, dirname(resolve(input.configPath)))
  }

  return composeLocalAgent({
    agentQaRoot: input.agentQaRoot,
    mintQuarantineIdentityPath: createQuarantineIdentityMint(input.configPath),
    runExecution: input.runExecution ?? createCliRunExecution({ configPath: input.configPath }),
    config: createMaskedConfigReader(input.configPath),
    knowledgeRoot,
    // D-18: when a live daemon holds the writer lease, this host hands it the SAME
    // `knowledge.proposal.apply` envelope over the SAME 386 socket every other capability crosses,
    // and waits bounded for the receipt. It is a closure over `invokeViaDaemon` rather than a new
    // seam, so the daemon needs no new server code and the transport has one implementation.
    //
    // The DAEMON's own composition supplies none of this: it holds the lease, so its applies take
    // the in-process branch, and delegation cannot recurse by construction rather than by a guard.
    applyDelegate: input.applyDelegate ?? (async (proposalId) => {
      const answer = await invokeViaDaemon({
        agentQaRoot: input.agentQaRoot,
        knowledgeRoot: await knowledgeRoot(),
        functionId: KNOWLEDGE_PROPOSAL_APPLY_FUNCTION_ID,
        input: { proposalId },
      })
      return KnowledgeApplyOutcomeSchema.parse(answer) as ApplyReviewResult
    }),
    // Deferred, and never called by a host that only invokes a function op: the queue is opened by
    // `jobs()` and nothing else resolves a provider handle.
    model: input.model ?? (() => resolveCliJobModel(input.configPath)),
    // 389-06: the author's compaction budget, from the SAME profile resolution as the model
    // binding one line up (386 D-15) — deferred identically, resolved once at queue open,
    // and degrading to `undefined` (no ladder) when no LLM is configured.
    analysisTokenBudget:
      input.analysisTokenBudget ?? (() => resolveCliAnalysisTokenBudget(input.configPath)),
    ...(input.postRun === undefined ? {} : { postRun: input.postRun }),
  })
}
