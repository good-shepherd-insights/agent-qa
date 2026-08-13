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

import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, resolve } from 'node:path'
import { createInterface } from 'node:readline'

import { Document as YamlDocument, parseDocument, parse as parseYaml } from 'yaml'

import type {
  ConfigApplyPortLike,
  ConfigFileSet,
  ConfigFilesPortLike,
  ConfigReaderPort,
  ConfigValidatePortLike,
  ConfigValidation,
  DraftApplyPortLike,
  JobModelCapability,
  StartedRun,
  TestDraftApplyRequestLike,
  TestDraftApplyResultLike,
} from '@vostride/agent-qa-agent'
import { composeLocalAgent } from '@vostride/agent-qa-agent-local'
import type {
  CandidateProsePosture,
  ComposeLocalAgentInput,
  DraftAuthoringPort,
  DraftParseOutcome,
  DraftStageOutcome,
  LocalAgentHost,
  RunExecutionPort,
  SuiteTextEntry,
} from '@vostride/agent-qa-agent-local'
import { KNOWLEDGE_PROPOSAL_APPLY_FUNCTION_ID } from '@vostride/agent-qa-agent'
import {
  AgentQaConfigSchema,
  applyPatchSetToTestDoc,
  discoverWorkspaceFiles,
  generateRunId,
  parseTestFile,
  parseTestFileWithTokens,
  renderPatchedTestDoc,
  resolveKnowledgeRoot,
  resolveWorkspacePaths,
  workspaceRelativeIdentityPath,
} from '@vostride/agent-qa-core'
import type { TestDefinition } from '@vostride/agent-qa-core'
import type { ApplyDelegate, ApplyReviewResult } from '@vostride/agent-qa-agent-local'
import { KnowledgeApplyOutcomeSchema, base64Decode, renderConfigDiff, sha256hexBytes } from '@vostride/agent-qa-schema'
import type {
  ConfigApplyOutcome,
  ConfigProposalApplyableV1,
  FunctionCaller,
  GrantRecordOutcome,
  RiskActionDescriptor,
  RunId,
  RunsStartInput,
  ScopeKey,
  TestEditPatchSet,
} from '@vostride/agent-qa-schema'

import { loadConfigFile, loadEnvOverrides, resolveConfig } from '../config.js'
import { listTargets, resolveTarget } from '../targets.js'
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
 *
 * 394-13 / WINDOWS 101: `test-write` was ABSENT here from 394-01 until this plan, and it was an
 * omission rather than a decision — 394-01 minted the sixth capability scope and recorded in the
 * same breath that what constrains its power is D-03's two decision points (the fan-out confirm
 * and 391's inbox accept), not a withheld grant. So the full-local-grants rule this header already
 * states covered it all along, and the list simply had not been extended. The list is now pinned
 * SET-EQUAL to `FunctionScopeSchema.options` (`__tests__/caller-scopes.test.ts`), which is that
 * rule made mechanical: a seventh scope minted by a later phase cannot be silently omitted, it
 * reds. Do not replace the equality with a membership check — a hand-extended list is exactly what
 * rotted here, and it rotted invisibly because every op-level suite mints its own caller.
 */
export const CLI_FUNCTION_CALLER: FunctionCaller = {
  surface: 'cli',
  // 391 D-06: `approval-write` joins because the CLI is where a person accepts a proposal and
  // revokes a standing grant. The scope is the POWER; the origin below is who may exercise it,
  // and this host is the only one that mints both.
  grantedScopes: [
    'read',
    'run',
    'config-write',
    'knowledge-write',
    'approval-write',
    'test-write',
  ],
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
// scope override and an execution-context override are declared on the op's input contract for
// later phases to wire (schema/functions/runs.ts). Accepting one and dropping it would make the
// acknowledgment a lie in exactly the way its own contract warns about, so an unhonourable field
// is a typed refusal instead.
//
// BOTH DURABLE MARKERS LEFT THAT LIST IN 393 (WTST-06), and the failure that took them out is worth
// recording. `gateRun` / `excludedFromOutcomes` were carried end to end — `RunsStartInput` accepts
// them, the runner stamps them onto the handoff, the outcome fold excludes a flagged handoff, and
// the post-run tail copies them onto the analyze-run payload. Every piece existed EXCEPT the one in
// the middle: this port re-enters `agent-qa run` as a child, and the command had no flag to carry a
// marker, so the port refused the request. The consequence was not cosmetic — `authoring.draft.verify`
// registered `bound` and could not take a single gate-run on a real CLI, which is to say the entire
// keep-gate evaluator was unreachable at runtime. It was found by the first live invocation and by
// nothing before it, because every earlier test of the op supplied its own run port.

/** The request named a field this host cannot honour, so the request is refused rather than reshaped. */
export class UnsupportedRunRequestError extends Error {
  constructor(readonly unsupportedFields: readonly string[]) {
    super(
      `agent-qa cannot start a run with: ${unsupportedFields.join(', ')}. ` +
        'These fields are declared on the runs.start contract for the phases that wire them ' +
        '(scope and executionContext: the run-invocation work). Accepting one now would drop it ' +
        'silently and acknowledge a run of a different kind.',
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
] as const satisfies readonly (keyof RunsStartInput)[]

/**
 * The request fields this port CARRIES, as the child flags that express them (393, WTST-06).
 *
 * A TABLE rather than two `if`s, for the reason the refusal list above is a list: the two halves of
 * "which fields does this port handle" then live beside each other, and a field added to
 * `RunsStartInput` with no plan for carrying it appears in neither — which the refusal turns into a
 * typed error rather than a silent drop.
 *
 * Only literal `true` sends the flag. The carriers are `?: true`, so `false` is a refusal rather
 * than a synonym for absence, and a marker a caller did not assert must not reach the handoff.
 */
const MARKER_FLAGS = [
  ['gateRun', '--gate-run'],
  ['excludedFromOutcomes', '--excluded-from-outcomes'],
] as const satisfies readonly (readonly [keyof RunsStartInput, string])[]

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
          // BEFORE the operand separator, because they are options of `run` rather than patterns.
          ...MARKER_FLAGS.flatMap(([field, flag]) => (request[field] === true ? [flag] : [])),
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
  /**
   * The turn engine's reconciliation strategy (392 plan 10, D-16), passed through untouched.
   *
   * A PASSTHROUGH OF A COMPOSITION-ONLY SEAM, and both halves of that matter. `composeLocalAgent`
   * declares this option so the mutation proof can assemble the REAL engine twice — deterministic
   * override on, override off — and read the difference off a named compound scenario. The live
   * arm of that proof needs a real model, and the only resolution that produces one is this
   * host's; without this line the differential would have to re-derive a host beside the one
   * production uses, which is exactly the lookalike-assembly failure the proof exists to exclude.
   *
   * IT IS NOT, AND MUST NEVER BECOME, CONFIG-REACHABLE. No key of the project configuration names
   * it, no environment variable selects it, and `strategy-config-unreachable.test.ts` asserts both.
   * This interface is a CALL SIGNATURE — a caller already holding the code that composes the host
   * — and widening it grants nothing a caller could not do by calling `composeLocalAgent` itself.
   * Absent leaves the shipped deterministic override in place, which is what makes the absence the
   * safe default rather than an unconfigured state.
   */
  chatReconcile?: ComposeLocalAgentInput['chatReconcile']
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
 * A parsed test's NL step text, pre-interpolation.
 *
 * PRE-interpolation and never post: a resolved step can carry the value a `${VAR}` expanded to, and
 * both the receipt's step table and gate 3's text lane are read by humans and stored on disk
 * (D-19 / T-393-02). The parser's step is `string | { step, ... }`; the object form's own `step`
 * field is the same sentence, so both narrow to one text.
 */
function draftStepTexts(test: TestDefinition): string[] {
  return test.steps.map((step) => (typeof step === 'string' ? step : step.step))
}

/**
 * The one test in a draft file, or the reason there is not one.
 *
 * A draft is ONE test. A file holding several is refused rather than silently evaluated on its
 * first document: the receipt keys on the draft's identity and its digest covers the whole file, so
 * a multi-test file would produce a receipt whose verdict names one test and whose bytes cover
 * several — and the author would have no way to tell which one was kept.
 */
function singleDraftTest(tests: readonly TestDefinition[]): TestDefinition | string {
  if (tests.length === 0) return 'the file parses but holds no test document'
  if (tests.length > 1) {
    return `the file holds ${tests.length} tests; a draft is one test, evaluated as one`
  }
  return tests[0] as TestDefinition
}

/**
 * The host half of `authoring.draft.verify` (393 D-01), pre-bound to one workspace.
 *
 * IT LIVES IN THIS FILE ON PURPOSE, for the reason the identity mint above and the run-id minting
 * before it already state: both verbs need `@vostride/agent-qa-core` — `parseTestFile`,
 * `workspaceRelativeIdentityPath`, `resolveWorkspacePaths`/`discoverWorkspaceFiles` — the FUNC-02
 * surface firewall forbids a `packages/cli` file naming core without an exact (file, specifier)
 * ledger entry, and that ledger only ever SHRINKS: new surface code can never join it. This file
 * already carries the entry (cleared by 395), so the placement mints no new debt. The daemon host
 * reaches this factory through the same deferred import it already uses for the run executor and
 * the identity mint.
 *
 * THE BOUNDARY CHECK IS `workspaceRelativeIdentityPath` AND NOTHING ELSE (T-393-01). It resolves
 * the caller's path against the checkout root and THROWS when the result escapes, so the refusal
 * and the identity are the same computation — a draft whose identity cannot be minted is exactly a
 * draft that is not in this workspace, and there is no second rule to keep in step. That the mint
 * is also the spelling the runner records on `PerTestOutcome.filePath` is what makes gates 1-2 able
 * to find the draft's own member at all.
 */
/**
 * A scope-less authoring call the host cannot answer unambiguously (394-26, WINDOWS 110 · D-19).
 *
 * IT NAMES EVERY CANDIDATE IT SAW, which is the whole difference between this and returning
 * `undefined`. A refusal that says only "ambiguous" leaves the author with no way to write the
 * `scope` that would have worked, and the host is the only side that knows what the alternatives
 * were. Zero candidates uses the same class: "this project configures no targets" and "it
 * configures several" are both answers of the form "there is no unique product here".
 */
export class AuthoringScopeUnresolvableError extends Error {
  constructor(readonly candidates: readonly string[]) {
    super(
      candidates.length === 0
        ? 'cannot derive a default authoring scope: this project configures no targets, so there '
          + 'is no product to author for. Add a target under registry.targets, or pass `scope` '
          + 'explicitly.'
        : `cannot derive a default authoring scope: ${candidates.length} products are candidates `
          + `(${candidates.join(', ')}). Pass \`scope\` explicitly to choose one.`,
    )
    this.name = 'AuthoringScopeUnresolvableError'
  }
}

/**
 * WHICH PRODUCT THIS PROJECT AUTHORS FOR, when the caller named no scope (394-26, WINDOWS 110).
 *
 * THE ONE DERIVATION, and both hosts reach exactly it: the CLI `fn` surface and the chat/daemon
 * host both build their authoring capability from `createDraftAuthoringPort` below, which
 * delegates here. A second resolver — a planner-side default, an utterance parser, a chat-side
 * stamp — would be a redundant mechanism second-guessing this one, and the two would be free to
 * answer differently for one workspace.
 *
 * THE PRODUCT MAPPING IS `agent-qa run`'S OWN. `resolveTarget` answers a target's `product` when
 * it has one and the target name otherwise, so the scope a draft is authored for is the scope its
 * gate runs are attributed under. A mapping spelled here would be a second arithmetic for one
 * number.
 *
 * THE WORKSPACE NARROWS THE CONFIG, and only when it has something to say. A project may declare
 * several targets and commit tests against one of them; that project has an unambiguous answer
 * the config alone cannot give. A project with nothing committed falls back to the configured
 * targets, which is what makes the very first authored test in a fresh checkout reachable at all.
 *
 * DISCOVERY IS ADVISORY, on `suiteTextCorpus`'s stated posture one function down: an unreadable
 * or unparsable file is omitted rather than raised, because one broken test must not make
 * authoring unreachable. The direction the omission moves the candidate set is the safe one — it
 * can only shrink it, and a shrunken set still has to survive the singleton check below.
 *
 * AMBIGUITY REFUSES AND NAMES ITS EVIDENCE (D-19). A unique candidate binds; zero or several
 * throw {@link AuthoringScopeUnresolvableError}. Picking the first would author a test for
 * whichever product happened to sort first in a config file.
 */
export async function deriveDefaultAuthoringScope(configPath: string): Promise<ScopeKey> {
  const config = await resolveConfig({ configPath, loadAuthPlugins: false })
  // THROUGH THE SHIPPED ENUMERATION (394-37, IN-03). This read used to be an untyped cast of its
  // own, which made three spellings of `registry.targets` in one file — and `configuredTargetNames`
  // below already imports `listTargets` and argues, in its own doc block, that a second walk of the
  // config is a second answer to what a target may be called.
  const targetNames = listTargets(config).map((target) => target.name)

  const productOfTarget = new Map<string, string>()
  for (const name of targetNames) productOfTarget.set(name, resolveTarget(config, name).product)

  const workspace = resolveWorkspacePaths({ config, configPath })
  const files = await discoverWorkspaceFiles({ workspace, kind: 'test' })
  const exercised = new Set<string>()
  for (const file of files) {
    try {
      const parsed = parseTestFile(readFileSync(file.absolutePath, 'utf8'), file.workspaceRelativePath)
      if (parsed.errors.length > 0) continue
      for (const test of parsed.tests) {
        // A target this config does not declare has no product mapping, so it can neither narrow
        // nor ambiguate — it is a test this project cannot run either.
        const product = productOfTarget.get(test.target)
        if (product !== undefined) exercised.add(product)
      }
    } catch {
      // One unreadable file cannot make authoring unreachable. See the note above.
    }
  }

  const candidates = [...(exercised.size > 0 ? exercised : new Set(productOfTarget.values()))].sort()
  if (candidates.length !== 1) throw new AuthoringScopeUnresolvableError(candidates)
  return { tier: 'product', key: candidates[0] as string }
}

export function createDraftAuthoringPort(configPath: string): DraftAuthoringPort {
  const configDir = dirname(resolve(configPath))

  return {
    // The op's absence path reaches THIS, through the composition — see the function's own header
    // for why there is exactly one derivation and why both hosts must reach it.
    deriveDefaultScope(): Promise<ScopeKey> {
      return deriveDefaultAuthoringScope(configPath)
    },

    parseDraft(filePath: string): Promise<DraftParseOutcome> {
      let identityPath: string
      let absolutePath: string
      try {
        identityPath = workspaceRelativeIdentityPath(configDir, filePath)
        absolutePath = resolve(configDir, identityPath)
      } catch {
        return Promise.resolve({ kind: 'outside-workspace' })
      }

      let stats
      try {
        stats = statSync(absolutePath)
      } catch {
        return Promise.resolve({ kind: 'not-found' })
      }
      if (!stats.isFile()) return Promise.resolve({ kind: 'not-a-file' })

      // READ ONCE, AS BYTES (394-29, CR-02). The digest below is the ONE value the apply's own
      // re-check is compared against, and that re-check hashes the target's raw bytes — so this
      // side reads bytes too and the decoding is derived FROM them for the parse alone. Reading the
      // file twice (once decoded, once raw) would be a second read of a file that can change
      // between them; deriving the string from these bytes cannot disagree with them.
      const bytes = readFileSync(absolutePath)
      const content = bytes.toString('utf8')
      // Parsed under the IDENTITY path, so any position a parse error names is the path the author
      // typed rather than an absolute one only this machine can produce.
      const parsed = parseTestFile(content, identityPath)
      if (parsed.errors.length > 0) {
        return Promise.resolve({
          kind: 'unparsable',
          reason: parsed.errors.map((error) => error.message).join('; '),
        })
      }
      const test = singleDraftTest(parsed.tests)
      if (typeof test === 'string') {
        return Promise.resolve({ kind: 'unparsable', reason: test })
      }

      return Promise.resolve({
        kind: 'parsed',
        draft: {
          // The run path's own recipe: an authored `test-id` if there is one, the name otherwise.
          testId: (test as { 'test-id'?: string })['test-id'] ?? test.name,
          filePath: identityPath,
          testName: test.name,
          // Read here since 394-15 and DROPPED until 394-37: the compile stage's vocabulary check
          // is the one consumer, and it can only exist if the parse carries the value out.
          target: test.target,
          steps: draftStepTexts(test),
          // An EDITABLE root, so it is carried rather than dropped: the credential gate scans it.
          ...(test.context === undefined ? {} : { context: test.context }),
          // Over the FILE'S BYTES — the bytes themselves, never their decoding — so a receipt
          // cannot be inherited by an edited draft (the whole of what `DraftRefSchema.contentDigest`
          // promises) AND so this value means the same thing as the digest the apply recomputes at
          // the accept. Every byte sequence that is not valid UTF-8 decodes to the same replacement
          // characters, so a digest over the decoding both collapses genuinely different targets
          // together and disagrees with the consumer about a target nobody touched.
          contentDigest: createHash('sha256').update(bytes).digest('hex'),
        },
      })
    },

    /**
     * Stage a compiled draft: PARSE first, WRITE second, and nothing at all when the parse fails
     * (394 D-01 · T-394-06).
     *
     * The order is the whole verb. What arrives here is bytes an LLM produced from a free-text
     * intent — the one input on the authoring path no schema at the op boundary can vet — so it is
     * put through the SAME `parseTestFile` + `singleDraftTest` pair a committed draft goes through
     * above, and only bytes that survived that become a file. A caller cannot reverse the two,
     * because there is only the one verb.
     *
     * PARSED UNDER THE PATH IT WILL LIVE AT, which is why the digest is computed before the parse
     * rather than after: the shelf path is minted from the digest, and the parser is handed that
     * path so any position an error names — and the `filePath` gates 1-2 later join on — is the
     * path the draft actually occupies. Parsing under a placeholder and re-parsing after the write
     * would be two parses of one file with two chances to disagree.
     */
    async stageDraft(contents: string): Promise<DraftStageOutcome> {
      const contentDigest = createHash('sha256').update(contents).digest('hex')
      const identityPath = `${DRAFT_SHELF_PARENT}/${DRAFT_SHELF_DIR_NAME}/${contentDigest}.yaml`

      const parsed = parseTestFile(contents, identityPath)
      if (parsed.errors.length > 0) {
        return {
          kind: 'unparsable',
          reason: parsed.errors.map((error) => error.message).join('; '),
        }
      }
      const test = singleDraftTest(parsed.tests)
      if (typeof test === 'string') return { kind: 'unparsable', reason: test }

      // Only now. The shelf's own guards still apply — the digest is character-class checked and
      // the join is boundary-checked — so a defect that produced a hostile digest is refused by
      // `DraftShelfOutsideWorkspaceError` rather than by this function's silence.
      const writtenPath = createDraftShelf(configDir).write(contentDigest, contents)
      return {
        kind: 'staged',
        draft: {
          testId: (test as { 'test-id'?: string })['test-id'] ?? test.name,
          filePath: writtenPath,
          testName: test.name,
          // The value WR-04's guard compares, off the same parse that decided these bytes are a
          // test at all — so the check runs against what the shelf really wrote, not against what
          // the model's text appeared to say.
          target: test.target,
          steps: draftStepTexts(test),
          // As above: an editable root the gate scans. A stage that dropped it would re-open the
          // blind spot for every patched draft, which is the path a repair patch takes.
          ...(test.context === undefined ? {} : { context: test.context }),
          contentDigest,
        },
      }
    },

    /**
     * Apply an RFC-6902 patch set to a staged draft and stage the result (394-06 D-09/D-20).
     *
     * THE ONE APPLIER, AND THE ONLY PLACE IT IS REACHED FROM THE AUTHORING PATH. `agent` declares
     * the capability as a shelf verb because it may not depend on `core`; this is where the
     * dependency actually exists, which is the same reason `stageDraft` above lives here.
     *
     * IT GOES THROUGH `stageDraft`, not around it. The rendered bytes are handed back to the
     * same parse-then-write verb a fresh compile uses, so a patched document that no longer
     * parses is refused with nothing written, and the new draft's digest is over the bytes that
     * were actually stored — which is the whole of `DraftRef.contentDigest`'s promise that a later
     * edit cannot inherit an earlier receipt.
     *
     * EVERY REFUSAL THE APPLIER RAISES BECOMES `unparsable` DATA. A pointer outside the editable
     * region, an unresolvable path, a collection where a scalar was required: all of them are
     * things a MODEL emitted, so they are ordinary answers rather than faults of this host, and
     * the repair loop's own accounting is what decides what to do about one.
     */
    async applyPatchesToDraft(
      draft: { readonly filePath: string },
      patchSet: TestEditPatchSet,
    ): Promise<DraftStageOutcome> {
      let source: string
      try {
        source = readFileSync(resolve(configDir, draft.filePath), 'utf8')
      } catch (error) {
        return {
          kind: 'unparsable',
          reason: `the staged draft could not be read: ${
            error instanceof Error ? error.message : String(error)}`,
        }
      }

      let rendered: string
      try {
        const parsed = parseTestFileWithTokens(source, draft.filePath)
        applyPatchSetToTestDoc(parsed, patchSet)
        rendered = renderPatchedTestDoc(parsed, draft.filePath)
      } catch (error) {
        return {
          kind: 'unparsable',
          reason: error instanceof Error ? error.message : String(error),
        }
      }

      return await this.stageDraft(rendered)
    },

    /**
     * The authored-test universe as text — gate 3's text-lane population before the derived index
     * subtracts the identities it has evidence for (D-16).
     *
     * ADVISORY BY CONSTRUCTION, exactly as `discoverAuthoringKnownTests` is: an unreadable or
     * malformed file is omitted rather than raised, because one broken test file in a repository
     * must not make every draft unverifiable. The direction that omission moves gate 3 is the safe
     * one — a smaller corpus can only make a draft look MORE novel, never less, and the gate's
     * primary lane is unaffected.
     *
     * Resolved per call rather than cached: an evaluation is rare and a stale suite listing would
     * compare a draft against a repository that no longer exists.
     */
    async suiteTextCorpus(): Promise<readonly SuiteTextEntry[]> {
      // The SAME resolution the `knowledgeRoot` closure below performs — one config loader per
      // host, never a second parse with its own layering and its own env precedence.
      const config = await resolveConfig({ configPath, loadAuthPlugins: false })
      const workspace = resolveWorkspacePaths({ config, configPath })
      const files = await discoverWorkspaceFiles({ workspace, kind: 'test' })

      const entries: SuiteTextEntry[] = []
      for (const file of files) {
        try {
          const parsed = parseTestFile(
            readFileSync(file.absolutePath, 'utf8'),
            file.workspaceRelativePath,
          )
          if (parsed.errors.length > 0) continue
          for (const test of parsed.tests) {
            entries.push({
              filePath: file.workspaceRelativePath,
              testName: test.name,
              stepsText: draftStepTexts(test),
            })
          }
        } catch {
          // One unreadable file cannot block a verification. See the note above.
        }
      }
      return entries
    },

    /**
     * The `target` vocabulary stage 3 chooses from (394-33, WR-07).
     *
     * `listTargets` AND NOT A SECOND ENUMERATION. It is the same read `agent-qa targets` prints
     * and the same `registry.targets` map `resolveTarget` resolves against, so the names a model
     * is offered are exactly the names a run can be started for. A second walk of the config here
     * would be a second answer to "what may a `target` say", free to drift from the one the runner
     * actually honours — and drift is precisely what WR-07 is about.
     *
     * NAMES, NOT PRODUCTS, and the distinction is the defect. `deriveDefaultAuthoringScope` above
     * answers a PRODUCT (`resolveTarget(...).product`, i.e. `target.product ?? targetName`), and
     * on a project where a target declares a product under a different name the two differ — so a
     * stage that read the scope key as a target would emit a value this config does not declare.
     *
     * Resolved per call, on `suiteTextCorpus`'s stated reason one function up: authoring is rare
     * and a cached target list would serve a vocabulary the config no longer has.
     */
    async configuredTargetNames(): Promise<readonly string[]> {
      const config = await resolveConfig({ configPath, loadAuthPlugins: false })
      return listTargets(config).map((target) => target.name)
    },
  }
}

// THE DRAFT SHELF: where an authored draft lives so that a run can actually verify it (394,
// WTST-01). `tests/.agent-qa-drafts/`, and deliberately NOT `.agent-qa/drafts/`. The location is
// forced by a TWO-SIDED admission property that only a dot-directory inside the workspace's own
// test patterns satisfies, and both sides were measured against the in-tree glob@13.0.6 on
// 2026-08-11:
//
//   ADMITTED BY A RUN. `runs.start` hands its `patterns` to `resolveWorkspaceFileTarget`, which
//   THROWS `Workspace test file is not matched by configured workspace patterns` for anything
//   `workspace.testMatch` does not match. Against the house pattern tests/**/*.yaml, `globToRegex`
//   compiles the globstar segment to `(?:.*/)?` and the star to `[^/]*`, giving
//   ^tests/(?:.*/)?[^/]*\.yaml$ — which MATCHES tests/.agent-qa-drafts/<digest>.yaml. A shelf
//   under .agent-qa/ matches nothing, so the loop could never verify a draft there at all.
//
//   INVISIBLE TO DISCOVERY. `discoverWorkspaceFiles` calls glob(patterns, {cwd, ignore, absolute,
//   nodir}) and passes NO `dot` option; glob@13.0.6 defaults dot:false. Measured on one workspace
//   holding both files: ['tests/real/t.yaml'] without it, and both paths with dot:true. THE
//   LEADING DOT IS THE WHOLE MECHANISM — suite discovery, gate 3's corpus enumeration and a bare
//   `agent-qa run` never see a draft because of it. If dot:true is ever passed at that call site,
//   drafts join the suite and this shelf has to move.
//
// It lives in THIS file for the reason the draft port above already states: the boundary check is
// `workspaceRelativeIdentityPath`, that needs `@vostride/agent-qa-core`, and the FUNC-02 ledger
// entry this file already carries is the only one that will ever exist for it.
export const DRAFT_SHELF_PARENT = 'tests'
export const DRAFT_SHELF_DIR_NAME = '.agent-qa-drafts'

/** The durable name shape, and the in-flight sibling that is never a draft. */
const DRAFT_SUFFIX = '.yaml'
const DRAFT_TEMP_SUFFIX = '.tmp'

/**
 * The digest shapes this shelf will turn into a path.
 *
 * IN-03 applied where the joining happens, verbatim from `draft-receipts-store.ts`: a
 * `contentDigest` arrives from a caller and becomes a filename two lines later, so a value
 * carrying `../` would be a caller-supplied arbitrary-path primitive. Wider than sha256-hex
 * because the DTO promises only a non-empty string, narrow enough that no member can name a path
 * separator, a parent directory or a hidden file.
 */
const SAFE_DRAFT_DIGEST = /^[A-Za-z0-9_-]{1,128}$/

/**
 * The shelf's one named refusal (T-394-02).
 *
 * ONE class for both rules because they are one rule seen twice: a digest that can name a path and
 * a path that escapes the workspace are the same failure — an address this workspace cannot own.
 * `reason` says which check fired without splitting the vocabulary a caller has to handle.
 */
export class DraftShelfOutsideWorkspaceError extends Error {
  constructor(
    readonly reason: 'unsafe-digest' | 'outside-workspace',
    readonly request: string,
    detail: string,
  ) {
    super(
      `draft shelf: refusing to address ${JSON.stringify(request)} — ${detail}. A shelf path's `
      + 'containment and its identity are the same computation, so a path with no '
      + 'workspace-relative identity is exactly a path no run in this workspace could be handed.',
    )
    this.name = 'DraftShelfOutsideWorkspaceError'
  }
}

function shelfIdentity(configDir: string, workspaceRelativePath: string): string {
  try {
    return workspaceRelativeIdentityPath(configDir, workspaceRelativePath)
  } catch (error) {
    throw new DraftShelfOutsideWorkspaceError(
      'outside-workspace',
      workspaceRelativePath,
      (error as Error).message,
    )
  }
}

/** The absolute shelf directory for one workspace. Creates nothing. */
export function draftShelfDir(configDir: string): string {
  return resolve(configDir, shelfIdentity(configDir, `${DRAFT_SHELF_PARENT}/${DRAFT_SHELF_DIR_NAME}`))
}

/** The absolute path one draft's bytes are addressed by. Creates nothing. */
export function shelfPathFor(configDir: string, contentDigest: string): string {
  if (!SAFE_DRAFT_DIGEST.test(contentDigest)) {
    throw new DraftShelfOutsideWorkspaceError(
      'unsafe-digest',
      contentDigest,
      'a draft digest must be 1-128 characters of [A-Za-z0-9_-]',
    )
  }
  return resolve(
    configDir,
    shelfIdentity(
      configDir,
      `${DRAFT_SHELF_PARENT}/${DRAFT_SHELF_DIR_NAME}/${contentDigest}${DRAFT_SUFFIX}`,
    ),
  )
}

/** Hosts may reject directory handles with only these established portability errors. */
const UNSUPPORTED_DIRECTORY_FSYNC_CODES = new Set(['EINVAL', 'EISDIR', 'EPERM', 'ENOTSUP'])

function fsyncPath(path: string): void {
  let fd: number | undefined
  try {
    fd = openSync(path, 'r')
    fsyncSync(fd)
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

function fsyncDirectory(path: string): void {
  try {
    fsyncPath(path)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === undefined || !UNSUPPORTED_DIRECTORY_FSYNC_CODES.has(code)) throw error
  }
}

/**
 * Write bytes atomically: full content to a PID-suffixed sibling, fsync, durable rename.
 *
 * The proposals-store / receipts-store posture wholesale, and the pid is the same load-bearing
 * detail — a shared temp name would make the rename's atomicity irrelevant, because the bytes
 * being renamed could be half of another process's draft. Two concurrent `authoring.draft.write`
 * calls in one workspace therefore never collide and never expose a half-written draft to a run.
 *
 * ONE PRIMITIVE, TWO CALLERS (394-23). The draft shelf and the one-commit apply's target write are
 * the same obligation — the bytes appear whole or they do not appear — and a second implementation
 * of it beside this one is the shape every other header in this file argues against. `string |
 * Buffer` because the apply is byte-true end to end (WR-04) while the shelf writes text; the
 * encoding argument is gone, so a Buffer is written as itself and a string as UTF-8.
 *
 * THE TEMP IS REMOVED ON EVERY FAILURE PATH, and it matters more for the apply than for the shelf.
 * The shelf lives in a gitignored directory; the target's sibling temp would sit UNTRACKED next to
 * a person's committed test suite, showing up in their `git status` as litter this product left
 * behind immediately after telling them nothing had been written. Best-effort, because a cleanup
 * that threw would replace the error that says why the write failed with one about the tidying up.
 */
function writeFileAtomically(path: string, contents: string | Buffer): void {
  const temp = `${path}.${process.pid}${DRAFT_TEMP_SUFFIX}`
  try {
    writeFileSync(temp, contents)
    fsyncPath(temp)
    fsyncDirectory(dirname(temp))
    renameSync(temp, path)
  } catch (error) {
    try {
      rmSync(temp, { force: true })
    } catch {
      // Best effort, and deliberately silent: see the header.
    }
    throw error
  }
  fsyncDirectory(dirname(path))
}

export interface DraftShelf {
  /** Stage one draft's bytes; answers the WORKSPACE-RELATIVE path a run can be handed. */
  write(contentDigest: string, contents: string): string
  /** Every staged draft, sorted, as workspace-relative paths. Never an in-flight temp. */
  list(): readonly string[]
}

/**
 * Bind the shelf over one workspace.
 *
 * LAZY, exactly as the receipts store is: nothing opens and nothing is created until the first
 * write, which is what lets a composition root bind this unconditionally without deciding whether
 * a project has ever authored a draft — an absent directory and an empty shelf are one answer.
 */
export function createDraftShelf(configDir: string): DraftShelf {
  const directory = draftShelfDir(configDir)

  return {
    write(contentDigest: string, contents: string): string {
      const path = shelfPathFor(configDir, contentDigest)
      mkdirSync(directory, { recursive: true })
      writeFileAtomically(path, contents)
      return `${DRAFT_SHELF_PARENT}/${DRAFT_SHELF_DIR_NAME}/${contentDigest}${DRAFT_SUFFIX}`
    },

    list(): readonly string[] {
      let names: readonly string[]
      try {
        names = readdirSync(directory)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
        throw error
      }
      // DETERMINISTIC ORDER, and an in-flight temp is NOISE rather than a draft: it sits beside a
      // durable name that either is already in this listing or is about to be.
      return [...names]
        .sort()
        .filter(name => !name.endsWith(DRAFT_TEMP_SUFFIX) && name.endsWith(DRAFT_SUFFIX))
        .map(name => `${DRAFT_SHELF_PARENT}/${DRAFT_SHELF_DIR_NAME}/${name}`)
    },
  }
}

// THE ONE-COMMIT APPLY (394-10, D-06 · WTST-01/WTST-07). The first write this product makes to a
// user's own git history.
//
// IT LIVES IN THIS FILE for the reason every verb above it does: the boundary check is
// `workspaceRelativeIdentityPath`, that needs `@vostride/agent-qa-core`, and the FUNC-02 surface
// firewall forbids a NEW `packages/cli` file naming that package — the ledger only ever shrinks.
// This file already carries the entry, so the placement mints no new debt.
//
// IT EXTENDS THE `runGitSymbolicRef` IDIOM rather than inventing one: an injected exec seam
// defaulting to `spawnSync`, a finite timeout on every invocation, and ENOENT distinguished from
// every other spawn failure. What it does NOT inherit is the skip-on-ENOENT branch that
// `checkIgnoreStatus` and `verifyEffectiveGitignore` take around `git check-ignore` in
// `commands/init-filesystem.ts`, and the difference is the whole point of writing it down. A
// read-only VERIFICATION may
// skip itself when git is absent, because there is a degraded posture to fall back to and a safety
// check that disables itself on an unexpected error is the wrong default. A COMMIT has no degraded
// posture: there is nothing to fall back TO, and "git was not there so nothing was recorded" read
// as success would tell a person their draft is in their history when it is on their disk and
// nowhere else. So git-absent is a typed refusal here and a skip nowhere on this path.
//
// THE DIRTY CHECK IS SCOPED TO THE TARGET PATH, and that scoping is a safety property in BOTH
// directions. A human with uncommitted work at exactly the file the agent is about to write must
// have the apply refuse — otherwise `git log` would attribute their edit to the agent's commit and
// the agent's edit to them, which is the one thing this apply may never do. And dirtiness ANYWHERE
// ELSE is not the agent's business: a repo-wide check would refuse every real working session, and
// it would pass every refusal cell written above while doing it.

/**
 * The bound on each synchronous git invocation the apply makes.
 *
 * RETUNE: raise it if a real repository's `git status` on one pathspec is genuinely slower than
 * this — that is the only one of the three that scales with repository size, and it is scoped to a
 * single path precisely so it does not. It may NOT become unbounded or configurable: a hanging
 * subprocess inside an accept is an accept that never answers, and the operator sees a terminal
 * that has stopped rather than a refusal they can act on (T-394-45).
 */
export const APPLY_GIT_TIMEOUT_MS = 20_000

/**
 * The injected exec seam, shaped as `spawnSync` — the `runGitSymbolicRef` idiom.
 *
 * `spawnSync` rather than `execFileSync` because the apply has to TRIAGE: a non-zero status is
 * git's own answer, an `error` is a failure to ask at all, and `execFileSync` collapses both into
 * one throw. `checkIgnoreStatus` makes exactly this distinction for exactly this reason.
 */
export type GitApplyExec = (
  file: string,
  args: readonly string[],
  options: { cwd: string; encoding: 'utf8'; timeout: number },
) => {
  status: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
  error?: Error
}

/** What an accepted `test-draft` proposal asks this host to do. */
export interface TestDraftApplyRequest {
  /** Named in the commit message, so history attributes the change to the artifact that made it. */
  readonly proposalId: string
  /** The staged draft's workspace-relative shelf path — where the bytes come FROM. */
  readonly draftPath: string
  /** Where the bytes go. Workspace-relative; boundary-checked by the identity mint and nothing else. */
  readonly targetPath: string
  /**
   * sha256 of the target's bytes as the proposal read them, or ABSENT when the target did not exist.
   *
   * Absent is a claim about absence, never a waiver: an apply carrying no digest requires the
   * target to STILL not exist, because a new suite file that has since been created by somebody
   * else is exactly the collision this field is here to catch.
   */
  readonly sourceDigest?: string
  /** The one line a person read in their inbox. Becomes the commit subject. */
  readonly summaryLine: string
}

export interface TestDraftApplyResult {
  /** Workspace-relative, as the identity mint spells it. */
  readonly filePath: string
  /** The commit this apply made, abbreviated as git prints it. */
  readonly commit: string
}

/**
 * A person has uncommitted work at the exact file the agent was about to write.
 *
 * The refusal is the mitigation for T-394-40 and it is a REPUDIATION control rather than a
 * convenience: an apply that swept those bytes in would produce a commit indistinguishable, in
 * `git log`, from the person having written the agent's change themselves.
 */
export class DirtyApplyTargetError extends Error {
  constructor(readonly targetPath: string, readonly porcelain: string) {
    super(
      `refusing to apply to ${JSON.stringify(targetPath)}: it carries uncommitted work `
      + `(${JSON.stringify(porcelain)}). Commit or stash that file first — an agent commit and a `
      + 'human commit never share a change, because a shared one attributes each edit to the other.',
    )
    this.name = 'DirtyApplyTargetError'
  }
}

/**
 * git could not be run at all. A REFUSAL, never a skip — see this section's header.
 */
export class GitUnavailableForApplyError extends Error {
  constructor(readonly targetPath: string, readonly cause: Error) {
    super(
      `refusing to apply to ${JSON.stringify(targetPath)}: git could not be run `
      + `(${cause.message}). An apply has nothing to degrade to — a draft written without a commit `
      + 'is a change nobody can find, so this refuses rather than reporting a commit that is not there.',
    )
    this.name = 'GitUnavailableForApplyError'
  }
}

/**
 * The target moved between the proposal's read and this accept (T-394-44).
 *
 * The window is real and ordinary: a proposal sits in an inbox until somebody looks at it, and the
 * file it targets is one a person may have been editing the whole time.
 */
export class ApplyTargetChangedError extends Error {
  constructor(
    readonly targetPath: string,
    readonly expected: string | undefined,
    readonly found: string | undefined,
  ) {
    super(
      `refusing to apply to ${JSON.stringify(targetPath)}: it is not what the proposal read. `
      + (expected === undefined
        ? 'The proposal recorded no source digest, which is a claim that the target did not exist; '
          + 'it exists now.'
        : found === undefined
          ? 'The proposal recorded a source digest, but the target is no longer there.'
          : `Expected ${expected}, found ${found}.`)
      + ' Re-run the authoring loop against the file as it stands.',
    )
    this.name = 'ApplyTargetChangedError'
  }
}

/**
 * The commit was MADE and its hash could not be read (394-18, CR-05).
 *
 * A class of its own because the two facts it carries pull in opposite directions and a caller has
 * to be told both: the write succeeded and is in the person's history, and this apply cannot say
 * which commit it is. The alternative shipped until now was to route the failed read through the
 * restore, which reverted a file the repository had already recorded.
 */
export class ApplyCommitHashUnavailableError extends Error {
  constructor(readonly targetPath: string, readonly status: number, readonly stderr: string) {
    super(
      `the commit for ${JSON.stringify(targetPath)} was made, but reading its hash failed `
      + `(git rev-parse exited ${status}${stderr === '' ? '' : `: ${stderr}`}). `
      + 'The commit stands — look for it at HEAD. Nothing has been reverted.',
    )
    this.name = 'ApplyCommitHashUnavailableError'
  }
}

/**
 * The apply staged nothing, so there was nothing to commit (394-18, CR-05).
 *
 * The reachable arrangement is an accept of a draft whose bytes already ARE the target's: the
 * digest re-check passes, the write is a no-op and the add stages nothing. Named rather than
 * reported as a git failure, and decided on the INDEX rather than on git's English — a message
 * match would move under a translated or reworded git.
 */
export class ApplyProducedNoChangeError extends Error {
  constructor(readonly targetPath: string) {
    super(
      `refusing to report a commit for ${JSON.stringify(targetPath)}: the draft's bytes are `
      + 'already what the target holds, so the apply staged nothing and made no commit. '
      + 'The proposal needs no apply.',
    )
    this.name = 'ApplyProducedNoChangeError'
  }
}

/**
 * The apply failed AND the rollback failed (394-23, WR-03).
 *
 * TWO FACTS, ONE ERROR, AND NEITHER MAY REPLACE THE OTHER. A bare `restoreApplyFailure(...)` inside
 * the catch lets a throwing restore unwind over the error that says why the apply failed, so a
 * caller is handed the second fact with no route to the first — at the one moment both matter,
 * because "the commit was refused" and "your file may not be back" are different things to do next.
 *
 * The message names both and the two errors are carried structurally as well, so a caller can
 * re-raise or log either without parsing prose. The worktree/index state after this is UNKNOWN by
 * construction: that is exactly what it is reporting, and a class that implied otherwise would be
 * the same lie in the other direction.
 */
export class ApplyRollbackFailedError extends Error {
  constructor(
    readonly targetPath: string,
    readonly applyError: unknown,
    readonly restoreError: unknown,
  ) {
    super(
      `the apply of ${JSON.stringify(targetPath)} failed AND its rollback did not complete. `
      + `The apply failed because: ${errorText(applyError)}. `
      + `The rollback then failed because: ${errorText(restoreError)}. `
      + `The state of ${JSON.stringify(targetPath)} in your working tree and index is therefore `
      + 'NOT known to this apply — check it with `git status` and `git diff` before committing.',
    )
    this.name = 'ApplyRollbackFailedError'
  }
}

/** An unknown throw as one readable sentence, for the composite above. */
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function runApplyGit(
  exec: GitApplyExec,
  cwd: string,
  targetPath: string,
  args: readonly string[],
): { status: number; stdout: string; stderr: string } {
  const result = exec('git', args, { cwd, encoding: 'utf8', timeout: APPLY_GIT_TIMEOUT_MS })
  if (result.error !== undefined) {
    // THE ONE TRIAGE. ENOENT is "git is not installed"; every other errno — EACCES, EAGAIN,
    // EMFILE, an ETIMEDOUT from the bound above — means the question could not be asked for a
    // reason nobody has thought about, and a write path that treated those as "git said no" would
    // be inventing an answer. They leave this function as themselves.
    if ((result.error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new GitUnavailableForApplyError(targetPath, result.error)
    }
    throw result.error
  }
  if (result.status === null) {
    throw new Error(
      `git ${args[0] ?? ''} exited without a status`
      + `${result.signal === null ? '' : ` (signal ${result.signal})`}`,
    )
  }
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

/**
 * Is anything uncommitted at this ONE path?
 *
 * `--` before the pathspec, as every caller-controlled path in this file is. The pathspec is what
 * makes the answer about the target rather than about the repository.
 */
export function runGitStatusPorcelain(
  exec: GitApplyExec,
  cwd: string,
  targetPath: string,
): string {
  const result = runApplyGit(exec, cwd, targetPath, ['status', '--porcelain', '--', targetPath])
  if (result.status !== 0) {
    throw new Error(
      `git status exited ${result.status} for ${JSON.stringify(targetPath)}: ${result.stderr.trim()}`,
    )
  }
  return result.stdout.trim()
}

/** Stage exactly one path. Never `-A`, never `.`, never a glob this host expanded. */
export function runGitAdd(exec: GitApplyExec, cwd: string, targetPath: string): void {
  const result = runApplyGit(exec, cwd, targetPath, ['add', '--', targetPath])
  if (result.status !== 0) {
    throw new Error(
      `git add exited ${result.status} for ${JSON.stringify(targetPath)}: ${result.stderr.trim()}`,
    )
  }
}

/**
 * What one pathspec commit did, or why it did nothing (394-18).
 *
 * A RESULT ARM rather than a message match at the call site. `git commit` exits non-zero for
 * "nothing to commit" exactly as it does for a hook refusal or a broken index, and the only thing
 * distinguishing them in git's own answer is English prose on stdout — which a translated,
 * reworded or newer git is free to change. The arm below is decided on the INDEX instead: if
 * nothing is staged at the path after the add, there is nothing to commit, and that is a fact this
 * function can check before it asks git to do anything at all.
 *
 * The commit HASH is deliberately not here. Reading HEAD is a separate question asked after the
 * commit exists — see {@link applyTestDraftAsOneCommit}, where keeping it separate is what stops a
 * failed read from routing through the restore and reverting a commit that succeeded.
 */
export type GitCommitOutcome =
  | { readonly kind: 'committed' }
  | { readonly kind: 'nothing-to-commit' }

/** Is anything staged at this ONE path, right now? Read from `git diff --cached`'s exit code. */
function stagedAtPath(exec: GitApplyExec, cwd: string, targetPath: string): boolean {
  const result = runApplyGit(
    exec,
    cwd,
    targetPath,
    ['diff', '--cached', '--quiet', '--', targetPath],
  )
  // 0 = no staged difference, 1 = there is one. Anything else is git failing to answer, which is
  // not "nothing is staged" and must not be read as it.
  if (result.status !== 0 && result.status !== 1) {
    throw new Error(
      `git diff --cached exited ${result.status} for ${JSON.stringify(targetPath)}: `
      + `${result.stderr.trim()}`,
    )
  }
  return result.status === 1
}

/**
 * Commit exactly one path.
 *
 * THE PATHSPEC ON THE COMMIT IS A SECOND, INDEPENDENT CONTROL and not a restatement of the add's.
 * A pathspec commit builds its tree from the named paths and the current HEAD, so anything a
 * person had already staged before accepting stays staged and stays out of this commit. The add's
 * pathspec cannot express that — by the time the add runs, their file is already in the index.
 *
 * No `-a`, no `--amend`, and no ref-moving subcommand anywhere on this path. Each of those turns
 * one recorded change into an edit of somebody else's.
 */
export function runGitCommit(
  exec: GitApplyExec,
  cwd: string,
  targetPath: string,
  message: string,
): GitCommitOutcome {
  if (!stagedAtPath(exec, cwd, targetPath)) return { kind: 'nothing-to-commit' }
  const committed = runApplyGit(
    exec,
    cwd,
    targetPath,
    ['commit', '--quiet', '-m', message, '--', targetPath],
  )
  if (committed.status !== 0) {
    throw new Error(
      `git commit exited ${committed.status} for ${JSON.stringify(targetPath)}: `
      + `${committed.stderr.trim()}`,
    )
  }
  return { kind: 'committed' }
}

/** The short hash at HEAD. Asked only where a commit is known to exist. */
export function runGitHeadHash(exec: GitApplyExec, cwd: string, targetPath: string): string {
  const head = runApplyGit(exec, cwd, targetPath, ['rev-parse', '--short', 'HEAD'])
  if (head.status !== 0) {
    throw new ApplyCommitHashUnavailableError(targetPath, head.status, head.stderr.trim())
  }
  return head.stdout.trim()
}

/**
 * The INDEX state for ONE path, as git's own plumbing spells it — or `undefined` for no entry.
 *
 * Captured BEFORE the apply stages anything, and restored verbatim if the apply fails. The pair is
 * the CR-05 fix, and the reason it is a capture rather than `git reset HEAD -- <path>` is the
 * arrangement a reset gets wrong: a person may have staged content that differs from HEAD, and
 * resetting would silently discard their own staged work at the very file the agent touched. An
 * unconditional `git rm --cached` gets the other direction wrong — for a tracked target it would
 * stage a DELETION of a test the person has committed.
 *
 * `ls-files --stage` answers `<mode> <object> <stage>\t<path>`; `update-index --cacheinfo` takes
 * `<mode>,<object>,<path>` — so the stage is parsed to be CHECKED (stage 0 only), not to be
 * restored. Both are path-scoped plumbing: nothing here can touch a second path, and there is no
 * repo-wide operation on this file at all.
 */
export function captureIndexEntry(
  exec: GitApplyExec,
  cwd: string,
  targetPath: string,
): IndexEntry | undefined {
  const result = runApplyGit(exec, cwd, targetPath, ['ls-files', '--stage', '--', targetPath])
  if (result.status !== 0) {
    throw new Error(
      `git ls-files exited ${result.status} for ${JSON.stringify(targetPath)}: `
      + `${result.stderr.trim()}`,
    )
  }
  const line = result.stdout.split('\n')[0]?.trim() ?? ''
  if (line === '') return undefined
  // `<mode> <object> <stage>\t<path>`. The path half is dropped: it is the path we asked about,
  // and re-reading it here would make a quoted or escaped filename a second parsing problem.
  const [mode, object, stage] = line.split('\t')[0]?.split(' ') ?? []
  if (mode === undefined || object === undefined || stage === undefined) {
    throw new Error(`git ls-files answered an unparsable index entry: ${JSON.stringify(line)}`)
  }
  if (stage !== '0') {
    throw new Error(
      `git ls-files answered ${JSON.stringify(targetPath)} at stage ${stage}: a conflicted index `
      + `entry cannot be captured for restore, because putting it back at stage 0 would collapse `
      + `an unresolved conflict into a resolved entry`,
    )
  }
  return { mode, object, stage }
}

/** One path's index entry, as `ls-files --stage` reports it and `update-index` takes it back. */
export interface IndexEntry {
  readonly mode: string
  readonly object: string
  readonly stage: string
}

/**
 * Put the captured index state back — BOTH directions, and never a repo-wide reset.
 *
 * An entry that existed is restored to the exact blob it named; an entry that did not exist is
 * removed. `--force-remove` is used for the second because it is unconditional: the path may or
 * may not be in the index by the time the restore runs, and a variant that failed on "not there"
 * would turn a successful rollback into a second error on top of the first.
 */
export function restoreIndexEntry(
  exec: GitApplyExec,
  cwd: string,
  targetPath: string,
  captured: IndexEntry | undefined,
): void {
  const args = captured === undefined
    ? ['update-index', '--force-remove', '--', targetPath]
    // NO TRAILING PATH OPERAND on the cacheinfo form, and the omission is load-bearing: the path
    // rides INSIDE the `<mode>,<object>,<path>` triple, and repeating it after `--` would make
    // `update-index` also read the WORKTREE copy — re-staging the agent's blob immediately after
    // the person's was restored. Measured: with the operand present this restore is a no-op.
    : ['update-index', '--add', '--cacheinfo', `${captured.mode},${captured.object},${targetPath}`]
  const result = runApplyGit(exec, cwd, targetPath, args)
  if (result.status !== 0) {
    throw new Error(
      `git update-index exited ${result.status} restoring ${JSON.stringify(targetPath)}: `
      + `${result.stderr.trim()}`,
    )
  }
}

/**
 * The commit message.
 *
 * IT NAMES THE PROPOSAL AND IT NAMES THE AUTHOR. The prohibition this discharges is not about
 * tidiness: a commit that presented agent-written test content as a person's own work would make
 * the repository's own history the wrong place to find out where a test came from, and the person
 * whose name is on the commit would be the last to know. The proposal id is the link back to the
 * receipt, the gate verdicts and the runs that produced it.
 */
function applyCommitMessage(request: TestDraftApplyRequest): string {
  return `test: ${request.summaryLine}\n\n`
    + `Authored by agent-qa and accepted from proposal ${request.proposalId}.\n`
    + `Draft: ${request.draftPath}\n`
}

export interface ApplyTestDraftInput {
  /** The project's config file; its directory is the workspace root the identity mint resolves against. */
  readonly configPath: string
  readonly request: TestDraftApplyRequest
  /** Injected for tests; defaults to `spawnSync`. */
  readonly exec?: GitApplyExec
  /**
   * Every byte that reaches the target path — the apply's write AND the rollback's restore — goes
   * through this one call. Injected for tests; defaults to {@link writeFileAtomically}.
   *
   * The `exec` seam's twin, and admitted for the same reason: a write that fails MID-FLIGHT is the
   * one thing a real filesystem will not do on demand, and the property CR-01 closes is stated
   * entirely in terms of what happens when it does. Routing the restore through it too is what
   * makes "the write reaches disk only through the atomic writer" a fact about both directions
   * rather than about the happy path.
   */
  readonly writeTarget?: (absolutePath: string, bytes: Buffer) => void
}

/**
 * Write an accepted draft to its target suite path and make ONE commit containing ONE file.
 *
 * THE ORDER IS THE CONTRACT. Identity, then the dirty check, then the digest re-check, then write,
 * then add, then commit — and every refusal above the write leaves the working tree byte-unchanged.
 *
 * THE WRITE, THE ADD AND THE COMMIT ARE ONE `try` (394-23, CR-01), which ends a class rather than
 * narrowing it once more. Three rounds each moved one further statement into the rollback's reach
 * and each left the next one out, so this states the region instead of adjudicating a statement.
 * Everything between the digest re-check and the commit is one of four things, and each is here for
 * a reason that is written down:
 *
 *   the draft read and the identity mint — pure reads, no effect to roll back;
 *   {@link captureIndexEntry}          — a read, and it PRODUCES the rollback's own input, so it
 *                                        cannot be inside the region that consumes it;
 *   `mkdirSync(..., recursive)`        — the ONE remaining effect outside the try, deliberately.
 *                                        git records no directories, so an empty directory left by
 *                                        a failed apply changes nothing this function restores or
 *                                        that `git status` reports; and removing it would not be
 *                                        safe to do — a recursive create may have made several
 *                                        levels and a concurrent writer may already be inside one,
 *                                        which is precisely the "undo work that was never the
 *                                        agent's" that {@link restoreApplyFailure} forbids;
 *   the write, the add and the commit  — inside, all three.
 *
 * And the write itself is TEMP-THEN-RENAME, so a failure part-way through it cannot leave partial
 * bytes at the target path at all: what used to truncate a person's committed test before writing
 * now touches that path only as one durable rename.
 *
 * THE HASH READ IS BELOW ALL OF IT AND STAYS THERE — see the note above the return.
 *
 * DIRTY BEFORE DIGEST, and the ordering is a decision rather than a sequence. The two overlap: a
 * target a person has edited is usually BOTH dirty and no longer what the proposal read, so
 * whichever is asked first decides which sentence the person gets. "You have uncommitted work at
 * this file" names something they can act on immediately; "the target is not what the proposal
 * read" is true but tells them less about why. The narrower check is asked second, where it still
 * catches the case dirtiness cannot see at all — a target somebody else COMMITTED since the
 * proposal was made, which is perfectly clean and completely different from what the proposal read.
 *
 * THE DIGEST RE-CHECK IS IMMEDIATELY BEFORE THE WRITE, and that placement is the mitigation rather
 * than a detail: the window it closes is the one between the proposal's read and this accept, and a
 * check performed anywhere earlier leaves a window of its own.
 *
 * WHAT A FAILED APPLY LEAVES BEHIND, STATED AS WHAT THE CELLS PROVE (394-18, CR-05). Two states are
 * restored for the ONE target path and for nothing else:
 *
 *   the WORKTREE — the exact BYTES that were there, or no file at all if there was none;
 *   the INDEX    — the entry that was there, or no entry at all if there was none.
 *
 * Both directions, per path, and never a repo-wide operation: no `reset`, no `checkout .`, no
 * `clean`. The index half is what stops the agent's blob from folding into the person's next
 * commit, and it is a CAPTURE rather than a reset because a person may have staged content that
 * differs from HEAD — resetting would discard their own work at the file the agent touched.
 *
 * BYTES, NOT TEXT — ON BOTH SIDES (394-23 WR-04, completed by 394-29 CR-02). The target is read,
 * digested and written back as raw bytes here, and `parseDraft` — the ONE producer of the
 * `sourceDigest` this compares against — hashes raw bytes too. The history is worth stating
 * exactly, because a one-sided version of it justified a defect: at the base BOTH halves hashed the
 * UTF-8 decoding and therefore AGREED, so a stable non-UTF-8 target matched; what the round-trip
 * genuinely destroyed was the rollback, which wrote U+FFFD back over every sequence the decoder
 * could not read. 394-23 moved this half alone, which made the two halves disagree and refused a
 * clean non-UTF-8 target as changed; 394-29 moved the producer, so one recipe holds end to end.
 *
 * A ROLLBACK THAT ITSELF FAILS IS REPORTED AS BOTH FACTS (394-23, WR-03), as
 * {@link ApplyRollbackFailedError} — never as the restore's own error unwinding over the one that
 * says why the apply failed.
 *
 * WHAT IS NOT RESTORED, and must not be: a commit that SUCCEEDED. Reading its hash is a separate
 * question asked after it exists, and a failure of that read surfaces as
 * {@link ApplyCommitHashUnavailableError} with the commit standing and the worktree matching it.
 *
 * WHAT IS NOT CLAIMED. The restore is exact for what this function did; it is not a general undo,
 * and it cannot speak for a concurrent writer — the previous state is bytes read moments ago and an
 * index entry read moments ago, under the same lock-free assumption the digest re-check makes. Nor
 * is the pre-staged-blob direction reachable through this entry point today: the dirty check
 * refuses a target with staged content before anything is written, so the capture's staged arm is
 * pinned at its own mechanism rather than through an apply.
 */
export function applyTestDraftAsOneCommit(input: ApplyTestDraftInput): TestDraftApplyResult {
  const { request } = input
  const configDir = dirname(resolve(input.configPath))
  const exec = input.exec ?? (spawnSync as unknown as GitApplyExec)
  const writeTarget = input.writeTarget ?? writeFileAtomically

  // THE BOUNDARY CHECK IS `workspaceRelativeIdentityPath` AND NOTHING ELSE (T-394-41). The refusal
  // and the identity are the same computation, so there is no second rule to drift from this one —
  // a target with no workspace-relative identity is exactly a target no run in this workspace could
  // have been handed, and it throws out of the mint rather than out of a check beside it.
  const identityPath = workspaceRelativeIdentityPath(configDir, request.targetPath)
  const absoluteTarget = resolve(configDir, identityPath)

  const porcelain = runGitStatusPorcelain(exec, configDir, identityPath)
  if (porcelain !== '') throw new DirtyApplyTargetError(identityPath, porcelain)

  const existing = readTargetIfPresent(absoluteTarget)
  const foundDigest = existing === undefined
    ? undefined
    : createHash('sha256').update(existing).digest('hex')
  if (foundDigest !== request.sourceDigest) {
    throw new ApplyTargetChangedError(identityPath, request.sourceDigest, foundDigest)
  }

  const draftIdentity = workspaceRelativeIdentityPath(configDir, request.draftPath)
  const contents = readFileSync(resolve(configDir, draftIdentity))

  // CAPTURED BEFORE THE WRITE, so a capture FAILURE is a refusal with the tree byte-unchanged
  // rather than a hole: none of this read's four throw paths is inside the try that owns the
  // rollback, and the entry it reads is a fact about the repository that does not depend on the
  // write having happened. See {@link captureIndexEntry} for why this is a capture, not a reset.
  //
  // The `mkdirSync` beside it is the one effect left outside the try, and the reason is enumerated
  // in this function's header rather than decided here: git records no directories, so nothing this
  // rollback restores can be affected by one, and undoing a recursive create is not safe.
  const indexBefore = captureIndexEntry(exec, configDir, identityPath)
  mkdirSync(dirname(absoluteTarget), { recursive: true })

  let committed: GitCommitOutcome
  try {
    writeTarget(absoluteTarget, contents)
    runGitAdd(exec, configDir, identityPath)
    committed = runGitCommit(exec, configDir, identityPath, applyCommitMessage(request))
  } catch (error) {
    // A FAILURE ANYWHERE IN WRITE -> ADD -> COMMIT PUTS THE FILE BACK — AND PUTS THE INDEX BACK.
    //
    // Everything above refuses with the tree untouched; from here on a bare throw would leave bytes
    // on a person's disk that no commit explains and that this apply already told the caller it did
    // not make. The INDEX half was missing until 394-18 and was the worse of the two: the worktree
    // was restored and the agent's blob stayed staged, so the person's very next `git commit` —
    // which commits the index — carried a file they never wrote and were told was not written. The
    // WRITE itself was outside this try until 394-23, which was the same hole one statement wider.
    restoreOrReportBoth(
      exec, configDir, identityPath, absoluteTarget, existing, indexBefore, writeTarget, error,
    )
    throw error
  }

  if (committed.kind === 'nothing-to-commit') {
    // Reachable, and it is not a failure of git: a draft whose bytes already ARE the target's
    // passes the digest re-check, writes the same bytes, and stages nothing. Refused BY NAME with
    // the repository put back, rather than reported as `git commit exited 1` with an empty stderr.
    const noChange = new ApplyProducedNoChangeError(identityPath)
    restoreOrReportBoth(
      exec, configDir, identityPath, absoluteTarget, existing, indexBefore, writeTarget, noChange,
    )
    throw noChange
  }

  // BELOW THIS LINE NOTHING IS RESTORED. The commit exists, so it is the new truth, and reverting
  // the worktree against it is the second defect CR-05 named: a checkout disagreeing with its own
  // history at the file the agent just wrote. A failure to READ the hash is surfaced as itself.
  return {
    filePath: identityPath,
    commit: runGitHeadHash(exec, configDir, identityPath),
  }
}

/**
 * Roll back, and if the rollback ITSELF fails say both things at once (394-23, WR-03).
 *
 * The wrapper exists because the alternative is silent: a bare call in a catch lets the restore's
 * own error unwind over the error being handled, and the caller is then told why the rollback
 * failed with no way to learn why the apply did. Both restore sites go through here, so neither
 * arm can drift into the masking form on its own.
 */
function restoreOrReportBoth(
  exec: GitApplyExec,
  cwd: string,
  identityPath: string,
  absoluteTarget: string,
  existing: Buffer | undefined,
  indexBefore: IndexEntry | undefined,
  writeTarget: (absolutePath: string, bytes: Buffer) => void,
  applyError: unknown,
): void {
  try {
    restoreApplyFailure(exec, cwd, identityPath, absoluteTarget, existing, indexBefore, writeTarget)
  } catch (restoreError) {
    throw new ApplyRollbackFailedError(identityPath, applyError, restoreError)
  }
}

/**
 * Put the working tree AND the index back where the apply found them, for this ONE path.
 *
 * Worktree first, then the index, and both scoped to the target: the previous worktree state is
 * either "no such file" or bytes this function read moments ago, and the previous index state is
 * whatever {@link captureIndexEntry} recorded before the add. Nothing here is repo-wide — no
 * `reset`, no `checkout .`, no `clean` — because the one thing this rollback must not do is undo
 * work that was never the agent's.
 *
 * THE BYTES GO BACK AS BYTES, through the SAME writer the apply used. A `Buffer` in, a `Buffer`
 * out, with no encoding named anywhere on the path: the round-trip this shipped with turned every
 * sequence the UTF-8 decoder could not read into U+FFFD, so "restored" meant a file the person had
 * committed and could no longer recover from their own working tree.
 */
function restoreApplyFailure(
  exec: GitApplyExec,
  cwd: string,
  identityPath: string,
  absoluteTarget: string,
  existing: Buffer | undefined,
  indexBefore: IndexEntry | undefined,
  writeTarget: (absolutePath: string, bytes: Buffer) => void,
): void {
  if (existing === undefined) rmSync(absoluteTarget, { force: true })
  else writeTarget(absoluteTarget, existing)
  restoreIndexEntry(exec, cwd, identityPath, indexBefore)
}

/**
 * The port `proposals.accept` reaches when a person accepts a `test-draft`, pre-bound to one
 * workspace.
 *
 * A FACTORY over the pure function above rather than a second implementation, on
 * `createDraftAuthoringPort`'s idiom: the composition root binds a capability, the capability is one
 * call, and the `configPath` is the only thing a host knows that the layer does not.
 */
export function createTestDraftApplyPort(configPath: string): DraftApplyPortLike {
  return {
    apply(request: TestDraftApplyRequestLike): Promise<TestDraftApplyResultLike> {
      return Promise.resolve(applyTestDraftAsOneCommit({ configPath, request }))
    },
  }
}

// THE CONFIG APPLY (395-01, D-05/D-17/D-19 · CFGM-03/CFGM-04). The second write this product makes
// to a person's own git history, and the first that touches more than one file.
//
// IT GENERALIZES `applyTestDraftAsOneCommit` DIRECTLY ABOVE and does not re-derive it: the same
// exec seam, the same atomic writer, the same index capture/restore, the same
// `restoreOrReportBoth`, the same "the hash read is below everything and is never rolled back". The
// deltas are a pinned file SET rather than one path, the D-19 byte comparison before any write, the
// spec §4.3 author string, the D-06 trailer, and CFGM-03's idempotency answer.
//
// WHAT THIS PLAN DOES NOT SHIP, NAMED SO IT IS NOT MISTAKEN FOR THE END STATE. D-05's dirty-tree
// discipline — a human-first commit carrying the person's bytes, THEN the agent commit — is plan
// 395-06's, and until it lands a dirty config file refuses through the shipped
// {@link DirtyApplyTargetError} posture. That refusal is a TEMPORARY disposition, not the decided
// one: D-08 records that config apply commits human-first while the test-draft apply keeps
// refusing, and the two are deliberately different. Whoever implements 395-06 replaces the refusal
// below and nothing else on this path.
//
// THE ORDER IS THE CONTRACT, and it differs from its analog by one step at the front:
//
//   0. ALREADY-APPLIED? Asked FIRST, before any freshness check, and the ordering is the whole of
//      CFGM-03's idempotency edge. After a successful apply the file on disk is the NEW content, so
//      every digest re-check below would fail — reporting `ApplyTargetChangedError` to a person
//      whose change is exactly where they left it. The question is answered from the person's own
//      git history rather than from a ledger this port keeps: the D-06 trailer IS the record, so
//      there is no second copy of "what has this applied" to fall out of step with the repository.
//   1. identity, per file, through `workspaceRelativeIdentityPath` and nothing else;
//   2. the dirty check, per file (see the temporary posture above);
//   3. the digest re-check, per file, IMMEDIATELY before the write — the window it closes is the
//      one between the proposal's read and this accept, and a check performed earlier leaves a
//      window of its own;
//   4. THE BYTE COMPARISON (D-19): recompute the diff from the bytes on disk RIGHT NOW to the
//      proposal's new content, through the SAME `renderConfigDiff` the construction called, and
//      compare against the bytes the proposal stored. Inequality refuses BEFORE anything is
//      written. This is what makes "what you saw is what was committed" a measurement rather than
//      an assertion, and it is why the proposal stores the rendered bytes at all;
//   5. write, add, commit — all three inside ONE try, with both the worktree and the index
//      restored per path on any failure;
//   6. the hash read, below all of it, never restored.

/** The machine-readable marker every agent config commit carries (D-06). */
export const AGENT_CONFIG_PROPOSAL_TRAILER_KEY = 'Agent-QA-Proposal'

/**
 * The author every agent config commit is written under (spec §4.3).
 *
 * ATTRIBUTION IS THE POINT rather than tidiness. A commit presenting agent-authored configuration
 * as a person's own work would make the repository's own history the wrong place to find out where
 * a change came from, and the person whose name is on the commit would be the last to know. It is
 * an `--author` and not only a message line because `git log --author` and every review tool that
 * reads authorship are what a person actually filters on.
 */
export const AGENT_CONFIG_COMMIT_AUTHOR = 'agent-qa (proposed by chat) <agent-qa@local>'

/** What an accepted `config` proposal asks this host to do. */
export interface ConfigApplyRequest {
  readonly proposalId: string
  readonly payload: ConfigProposalApplyableV1
}

/**
 * The bytes about to be committed are not the bytes the person reviewed (D-19).
 *
 * THE REFUSAL IS THE MEASUREMENT. Everything else about this contract is a claim; this class is
 * what happens when the claim is false, and it fires BEFORE any write, so a payload doctored
 * between the render and the accept changes nothing on disk. The digests are named rather than the
 * diffs themselves: a message carrying the widened diff would print the very bytes it is refusing
 * to commit.
 */
export class ConfigApplyDiffMismatchError extends Error {
  constructor(readonly expectedDigest: string, readonly foundDigest: string) {
    super(
      'refusing to apply this configuration change: the diff it would commit is not the diff the '
      + `proposal recorded showing you (recorded ${expectedDigest}, recomputed ${foundDigest}). `
      + 'Nothing has been written. Re-propose the change against the configuration as it stands.',
    )
    this.name = 'ConfigApplyDiffMismatchError'
  }
}

/** The commit message: subject from the one-liner, the proposal named, the D-06 trailer last. */
function configApplyCommitMessage(request: ConfigApplyRequest): string {
  return `config: ${request.payload.summaryLine}\n\n`
    + `Proposed by agent-qa and accepted from proposal ${request.proposalId}.\n\n`
    // EMBEDDED IN THE MESSAGE rather than passed as `--trailer`, deliberately: the flag's
    // availability and its exact placement behaviour vary across git versions, and this value is
    // byte-asserted by the composed case. A marker a test cannot pin is not a contract.
    + `${AGENT_CONFIG_PROPOSAL_TRAILER_KEY}: ${request.proposalId}\n`
}

/** Does this repository have any commit at all? Asked before anything reads history. */
function repositoryHasCommits(exec: GitApplyExec, cwd: string, targetPath: string): boolean {
  const head = runApplyGit(exec, cwd, targetPath, ['rev-parse', '--verify', '--quiet', 'HEAD'])
  return head.status === 0 && head.stdout.trim() !== ''
}

/**
 * The commit this proposal already made, if it made one — CFGM-03's idempotency answer.
 *
 * READ OFF THE PERSON'S OWN HISTORY, which is the decision this function is. The alternative was a
 * durable "applied proposals" ledger beside the repository, and it would be a second answer to a
 * question git already answers — free to say `applied` about a commit somebody has since rebased
 * away, or to have lost a record of a commit that is plainly there. The trailer is the record.
 *
 * `--fixed-strings` because the proposal id is data: a `--grep` treating it as a regular expression
 * would be a search whose meaning depends on the characters an id mint happens to produce.
 */
function findAppliedCommit(
  exec: GitApplyExec,
  cwd: string,
  targetPath: string,
  proposalId: string,
): string | undefined {
  if (!repositoryHasCommits(exec, cwd, targetPath)) return undefined
  const marker = `${AGENT_CONFIG_PROPOSAL_TRAILER_KEY}: ${proposalId}`
  const found = runApplyGit(exec, cwd, targetPath, [
    'log', '--format=%h', '--fixed-strings', `--grep=${marker}`, '--max-count=1',
  ])
  if (found.status !== 0) {
    throw new Error(
      `git log exited ${found.status} looking for proposal ${JSON.stringify(proposalId)}: `
      + `${found.stderr.trim()}`,
    )
  }
  const hash = found.stdout.trim()
  return hash === '' ? undefined : hash
}

/**
 * Commit exactly these paths, as ONE commit, authored as the agent.
 *
 * `runGitCommit`'s multi-path twin rather than a widening of it, because its single-path form is
 * corpus-pinned by 394 and this phase may not move it. Everything load-bearing is carried over
 * verbatim: nothing-to-commit is decided on the INDEX rather than on git's English prose, the
 * pathspec on the commit is a SECOND independent control that keeps anything a person had already
 * staged out of this commit, and there is no `-a`, no `--amend` and no ref-moving subcommand
 * anywhere on this path.
 */
function runGitCommitPaths(
  exec: GitApplyExec,
  cwd: string,
  paths: readonly string[],
  message: string,
): GitCommitOutcome {
  if (!paths.some((path) => stagedAtPath(exec, cwd, path))) return { kind: 'nothing-to-commit' }
  const committed = runApplyGit(exec, cwd, paths[0] ?? '.', [
    'commit', '--quiet', '-m', message, `--author=${AGENT_CONFIG_COMMIT_AUTHOR}`, '--', ...paths,
  ])
  if (committed.status !== 0) {
    throw new Error(
      `git commit exited ${committed.status} for ${JSON.stringify(paths)}: `
      + `${committed.stderr.trim()}`,
    )
  }
  return { kind: 'committed' }
}

export interface ApplyConfigProposalInput {
  readonly configPath: string
  readonly request: ConfigApplyRequest
  /** Injected for tests; defaults to `spawnSync`. */
  readonly exec?: GitApplyExec
  /** Injected for tests; defaults to {@link writeFileAtomically}. See its analog's reasoning. */
  readonly writeTarget?: (absolutePath: string, bytes: Buffer) => void
}

/** One file's state as this apply found it, carried to the write and to the rollback. */
interface ConfigApplyFile {
  readonly identityPath: string
  readonly absolutePath: string
  readonly existing: Buffer | undefined
  readonly newBytes: Buffer
  readonly indexBefore: IndexEntry | undefined
}

export function applyConfigProposalAsOneCommit(
  input: ApplyConfigProposalInput,
): ConfigApplyOutcome {
  const { request } = input
  const configDir = dirname(resolve(input.configPath))
  const exec = input.exec ?? (spawnSync as unknown as GitApplyExec)
  const writeTarget = input.writeTarget ?? writeFileAtomically

  // SORTED BY PATH, matching the diff primitive's own ordering. The commit's pathspec list, the
  // receipt's file list and the recomputed diff then all speak about the set in one order, so the
  // D-19 comparison cannot fail for a reason that is about enumeration rather than about content.
  const payloadFiles = [...request.payload.files].sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0)
  if (payloadFiles.length === 0) {
    throw new TypeError('a config proposal reached the apply carrying no files')
  }

  const identityPaths = payloadFiles.map((file) =>
    workspaceRelativeIdentityPath(configDir, file.path))

  // (0) CFGM-03: asked before any freshness check. See this section's header for why the order is
  // the whole of the idempotency answer rather than an optimisation.
  const alreadyApplied = findAppliedCommit(exec, configDir, identityPaths[0]!, request.proposalId)
  if (alreadyApplied !== undefined) {
    return {
      outcome: 'already-applied',
      commits: [{ role: 'agent', hash: alreadyApplied }],
      files: identityPaths,
    }
  }

  const files: ConfigApplyFile[] = []
  for (const [index, file] of payloadFiles.entries()) {
    const identityPath = identityPaths[index]!
    const absolutePath = resolve(configDir, identityPath)

    // (2) TEMPORARY POSTURE — 395-06 replaces this refusal with D-05's human-first commit.
    const porcelain = runGitStatusPorcelain(exec, configDir, identityPath)
    if (porcelain !== '') throw new DirtyApplyTargetError(identityPath, porcelain)

    // (3) RAW BYTES on both sides, through the SAME recipe the construction used: the schema's
    // `sha256hexBytes`, not this file's `createHash`. Two recipes for one digest contract is
    // exactly 394's CR-02 class, and D-17 exists because it cost a phase to find.
    const existing = readTargetIfPresent(absolutePath)
    const foundDigest = existing === undefined ? undefined : sha256hexBytes(existing)
    if (foundDigest !== file.baseDigest) {
      throw new ApplyTargetChangedError(identityPath, file.baseDigest, foundDigest)
    }

    files.push({
      identityPath,
      absolutePath,
      existing,
      newBytes: Buffer.from(base64Decode(file.newContentBase64)),
      indexBefore: captureIndexEntry(exec, configDir, identityPath),
    })
  }

  // (4) D-19, AND IT IS THE MEASUREMENT. Recomputed from the bytes on disk right now — not from
  // the proposal's own record of what they were — so a payload whose `newContent` was widened
  // between the render and this accept produces different diff bytes and refuses here, before
  // anything is written.
  const recomputed = renderConfigDiff(files.map((file, index) => ({
    path: payloadFiles[index]!.path,
    ...(file.existing === undefined ? {} : { oldBytes: Uint8Array.from(file.existing) }),
    newBytes: Uint8Array.from(file.newBytes),
  })))
  if (recomputed.diffDigest !== request.payload.shownDiffDigest) {
    throw new ConfigApplyDiffMismatchError(
      request.payload.shownDiffDigest,
      recomputed.diffDigest,
    )
  }

  for (const file of files) mkdirSync(dirname(file.absolutePath), { recursive: true })

  let committed: GitCommitOutcome
  try {
    for (const file of files) {
      writeTarget(file.absolutePath, file.newBytes)
      runGitAdd(exec, configDir, file.identityPath)
    }
    committed = runGitCommitPaths(
      exec,
      configDir,
      files.map((file) => file.identityPath),
      configApplyCommitMessage(request),
    )
  } catch (error) {
    restoreConfigApplyFailure(exec, configDir, files, writeTarget, error)
    throw error
  }

  if (committed.kind === 'nothing-to-commit') {
    const noChange = new ApplyProducedNoChangeError(files.map((file) => file.identityPath).join(', '))
    restoreConfigApplyFailure(exec, configDir, files, writeTarget, noChange)
    throw noChange
  }

  // BELOW THIS LINE NOTHING IS RESTORED — the commit exists, so it is the new truth.
  return {
    outcome: 'applied',
    commits: [{ role: 'agent', hash: runGitHeadHash(exec, configDir, files[0]!.identityPath) }],
    files: files.map((file) => file.identityPath),
  }
}

/**
 * Put every touched path back, worktree and index, and report BOTH facts if a restore fails.
 *
 * PER PATH AND NEVER REPO-WIDE — no `reset`, no `checkout .`, no `clean` — for the reason its
 * single-path analog states: the one thing a rollback must not do is undo work that was never the
 * agent's. Restores run in REVERSE order so the file this apply touched last is the first put back,
 * which keeps the sequence a mirror of the writes rather than a second traversal with its own
 * ordering assumptions.
 */
function restoreConfigApplyFailure(
  exec: GitApplyExec,
  cwd: string,
  files: readonly ConfigApplyFile[],
  writeTarget: (absolutePath: string, bytes: Buffer) => void,
  applyError: unknown,
): void {
  for (const file of [...files].reverse()) {
    restoreOrReportBoth(
      exec,
      cwd,
      file.identityPath,
      file.absolutePath,
      file.existing,
      file.indexBefore,
      writeTarget,
      applyError,
    )
  }
}

/**
 * The pinned config file SET, enumerated from the config itself (RESEARCH Pitfall 5, 394-39).
 *
 * A SET AND NOT A GLOB, and the difference is what this constant is. `*.yaml` would answer
 * differently on the first repository whose layout nobody anticipated — silently, and in the
 * direction that matters, because the set is what a porcelain check scopes to, what an out-of-set
 * classifier compares against and what a commit's pathspec names. Every member here is a file the
 * CONFIG itself names: the config yaml, the hooks file `workspace.hooksFile` points at, and the
 * `.gitignore` whose managed block `init` maintains.
 *
 * RETUNE: add a member here when the config grows a new file it OWNS — not when a project happens
 * to keep another yaml beside it. The test is authorship: this product writes these files.
 */
const CONFIG_SET_GITIGNORE = '.gitignore'
const CONFIG_SET_DEFAULT_HOOKS_FILE = 'hooks.yaml'

/**
 * Read the committed config set as RAW BYTES, and perform the comment-preserving field edit.
 *
 * THE READ IS BYTES AND NEVER TEXT (D-17). A decode between the file and the digest taken over it
 * is 394's CR-02 defect class in its original form.
 *
 * THE EDIT LIVES HERE rather than in the construction pipeline because the `yaml` Document API is
 * an external dependency `packages/agent`'s ownership contract does not admit — its
 * `externalDependencies` are exactly `['ai', 'zod']`, reconciled against package.json by
 * `validate:arch`. Admitting one so the edit could move in-layer would have widened a boundary
 * rather than respected it, and the edit is a fact about the FILE FORMAT, which this host already
 * owns.
 *
 * `parseDocument` → `setIn` → `toString` is the shipped `agent-qa config set` idiom
 * (`commands/config.ts:71-82`) and it is load-bearing rather than stylistic: a
 * parse→object→stringify round trip destroys every comment in the comment-dense house config and
 * widens the rendered diff past the point a person can review it — which is the whole of what
 * CFGM-01 asks a proposal to be.
 */
export function createConfigFilesPort(configPath: string): ConfigFilesPortLike {
  const configDir = dirname(resolve(configPath))
  const configIdentity = workspaceRelativeIdentityPath(configDir, configPath)

  return {
    async read(): Promise<ConfigFileSet> {
      const fileConfig = await loadConfigFile(configPath) as { workspace?: { hooksFile?: unknown } }
      const hooksFile = typeof fileConfig.workspace?.hooksFile === 'string'
        ? fileConfig.workspace.hooksFile
        : CONFIG_SET_DEFAULT_HOOKS_FILE

      // Deduplicated and sorted, so two reads of one project answer in one order. A `Set` rather
      // than a filter because a project whose `hooksFile` IS the config file would otherwise be
      // enumerated twice and digested twice under one path.
      const members = [...new Set([configIdentity, hooksFile, CONFIG_SET_GITIGNORE])].sort()

      return {
        configFile: configIdentity,
        files: members.map((path) => {
          const bytes = readTargetIfPresent(resolve(configDir, path))
          // ABSENT MEANS ABSENT. A zero-length stand-in would make "there is no hooks file" and
          // "there is an empty hooks file" the same fact, and the apply's `baseDigest` re-check
          // reads exactly that distinction.
          return bytes === undefined ? { path } : { path, bytes: Uint8Array.from(bytes) }
        }),
      }
    },

    setField({ bytes, path, value }): Promise<Uint8Array> {
      const document = bytes === undefined
        ? new YamlDocument({})
        : parseDocument(Buffer.from(bytes).toString('utf8'))
      document.setIn(path.split('.'), value)
      return Promise.resolve(Uint8Array.from(Buffer.from(document.toString(), 'utf8')))
    },
  }
}

/**
 * Whole-config validation, run BEFORE a proposal surfaces (CFGM-01).
 *
 * IT VALIDATES THE ENTIRE CANDIDATE, not the changed field, and that is D-03's other half: the
 * settable-field whitelist was refused because a rule that can only refuse what it can NAME cannot
 * be driven to zero by naming more things, so the guard has to be whole-input by construction. This
 * one is: `AgentQaConfigSchema` is the project's own schema including its cross-field refinements,
 * so a mutation that is locally plausible and globally wrong — a `use.llm` naming a registry entry
 * that does not exist — is refused here rather than at the next run.
 *
 * A PORT because the schema lives in `@vostride/agent-qa-core` and `packages/agent` does not depend
 * on it; `validate:arch` reds that edge with no legal repair. The `draftApply` idiom exactly.
 */
export function createConfigValidatePort(): ConfigValidatePortLike {
  return {
    validate({ bytes }): Promise<ConfigValidation> {
      let parsed: unknown
      try {
        parsed = parseYaml(Buffer.from(bytes).toString('utf8'))
      } catch (error) {
        // A yaml the parser cannot read is a validation failure and not a crash: the candidate
        // came from a mutation this product made, so the person is owed the reason rather than a
        // stack trace out of a library.
        return Promise.resolve({
          ok: false,
          issues: [`the configuration is not readable as YAML: ${errorText(error)}`],
        })
      }
      const result = AgentQaConfigSchema.safeParse(parsed ?? {})
      if (result.success) return Promise.resolve({ ok: true })
      return Promise.resolve({
        ok: false,
        // The validator's OWN words, joined to a path. This layer reports issues; it does not
        // classify them, because a closed issue vocabulary here would be a second, weaker copy of
        // core's refinements, out of date the first time one is added.
        issues: result.error.issues.map((issue) =>
          `${issue.path.join('.') || '<root>'}: ${issue.message}`),
      })
    },
  }
}

/**
 * The port `proposals.accept` and `config.proposal.apply` both reach, pre-bound to one workspace.
 *
 * ONE PORT, TWO CALLERS, and neither calls the other. The accept has already read the envelope and
 * hands its payload straight here; the apply verb was given an id and does that read itself. Both
 * arrive at this same function, which is what keeps exactly one place where committed configuration
 * changes — op-calling-op would have put a second gate evaluation and a second audit row in front
 * of one human decision.
 */
export function createConfigApplyPort(configPath: string): ConfigApplyPortLike {
  return {
    apply(request) {
      return Promise.resolve(applyConfigProposalAsOneCommit({
        configPath,
        request: { proposalId: request.proposalId, payload: request.payload },
      }))
    },
  }
}

/**
 * The target's RAW BYTES, or `undefined` for no such file (394-23, WR-04).
 *
 * NO ENCODING, and that is the whole content of this function beyond the ENOENT triage. The digest
 * taken over this value is compared against one the proposal took over a file's bytes, and the
 * rollback writes this value back verbatim — a decode here would make both a claim about a
 * DECODING of the person's test rather than about the test.
 */
function readTargetIfPresent(absolutePath: string): Buffer | undefined {
  try {
    return readFileSync(absolutePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
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
/**
 * Write the per-invocation disclosure, when the action carries one (394-08, D-03 · WTST-08).
 *
 * ONE writer for BOTH confirm forms, so the one-form CLI prompt and chat's three-way inline confirm
 * cannot end up showing a person different things about the same call. It writes nothing at all when
 * the field is absent, which is every action but this phase's authoring dispatch — so no existing
 * prompt gains a blank line.
 *
 * The string is composed by the op through `FunctionSpec.disclose` and reaches here as inert data;
 * this function decides only WHERE it goes, never what it says.
 */
function writeDisclosure(output: NodeJS.WritableStream, action: RiskActionDescriptor): void {
  if (action.disclosure === undefined) return
  output.write(`agent-qa: ${action.disclosure}\n`)
}

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
    //
    // THE DISCLOSURE IS A SEPARATE LINE, ABOVE (394-08 D-03 / WTST-08). It says what THIS
    // invocation is about to cost, which the class name cannot; keeping it on its own line is what
    // lets the name stay verbatim rather than becoming a paraphrase with a number in it. Absent on
    // every action that has nothing invocation-specific to say, which is almost all of them.
    writeDisclosure(output, action)
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

    // Both forms show the same disclosure, for the reason this wrapper is an extension rather than
    // a fork: the person answering `a` is deciding about the same call as the person answering `y`,
    // and a standing approval granted without the cost in front of them would be the widest answer
    // taken with the least information.
    writeDisclosure(output, action)
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
    // 393 D-01: the keep-gate evaluator's host half, bound UNCONDITIONALLY on this host — a CLI
    // always has a config path, therefore a checkout root, therefore both verbs. Together with the
    // run executor one line up, this is what makes `authoring.draft.verify` read `bound` in this
    // composition's catalog; a host missing either would list it `unbound` BY NAME instead.
    draftAuthoring: createDraftAuthoringPort(input.configPath),
    // 394-10 D-06: the one-commit apply, bound unconditionally for the same reason its neighbour
    // is — a CLI always has a config path and therefore a checkout root. It is a SEPARATE binding
    // rather than a member of the port above because the two answer different questions: that one
    // is "can this host author a draft", this one is "can this host commit one a person accepted".
    draftApply: createTestDraftApplyPort(input.configPath),
    // 395-01 D-01/D-03/D-17 · CFGM-01/03/04: the config editor's three host ports, bound
    // unconditionally for the reason the two lines above are — a CLI always has a config path and
    // therefore a checkout root. They are three SEPARATE bindings rather than one bundle because
    // they answer three different questions: what bytes are committed, whether a candidate config
    // is valid at all, and whether this host can commit one a person accepted. The fourth port
    // (`configProposals`) is bound inside `composeLocalAgent` itself, over the durable store that
    // composition already owns — a host-supplied writer would be a second door into one store.
    configFiles: createConfigFilesPort(input.configPath),
    configValidate: createConfigValidatePort(),
    configApply: createConfigApplyPort(input.configPath),
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
    // 392 plan 10, D-16: the reconciliation strategy, conditionally spread on the exact idiom of
    // the three chat options above. ABSENT must stay absent, because the composition's own
    // `?? deterministicOverrideStrategy` is where the safe default lives and a present-undefined
    // field would be a second place it could be decided.
    ...(input.chatReconcile === undefined ? {} : { chatReconcile: input.chatReconcile }),
    // 391 PROP-01: conditionally spread, so a host with no terminal leaves the field ABSENT and the
    // gate's own deny-by-default is what answers — in exactly one place.
    ...(() => {
      const confirm = input.confirm ?? createTtyConfirmPort()
      return confirm === undefined ? {} : { confirm }
    })(),
  })
}
