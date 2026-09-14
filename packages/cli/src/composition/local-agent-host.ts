import type { CurationSnapshot } from '@vostride/agent-qa-schema'
import { createCanaryAblationForHost } from '../gates/canary-ablation-host.js'
import { randomUUID } from 'node:crypto'
import { AUTHORING_DRAFT_EDIT_FUNCTION_ID, invokeFunction } from '@vostride/agent-qa-agent'
import { AuthoringDraftEditOutputSchema } from '@vostride/agent-qa-schema'
import { createFeedbackPortForHost } from '../gates/feedback-host.js'
import { bindTrustPriorsToConfig, trustPriorsForHost, type ResolveTrustPriors, type TrustPriorDisclosure } from '../curation/trust-priors.js'
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

import { spawnSync } from 'node:child_process'
import { buildPromotionPostureResolver, promotionPostureResolverForHost } from '../curation/promotion-posture.js'
import { createReplayGatePortForHost, type ReplayGateClaimAuthority } from '../gates/replay-gate-host.js'
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

import {
  Document as YamlDocument,
  isMap,
  isScalar,
  isSeq,
  parseDocument,
  parse as parseYaml,
} from 'yaml'

import type {
  ConfigApplyPortLike,
  ConfigFieldSetResult,
  ConfigFileSet,
  ConfigFilesPortLike,
  ConfigPathFacts,
  ConfigReaderPort,
  ConfigValidatePortLike,
  ConfigValidation,
  ConfigValidationIssue,
  DraftApplyPortLike,
  JobModelCapability,
  KnowledgeReaderPort,
  PostRunJobCapabilities,
  ProposeCorpusPosture,
  ReplayGatePort,
  TestDraftApplyRequestLike,
  TestDraftApplyResultLike,
} from '@vostride/agent-qa-agent'
import {
  composeLocalAgent,
  createKnowledgeReader,
  LOCAL_CURATION_CAPABILITIES,
  latestBuildOrdinal,
  resolveRunExecutionContext,
  sensitiveEnvSlice,
} from '@vostride/agent-qa-agent-local'
import type {
  CandidateProsePosture,
  ChatApprovalDecisionRecord,
  ComposeLocalAgentInput,
  DraftAuthoringPort,
  DraftParseOutcome,
  DraftStageOutcome,
  LocalAgentHost,
  RunExecutionContext,
  RunExecutionPort,
  SuiteTextEntry,
} from '@vostride/agent-qa-agent-local'
import { KNOWLEDGE_PROPOSAL_APPLY_FUNCTION_ID } from '@vostride/agent-qa-agent'
import {
  AgentQaConfigSchema,
  HooksFileSchema,
  applyPatchSetToTestDoc,
  discoverWorkspaceFiles,
  // 395-05: the canonical hook-id mint, through `core`'s re-export beside `generateRunId` rather
  // than from the ids package directly — `packages/cli`'s ownership contract was deliberately
  // emptied of that dependency by 394-11 and this needs no reopening of it.
  generateHookId,
  DEFAULT_AGENT_QA_AUTH_STATES_DIR,
  DEFAULT_AGENT_QA_CACHE_DIR,
  parseTestFile,
  parseTestFileWithTokens,
  renderPatchedTestDoc,
  resolveKnowledgeRoot,
  resolveWorkspacePaths,
  workspaceRelativeIdentityPath,
  // 395-14: the position-only yaml-fault sentence, LIFTED out of this file into core. It was a
  // private copy here; the cli loader guard and core's own `validateConfig` arm need the same
  // sentence, and two spellings of one sentence are two things that can drift apart. The bytes this
  // file emits are unchanged — only the definition moved.
  yamlParseFailureMessage,
} from '@vostride/agent-qa-core'
import type { TestDefinition } from '@vostride/agent-qa-core'
// 422-09: the shared proposal-stage builder lives in its own module so the daemon can compose it
// without dragging this file's whole surface into its module graph. Re-exported here because the
// terminal host is its other caller and every reader of this file expects to find it beside the
// composition it feeds.
export {
  proposalStageCapabilities,
  resolveProposeGate1MaxPerJob,
  type ProposalStageCapabilities,
  type ProposalStageCapabilitiesInput,
} from './proposal-stage-capabilities.js'
import { proposalStageCapabilities, resolveProposeGate1MaxPerJob } from './proposal-stage-capabilities.js'
import { misdirectionPostureCapability } from './misdirection-posture-capability.js'
import { misdirectionPreparationCapabilities } from '../curation/misdirection-tail.js'
import type { ApplyDelegate, ApplyReviewResult } from '@vostride/agent-qa-agent-local'
import type {
  ConfigScaffoldContentPortLike,
  ConfigUndoSource,
  ConfigUndoSourcePortLike,
} from '@vostride/agent-qa-agent'
// D-04: the ONE scaffold producer. `agent-qa init` renders these same functions and writes them
// to disk; this host renders them into a proposal's file bytes. No second copy exists.
import { buildScaffoldFileSet } from '../commands/scaffold-content.js'
import { TARGET_GITIGNORE_ENTRIES } from '../commands/init-filesystem.js'
import {
  CONFIG_SET_DEFAULT_HOOKS_FILE,
  KnowledgeApplyOutcomeSchema,
  base64Decode,
  enumerateConfigFileSet,
  renderConfigDiff,
  sha256hexBytes,
} from '@vostride/agent-qa-schema'
import type {
  ConfigApplyCommit,
  ConfigApplyOutcome,
  ConfigProposalApplyableV1,
  FunctionCaller,
  GrantRecordOutcome,
  RiskActionDescriptor,
  RunEventEnvelope,
  RunId,
  RunSession,
  RunsStartInput,
  ScopeKey,
  TestEditPatchSet,
} from '@vostride/agent-qa-schema'

import {
  loadConfigFile,
  loadEnvOverrides,
  mergeConfigs,
  normalizeConfigForValidation,
  resolveConfig,
} from '../config.js'
import { listTargets, resolveTarget } from '../targets.js'
import { invokeViaDaemon } from '../daemon/client.js'
import { resolveCliAnalysisTokenBudget, resolveCliJobModel } from '../llm-utils.js'
import { createCliCapabilityCatalogPort } from '../capability-catalog/explain-port.js'
import { analyticsEvent } from './analytics-host.js'
import type { CliAnalyticsHost } from './analytics-host.js'
// TYPE-ONLY, and that matters here: `in-process-run-execution.ts` imports `commands/run.ts`'s
// producers statically and `commands/run.ts` imports THIS file, so a VALUE import back would close
// an ESM cycle at module-evaluation time (401-11, Deviations 1). A `import type` is erased, adds no
// runtime edge, and is how this host names the option shapes it merely passes through — the port
// itself is still acquired through the deferred `await import(...)` in `createComposedRunExecution`.
import type { InProcessCliRunExecutionOptions } from './in-process-run-execution.js'
// Type-only: the pump's authority shape, named here because this door's drain leg declares
// what its `takeLease` thunk answered. Erased at emit, so no runtime edge is added.
import type { CurationWriterAuthority } from '../curation/curation-tail.js'
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

/** Resolve only cold-read masking inputs: no plugins, run preparation, or directory writes. */
export function createColdReadMaskingSources(
  configPath: string,
  retainedStores: () => Iterable<{
    forEachSecret(cb: (name: string, value: string) => void): void
  }> = () => [],
): NonNullable<ComposeLocalAgentInput['readMaskingSources']> {
  return async () => {
    try {
      const config = await resolveConfig({ configPath, loadAuthPlugins: false })
      const workspace = resolveWorkspacePaths({ config, configPath })
      return {
        secretsContent: readFileSync(workspace.secretsFile.absolutePath, 'utf8'),
        secretStores: [...retainedStores()],
        env: process.env,
      }
    } catch {
      // Required file/config failures leave no new masking authority. An optional retained
      // store may be absent, but a missing required source is never an empty secret file.
      return undefined
    }
  }
}

/**
 * The chat / `fn` / MCP door's run execution: the ONE in-process, policy-gated drive (401-05).
 *
 * D-01 — THIS RETIRED THE SECOND SPAWN FAMILY, and 401-10 deleted what was left of it. The retired
 * `createCliRunExecution` re-entered `agent-qa run` as a child process; every field a caller could not express became a `--` operand
 * and every policy denial died in the child's stderr. That is not a theory: 401-06 measured the
 * daemon's identical wire handing callers `RunProducedNoEventsError` while the gate's real reason
 * and its remedies were lost. This door hands the caller `RunDeniedError` with the row's reason
 * intact, because the gate ran in this process.
 *
 * D-07 — THE POSTURE TRAVELS EXPLICITLY, AND IT IS THIS DOOR'S OWN ANSWER. `executionContext` and
 * the confirm port are resolved HERE and handed over; the core never sniffs. Both are resolved the
 * same way the op-level gate at this host resolves them, so the two gates a single `runs.start`
 * crosses cannot disagree about who is asking:
 *
 *   - the context is `input.resolveExecutionContext` when the host supplied one — the dashboard
 *     door's live-confirm-channel answer (Pitfall 3) — and this process's real TTY/CI detection
 *     otherwise, which is exactly what `agent-qa run` resolves for the same gate;
 *   - the confirm is the host's own port, read by FIELD PRESENCE rather than by value (396-01
 *     D-09), so the MCP host's `confirm: undefined` REFUSES the prompt at this gate too rather
 *     than falling back to a tty write on the JSON-RPC channel.
 *
 * THE DOOR READS ITS OWN PREFLIGHT, for the reason the daemon's does: `config.safety.trustMode` is
 * a project-level opt-in the retired child honoured because the child read the config itself, and
 * letting it stop reaching the gate here would be a one-sided tightening nobody ratified. The
 * resolved inputs are then handed to the drive through `inputs`, so the config, the env file and
 * the secrets file are read once rather than twice.
 *
 * `reader` ARRIVES PER CALL SINCE 401-08 (D-08), through the port's own optional `gate` argument.
 * The composition resolves it — the durable grant ledger unioned with any open dispatch scope —
 * because which approvals are in force is a fact about the moment a run starts, not about the
 * moment this door was built, and because this file may name neither the ledger nor `safety`.
 *
 * WHAT IS DELIBERATELY ABSENT, each because an option nothing reads is a stub with a type on it:
 * `produceMembers` (the default
 * dispatcher is MODE-AWARE, which is what makes an argument-less request and a suite pattern both
 * work at this door), `afterVerdict` (a `runs.start` ack is a START, not an outcome — there is no
 * door-level fold to apply), and `trust.credential` (402's parameter).
 *
 * ═══ 2026-08-26 — Phase 404 D-05: WHAT `afterVerdict`'s ABSENCE USED TO COST ═══
 *
 * It was not merely "no fold to apply". `afterVerdict` was also where `commands/run.ts` performed
 * the durable `analyze-run` ENQUEUE, so every run through this door — the dashboard, MCP and chat
 * doors all reach it — finished its verdict and queued NOTHING. A dashboard-only user's run was
 * analysed and curated by nobody, ever, and read `pending` for as long as they cared to look.
 *
 * The enqueue is now the CORE's: the runner shell awaits a post-verdict step between `verdict` and
 * `runFinished` on every door (`curation/post-verdict-step.ts`), so this door needs no fold to
 * queue its work and the sentence above is once again about folding alone.
 *
 * The DRAIN leg is `postRunTail` below (D-06), and it is deliberately NOT `afterVerdict`. A drain
 * inside `afterVerdict` is inside `execute()`, and `dashboard-server` emits `'run-settled'` — db
 * finalize, Appium release, handle cleanup — when that promise settles, so the runs list would show
 * "running" for a minute after the verdict and a leased device would stay leased (Pitfall 2). The
 * drive starts the tail AFTER `afterVerdict` settles, does not await it, and hands it the masker's
 * dispose duty so the fold still runs inside the masker's lifetime.
 *
 * WHAT ARRIVES FROM THE HOST SINCE 401-07: `onSession`, `subscribers`, `resolveAppiumUrl` and
 * `resolveRunFlags`, all four through `runBridge` and all four absent unless a host asks. A host that watches its runs
 * needs the first; one that writes its own rows needs the second (D-04 still holds for a host that
 * asks for neither — the typed bus event log is the run's record, and a reporter bound by default
 * would be the console tee under another name); one that leases devices needs the third.
 *
 * IT IS ACQUIRED THROUGH A DEFERRED IMPORT, and that is load-bearing rather than stylistic.
 * `composition/in-process-run-execution.ts` imports `commands/run.js`'s producers statically — the
 * surface firewall's only legal route for that vocabulary — and `commands/run.ts` imports THIS file
 * for `createTtyConfirmPort`. A static import back would close that cycle at module-evaluation
 * time; an ESM cycle survives only while every edge is call-time. Both of the drive's own call
 * sites and the daemon's composition defer for the same reason.
 */
function createComposedRunExecution(input: {
  readonly trustPriors: ReturnType<typeof trustPriorsForHost>
  readonly configPath: string
  readonly agentQaRoot: string
  readonly resolveExecutionContext: ComposeLocalAgentInput['resolveExecutionContext']
  readonly confirm: ComposeLocalAgentInput['confirm']
  readonly runBridge?: ComposeCliLocalAgentInput['runBridge']
}): RunExecutionPort {
  const selectTrustPriors = bindTrustPriorsToConfig(input)
  return {
    // `gate` is the composition's answer to the run gate's standing-approvals question, resolved
    // per call and handed down here (401-08, D-08). This door does not resolve it and must not:
    // the grant ledger and the dispatch overlay are `agent-local`/`safety` vocabulary, and this
    // file's surface-firewall ledger has exactly one entry and only ever shrinks. It is FORWARDED
    // and nothing else — the type comes from the port it implements, so no safety type is named.
    async execute(
      request: RunsStartInput,
      gate?: Parameters<RunExecutionPort['execute']>[1],
    ): Promise<{ runId: RunId }> {
      const { resolveRunInvocationInputs } = await import('../commands/run.js')
      const {
        refuseUnhonourableRequestFields,
        runInProcessCliRun,
      } = await import('./in-process-run-execution.js')

      // THE REFUSAL COMES FIRST, and at THIS door rather than only inside the drive. Reading the
      // preflight below resolves the caller's project config and loads its auth plugins; doing
      // that for a request the seam was always going to refuse would execute third-party code on
      // behalf of a refused call. It is the drive's own exported predicate over the core's own
      // field set — one spelling, applied where the ordering claim is still true.
      refuseUnhonourableRequestFields(request)

      // The request may name another config; the drive resolves against exactly this expression, so
      // a preflight read here that used a different one would resolve a different project.
      const configPath = request.configPath ?? input.configPath
      // Both `warn` seams, pointed at one place. `console.warn` writes to stderr, which is the only
      // channel free at every door this host serves: `agent-qa fn --json` owns stdout and the MCP
      // host's stdout IS the JSON-RPC connection. Dropping them — the drive's own default — would
      // make this the one door where a quarantine fold happens silently.
      const warn = (message: string): void => { console.warn(message) }
      const inputs = await resolveRunInvocationInputs({
        configPath,
        ...(request.patterns === undefined ? {} : { patterns: request.patterns }),
        warn,
      })
      const trustPriors = selectTrustPriors(inputs.configFilePath)

      let startedRunId: string | undefined
      try {
        const outcome = await runInProcessCliRun(
          {
            resolveTrustPriors: trustPriors.resolve,
            configPath,
            agentQaRoot: input.agentQaRoot,
            executionContext:
              (input.resolveExecutionContext?.() ?? resolveRunExecutionContext()) as RunExecutionContext,
            trust: { trustMode: inputs.config.safety?.trustMode === true },
            // 422-14 (D-18): the pre-analysis circularity arbiter, composed from the ONE builder
            // the daemon composes from too. Parity is a property of there being a single
            // construction site rather than a claim a reviewer re-derives by reading two literals
            // — and the capability a run's post-verdict step arbitrates through is exactly the
            // sort of thing 422-08's window recorded as bound on one host and forgotten on the
            // other. The run's own resolved config file, not the one this door was handed.
            postProcessing: {
              misdirection: misdirectionPreparationCapabilities({
                configPath: inputs.configFilePath,
                agentQaRoot: input.agentQaRoot,
              }),
            },
            ...(input.confirm === undefined ? {} : { confirm: input.confirm }),
            // Conditionally spread on this file's own house rule: an absent authority must be an
            // ABSENT field, so the gate's `NO_STANDING_APPROVALS` default lives in one place.
            ...(gate?.reader === undefined ? {} : { reader: gate.reader }),
            inputs,
            // THE LOCAL CAPTURE FIRST, THEN THE HOST'S BRIDGE (401-07). The capture is what the
            // `catch` below reads to tell a run that STARTED from one that never did, so it can
            // never be REPLACED by a host's hook — it is chained. A bridge that threw here would
            // fail the run, which is correct: a host that asked to watch its runs and cannot is a
            // host whose surface would silently show nothing.
            onSession: (session) => {
              startedRunId = session.id as unknown as string
              input.runBridge?.onSession?.(session)
            },
            ...(input.runBridge?.subscribers === undefined
              ? {}
              : { subscribers: input.runBridge.subscribers }),
            ...(input.runBridge?.resolveAppiumUrl === undefined
              ? {}
              : { resolveAppiumUrl: input.runBridge.resolveAppiumUrl }),
            ...(input.runBridge?.resolveRunFlags === undefined
              ? {}
              : { resolveRunFlags: input.runBridge.resolveRunFlags }),
            ...(input.runBridge?.maskingSecrets === undefined
              ? {}
              : { maskingSecrets: input.runBridge.maskingSecrets }),
            // ═══ 2026-08-26 — Phase 404 D-06: THIS DOOR'S DRAIN LEG ═══
            //
            // `postRunTail` and not `afterVerdict`: the drive starts this AFTER `afterVerdict`
            // settles and does NOT await it, so `execute()` resolves and `dashboard-server`'s
            // `'run-settled'` (db finalize, Appium release, handle cleanup) fires on the verdict's
            // clock rather than on the drain's (RESEARCH Pitfall 2). The masker is disposed in
            // this leg's own `finally`, so the fold runs inside its lifetime (T-404-01).
            //
            // DRAIN ONLY IF THE LEASE WAS ACTUALLY TAKEABLE. `takeAcquiredLease()` is the step's
            // one acquisition; `undefined` means somebody else holds it (or the posture was
            // `detached`), and this door declines to consult a second time for itself — so it
            // says `withoutLease: 'skip'` and pumps nothing. `finish()` runs on BOTH arms, because
            // the posture that most needs a line about work left queued is the one where nothing
            // drained.
            //
            // THE RULE MOVED INTO THE CALL (2026-08-27, CR-01). It used to be an `if` around
            // `drain({ lease: takeAcquiredLease() })`, which meant the lease was acquired out here
            // — before `drain()` had resolved a root or composed a host, either of which can
            // throw, and neither of which could then release what this line had already minted.
            // The take now happens inside the pump's own try, so the skip has to be stated rather
            // than performed.
            //
            // DEFERRED IMPORT, for the reason the drive's own is: `post-run-tail.ts` imports THIS
            // file statically (`composeCliLocalAgent`), so a static import back would close an
            // ESM cycle at module-evaluation time.
            postRunTail: async (context): Promise<void> => {
              const { composeCliPostRunTail } = await import(
                '../curation/post-run-tail-composition.js'
              )
              const tail = composeCliPostRunTail({
                postVerdict: context.postVerdict,
                ...(context.postVerdictDeadlineMs === undefined ? {} : { deadlineMs: context.postVerdictDeadlineMs }),
                trustPriors,
                canaryAblation: createCanaryAblationForHost({ configPath: context.configFilePath, agentQaRoot: input.agentQaRoot }),
                runId: context.runId,
                configDir: context.configDir,
                configFilePath: context.configFilePath,
                knowledgeConfig: inputs.config.knowledge,
                auditSink: context.auditSink,
                maskingContext: context.maskingContext,
                // LOG, NEVER PRINT. The tail's close-out line and digest block are CLI outputs, and
                // this door serves `agent-qa fn --json` (stdout is the JSON document) and the MCP
                // host (stdout IS the JSON-RPC connection). Both go to the same stderr sink the
                // quarantine warning uses, so nothing this door serves can have its channel
                // corrupted by a post-run line.
                log: { warn, info: warn },
                ...(input.runBridge?.chipRelay === undefined
                  ? {}
                  : { relay: input.runBridge.chipRelay }),
              })
              let lease: CurationWriterAuthority | undefined
              await tail.drain({
                takeLease: () => (lease = context.postVerdict.takeAcquiredLease()),
                withoutLease: 'skip',
              })
              await tail.finish({ detached: lease === undefined })
            },
            warn,
          },
          request,
        )
        // A NON-ZERO EXIT CODE IS A REAL RUN, not an error — the same rule the child's exit code
        // carried. What decides whether a run happened is the durable evidence
        // `createLocalRunInvocation` reads back, which no code here can fake.
        return { runId: outcome.runId as RunId }
      } catch (error) {
        // ONE NARROW CATCH, AND IT CONVERTS EXACTLY ONE THING (D-03).
        //
        // Everything raised before a session exists — a denial, a refused field, an input error, a
        // crash — re-throws untouched. What is converted is a run that STARTED and then surfaced a
        // member's framework error: the drive re-raises that to preserve `agent-qa run`'s exit-2
        // contract, but this door is answering `runs.start`, whose ack is a START and not an
        // outcome. The retired child said the same thing by ignoring its own exit code —
        // `createCliRunExecution`'s header: "the child's exit code is deliberately NOT the verdict
        // on whether a run happened". Letting it propagate would reject the acknowledgment for
        // exactly the runs that left a full durable record, and the composition's evidence check
        // (`RunProducedNoEventsError`) is what decides whether one did.
        //
        // Measured: without this, a `runs.start` whose member cannot find a browser binary rejects
        // with the browser error while `events.jsonl` and `handoff.json` sit on disk.
        if (startedRunId === undefined) throw error
        warn(`Run ${startedRunId} failed: ${error instanceof Error ? error.message : String(error)}`)
        return { runId: startedRunId as RunId }
      }
    },
  }
}

export interface ComposeCliLocalAgentInput {
  /** Additional credentials this host retains, enumerated again for every cold read. */
  readonly maskingSecretStores?: () => Iterable<{
    forEachSecret(cb: (name: string, value: string) => void): void
  }>
  /** An enclosing host supplies its ready snapshot, including the matching disclosure. */
  trustPriors?: ReturnType<typeof trustPriorsForHost>
  /** An enclosing drain may supply its already-memoised preparation. */
  resolvePromotionPosture?: ComposeLocalAgentInput['resolvePromotionPosture']
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
   * The dispatch-scoped grant overlay this host's run gate consults (401-08, D-08).
   *
   * Forwarded UNTOUCHED to `composeLocalAgent`, on the passthrough idiom every neighbour here uses
   * and typed by indexed access so this file names no `agent-local` internal it does not already
   * name. Absent leaves the composition minting its own — which is the shipped default and the
   * posture every caller had before this field existed.
   */
  dispatchGrants?: ComposeLocalAgentInput['dispatchGrants']
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
   * The context every policy decision in this host's registry is taken in (400-01, D-05).
   *
   * A PASSTHROUGH of the shared composition's own new input, and it is here rather than pinned on
   * the process for the reason that field states at length: `setActiveExecutionContextResolver` is
   * a process global, and the dashboard door's posture is a property of a SERVER (its confirm
   * channel is live, or it is not) rather than of the machine the server runs on. Absent leaves
   * the shipped ambient resolver, which is every other CLI invocation.
   */
  resolveExecutionContext?: ComposeLocalAgentInput['resolveExecutionContext']
  /**
   * Notified after one session event has been appended (400-01, D-03), passed through untouched.
   *
   * The dashboard door binds it so a browser can watch a turn happen; nothing else does, and an
   * absent observer is the shipped state for every other CLI invocation. See the shared
   * composition's own field for why this is an observer over the one log rather than a
   * replaceable log.
   */
  observeSessionEvent?: ComposeLocalAgentInput['observeSessionEvent']
  /**
   * Which door opened the sessions this host writes (400-03, D-04), passed through untouched.
   *
   * The dashboard door supplies `'dashboard'`; `agent-qa chat` supplies nothing, which is the
   * pre-400 population's own posture and keeps the CLI's header bytes exactly as they were. See
   * the shared composition's own field for why the tag lives on the header rather than on events.
   */
  sessionSurface?: ComposeLocalAgentInput['sessionSurface']
  /**
   * Which door this host MINTS PROPOSALS as (400-05), passed through untouched.
   *
   * Each door supplies its own `FunctionCaller.surface` — the same record it dispatches with, never
   * a second spelling of the word. Absent records nothing, which is honest and is what the reader
   * calls `unrecorded`; it can never mis-name a door, which is the property that makes an omission
   * here safe. See the shared composition's own field for why this is the seam and why it is not
   * `sessionSurface`.
   */
  mintingSurface?: ComposeLocalAgentInput['mintingSurface']
  /**
   * How this host reads configuration, MASKED (400-01, D-16).
   *
   * A passthrough with a default rather than a required argument, because there is exactly one
   * right answer for a CLI — {@link createMaskedConfigReader} over this invocation's config path —
   * and one host that needs to say something more: `agent-qa dashboard` composes a host whose
   * `services.dashboard.baseUrl` is the origin the server actually bound, so the entity cards a
   * conversation in that browser renders carry working links with no user setup (387 D-10's config
   * knob, supplied by the second of its two suppliers). It is an OVERLAY over this reader in that
   * host and never a replacement: the masking oracle, the layer precedence and the disclosure
   * decision all stay where they are.
   */
  config?: ComposeLocalAgentInput['config']
  /**
   * Where a chat session PRINTS the scaffold proposal a person is about to be asked about
   * (395-13, D-14), passed through untouched on `chatConfirm`'s precedent.
   *
   * The same split as the line above: this host knows whether there is a stream to write on, and
   * the shared composition knows what a turn is. Absent leaves the engine rendering nothing, which
   * is every non-chat CLI invocation.
   */
  chatPresent?: ComposeLocalAgentInput['chatPresent']
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
   * The invocation's composed analytics, when this host has any (398-10, D-11/D-18).
   *
   * PASSED IN, never composed here, for the reason every other capability on this interface is:
   * the opt-out decision belongs to the command's composition root and there is one per process.
   * Absent is a real posture — `agent-qa fn --list` composes a host and emits nothing — and the
   * counter hooks below are then simply unbound, which is what they were built to tolerate.
   */
  analytics?: CliAnalyticsHost
  /**
   * How this invocation executes a run (D-16). Defaults to re-entering `agent-qa run`; a test
   * substitutes the child launcher so the whole path — gate, binding, evidence, acknowledgment
   * — is exercised without a browser and a provider behind it.
   */
  runExecution?: RunExecutionPort
  /**
   * The D-09 RUN BRIDGE: what a host that watches its own runs needs from them (401-07, INVK-01).
   *
   * ONE OPTION RATHER THAN THREE FIELDS, because the three are one story — a host that bridges a
   * run's bus to a surface also needs that run's reporters and, if it leases devices, that run's
   * device. A door that wants none of it passes nothing and this composition is byte-identical to
   * what it was; the dashboard is the only door that wants any of it today, and it wants all three.
   *
   * IT IS A PASS-THROUGH, NOT A DECISION. Every member is handed to `runInProcessCliRun` as the
   * option of the same name. This host adds nothing and defaults nothing — `onSession` in
   * particular is CHAINED onto the door's own local capture rather than replacing it, because that
   * capture is what the ack-law catch below reads to tell a started run from one that never began.
   */
  runBridge?: {
    /** Fired with each started `RunSession` — the D-09 bridge hook. */
    readonly onSession?: (session: RunSession) => void
    /** The host's own bus subscribers, attached inside the core's `onSession`. */
    readonly subscribers?: InProcessCliRunExecutionOptions['subscribers']
    /** The Appium this host leased for a named run, if it leases any. */
    readonly resolveAppiumUrl?: InProcessCliRunExecutionOptions['resolveAppiumUrl']
    /** Per-run flags this host's own UI offers that the request DTO has no field for. */
    readonly resolveRunFlags?: InProcessCliRunExecutionOptions['resolveRunFlags']
    /**
     * Secrets this host holds that every run through it must mask (402-06, T-402-04).
     *
     * A PASS-THROUGH LIKE ITS FOUR SIBLINGS. The authed run door's credentials are the case: they
     * live only in the environment, under names `sensitiveEnvSlice` does not recognise, and the
     * runs they authorise execute in the same process. See the option's own doc on
     * `InProcessCliRunExecutionOptions` for why it is a resolver rather than a store.
     */
    readonly maskingSecrets?: InProcessCliRunExecutionOptions['maskingSecrets']
    /**
     * This host's SECOND chip sink (404 D-16) — the dashboard's live push channel.
     *
     * A PASS-THROUGH LIKE ITS FIVE SIBLINGS: this composition neither creates nor defaults it. It
     * is handed to `composeCliPostRunTail` as `relay`, which threads it to the chip emitter in
     * 404-05. A host that watches its own runs' chips supplies one; every other door passes
     * nothing and the emitter writes only to `events.jsonl`, exactly as it does today.
     */
    readonly chipRelay?: (envelope: RunEventEnvelope) => void
  }
  /**
   * 403 D-03: the live-view mint seam, FORWARDED UNTOUCHED to `composeLocalAgent`.
   *
   * A pass-through like `runBridge` above: this host neither creates nor defaults it. The dashboard
   * command composes it (it is the only door with a served origin); every other caller passes
   * nothing and `runs.liveurl` lists `unbound` by name.
   */
  liveView?: ComposeLocalAgentInput['liveView']
  /**
   * 405 D-03: the durable run-detail projection read, FORWARDED UNTOUCHED to `composeLocalAgent`.
   *
   * A pass-through on `liveView`'s exact footing: this host neither creates nor defaults it. Only
   * the dashboard command composes one — it is the only door that owns a projection database —
   * and every other caller passes nothing, so `runs.detail` lists `unbound` by name.
   */
  runDetail?: ComposeLocalAgentInput['runDetail']
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
      readonly snapshot?: CurationSnapshot
      /**
       * The candidates the fold's own COMMITTED receipt names (422 D-13).
       *
       * Additive-optional, and the distinction is carried rather than flattened: absent means
       * the binding reported no candidate ids at all, `[]` means it reported that there were
       * none. See the capability's own comment in `agent` for why those are not one answer.
       */
      readonly candidateIds?: readonly string[]
    }>
    /**
     * REQUIRED wherever the binding is supplied (388-10, UF-388-01): what this binding does
     * with candidate prose. Passed through untouched — the shared composition owns what the
     * posture MEANS (see `CandidateProsePosture`), and this host only carries the caller's
     * declaration to it.
     */
    candidateProse: CandidateProsePosture
    /**
     * The writer lease THIS host holds while the chain drains (422 D-14).
     *
     * Supplied by the leg that owns the pump, never by this file: the terminal's lease is taken
     * inside `runPostRunTail`'s drain and the daemon's is the one it acquired at startup, and
     * both are resolved at the Gate-1 claim rather than captured here. Absent leaves the
     * standalone posture — correct for a composition with no lease behind it.
     */
    resolveClaimAuthority?: () => ReplayGateClaimAuthority | undefined
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
// THE DIRTY-TREE POSTURE HERE IS COMMIT-INSTEAD-OF-REFUSE, AND IT IS THE DECIDED ONE (395-06,
// D-05/D-08). 395-01 shipped a temporary {@link DirtyApplyTargetError} refusal on this path and
// said so in this header; it is gone. A config file carrying uncommitted human work is now
// PRESERVED in a commit of its own — the person's bytes, under their own name, under a conventional
// message with no agent attribution and no trailer — and the agent commit follows it. Two commits,
// human first, and `git log` attributes each edit to whoever made it.
//
// THE 394/395 SPLIT IS DELIBERATE AND MUST STAY (D-08, and 394 D-06 on the other side).
// `applyTestDraftAsOneCommit` directly above keeps REFUSING on a dirty target, and nobody unifies
// the two as a drive-by refactor. The artifact classes differ: auto-committing a person's
// in-progress TEST edits is more surprising than preserving their config bytes, because a
// half-written test is a thing they are in the middle of and a config value is not. Harmonizing
// them is a phase-level decision, not a tidy-up.
//
// WHAT THE HUMAN-FIRST COMMIT MAY CONTAIN, STATED AS A PROHIBITION (D-05). Exactly the files this
// proposal touches, and only those of them that were dirty. Dirty bytes in any OTHER file —
// config-class or not — stay uncommitted, because the apply may never commit human work the
// approval did not implicate. There is no `-A`, no `.`, and no glob on this path; every add and
// every commit carries an explicit pathspec, and the commit's pathspec is a second independent
// control over the add's.
//
// A DIRTY PROPOSAL FILE OUTSIDE THE PINNED CONFIG SET IS REFUSED RATHER THAN PRESERVED. The pinned
// set arrives as `pinnedFileSet`, from `schema`'s `enumerateConfigFileSet` — the SAME enumeration
// `createConfigFilesPort` reads bytes for and `agent`'s classifier decides `out-of-set-path`
// against. A payload naming a path this product does not own is still applyable (that is what the
// `out-of-set-path` cross-boundary flag is FOR — it needs explicit approval, not a blanket
// refusal), but auto-committing a person's uncommitted work in a file agent-qa does not own is
// exactly the sweep D-05 forbids, so that one case falls back to the 394 refusal.
//
// THE ORDER IS THE CONTRACT, and it differs from its analog by two steps:
//
//   0. ALREADY-APPLIED? Asked FIRST, before any freshness check, and the ordering is the whole of
//      CFGM-03's idempotency edge. After a successful apply the file on disk is the NEW content, so
//      every digest re-check below would fail — reporting a stale refusal to a person whose change
//      is exactly where they left it. The question is answered from the person's own git history
//      rather than from a ledger this port keeps: the D-06 trailer IS the record, so there is no
//      second copy of "what has this applied" to fall out of step with the repository.
//   1. identity, per file, through `workspaceRelativeIdentityPath` and nothing else;
//   2. the digest re-check, per file (D-18) — a stale file refuses here;
//   3. THE BYTE COMPARISON (D-19): recompute the diff from the bytes on disk RIGHT NOW to the
//      proposal's new content, through the SAME `renderConfigDiff` the construction called, and
//      compare against the bytes the proposal stored. Inequality refuses. This is what makes "what
//      you saw is what was committed" a measurement rather than an assertion, and it is why the
//      proposal stores the rendered bytes at all;
//   4. the dirty check, per file, and the human-first preserve commit if any file is dirty;
//   5. write, add, commit — all three inside ONE try, with both the worktree and the index
//      restored per path on any failure;
//   6. the hash read, below all of it, never restored.
//
// STEPS 2 AND 3 ARE ABOVE STEP 4, AND THAT ORDERING IS A DECISION RATHER THAN A SEQUENCE. 395-06's
// plan puts the preserve commit first and notes, correctly, that the digests compare against the
// same worktree bytes either way — committing a pathspec does not change what is in the working
// tree. The orders therefore agree on every apply that SUCCEEDS and disagree on every one that
// REFUSES, and the disagreement is the whole reason to choose: with the preserve commit first, a
// D-18 stale refusal makes a commit in a person's history on its way to doing nothing. "Your apply
// was refused, and it committed your work" is a sentence this path must never produce. Above, the
// property is unconditional and is stated as a cell: NO REFUSAL ON THIS PATH MUTATES THE
// REPOSITORY. What it costs is the width of one `git commit` between the freshness check and the
// write, which is the same lock-free window the write→add→commit sequence below already has.

/** The machine-readable marker every agent config commit carries (D-06). */
export const AGENT_CONFIG_PROPOSAL_TRAILER_KEY = 'Agent-QA-Proposal'

/**
 * The doors this host can NAME in a commit author (400-05).
 *
 * A CLOSED VOCABULARY ON THE READING SIDE, against an open `string` on the writing side, and the
 * asymmetry is deliberate. `ProposalOrigin.surface` is a plain string so that a record written by a
 * later build still parses here; this map is closed so that nothing a later build writes can be
 * INTERPOLATED into a git author. A commit author is a structured field — `Name <email>` — and a
 * value spliced into it from a stored record is a place where a newline or an angle bracket would
 * rewrite the field. Nothing below ever renders the stored word; it only ever looks it up.
 *
 * The four rostered doors plus the two non-interactive hosts that compose this port set. The `cli`
 * arm is not a synonym for `chat`: `agent-qa fn config.field.set` is a person typing a command, and
 * before this plan it was one of the surfaces the single constant misnamed.
 */
export const CONFIG_COMMIT_AUTHOR_SURFACES = [
  'chat', 'dashboard', 'mcp', 'fn', 'cli', 'daemon',
] as const

export type ConfigCommitAuthorSurface = (typeof CONFIG_COMMIT_AUTHOR_SURFACES)[number]

/**
 * The author every agent config commit is written under (spec §4.3), BY MINTING SURFACE.
 *
 * ATTRIBUTION IS THE POINT rather than tidiness. A commit presenting agent-authored configuration
 * as a person's own work would make the repository's own history the wrong place to find out where
 * a change came from, and the person whose name is on the commit would be the last to know. It is
 * an `--author` and not only a message line because `git log --author` and every review tool that
 * reads authorship are what a person actually filters on.
 *
 * A TOTAL MAP RATHER THAN A CONSTANT, since 400-05. Until the fourth door shipped this was one
 * string — `agent-qa (proposed by chat) <agent-qa@local>` — written on every apply whatever had
 * proposed it. That was imprecise for `mcp` and `fn` and became a plain falsehood the day
 * `agent-qa dashboard` could mint a config change: a browser-minted proposal committed under
 * chat's name makes the audit trail lie in the one direction an audit trail must not.
 *
 * `Record<ConfigCommitAuthorSurface, string>` and not a partial map: a seventh surface added to the
 * vocabulary above stops this object compiling until somebody writes the sentence a person will
 * read in `git log`, which is the only place that decision belongs.
 */
export const AGENT_CONFIG_COMMIT_AUTHOR_BY_SURFACE:
Readonly<Record<ConfigCommitAuthorSurface, string>> = Object.freeze({
  chat: 'agent-qa (proposed by chat) <agent-qa@local>',
  dashboard: 'agent-qa (proposed by the dashboard) <agent-qa@local>',
  mcp: 'agent-qa (proposed over mcp) <agent-qa@local>',
  fn: 'agent-qa (proposed by the cli) <agent-qa@local>',
  cli: 'agent-qa (proposed by the cli) <agent-qa@local>',
  daemon: 'agent-qa (proposed by the daemon) <agent-qa@local>',
})

/**
 * The author for a proposal that recorded NO minting surface.
 *
 * THE HONEST ARM, and it exists so that nothing has to be invented. Every config proposal written
 * before 400-05 is in this population, and so is any mint by a composition that declares no door.
 * Falling back to the chat form would have been the original defect wearing a default; picking any
 * other surface would be a fabricated attribution in a durable audit record.
 *
 * IT STILL APPLIES. This is a reading, never a refusal: a store this product itself wrote must not
 * become unapplyable because a later build learned to record more about it.
 */
export const AGENT_CONFIG_COMMIT_AUTHOR_UNRECORDED =
  'agent-qa (proposed by an unrecorded surface) <agent-qa@local>'

/**
 * The author for a proposal whose recorded surface this build does not recognise.
 *
 * DISTINCT FROM `…_UNRECORDED`, because the two are different facts and a person reading `git log`
 * deserves the true one: nothing was recorded, versus something was recorded and this binary has
 * never heard of it (a record written by a newer build, or by a host outside this composition).
 * Collapsing them would report an absence where there was a presence.
 */
export const AGENT_CONFIG_COMMIT_AUTHOR_UNRECOGNISED =
  'agent-qa (proposed by an unrecognised surface) <agent-qa@local>'

function isConfigCommitAuthorSurface(value: string): value is ConfigCommitAuthorSurface {
  return (CONFIG_COMMIT_AUTHOR_SURFACES as readonly string[]).includes(value)
}

/**
 * The commit author for one applied proposal, from the surface that MINTED it (400-05).
 *
 * THE ONE DERIVATION. `applyConfigProposalAsOneCommit` calls this and nothing else builds an
 * author, so there is no second recipe to disagree with it — and every arm above is reachable only
 * through here.
 */
export function agentConfigCommitAuthor(mintedSurface: string | undefined): string {
  if (mintedSurface === undefined) return AGENT_CONFIG_COMMIT_AUTHOR_UNRECORDED
  return isConfigCommitAuthorSurface(mintedSurface)
    ? AGENT_CONFIG_COMMIT_AUTHOR_BY_SURFACE[mintedSurface]
    : AGENT_CONFIG_COMMIT_AUTHOR_UNRECOGNISED
}

/** What an accepted `config` proposal asks this host to do. */
export interface ConfigApplyRequest {
  readonly proposalId: string
  readonly payload: ConfigProposalApplyableV1
  /**
   * The door that MINTED this proposal — `ProposalOrigin.surface`, read off the stored record.
   *
   * NOT DERIVED HERE, and that is the load-bearing half of 400-05. This function runs inside
   * whichever host is APPLYING, which is routinely not the host that proposed; a surface computed
   * at this point would name the person's inbox rather than the agent's door.
   */
  readonly mintedSurface?: string
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
/**
 * What the mismatch error reports where a digest would go, when there is no diff to have digested.
 *
 * A NAMED CONSTANT so a cell can pin the message rather than matching a sentence, and prose rather
 * than a digest-shaped string so nobody reads it as a hash that failed to compare.
 */
export const NO_DIFF_RECOMPUTED = 'nothing — the files already hold the proposed bytes'

/**
 * The CLI verb a D-18 refusal names as the one recovery.
 *
 * A CONSTANT SO THE ADVICE IS CHECKABLE. This project has shipped a user-facing instruction to run
 * a command the CLI does not have; naming the verb here lets a cell assert it against the command
 * registry `createProgram` builds, rather than against a sentence somebody read once. The op id is
 * interpolated from the proposal's own `action`, which is a registered function id by construction —
 * it is what the registry dispatched to build the proposal in the first place.
 */
export const CONFIG_REPROPOSE_CLI_VERB = 'fn'

/**
 * The file changed out of band between the proposal and this apply — and the human wins (D-18).
 *
 * ITS OWN CLASS RATHER THAN `ApplyTargetChangedError`, which the test-draft apply throws and whose
 * recovery sentence is "re-run the authoring loop". A config proposal's recovery is a different
 * action, and a shared error would have made one of the two messages wrong for its own path.
 *
 * STATELESS, AND THAT IS THE RATIFIED POSTURE (D-18). This refusal mints nothing, rebases nothing
 * and re-proposes nothing. A fresh artifact materializing in a person's inbox at the exact moment
 * they were editing the file themselves is pushy in the one moment sovereignty is the whole
 * subject — and if their edit made the change moot, the right amount of further activity is none.
 * Recovery is NAMED and never performed.
 *
 * NOTHING STALE IS RENDERED. The diff the proposal stored describes a file that no longer exists in
 * that form, so printing it here would be showing a person a picture of a state they have already
 * left. The digests are named instead: they are references, non-reversing, and they are what makes
 * the claim "these are not the same bytes" checkable rather than asserted.
 */
export class ConfigApplyStaleError extends Error {
  constructor(
    readonly targetPath: string,
    readonly action: string,
    readonly expectedDigest: string | undefined,
    readonly foundDigest: string | undefined,
  ) {
    super(
      `refusing to apply this configuration change: ${JSON.stringify(targetPath)} has changed `
      + 'since the proposal read it. Somebody edited it out of band, and their bytes win — nothing '
      + 'has been written, nothing has been committed, and the diff you were shown is not repeated '
      + 'here because it describes a file that no longer exists in that form. '
      + (expectedDigest === undefined
        ? 'The proposal recorded no digest for it, which is a claim that the file did not exist; '
          + 'it exists now.'
        : foundDigest === undefined
          ? 'The proposal recorded a digest for it, but the file is no longer there.'
          : `Expected ${expectedDigest}, found ${foundDigest}.`)
      + ` To pick the change up against the configuration as it stands, run the proposing action `
      + `again: \`agent-qa ${CONFIG_REPROPOSE_CLI_VERB} ${action}\`. It re-reads the committed `
      + 'files, so the new proposal will contain the out-of-band edit. Nothing has been '
      + 're-proposed for you.',
    )
    this.name = 'ConfigApplyStaleError'
  }
}

/**
 * A dirty proposal file that this product does not own is refused rather than preserved (D-05).
 *
 * The pinned config set is the boundary. Inside it, uncommitted human work is committed first and
 * kept; outside it, an apply that staged and committed somebody's in-progress source file under a
 * message saying "preserve human edits" would be doing exactly the sweep D-05 forbids, in the one
 * direction where it is unrecoverable from the message alone.
 */
export class ConfigApplyDirtyOutsideSetError extends Error {
  constructor(
    readonly targetPath: string,
    readonly porcelain: string,
    readonly pinnedFileSet: readonly string[],
  ) {
    super(
      `refusing to apply this configuration change: ${JSON.stringify(targetPath)} carries `
      + `uncommitted work (${JSON.stringify(porcelain)}) and is not a member of this project's `
      + `configuration file set (${pinnedFileSet.map((path) => JSON.stringify(path)).join(', ')}). `
      + 'agent-qa commits your own uncommitted config bytes for you before applying a change to '
      + 'them; it will not do that to a file it does not own. Commit or set that file aside '
      + 'yourself, then accept this proposal again.',
    )
    this.name = 'ConfigApplyDirtyOutsideSetError'
  }
}

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

/**
 * The subject the human-first preserve commit carries (D-05).
 *
 * A PINNED CONSTANT because two other things read it: the `already-applied` receipt reconstructs a
 * previous apply's human-first commit by comparing the agent commit's parent subject against this
 * exact string, and the composed cells assert it. Deciding on OUR OWN pinned prose is not the
 * "match git's English" hazard `runGitCommit` refuses — that one is about a message a translated or
 * reworded git is free to change, and this one is a byte this file writes.
 *
 * CONVENTIONAL AND PRESERVING. `chore(config)` says what it is: not a feature, not the agent's
 * change, just the person's own work being recorded before somebody else's lands on top of it.
 */
export const HUMAN_FIRST_COMMIT_SUBJECT =
  'chore(config): preserve human edits before agent-qa apply'

/**
 * The human-first commit's message. NO AUTHOR OVERRIDE, NO TRAILER — and both absences are the point.
 *
 * The `--author` and the `Agent-QA-Proposal` trailer are how this product marks a commit as ITS
 * work. This commit is not its work: every byte in it was written by the person whose repository
 * it is, and stamping the agent on it would make `git log --author` and every review tool that
 * reads authorship answer the exact opposite of the truth. The commit is therefore made under
 * whatever identity the repository is configured with, which is the person's own.
 */
function humanFirstCommitMessage(paths: readonly string[]): string {
  return `${HUMAN_FIRST_COMMIT_SUBJECT}\n\n`
    + 'Your uncommitted changes to the files below are recorded here as your own work, before '
    + 'agent-qa commits the change you accepted, so that git history attributes each edit to '
    + 'whoever made it.\n\n'
    + `${paths.map((path) => `  ${path}`).join('\n')}\n\n`
    + 'No agent-authored bytes are in this commit.\n'
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
  // THE AUTHOR IS A PARAMETER BECAUSE ONE OF THE TWO COMMITS THIS FILE MAKES IS NOT THE AGENT'S
  // (395-06, D-05). `undefined` means "no `--author` flag at all", which is not the same as
  // supplying the repository's configured identity by hand: git already knows who the person is,
  // and a host that restated it would be a second answer free to disagree with `user.name`.
  author?: string,
): GitCommitOutcome {
  if (!paths.some((path) => stagedAtPath(exec, cwd, path))) return { kind: 'nothing-to-commit' }
  const committed = runApplyGit(exec, cwd, paths[0] ?? '.', [
    'commit', '--quiet', '-m', message,
    ...(author === undefined ? [] : [`--author=${author}`]),
    '--', ...paths,
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
  /**
   * The pinned config file set, as `enumerateConfigFileSet` answered it for this workspace.
   *
   * SUPPLIED RATHER THAN ENUMERATED HERE, and the reason is that the answer depends on reading and
   * parsing the config (`workspace.hooksFile` can name anything), which is an async host read this
   * synchronous function has no business doing. {@link createConfigApplyPort} resolves it through
   * {@link resolvePinnedConfigSet} — the SAME function {@link createConfigFilesPort} reads bytes
   * for — so the porcelain scope below and the `pinnedFileSet` the classifier saw at proposal time
   * are one enumeration with two callers rather than two lists that agree until one is edited.
   */
  readonly pinnedFileSet: readonly string[]
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

/**
 * WHICH STATEMENTS EXECUTE OUTSIDE THE REGION THE ROLLBACK PROTECTS (394's four-round lesson,
 * answered by ENUMERATION rather than by moving one more line inside a `try`).
 *
 * Every statement below the already-applied return is one of five things, and each is here for a
 * reason that is written down:
 *
 *   PURE READS — `readTargetIfPresent`, `sha256hexBytes`, `base64Decode`, `renderConfigDiff`, the
 *     digest comparisons, `workspaceRelativeIdentityPath`, the pinned-set membership test. No
 *     effect exists to roll back, and every one of their throw paths leaves the worktree and the
 *     index byte-unchanged. This is where the D-18 and D-19 refusals live, which is why "a refusal
 *     never mutates the repository" is a property of the whole class rather than of three sites.
 *
 *   READ-ONLY GIT — `findAppliedCommit` (`rev-parse`/`log`), `runGitStatusPorcelain` (`status`),
 *     `captureIndexEntry` (`ls-files`). All four of `captureIndexEntry`'s throw paths (git absent,
 *     EACCES, a timeout, a conflicted stage) therefore refuse with nothing to undo — and it cannot
 *     move inside the region that consumes it anyway, because it PRODUCES the rollback's input.
 *     394 shipped a version with it after the write for one round; that hole is what this
 *     enumeration exists to keep closed.
 *
 *   THE HUMAN-FIRST COMMIT — the ONE mutation outside the write region, and it has a rollback of
 *     its own rather than an argument for why it needs none. It touches the INDEX (`git add`) and
 *     then HEAD (`git commit`); it never writes a byte to the working tree, so there is no worktree
 *     state to restore, and its restore is exactly `restoreIndexEntriesOrReportBoth` over entries
 *     captured immediately before its adds. On SUCCESS it is deliberately NOT rolled back by any
 *     later failure: it contains only the person's own bytes, and reverting it would delete work
 *     that was never the agent's — the one thing `restoreApplyFailure`'s header forbids.
 *
 *   `mkdirSync(..., recursive)` — the one remaining effect left outside, quoting its analog's
 *     enumeration verbatim: git records no directories, so an empty directory a failed apply leaves
 *     behind changes nothing this rollback restores and nothing `git status` reports; and removing
 *     it would not be safe, because a recursive create may have made several levels and a
 *     concurrent writer may already be inside one.
 *
 *   THE WRITE, THE ADDS AND THE COMMIT — inside, all of them, in ONE `try`. The write itself is
 *     temp-then-rename, so a failure part-way through it cannot leave partial bytes at a target
 *     path at all.
 *
 * BELOW THE COMMIT NOTHING IS RESTORED. The hash reads are separate questions asked after the
 * commits exist, and a failure of one surfaces as {@link ApplyCommitHashUnavailableError} with the
 * commits standing.
 */
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
      // THE ORIGINAL RECEIPT, AND BOTH OF ITS COMMITS. A two-commit apply that answered the retry
      // with the agent commit alone would hand a retrying caller a different record than the first
      // caller got, which is the one thing the `already-applied` arm exists not to do.
      commits: [...originalApplyReceipt(exec, configDir, identityPaths[0]!, alreadyApplied)],
      files: identityPaths,
    }
  }

  // (1) + (2) EVERYTHING IN THIS BLOCK IS A READ. See the enumeration above: the D-18 stale refusal
  // and the D-19 mismatch refusal both fire from here, above every mutation this function makes.
  const pending: Omit<ConfigApplyFile, 'indexBefore'>[] = []
  for (const [index, file] of payloadFiles.entries()) {
    const identityPath = identityPaths[index]!
    const absolutePath = resolve(configDir, identityPath)

    // RAW BYTES on both sides, through the SAME recipe the construction used: the schema's
    // `sha256hexBytes`, not this file's `createHash`. Two recipes for one digest contract is
    // exactly 394's CR-02 class, and D-17 exists because it cost a phase to find.
    const existing = readTargetIfPresent(absolutePath)
    const foundDigest = existing === undefined ? undefined : sha256hexBytes(existing)
    if (foundDigest !== file.baseDigest) {
      // D-18: NAMED RECOVERY, NOTHING MINTED, NOTHING STALE RENDERED. See the class.
      throw new ConfigApplyStaleError(
        identityPath, request.payload.action, file.baseDigest, foundDigest,
      )
    }

    pending.push({
      identityPath,
      absolutePath,
      existing,
      newBytes: Buffer.from(base64Decode(file.newContentBase64)),
    })
  }

  // (3) D-19, AND IT IS THE MEASUREMENT. Recomputed from the bytes on disk right now — not from
  // the proposal's own record of what they were — so a payload whose `newContent` was widened
  // between the render and this accept produces different diff bytes and refuses here, before
  // anything is written.
  const recomputed = renderConfigDiff(pending.map((file, index) => ({
    path: payloadFiles[index]!.path,
    ...(file.existing === undefined ? {} : { oldBytes: Uint8Array.from(file.existing) }),
    newBytes: Uint8Array.from(file.newBytes),
  })))
  // 395-02: `unchanged` NARROWS HERE, AND IT IS A REFUSAL RATHER THAN A NO-OP. A recompute that
  // finds no difference means the files on disk already hold the bytes this proposal would write —
  // somebody applied this change by hand, or applied an identical one. Committing anyway would
  // produce an empty commit and a receipt claiming to have written something; skipping silently
  // would answer `applied` for an apply that did nothing. The proposal recorded a NON-empty diff
  // (an empty one cannot be minted — see the primitive's own refusals), so the honest reading is
  // exactly the one this error already states: the diff on disk is not the diff you were shown.
  if (recomputed.outcome === 'unchanged') {
    throw new ConfigApplyDiffMismatchError(
      request.payload.shownDiffDigest,
      NO_DIFF_RECOMPUTED,
    )
  }
  if (recomputed.diffDigest !== request.payload.shownDiffDigest) {
    throw new ConfigApplyDiffMismatchError(
      request.payload.shownDiffDigest,
      recomputed.diffDigest,
    )
  }

  // (4) D-05: THE HUMAN-FIRST COMMIT. Scoped to the proposal's own files and to the dirty ones
  // among them — a dirty file this proposal does not touch is never looked at, let alone staged.
  const dirty: typeof pending = []
  for (const file of pending) {
    const porcelain = runGitStatusPorcelain(exec, configDir, file.identityPath)
    if (porcelain === '') continue
    if (!input.pinnedFileSet.includes(file.identityPath)) {
      throw new ConfigApplyDirtyOutsideSetError(file.identityPath, porcelain, input.pinnedFileSet)
    }
    dirty.push(file)
  }

  let humanHash: string | undefined
  if (dirty.length > 0) {
    const dirtyPaths = dirty.map((file) => file.identityPath)
    // CAPTURED BEFORE THE ADDS, because the adds are what they undo. The worktree needs no capture
    // here: committing a pathspec writes nothing to it, which is why this rollback is index-only
    // and says so rather than restoring bytes it never touched.
    const indexBeforePreserve = dirty.map((file) => ({
      identityPath: file.identityPath,
      entry: captureIndexEntry(exec, configDir, file.identityPath),
    }))
    try {
      for (const path of dirtyPaths) runGitAdd(exec, configDir, path)
      const preserved = runGitCommitPaths(
        exec, configDir, dirtyPaths, humanFirstCommitMessage(dirtyPaths),
      )
      if (preserved.kind === 'nothing-to-commit') {
        // git status called these paths dirty and `git diff --cached` then found nothing staged.
        // Named rather than swallowed: the two answers disagreeing is a fact about this repository
        // that the apply cannot resolve, and proceeding would commit the agent's bytes on top of
        // human work this function has just failed to preserve.
        throw new Error(
          `refusing to apply: git status reported uncommitted work at ${dirtyPaths.join(', ')} but `
          + 'staging those paths produced nothing to commit, so the human-first commit D-05 '
          + 'requires could not be made. Nothing has been written.',
        )
      }
    } catch (error) {
      restoreIndexEntriesOrReportBoth(exec, configDir, indexBeforePreserve, error)
      throw error
    }
    humanHash = runGitHeadHash(exec, configDir, dirtyPaths[0]!)
  }

  // (5) THE INDEX IS CAPTURED HERE, AFTER THE PRESERVE COMMIT, and the placement is load-bearing
  // rather than incidental. An entry captured before it names the blob HEAD held BEFORE the human's
  // bytes were recorded; restoring that on a later failure would stage a revert of the person's own
  // commit at the file the agent touched — the index half of CR-05's defect, pointing backwards.
  const files: ConfigApplyFile[] = pending.map((file) => ({
    ...file,
    indexBefore: captureIndexEntry(exec, configDir, file.identityPath),
  }))

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
      // 400-05: the surface the PROPOSAL recorded, never this host's own. See
      // `agentConfigCommitAuthor` for the map and its two honest arms.
      agentConfigCommitAuthor(request.mintedSurface),
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

  // BELOW THIS LINE NOTHING IS RESTORED — the commits exist, so they are the new truth.
  return {
    outcome: 'applied',
    // HUMAN FIRST, IN THE ORDER THE COMMITS WERE MADE. The receipt is what a surface renders and
    // what a person checks against `git log`, so its order is the history's order or it is a
    // second account of the same events.
    commits: [
      ...(humanHash === undefined ? [] : [{ role: 'human' as const, hash: humanHash }]),
      { role: 'agent' as const, hash: runGitHeadHash(exec, configDir, files[0]!.identityPath) },
    ],
    files: files.map((file) => file.identityPath),
  }
}

/**
 * A previous apply's receipt, reconstructed from the repository (CFGM-03's idempotency arm).
 *
 * THE AGENT COMMIT IS FOUND BY ITS TRAILER; ITS HUMAN-FIRST PARTNER CANNOT BE, and deliberately so —
 * the preserve commit carries no trailer and no agent attribution because it is not the agent's
 * work. What identifies it is that it is the agent commit's PARENT and carries this file's own
 * pinned subject, which is a byte this file writes rather than English git chose. A parent with any
 * other subject is somebody else's commit and is left out of the receipt.
 */
function originalApplyReceipt(
  exec: GitApplyExec,
  cwd: string,
  targetPath: string,
  agentHash: string,
): readonly ConfigApplyCommit[] {
  const parent = runApplyGit(exec, cwd, targetPath, [
    'log', '--format=%h%x00%s', '--max-count=1', `${agentHash}^`,
  ])
  if (parent.status !== 0) return [{ role: 'agent', hash: agentHash }]
  const [hash, subject] = parent.stdout.trim().split('\0')
  if (hash === undefined || subject !== HUMAN_FIRST_COMMIT_SUBJECT) {
    return [{ role: 'agent', hash: agentHash }]
  }
  return [{ role: 'human', hash }, { role: 'agent', hash: agentHash }]
}

/**
 * Put back every index entry the human-first staging moved, and report BOTH facts if that fails.
 *
 * INDEX ONLY, BECAUSE THE INDEX IS ALL THAT MOVED. `git add` followed by a `git commit` that threw
 * writes nothing to the working tree, so a version of this that also wrote bytes back would be
 * restoring a state nothing had left — and the bytes it would write are the person's own, which
 * makes an unnecessary write here the most expensive kind of harmless.
 */
function restoreIndexEntriesOrReportBoth(
  exec: GitApplyExec,
  cwd: string,
  captured: readonly { identityPath: string; entry: IndexEntry | undefined }[],
  applyError: unknown,
): void {
  const failures: string[] = []
  for (const item of [...captured].reverse()) {
    try {
      restoreIndexEntry(exec, cwd, item.identityPath, item.entry)
    } catch (restoreError) {
      failures.push(`${item.identityPath}: ${errorText(restoreError)}`)
    }
  }
  if (failures.length === 0) return
  throw new ApplyRollbackFailedError(
    captured.map((item) => item.identityPath).join(', '),
    applyError,
    new Error(failures.join('; ')),
  )
}

/**
 * Put every touched path back, worktree and index, and report BOTH facts if a restore fails.
 *
 * PER PATH AND NEVER REPO-WIDE — no `reset`, no `checkout .`, no `clean` — for the reason its
 * single-path analog states: the one thing a rollback must not do is undo work that was never the
 * agent's. Restores run in REVERSE order so the file this apply touched last is the first put back,
 * which keeps the sequence a mirror of the writes rather than a second traversal with its own
 * ordering assumptions.
 *
 * EVERY FILE IS ATTEMPTED, AND THE FAILURES ARE COLLECTED (395-06). The first draft of this
 * function called `restoreOrReportBoth` in the loop, which THROWS on the first failing restore —
 * so a multi-file apply whose second file could not be put back abandoned the first one, still
 * carrying the agent's bytes, with the caller told only about the file that failed. That is
 * `restoreOrReportBoth`'s single-path contract used where it does not hold: for one path, "throw on
 * the restore's failure" and "attempt everything, then report" are the same sequence; for several
 * they are opposite. The wrapper stays exactly as it is for the test-draft apply, which has one
 * path by construction.
 */
function restoreConfigApplyFailure(
  exec: GitApplyExec,
  cwd: string,
  files: readonly ConfigApplyFile[],
  writeTarget: (absolutePath: string, bytes: Buffer) => void,
  applyError: unknown,
): void {
  const failures: string[] = []
  for (const file of [...files].reverse()) {
    try {
      restoreApplyFailure(
        exec, cwd, file.identityPath, file.absolutePath, file.existing, file.indexBefore, writeTarget,
      )
    } catch (restoreError) {
      failures.push(`${file.identityPath}: ${errorText(restoreError)}`)
    }
  }
  if (failures.length === 0) return
  throw new ApplyRollbackFailedError(
    files.map((file) => file.identityPath).join(', '),
    applyError,
    new Error(failures.join('; ')),
  )
}

// 395-04: the pinned config file SET's enumeration MOVED to `schema`
// (`config-mutation/file-set.ts`), and the move is the point rather than tidiness. Three packages
// read that one answer — this port enumerates the files it reads bytes for, `agent`'s cross-boundary
// classifier decides `out-of-set-path` against it, and 395-06's apply porcelain scopes its check to
// it — and `agent` may not import `cli`. A copy on either side would fail in the PERMISSIVE
// direction and silently, the day the set grew a member. The two names and the retune note live
// beside the function.

/**
 * This workspace's pinned config set, resolved once and read by BOTH config host ports (395-06).
 *
 * ONE FUNCTION, TWO CALLERS, AND THAT IS THE WHOLE REASON IT EXISTS. `createConfigFilesPort` reads
 * bytes for these members and hands their paths to the classifier as `pinnedFileSet`;
 * `createConfigApplyPort` scopes its human-first preserve commit to the same answer. Two spellings
 * of "which files are config" agree until somebody edits one of them, and the direction they fail
 * in is permissive: the apply would happily commit a person's uncommitted work in a file the
 * classifier had already decided was out of set.
 *
 * IT READS THE CONFIG BECAUSE THE SET DEPENDS ON THE CONFIG. `workspace.hooksFile` can name
 * anything, so the enumeration's second member is a fact only a parse can supply.
 */
async function resolvePinnedConfigSet(configPath: string): Promise<{
  readonly configIdentity: string
  readonly hooksFile: string
  readonly members: readonly string[]
}> {
  const configDir = dirname(resolve(configPath))
  const configIdentity = workspaceRelativeIdentityPath(configDir, configPath)
  const fileConfig = await loadConfigFile(configPath) as { workspace?: { hooksFile?: unknown } }
  const named = typeof fileConfig.workspace?.hooksFile === 'string'
    ? fileConfig.workspace.hooksFile
    : undefined

  // THE ONE ENUMERATION, imported. Deduplication, ordering and the default hooks file are all its
  // business, so no consumer of this answer can disagree about which files are config.
  const members = enumerateConfigFileSet({
    configFile: configIdentity,
    ...(named === undefined ? {} : { hooksFile: named }),
  })

  return {
    configIdentity,
    // NAMED, NOT MATCHED (395-05). `config.hook.add` writes this member and the validator picks its
    // schema by it. The default is read from the SAME enumeration, so a project that names no hooks
    // file and one that names `hooks.yaml` explicitly answer identically here.
    hooksFile: named === undefined || named === '' ? CONFIG_SET_DEFAULT_HOOKS_FILE : named,
    members,
  }
}

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
      const { hooksFile, members } = await resolvePinnedConfigSet(configPath)

      return {
        configFile: configIdentity,
        hooksFile,
        files: members.map((path) => {
          const bytes = readTargetIfPresent(resolve(configDir, path))
          // ABSENT MEANS ABSENT. A zero-length stand-in would make "there is no hooks file" and
          // "there is an empty hooks file" the same fact, and the apply's `baseDigest` re-check
          // reads exactly that distinction.
          return bytes === undefined ? { path } : { path, bytes: Uint8Array.from(bytes) }
        }),
      }
    },

    /**
     * The document's SHAPE at each path, from ONE parse (395-05).
     *
     * SHAPE AND NEVER CONTENT. `keys` and `length` describe the container so a create can refuse a
     * collision, an edit can list the names that exist and an append can land past the end; the
     * values inside are not returned, because a port that answered "what is at this path" would be
     * the unmasked config reader `ConfigReaderPort`'s header says must not exist, reached through
     * the back door of a mutation helper.
     */
    inspect({ bytes, paths }): Promise<readonly ConfigPathFacts[]> {
      const document = bytes === undefined
        ? new YamlDocument({})
        : parseDocument(Buffer.from(bytes).toString('utf8'))
      return Promise.resolve(paths.map((path) => {
        const node = document.getIn(path.split('.'), true)
        if (node === undefined || node === null) return { path, present: false }
        if (isSeq(node)) return { path, present: true, kind: 'sequence' as const, length: node.items.length }
        if (isMap(node)) {
          return {
            path,
            present: true,
            kind: 'map' as const,
            // DOCUMENT ORDER, not sorted: these names are read back to a person as "did you mean",
            // and the order they appear in the file is the order they will be looked for in it.
            keys: node.items.map((item) => String(isScalar(item.key) ? item.key.value : item.key)),
          }
        }
        return { path, present: true, kind: 'scalar' as const }
      }))
    },

    /**
     * A fresh canonical hook id, from the ONE mint `isCanonicalHookId` accepts (395-05).
     *
     * A HOST FACT because `@vostride/agent-qa-ids` is not among `packages/agent`'s internal
     * dependencies and because the mint draws randomness, which nothing in that package may read.
     * Calling `generateHookId` rather than formatting `h_` plus ten words here is the difference
     * between an id the hooks schema accepts and one it refuses at the next run.
     */
    mintHookId(): string {
      return generateHookId()
    },

    setField({ bytes, path, value }): Promise<ConfigFieldSetResult> {
      const document = bytes === undefined
        ? new YamlDocument({})
        : parseDocument(Buffer.from(bytes).toString('utf8'))
      const segments = path.split('.')
      // READ BEFORE WRITE, THROUGH THE SAME DOCUMENT (395-04, D-02). The classifier compares the
      // value this edit replaces against the one it writes — a base URL pointing at a NEW origin is
      // the case no per-op map can see — and the alternative to reading it here was a second parse
      // of the same bytes, free to disagree with the one that actually applied the edit.
      //
      // SCALARS ONLY, and the narrowing is honest rather than lossy: `getIn` with `keepScalar` false
      // answers a JS value, which for a map or a sequence is an object. "There was no scalar there"
      // is the true statement about what a wholesale subtree replacement replaced, and such an edit
      // is flagged on its own grounds (secret-adjacency) rather than by pretending it had one.
      const previous = document.getIn(segments) as unknown
      document.setIn(segments, value)
      const mutated = Uint8Array.from(Buffer.from(document.toString(), 'utf8'))
      return Promise.resolve(
        typeof previous === 'string'
          || typeof previous === 'number'
          || typeof previous === 'boolean'
          ? { bytes: mutated, previousValue: previous }
          : { bytes: mutated },
      )
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
 *
 * 395-05: THE CANDIDATE IS THE WHOLE FILE SET, NOT THE CONFIG YAML. `config.hook.add` changes only
 * the hooks file, and a validator that only ever read the config yaml would have declared that
 * proposal valid without looking at the one artifact it wrote — the whole-input law satisfied on
 * paper and violated in fact. Each member is validated against the schema that OWNS it: the config
 * yaml against `AgentQaConfigSchema`, the hooks file against `core`'s `HooksFileSchema` (which is
 * where the canonical `h_` id rule and the duplicate-id/duplicate-name refinements live). A member
 * with no schema — `.gitignore` is in the set — is passed over rather than guessed at.
 *
 * A CONSEQUENCE, STATED RATHER THAN DISCOVERED LATER: a project whose committed hooks file is
 * already invalid now has every config proposal blocked with that file's issues, not only its hook
 * additions. That is the same posture D-12 takes for a secret a human committed — the whole input is
 * the whole input — and the blocked record names the file, so the person is told what to fix.
 */
export function createConfigValidatePort(): ConfigValidatePortLike {
  return {
    validate({ configFile, hooksFile, files }): Promise<ConfigValidation> {
      const issues: ConfigValidationIssue[] = []

      for (const member of files) {
        if (member.bytes === undefined) continue
        // WHICH SCHEMA IS DECIDED BY WHICH MEMBER THIS IS, and the config file is named by the set
        // rather than matched by extension: a project whose config is `agent-qa.yml` is still that
        // project's config, and the hooks file is whatever `workspace.hooksFile` said it was.
        const isConfig = member.path === configFile
        const isHooks = !isConfig && member.path === hooksFile
        if (!isConfig && !isHooks) continue

        let parsed: unknown
        try {
          parsed = parseYaml(Buffer.from(member.bytes).toString('utf8'))
        } catch (error) {
          // A yaml the parser cannot read is a validation failure and not a crash: the candidate
          // came from a mutation this product made, so the person is owed the reason rather than a
          // stack trace out of a library.
          //
          // WHERE, NEVER WHAT (395-10 · GAP 1). This line used to interpolate the thrown error's
          // own text, and the vendored `yaml` package pretty-prints a parse error with an excerpt of
          // the offending source line and a caret under the column. That excerpt is the person's own
          // file content, it is persisted in the blocked record and printed by `proposals show`, and
          // it was measured carrying a planted credential onto all three surfaces. The error's
          // POSITION is the one fact this product chose to publish, so the position is the only
          // thing read off the error — not its message, not its code, not its stringification.
          issues.push({ path: member.path, message: yamlParseFailureMessage(error) })
          continue
        }

        if (isConfig) {
          // THE SAME THREE STEPS A REAL RUN TAKES — merge, normalize, parse (`resolveConfig`'s own
          // sequence). Validating the raw file against the resolved schema instead was measured
          // wrong during 395-01: `AgentQaConfigSchema` describes a COMPLETE configuration, so a
          // candidate that omitted the env layer would be refused for keys a run supplies. The env
          // overrides are included deliberately — "is this configuration valid" means valid for the
          // process that will read it, and a proposal refused for a key the environment provides
          // would be refusing a change that works.
          const merged = mergeConfigs(parsed ?? {}, loadEnvOverrides(), {})
          const result = AgentQaConfigSchema.safeParse(normalizeConfigForValidation(merged))
          // The validator's OWN words, joined to a path. This layer reports issues; it does not
          // classify them, because a closed issue vocabulary here would be a second, weaker copy of
          // core's refinements, out of date the first time one is added.
          if (!result.success) {
            // THE PATH IS THE FILE, the dotted config path stays inside the message. A schema issue
            // is about a key in a document, and the document is the config yaml member — which is
            // the fact the blocked record's `paths` needs (WR-11). Putting the dotted path there
            // instead would name something that is not a file and cannot be opened.
            issues.push(...result.error.issues.map((issue) => ({
              path: member.path,
              message: `${issue.path.join('.') || '<root>'}: ${issue.message}`,
            })))
          }
          continue
        }

        // An EMPTY hooks file is a hooks file with no hooks, which is legal and common; `parseYaml`
        // answers `null` for one, and refusing that would refuse every project that has the file and
        // has not written a hook yet.
        if (parsed === null || parsed === undefined) continue
        const hooks = HooksFileSchema.safeParse(parsed)
        if (!hooks.success) {
          issues.push(...hooks.error.issues.map((issue) => ({
            path: member.path,
            message: `${issue.path.join('.') || '<root>'}: ${issue.message}`,
          })))
        }
      }

      return Promise.resolve(issues.length === 0 ? { ok: true } : { ok: false, issues })
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
    async apply(request) {
      // RESOLVED PER APPLY, NOT CAPTURED AT COMPOSITION TIME. A long-lived host outlives the config
      // it was composed against, and `workspace.hooksFile` is exactly the kind of value a person
      // changes; a set read once would scope the preserve commit to a file set that no longer
      // describes the project.
      const { members } = await resolvePinnedConfigSet(configPath)
      return applyConfigProposalAsOneCommit({
        configPath,
        pinnedFileSet: members,
        request: {
          proposalId: request.proposalId,
          payload: request.payload,
          // 400-05: passed through untouched. This port decides nothing about attribution — the
          // value was recorded at propose time and read by the op that held the envelope.
          ...(request.mintedSurface === undefined
            ? {}
            : { mintedSurface: request.mintedSurface }),
        },
      })
    },
  }
}

/**
 * One committed blob's RAW BYTES, or `undefined` if that revision has no such path (395-06, D-17).
 *
 * IT DOES NOT GO THROUGH `runApplyGit`, AND THE REASON IS THE ONE D-17 EXISTS FOR. That helper
 * pins `encoding: 'utf8'` on its exec seam, so every byte it returns has been through a decoder —
 * and a decoder maps every sequence it cannot read onto U+FFFD, many-to-one. These bytes become a
 * proposal's `newContentBase64` and are digested and re-checked against a file on disk, so reading
 * them decoded would mean proposing a lossy rewrite of a person's configuration and then comparing
 * it against a digest taken over the real thing. 394's CR-02 cost a phase to find in exactly this
 * shape; this is the same contract's third caller, so it reads bytes.
 *
 * `--` BEFORE NOTHING, DELIBERATELY: the argument is a `<rev>:<path>` object name and not a
 * pathspec, so there is nothing here for a pathspec separator to disambiguate. The revision string
 * is built from a hash this function was handed and a path git itself listed, never from caller
 * text.
 */
function readBlobBytes(cwd: string, objectName: string): Uint8Array | undefined {
  const result = spawnSync('git', ['show', objectName], {
    cwd,
    encoding: 'buffer',
    timeout: APPLY_GIT_TIMEOUT_MS,
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) return undefined
  return Uint8Array.from(result.stdout)
}

/**
 * The repository's own account of the last agent configuration commit (395-06, D-07).
 *
 * EVERY ANSWER IS READ FROM GIT'S PLUMBING AND EXIT CODES, NEVER FROM ITS PROSE. The commit is found
 * by the SAME `Agent-QA-Proposal` marker `findAppliedCommit` reads, with `--fixed-strings` because
 * the id is data, and with a PATHSPEC restricting it to the pinned config set — so a commit this
 * product made to something other than configuration (394's test-draft applies carry no such
 * trailer today, but a future one might) cannot be mistaken for a config commit.
 *
 * THE FILE LIST IS ALSO PATHSPEC-SCOPED, so a commit that somehow touched both config and
 * non-config paths yields only the config half, and the undo cannot propose a change to a file this
 * product does not own.
 *
 * THE BYTES COME FROM `git show <commit>^:<path>`, WHICH IS THE PARENT SIDE AND NOTHING ELSE. See
 * `ConfigUndoSourceFile`'s header for why the applied side and the current side are deliberately
 * not carried: the construction re-reads current for itself, and the applied side never enters a
 * `current → parent` diff.
 */
/**
 * The shared scaffold CONTENT, rendered for the propose path (395-08, D-04 · CFGM-05).
 *
 * ONE PRODUCER, TWO WRITE PATHS, AND THIS IS THE SECOND ONE. `agent-qa init` calls the very same
 * functions and then writes the bytes to disk through its own filesystem machinery; this port calls
 * them and hands the bytes back so they can become a proposal's diff. There is no second copy of
 * the scaffold's substance anywhere, which is what makes D-04's no-drift claim a property of the
 * module graph rather than a promise — and it is why this lives in `cli` rather than in `agent`,
 * which may not import it.
 *
 * THE ENTRIES ARE `TARGET_GITIGNORE_ENTRIES`, IMPORTED. That constant is the default
 * `upsertManagedGitignoreBlock` writes, so a project scaffolded by proposal and one scaffolded by
 * `init` get the same managed block by construction. It is imported rather than restated for the
 * reason the whole module exists.
 *
 * NOTHING HERE TOUCHES THE FILESYSTEM. The existing `.gitignore`'s bytes arrive from the caller,
 * which read them through `ConfigFilesPortLike.read` — the same read the digests are taken over, so
 * the upsert composes against the bytes the apply will re-check rather than against a second read.
 */
export function createScaffoldContentPort(): ConfigScaffoldContentPortLike {
  return {
    render({ targetName, baseUrl, existingGitignore, existingConfig }) {
      const files = buildScaffoldFileSet({
        targetName,
        baseUrl,
        // THE HOST DEFAULTS, READ HERE (FUNC-02). `scaffold-content.ts` may not name
        // `@vostride/agent-qa-core`; this file is ledgered for it, so the two directory defaults
        // are resolved on this side and handed over — the same two values `init` passes.
        cacheDir: DEFAULT_AGENT_QA_CACHE_DIR || '.agent-qa/cache',
        authStatesDir: DEFAULT_AGENT_QA_AUTH_STATES_DIR || '.agent-qa/auth-states',
        gitignoreEntries: TARGET_GITIGNORE_ENTRIES,
        ...(existingGitignore === undefined
          ? {}
          : { existingGitignore: Buffer.from(existingGitignore).toString('utf8') }),
        // 395-12: the MERGE mode's bytes, decoded here for the reason the gitignore's are — the
        // port speaks bytes because the digests are taken over bytes, and the content module is
        // text. The paths cross unchanged: they are the pinned set's own spelling, and a producer
        // that re-derived them could name a file outside the set.
        ...(existingConfig === undefined
          ? {}
          : {
            existingConfig: {
              path: existingConfig.path,
              text: Buffer.from(existingConfig.bytes).toString('utf8'),
              hooksPath: existingConfig.hooksPath,
              hooksPresent: existingConfig.hooksPresent,
            },
          }),
      })
      return Promise.resolve(files.map((file) => ({
        path: file.path,
        bytes: Uint8Array.from(Buffer.from(file.text, 'utf8')),
      })))
    },
  }
}

/**
 * git named a file this product does not own — refused whole, by name (395-11 · CR-03).
 *
 * A REFUSAL RATHER THAN A FLAG, and the distinction is the whole of why this class exists. The
 * cross-boundary classifier already reports `out-of-set-path` on a proposal that names such a file,
 * and a flag forces a person to make an individual decision about it — which is the right answer
 * when the CONSTRUCTION legitimately reached outside the set, and the wrong one here. There are
 * exactly two ways a path git listed under a set-scoped pathspec can fail to be a set member:
 * this port asked its question in the wrong path vocabulary, or the pinned set stopped describing
 * the project. Neither is something to build a write proposal out of and hand somebody to approve.
 *
 * IT NAMES BOTH SIDES. The stray paths say what was answered; the members say what the answer was
 * checked against — so the person reading it can see which of the two failures they have without
 * re-deriving the set themselves.
 */
export class ConfigUndoSourceOutOfSetError extends Error {
  constructor(strayPaths: readonly string[], members: readonly string[]) {
    super(
      `refusing to build an undo from ${JSON.stringify(strayPaths.join(', '))}: git listed `
      + 'path(s) that are not members of this project\'s pinned configuration set '
      + `(${JSON.stringify(members.join(', '))}). Every path in that commit must already be a `
      + 'member — a path outside it is either a relativity bug in this port or a file agent-qa '
      + 'does not own, and an undo is refused whole rather than proposed from one.',
    )
    this.name = 'ConfigUndoSourceOutOfSetError'
  }
}

/**
 * @param injectedExec - the git seam, defaulted to `spawnSync` exactly as the sibling apply helpers
 *   default theirs. Production never passes it; it exists so a cell can drive the out-of-set
 *   refusal above, which no real repository can be made to produce once `--relative` is in place.
 */
export function createConfigUndoSourcePort(
  configPath: string,
  injectedExec?: GitApplyExec,
): ConfigUndoSourcePortLike {
  const configDir = dirname(resolve(configPath))
  const exec = injectedExec ?? (spawnSync as unknown as GitApplyExec)

  return {
    async read(): Promise<ConfigUndoSource> {
      const { members } = await resolvePinnedConfigSet(configPath)
      const anchor = members[0] ?? '.'
      if (!repositoryHasCommits(exec, configDir, anchor)) return { kind: 'none' }

      const found = runApplyGit(exec, configDir, anchor, [
        'log', '--format=%h%x00%s%x00%B%x00', '--max-count=1',
        '--fixed-strings', `--grep=${AGENT_CONFIG_PROPOSAL_TRAILER_KEY}: `,
        '--', ...members,
      ])
      if (found.status !== 0) {
        throw new Error(
          `git log exited ${found.status} looking for the last agent config commit: `
          + `${found.stderr.trim()}`,
        )
      }
      const [commit, subject, body] = found.stdout.split('\0')
      if (commit === undefined || commit.trim() === '' || subject === undefined) {
        return { kind: 'none' }
      }

      // THE ID IS READ OFF THE TRAILER LINE, not off the subject and not off a position in the
      // message. The trailer is the machine-readable half D-06 exists to provide; a body whose
      // shape somebody reworded still yields the id, and a body that does not carry one is not an
      // agent commit no matter what its subject says.
      const trailer = (body ?? '').split('\n')
        .map((line) => line.trim())
        .find((line) => line.startsWith(`${AGENT_CONFIG_PROPOSAL_TRAILER_KEY}: `))
      if (trailer === undefined) return { kind: 'none' }
      const proposalId = trailer.slice(`${AGENT_CONFIG_PROPOSAL_TRAILER_KEY}: `.length).trim()
      if (proposalId === '') return { kind: 'none' }

      // `--relative` IS WHAT MAKES THE ANSWER THE configDir VOCABULARY BY CONSTRUCTION RATHER THAN
      // BY LUCK (395-11 · CR-03). git answers `--name-only` in repo-root-relative paths, and every
      // other participant in this pipeline speaks configDir-relative — the pinned set, the apply's
      // pathspec, the classifier's `pinnedFileSet`, the freshness digests. Without this flag the two
      // vocabularies are identical for exactly one layout, the one `agent-qa init` produces, and
      // differ by a prefix for every other: a config at `sub/dir/` yielded
      // `sub/dir/agent-qa.config.yaml`, which the construction then read as a NEW file at
      // `<configDir>/sub/dir/agent-qa.config.yaml` — a whole-file add with no `baseDigest`, whose
      // absent digest satisfies D-18 vacuously, and whose accept created the nested directory and
      // committed a duplicate configuration while reverting nothing.
      //
      // THE PATHSPEC AND THE `--relative` BASE ARE THE SAME DIRECTORY. `members` are configDir
      // -relative and this process runs in `configDir`, which is what `--relative` resolves against
      // when given no explicit value — so the paths that come back are answers about the same
      // strings the question was asked with. That identity is the invariant; the guard below is it
      // asserted rather than assumed.
      const touched = runApplyGit(exec, configDir, anchor, [
        'show', '--name-only', '--relative', '--format=', commit.trim(), '--', ...members,
      ])
      if (touched.status !== 0) {
        throw new Error(
          `git show exited ${touched.status} listing ${JSON.stringify(commit.trim())}: `
          + `${touched.stderr.trim()}`,
        )
      }
      const paths = [...new Set(
        touched.stdout.split('\n').map((line) => line.trim()).filter((line) => line !== ''),
      )].sort()

      // ASSERTED, NOT ASSUMED. The pathspec above already restricts the answer to the pinned set,
      // so under a correct relativity this loop can never fire — which is precisely the reason to
      // write it: a silent invariant that holds by an argument is one that stops holding the day
      // the argument does, and the failure it hid last time was a duplicate config file committed
      // at a doubled path. See `ConfigUndoSourceOutOfSetError`'s header for why this is a refusal.
      const stray = paths.filter((path) => !members.includes(path))
      if (stray.length > 0) throw new ConfigUndoSourceOutOfSetError(stray, members)

      return {
        kind: 'found',
        commit: commit.trim(),
        proposalId,
        subject: subject.trim(),
        files: paths.map((path) => {
          // `./` IS NOT COSMETIC — IT IS THE OTHER HALF OF THE SAME RELATIVITY (395-11). In git's
          // `<rev>:<path>` object syntax a bare path is resolved from the ROOT of the tree and only
          // a path beginning `./` or `../` is resolved from the current directory. So the moment
          // the listing above started answering in the configDir vocabulary, reading its blobs
          // without this prefix would ask for `<repo-root>/agent-qa.config.yaml` — a path that does
          // not exist on a sub/dir layout — and `readBlobBytes` would answer `undefined`, which
          // this pipeline reads as "the parent had no such file" and turns into a spurious
          // `undo-needs-delete` refusal. Both halves are relative to `configDir` or neither is.
          const parentBytes = readBlobBytes(configDir, `${commit.trim()}^:./${path}`)
          // ABSENT IS "THE PARENT HAD NO SUCH FILE", which is the fact that makes this an
          // undo-needs-delete rather than an empty payload. `git show` distinguishes that from a
          // present EMPTY file by its exit status, which is why the status is what is read.
          return parentBytes === undefined ? { path } : { path, parentBytes }
        }),
      }
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
  return {
    // THE SURFACE, DECLARED WHERE THE PROMPT IS BUILT (G-401-17). This port is a `readline`
    // question on this process's own stdio, so the person answering it is at a terminal — and the
    // tty check three lines up is exactly the fact that makes that true. The gate used to assume
    // it for EVERY confirm binding, which is how a click in a browser was recorded as a terminal
    // prompt on the row a person audits.
    surface: 'tty-prompt',
    ask: (action) => new Promise<boolean>((answer) => {
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
    }),
  }
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

// WHAT THE SESSION LOG RECORDS ABOUT ONE DECISION IS DECLARED IN `agent-local`, NOT HERE (401-01,
// D-13). This file used to carry its own `ChatApprovalDecisionRecord`, structurally mirroring the
// composition's — two spellings of one contract, free to drift the moment either producer changed,
// and the shape that let NEW-AUDIT-01 sit half-closed. `cli` may import `agent-local` and the
// reverse is forbidden, so the canon lives at the composition root and this surface imports it.

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
  /**
   * WHICH CONVERSATION THIS TERMINAL IS IN, asked PER DECISION (401-01, D-13).
   *
   * A SUPPLIER RATHER THAN A VALUE, because the id does not exist when this port is built: the
   * REPL composes its host before its first turn, and the engine mints the session id on that
   * turn. Captured at construction it would be `undefined` forever.
   *
   * `undefined` MEANS NO APPEND, and that is the same fail-safe direction the composition takes:
   * a decision that cannot name its conversation gets no row rather than a guessed one. It never
   * substitutes another conversation, because a row in the wrong transcript IS the defect.
   */
  readonly resolveSessionId: () => string | undefined
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

  /**
   * The ledger append is a RECORD of the decision, never a veto over it.
   *
   * THE CONVERSATION IS RESOLVED HERE, ONCE PER DECISION (401-01, D-13) rather than passed down
   * from each arm: every arm below records the same person's answer in the same terminal, so one
   * resolution point is what keeps the three of them from being able to disagree. No conversation
   * means no append — the composition would refuse an unplaceable row anyway, and refusing it here
   * keeps the wrapper honest about what it can attribute.
   */
  const ledger = async (
    decision: Omit<ChatApprovalDecisionRecord, 'sessionId'>,
  ): Promise<void> => {
    const sessionId = options.resolveSessionId()
    if (sessionId === undefined) return
    try {
      await options.onDecision({ ...decision, sessionId })
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

  return {
    // THE SAME TERMINAL, DECLARED AGAIN AT THIS BINDING SITE rather than inherited from the
    // one-form port above (G-401-17). This wrapper is an EXTENSION of that port, not a decorator
    // over it: it builds its own `readline` interface on its own streams, so it is its own
    // producer and owes its own declaration. Two spellings of `tty-prompt` is the correct number
    // here — a shared default would be the thing that let the browser port inherit one silently.
    surface: 'tty-prompt',
    ask: (action) => new Promise<boolean>((answer) => {
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
    }),
  }
}

export function composeCliLocalAgent(input: ComposeCliLocalAgentInput): LocalAgentHost & { trustPriorDisclosure: TrustPriorDisclosure } {
  const trustPriors = input.trustPriors ?? trustPriorsForHost({ configPath: input.configPath })
  const resolveTrustPriors = trustPriors.resolve
  /**
   * THIS host's ONE replay-gate bridge — constructed lazily, then memoised (417/421 walls).
   *
   * Lazy because `judge-panel-host-paths.test.ts` pins that composing a host constructs no bridge
   * at all until an operation asks for one; memoised because `replay-gate-binding.test.ts` pins
   * exactly one construction site per host file, and one site that ran twice with different deps
   * would satisfy the letter of that wall while breaking what it protects. The promotion posture
   * and the 422 D-14 Gate-1 leg receive the SAME object.
   *
   * 422 D-14: the borrowed lease travels on the bridge's own deps rather than on either consumer,
   * so the posture's presence check and the proposal stage's write share one answer to "which
   * lease is this host holding" — resolved at the claim, never captured here.
   */
  let replayGateMemo: ReplayGatePort | undefined
  const sharedReplayGate = (): ReplayGatePort => (replayGateMemo ??= createReplayGatePortForHost({
    configPath: input.configPath,
    agentQaRoot: input.agentQaRoot,
    resolveTrustPriors,
    ...(input.postRun?.resolveClaimAuthority === undefined
      ? {}
      : { resolveClaimAuthority: input.postRun.resolveClaimAuthority }),
  }))
  const resolvePromotionPosture = input.resolvePromotionPosture ?? (async () =>
    buildPromotionPostureResolver({ configPath: input.configPath,
      knowledgeRoot: await knowledgeRoot(), agentQaRoot: input.agentQaRoot,
      canaryFacts: LOCAL_CURATION_CAPABILITIES.readCanaryPostureFacts,
      lowerTrustShares: LOCAL_CURATION_CAPABILITIES.readLowerTrustShares,
      currentBuildOrdinal: product => latestBuildOrdinal({ root: input.agentQaRoot, product }),
      replayGate: sharedReplayGate(),
    })
      .then(result => promotionPostureResolverForHost(result, message => console.warn(message))))
  // Narrowed once, here, so the hook closures below close over a value TypeScript knows is present
  // rather than re-reading an optional field at call time.
  const analytics = input.analytics
  const knowledgeRoot = async (): Promise<string> => {
    const config = await resolveConfig({ configPath: input.configPath, loadAuthPlugins: false })
    return resolveKnowledgeRoot(config.knowledge, dirname(resolve(input.configPath)))
  }
  // THE DOOR'S CONFIRM, RESOLVED ONCE FOR BOTH GATES (401-05, D-07).
  //
  // It was resolved inline in the `composeLocalAgent` literal below until this host gained a second
  // gate to answer for. Two resolutions of "is there somebody at this door" would be free to
  // disagree — and the way they would disagree is the dangerous direction: the op-level gate
  // refusing to prompt while the run gate wrote a tty prompt onto a JSON-RPC connection.
  //
  // 396-01 D-09's rule is preserved exactly, because it is the whole reason this is a hoist rather
  // than a `??`: the FIELD's presence is read, not its value. `confirm: undefined` (the MCP host)
  // REFUSES to ask at both gates; an absent field defaults to "prompt where there is somebody to
  // prompt", which is every other CLI invocation.
  const doorConfirm = 'confirm' in input ? input.confirm : createTtyConfirmPort()

  const host = composeLocalAgent({
    readMaskingSources: createColdReadMaskingSources(input.configPath, () => {
      const bridgeSecrets = input.runBridge?.maskingSecrets?.()
      return [
        ...(bridgeSecrets === undefined ? [] : [bridgeSecrets]),
        ...(input.maskingSecretStores?.() ?? []),
      ]
    }),
    feedback: createFeedbackPortForHost({
      resolveTrustPriors,
      configPath: input.configPath, agentQaRoot: input.agentQaRoot, randomUuid: randomUUID,
      invokeAuthoringDraftEdit: async draftInput => AuthoringDraftEditOutputSchema.parse(
        await invokeFunction(host.registry, AUTHORING_DRAFT_EDIT_FUNCTION_ID, draftInput, CLI_FUNCTION_CALLER),
      ),
    }),
    resolvePromotionPosture,
    resolveTrustPriors,
    agentQaRoot: input.agentQaRoot,
    mintQuarantineIdentityPath: createQuarantineIdentityMint(input.configPath),
    // 401-05 (D-01/D-07): the default is the in-process policy-gated drive, and since 401-10 it is
    // the ONLY one — `createCliRunExecution`, the child spawn this host used to compose, is deleted
    // rather than merely unreferenced. `input.runExecution` stays the injectable override, which is
    // what cells substitute.
    runExecution: input.runExecution ?? createComposedRunExecution({
      trustPriors,
      configPath: input.configPath,
      agentQaRoot: input.agentQaRoot,
      resolveExecutionContext: input.resolveExecutionContext,
      confirm: doorConfirm,
      ...(input.runBridge === undefined ? {} : { runBridge: input.runBridge }),
    }),
    // D-08 (401-08): forwarded untouched, conditionally spread on this literal's own house rule.
    // Absent leaves `composeLocalAgent` minting its own dispatch scope.
    ...(input.dispatchGrants === undefined ? {} : { dispatchGrants: input.dispatchGrants }),
    // 403 D-03: the live-view mint seam, forwarded untouched on the same house rule.
    ...(input.liveView === undefined ? {} : { liveView: input.liveView }),
    // 405 D-03: the run-detail projection read, forwarded untouched on the same house rule.
    ...(input.runDetail === undefined ? {} : { runDetail: input.runDetail }),
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
    // 395-06 D-07: the undo's source read, bound unconditionally on the same footing — a CLI always
    // has a config path and therefore a repository. It is a SEPARATE binding from `configApply`
    // because the two answer opposite questions (that one writes a commit a person accepted, this
    // one reads a commit somebody already made), and folding a read into the one port through
    // which committed configuration changes would enlarge that write surface for no reason.
    configUndoSource: createConfigUndoSourcePort(input.configPath),
    // 395-08 D-04 · CFGM-05: the shared scaffold content, bound unconditionally. It needs no
    // filesystem and no repository — it is a pure render of the one producer `agent-qa init` writes
    // from — so there is no host posture in which a CLI has it unavailable.
    scaffoldContent: createScaffoldContentPort(),
    // 398 D-09/D-11 · XPLN-02: the catalog port `agent.explain` binds through, constructed HERE
    // and bound unconditionally — a CLI always ships beside the committed capability catalog, so
    // there is no CLI posture in which the capability is genuinely unavailable. Binding it here is
    // what puts `agent.explain` in every cli-hosted composition at once (385 D-15): the REPL, the
    // conformance census caller and the daemon reach one implementation, so "what can you do" has
    // one answer rather than one per surface.
    //
    // THE MODEL IS THE ONE THE CHAT HOST ALREADY RESOLVED, handed through rather than resolved
    // again — CHAT-06's rule, which is why the field is spread from `input.chatModel` instead of
    // calling a resolver. A second construction site would be a model call that skipped the
    // masking middleware and the profile resolution `createModel` owns. Its absence is a real
    // posture and not an unconfigured one: a project with no usable LLM configuration composes a
    // host whose explain cannot cite, so it abstains and SAYS SO, which is the honest answer.
    //
    // 398-10 (D-11/D-18): the counter hooks, bound to the composed port when this host has one.
    //
    // COUNTS ONLY, AND THE PORT'S SHAPE IS WHAT MAKES THAT TRUE RATHER THAN THIS COMMENT.
    // `onAnswered` takes nothing at all — `recordAnswered()` has no parameters, so this host is
    // never told how many rows were cited and cannot report a number nobody counted; the union's
    // `cited_row_count` is optional precisely so the omission is representable. `onAbstained` is
    // handed two values and neither is text: a suggestion count and whether the catalog loaded
    // empty. The QUERY does not reach here and there is no field it could reach — it stays in the
    // local coverage log under `.agent-qa/`, which is the whole of D-11's arrangement.
    capabilityCatalog: createCliCapabilityCatalogPort({
      agentQaRoot: input.agentQaRoot,
      ...(input.chatModel === undefined ? {} : { model: input.chatModel }),
      ...(analytics === undefined ? {} : {
        onAnswered: () => {
          analytics.port.capture(analyticsEvent(analytics, 'agent-qa.explain.answered', {}))
        },
        onAbstained: (counts) => {
          analytics.port.capture(analyticsEvent(analytics, 'agent-qa.explain.abstained', {
            suggested_row_count: counts.suggestedRowCount,
            catalog_empty: counts.catalogEmpty,
          }))
        },
      }),
    }),
    // 395-04 D-09 · CFGM-02: the construction scan's seeds, supplied by the HOST because the
    // environment is a host fact — `composeLocalAgent` is host-neutral and its own D-16 artifact
    // guard reds on a `process.env` read in that package.
    //
    // `sensitiveEnvSlice` AND NOT `process.env`, imported rather than restated. It is the D-05
    // name-based filter `buildRunMaskingContext` already feeds `seedMaskingContext` with, so the
    // values this scan looks for and the values the run masker hides are one set by construction
    // (D-09's sibling-input law). Raw env would seed HOME, PATH and every planner-visible setting,
    // and a config edit whose new value happened to equal one of them would be refused as a secret —
    // so bypassing the filter fails in both directions at once.
    //
    // The run's other two channels — the `SecretStore` and captured auth state — are RUN-SCOPED and
    // do not exist at proposal time. Inventing them here would be inventing facts; the scan's
    // pattern half is what covers shapes nobody seeded.
    configScanSeeds: () => ({ env: sensitiveEnvSlice(process.env) }),
    config: input.config ?? createMaskedConfigReader(input.configPath),
    knowledgeRoot,
    // 400-01 (D-05): forwarded untouched, conditionally spread on this file's own absent-field
    // rule so that a host supplying nothing composes exactly as it did before the option existed.
    ...(input.resolveExecutionContext === undefined
      ? {}
      : { resolveExecutionContext: input.resolveExecutionContext }),
    ...(input.observeSessionEvent === undefined
      ? {}
      : { observeSessionEvent: input.observeSessionEvent }),
    // 400-03, D-04: the session surface tag, conditionally spread on the idiom above so a host
    // that names no surface writes the untagged header every pre-400 file carries.
    ...(input.sessionSurface === undefined ? {} : { sessionSurface: input.sessionSurface }),
    ...(input.mintingSurface === undefined ? {} : { mintingSurface: input.mintingSurface }),
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
    // 422-09 (D-01/D-13/D-14): the proposal stage's capabilities are composed HERE, beside the
    // caller's fold, rather than asked of the caller. Every one of them is a fact about this
    // host — which configuration is in force, which knowledge root is served, which committed
    // corpus the screening is measured against — and a caller that had to supply them would be
    // a second place for the terminal and the daemon to disagree. The caller supplies only what
    // it alone owns: the fold, its prose posture, and the lease it holds while the chain drains.
    ...(input.postRun === undefined
      ? {}
      : {
          postRun: {
            // Named one by one rather than spread: `resolveClaimAuthority` is THIS file's input
            // and not the composition's — it is consumed by the Gate-1 bridge below and must not
            // travel on to a package that has no idea what a writer lease is.
            curateRun: input.postRun.curateRun,
            candidateProse: input.postRun.candidateProse,
            ...misdirectionPostureCapability({ agentQaRoot: input.agentQaRoot }),
            ...proposalStageCapabilities({
              configPath: input.configPath,
              agentQaRoot: input.agentQaRoot,
              resolveKnowledgeRoot: knowledgeRoot,
              resolveTrustPriors,
              resolvePromotionPosture,
              replayGate: sharedReplayGate,
            }),
            proposeGate1MaxPerJob: () => resolveProposeGate1MaxPerJob(input.configPath),
          },
        }),
    ...(input.chatConfirm === undefined ? {} : { chatConfirm: input.chatConfirm }),
    ...(input.chatPresent === undefined ? {} : { chatPresent: input.chatPresent }),
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
    //
    // 396-01 D-09: the resolution reads the FIELD's presence and not its value, which is what lets
    // a host REFUSE the prompt rather than only fail to have one. Under `??` those were the same
    // answer, and for the MCP host they must not be: its stdout is the JSON-RPC channel, so a tty
    // prompt written there does not go unanswered, it breaks every client on the connection. An
    // absent field still defaults to "prompt where there is somebody to prompt".
    ...(doorConfirm === undefined ? {} : { confirm: doorConfirm }),
  })
  return Object.assign(host, { trustPriorDisclosure: trustPriors.disclosure })
}
