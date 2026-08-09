// The CLI's half of the local host (Phase 384 plan 01, superseded in place by 385 plan 09, D-15).
//
// What used to live here — the runs reader, the knowledge listing binding and the registry
// assembly — moved to `composeLocalAgent()` in `@vostride/agent-qa-agent-local`, which 386's daemon
// calls too. What stays is what only THIS host can answer: who the caller is, how a configuration
// file is resolved and masked, which model a job would author with, and — since 385 plan 10 — how
// a run is executed. Each of those is a port the composition takes, so the two hosts share a
// composition rather than each writing one.
//
// 391 PROP-01: the interactive confirmation lives here for the same class of reason. Whether there
// is a PERSON on the other end of this process is a fact only a surface knows, and it is the
// difference between the two hosts that compose the same registry: a terminal can ask, a daemon
// cannot. So the gate's ConfirmPort is bound at THIS host and at no other, and the daemon's own
// composition passes none — which leaves the gate's deny-by-default confirm in place, the only
// correct answer for a host with nobody to ask.
//
// The run executor lives HERE rather than in a file of its own for the reason plan 09's model
// binding did: minting a run id needs `@vostride/agent-qa-core`, the FUNC-02 firewall forbids a
// surface naming it without a ledger entry, and the ledger only ever SHRINKS — new surface code
// can never join it. This file already carries that entry, so the placement mints none.

import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { createInterface } from 'node:readline'

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
import type {
  FunctionCaller,
  GrantRecordOutcome,
  RiskActionDescriptor,
  RunId,
  RunsStartInput,
} from '@vostride/agent-qa-schema'

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
  /**
   * How this invocation asks a person to confirm an ask-tier capability (391 PROP-01).
   *
   * Defaults to {@link createTtyConfirmPort}, which answers `undefined` when this process has no
   * terminal — so the default is "prompt where there is somebody to prompt, and nowhere else".
   * Overridable on the same optional-operation idiom `runExecution` and `model` use, so the
   * prompt's behaviour can be driven without a real tty behind it.
   */
  confirm?: ComposeLocalAgentInput['confirm']
  /**
   * How a chat SESSION asks (392 plan 08, D-03).
   *
   * A factory handed the composition's own grant mint and session-log sink, passed through
   * untouched: this host decides whether there is a person to ask, and the shared composition
   * decides what an approval and a session event ARE. Absent leaves the plain one-form confirm
   * above in place, which is every non-chat CLI invocation.
   */
  chatConfirm?: ComposeLocalAgentInput['chatConfirm']
  /**
   * What a chat session plans with (392 plan 09, CHAT-06 / D-04), passed through untouched.
   *
   * RESOLVED BY THE CALLER, NOT HERE, and the reason is mechanical rather than stylistic: this
   * function is synchronous, and reaching a provider costs a configuration read and an auth
   * resolution. `resolveCliChatCapabilities` is that resolution, and it is paid once when a
   * conversation opens — never by `agent-qa fn --list`, and never by a host that only lists the
   * registry (the `model` factory's own laziness rule, applied to a surface that cannot defer).
   *
   * All three are conditionally spread, so a project with no usable LLM configuration composes a
   * HEADLESS host: canonical utterances still route deterministically and anything else fails the
   * turn closed by name (D-08). Absence is a posture, not an unconfigured state.
   */
  chatModel?: ComposeLocalAgentInput['chatModel']
  chatModelFor?: ComposeLocalAgentInput['chatModelFor']
  chatAccounting?: ComposeLocalAgentInput['chatAccounting']
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

/**
 * The terminal confirmation the gate's ask arm reaches when nothing else satisfied it (391 PROP-01).
 *
 * ANSWERS `undefined` WHEN THERE IS NO TERMINAL, and that is the whole binding rule rather than a
 * convenience. An absent confirm leaves `evaluate()`'s own deny-by-default in place, which is the
 * only correct answer for a process with nobody to ask — and it is what keeps a piped `agent-qa`,
 * a CI job and the daemon on the fail-closed arm they are supposed to be on. BOTH streams are
 * checked: a process with a tty on input and a pipe on output would print the question where
 * nobody can read it and then wait for an answer nobody knows to give.
 *
 * DEFAULT NO. Anything other than an explicit yes is a refusal, including an empty line, an EOF and
 * a closed stream — the direction of that error costs a retry, and the other direction costs an
 * unasked commit to shared knowledge. The `[y/N]` in the prompt says so where the person is.
 *
 * NO TIMEOUT, and no knob for one (386 D-15 / D-17's spirit). A prompt that gave up after N seconds
 * would turn "the person went to get coffee" into a policy decision, and the decision it would make
 * is the one nobody asked for.
 */
export function createTtyConfirmPort(
  options: {
    readonly isTty?: boolean
    readonly input?: NodeJS.ReadableStream
    readonly output?: NodeJS.WritableStream
  } = {},
): ComposeLocalAgentInput['confirm'] {
  const isTty = options.isTty ?? (process.stdin.isTTY === true && process.stdout.isTTY === true)
  if (!isTty) return undefined

  const input = options.input ?? process.stdin
  const output = options.output ?? process.stdout
  return (action) => new Promise<boolean>((answer) => {
    const prompt = createInterface({ input, output })
    let settled = false
    const settle = (approved: boolean): void => {
      if (settled) return
      settled = true
      prompt.close()
      answer(approved)
    }

    // EOF IS A REFUSAL, and it needs its own handler rather than falling out of the question.
    // `question` never settles when the stream simply ends — it waits for a line that is not
    // coming — so a piped or closed stdin that slipped past the tty check above would leave a
    // capability call hanging forever instead of denying. Measured, not anticipated: the
    // closed-stream case in this port's own suite timed out at 30s until this handler existed.
    prompt.on('close', () => {
      settle(false)
    })

    // The ACTION NAME, verbatim — the same string the audit row carries and the same one a
    // standing grant would have to match. A friendlier paraphrase here would leave a person
    // unable to connect what they were asked about to what a `grants.list` later shows them.
    prompt.question(
      `agent-qa: ${action.name} needs your approval. Proceed? [y/N] `,
      (typed: string) => {
        const normalized = typed.trim().toLowerCase()
        settle(normalized === 'y' || normalized === 'yes')
      },
    )
  })
}

// ---- chat's three-way inline confirm (Phase 392 plan 08, D-03 / D-22 / T-392-26) -------------
//
// AN EXTENSION, NOT A FORK. `createTtyConfirmPort` above keeps its one-form prompt and every
// non-chat CLI decision keeps answering through it; this wrapper adds the second of 391's two
// decision forms for the surface that has a conversation to record it in. Reshaping the shipped
// port instead would have given every `agent-qa` command an `always` answer nobody reviewed for it.
//
// `ConfirmPort` IS UNTOUCHED, and that is the whole shape of the design (RESEARCH Pitfall 7). The
// port's type stays `(action) => boolean | Promise<boolean>`; the standing approval and the session
// event are things this wrapper does BESIDE answering, in the surface that knows a person is there.
// Nothing in `packages/safety` learns that chat exists.
//
// EXACTLY TWO FORMS, AND NO THIRD (D-22). `y` accepts this call; `a` accepts it and records a
// standing approval for its class; everything else refuses. The progressive "you have accepted
// this three times, always allow it?" offer is deferred, so it is not here and there is no
// almost-it to grow into one.
//
// THE MINT IS NOT THIS FILE'S. A standing approval widens autonomy permanently, and the machinery
// that gets that right — the protected-class refusal, the already-granted fold, the writer lease,
// the committed ledger — lives behind the `StandingGrantsPort` the composition binds and
// `proposals.accept --always` mints through. This wrapper is handed a closure over that same port
// and calls it; it writes no ledger of its own, and there is no second mint to review.

/** What the session log records about one decision. The wrapper produces it; composition appends it. */
export interface ChatApprovalDecisionRecord {
  /** The `fn:`-prefixed class the GATE produced, never one this file spelled (D-04 / 391-05). */
  readonly actionClass: string
  readonly decision: 'accept' | 'accept-always' | 'deny'
}

/**
 * The two things the wrapper does beside answering, both supplied by whoever composed the session.
 *
 * Supplied rather than reached for, because both are composition facts: which grants port is in
 * force and which session log is open are decided where the host is assembled, and a surface that
 * resolved either itself would be a second answer to a question the composition root already
 * closes (385 D-15).
 */
export interface ChatConfirmBindings {
  /**
   * Record the standing approval, through the SAME port `proposals.accept --always` mints on.
   *
   * Takes the action class and nothing else: the scope is the one pinned constant both the mint
   * and the gate read, and a caller that could name it could widen any grant into a match.
   */
  readonly recordStandingApproval: (actionClass: string) => Promise<GrantRecordOutcome>
  /** Append the `approval_decision` session event. Failures here never change the answer. */
  readonly onDecision: (decision: ChatApprovalDecisionRecord) => void | Promise<void>
}

export interface CreateChatConfirmPortOptions extends ChatConfirmBindings {
  readonly isTty?: boolean
  readonly input?: NodeJS.ReadableStream
  readonly output?: NodeJS.WritableStream
}

/**
 * Build the chat REPL's confirmation, or nothing when there is no terminal.
 *
 * The binding rule is the one-form port's, verbatim and for its reason: BOTH streams are checked,
 * and an absent port leaves `evaluate()`'s deny-by-default in place — which is what keeps a
 * scripted `ask`, a CI job and the daemon on the fail-closed arm D-03 says they stay on.
 *
 * DEFAULT NO, and the close handler is mandatory rather than defensive. `question` never settles
 * when a stream simply ends, so an EOF that slipped past the tty check would leave a capability
 * call hanging forever instead of denying — measured at 30s in the analog's own suite, not feared.
 *
 * NO TIMEOUT, for the same reason the analog has none: a prompt that gave up after N seconds would
 * turn "the person went to get coffee" into a policy decision nobody asked it to make.
 */
export function createChatConfirmPort(
  options: CreateChatConfirmPortOptions,
): ComposeLocalAgentInput['confirm'] {
  const isTty = options.isTty ?? (process.stdin.isTTY === true && process.stdout.isTTY === true)
  if (!isTty) return undefined

  const input = options.input ?? process.stdin
  const output = options.output ?? process.stdout

  /** The ledger append is a RECORD of the decision, never a veto over it. */
  const ledger = async (decision: ChatApprovalDecisionRecord): Promise<void> => {
    try {
      await options.onDecision(decision)
    } catch {
      // Swallowed HERE and nowhere else. A session log that cannot be written is a real problem
      // and it is the REPL's to report; letting it propagate through a `ConfirmPort` would turn a
      // logging failure into an exception where the gate expects a boolean, and the person who
      // just said yes would be told their action failed.
    }
  }

  /**
   * The `a` arm: mint first, then answer.
   *
   * The ORDER is deliberate and it is the opposite of `proposals.accept`'s, because the situations
   * are mirror images. There, the apply has already committed when the mint runs, so a mint
   * refusal must not discard the receipt. Here nothing has happened yet, so the standing half is
   * settled while it can still be reported cleanly — and the ONE-TIME approval survives either way,
   * because the person said yes to this call and a refusal of the standing half is not a
   * retraction of that.
   */
  const acceptAlways = async (action: RiskActionDescriptor): Promise<void> => {
    let outcome: GrantRecordOutcome | undefined
    try {
      outcome = await options.recordStandingApproval(action.name)
    } catch (error) {
      // The port RAISES rather than answers when the committed ledger carries a line it cannot
      // read — a refusal to DECIDE, which is not a decision and therefore not an arm it may have.
      // Folded here for the reason `proposals-accept.ts` folds it: something the person approved is
      // about to proceed, and an uncaught throw would report that as a failure of the whole call.
      output.write(
        `agent-qa: the standing approval could not be recorded `
        + `(${error instanceof Error ? error.name : String(error)}); this call still proceeds.\n`,
      )
    }

    if (outcome?.kind === 'protected-class') {
      // D-05's mint half: a protected class never acquires a standing approval, however it is
      // asked for. Reported rather than swallowed, because a person who typed `a` and got a plain
      // accept must be told which half of their answer did not happen.
      output.write(
        `agent-qa: ${outcome.actionClass} is a protected class and never takes a standing `
        + 'approval; this call is approved once.\n',
      )
    }

    const recorded = outcome?.kind === 'recorded' || outcome?.kind === 'already-granted'
    // The log records the EFFECT, not the request (392-05's law): `accept-always` claims a standing
    // approval exists, so it is written only where one does.
    await ledger({ actionClass: action.name, decision: recorded ? 'accept-always' : 'accept' })
  }

  return (action) => new Promise<boolean>((answer) => {
    const prompt = createInterface({ input, output })
    let settled = false
    const settle = (approved: boolean, record: () => Promise<void>): void => {
      if (settled) return
      settled = true
      prompt.close()
      void record().then(() => {
        answer(approved)
      })
    }

    prompt.on('close', () => {
      // EOF IS A REFUSAL. See the one-form port's own comment for the measurement behind this.
      settle(false, () => ledger({ actionClass: action.name, decision: 'deny' }))
    })

    prompt.question(
      `agent-qa: ${action.name} needs your approval. Proceed? [y/a/N] `
      + '(y = once, a = always allow this action class) ',
      (typed: string) => {
        const normalized = typed.trim().toLowerCase()
        if (normalized === 'a' || normalized === 'always') {
          settle(true, () => acceptAlways(action))
          return
        }
        if (normalized === 'y' || normalized === 'yes') {
          settle(true, () => ledger({ actionClass: action.name, decision: 'accept' }))
          return
        }
        settle(false, () => ledger({ actionClass: action.name, decision: 'deny' }))
      },
    )
  })
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
    ...(input.chatConfirm === undefined ? {} : { chatConfirm: input.chatConfirm }),
    // 392 plan 09, CHAT-06: the chat model arrives ALREADY BUILT, through `createModel` at the
    // resolution one layer up. Conditionally spread on the `confirm` precedent, so a host without
    // one leaves the field ABSENT and the composition's own headless posture is what answers.
    ...(input.chatModel === undefined ? {} : { chatModel: input.chatModel }),
    ...(input.chatModelFor === undefined ? {} : { chatModelFor: input.chatModelFor }),
    ...(input.chatAccounting === undefined ? {} : { chatAccounting: input.chatAccounting }),
    // 391 PROP-01: conditionally spread, so a host with no terminal leaves the field ABSENT and the
    // gate's own deny-by-default is what answers — in exactly one place.
    ...(() => {
      const confirm = input.confirm ?? createTtyConfirmPort()
      return confirm === undefined ? {} : { confirm }
    })(),
  })
}
