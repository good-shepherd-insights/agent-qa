// The ONE place the post-run tail's option literal is spelled (Phase 404 plan 04, D-06).
//
// WHY IT EXISTS. `runPostRunTail` takes eleven fields, and until now the literal that fills them
// was written twice — once at each of `commands/run.ts`'s two tail sites — with `agentQaRoot` and
// `configPath` derived by hand at both. That was tolerable while ONE command had a tail. D-06 gives
// the `runs.start` door (dashboard, MCP, chat) a drain leg of its own, which would have made three
// spellings of "how this project's tail is composed" — and the way three spellings fail is not that
// one is wrong on the day it is written, but that a field added to the tail reaches two of them.
//
// A COMPOSITION, NOT A POLICY. Everything here is either handed in or DERIVED from something handed
// in; nothing is chosen. The two derivations are the two every caller was doing anyway:
// `agentQaRoot` is `<configDir>/.agent-qa` and `configPath` is the resolved config file. The one
// default — the guardrail policy — is the expression both `run.ts` sites already used, reached
// through `curation-tail.ts` because that is the file ledgered to name the gate package (see
// `defaultPostRunGuardrailPolicy`).
//
// WHAT IT DOES NOT DO. It does not drain, finish, or decide who pumps. It hands back the SAME
// `PostRunTailHandle` the tail has always returned, and the caller drives its two legs — because
// which legs run is the caller's knowledge: `commands/run.ts` gates the drain on `--detach` through
// `runVerdictFirstCurationTail`, and the `runs.start` door gates it on whether the post-verdict
// step's lease was actually takeable.
//
// Import discipline (FUNC-02): a file written today may name only `agent`, `agent-local`,
// `analytics` and `schema` across package boundaries, and the ledger only ever shrinks. This file
// names `schema` for two types and nothing else; the guardrail policy, the audit sink type and the
// masking context all arrive through relative modules that are already ledgered for them.

import { createCanaryAblationForHost } from '../gates/canary-ablation-host.js'
import { resolve } from 'node:path'

import type { RunEventEnvelope } from '@vostride/agent-qa-schema'

import {
  defaultPostRunGuardrailPolicy,
  type RunCurationTailOptions,
} from './curation-tail.js'
import {
  runPostRunTail,
  type PostRunEnqueueOutcome,
  type PostRunTailHandle,
  type PostRunTailOperations,
} from './post-run-tail.js'

/**
 * What a host has to answer to get this project's post-run tail.
 *
 * `configDir` and `configFilePath` rather than `agentQaRoot`/`configPath`: those two are the facts
 * a door actually holds (the drive hands both to `afterVerdict` as `CliRunVerdictContext`), and the
 * roots below are derived from them here so no caller derives them again.
 */
export interface ComposeCliPostRunTailInput {
  readonly maxAblations?: number
  readonly canaryAblation?: import('./canary-credit.js').CanaryAblation
  readonly runId: string
  /** The directory the project's config file lives in. `<configDir>/.agent-qa` is derived from it. */
  readonly configDir: string
  /** The project's resolved config file. */
  readonly configFilePath: string
  readonly knowledgeConfig: RunCurationTailOptions['knowledgeConfig']
  readonly auditSink: RunCurationTailOptions['auditSink']
  /**
   * The RUN's masking context, when the caller has one.
   *
   * Conditionally spread rather than passed as `undefined`, because the tail DERIVES its candidate-
   * prose posture from this field's PRESENCE (388-10, UF-388-01): a tail composed without one
   * declares `no-masker` and may not claim `curate-memory` at all. An `undefined` written into the
   * field would be indistinguishable from a masker at the type level and identical at runtime, but
   * the conditional spread is the house rule every sibling literal follows and the one that keeps
   * "absent means absent" true everywhere.
   */
  readonly maskingContext?: RunCurationTailOptions['maskingContext']
  readonly modelDeps?: RunCurationTailOptions['modelDeps']
  /** A caller's own policy. Absent ⇒ `defaultPostRunGuardrailPolicy()`, the shipped expression. */
  readonly policy?: RunCurationTailOptions['policy']
  readonly signal?: RunCurationTailOptions['signal']
  readonly log: RunCurationTailOptions['log']
  /** What the shell's post-verdict step reported about the durable hand-off (404 D-05). */
  readonly enqueueOutcome?: PostRunEnqueueOutcome
  /**
   * The dashboard's SECOND chip sink (404 D-16), threaded through to the emitter in 404-05.
   *
   * Accepted here now rather than later so the emitter side is the only thing 404-05 has to fill:
   * a field added on the emitter alone would leave this composition — the one place every host's
   * tail is spelled — unable to name it, and the alternative is a second literal somewhere.
   */
  readonly relay?: (envelope: RunEventEnvelope) => void
  /** Focused test seam. Production callers omit it. */
  readonly operations?: Partial<PostRunTailOperations>
}

/**
 * Compose this project's post-run tail. Every host calls exactly this.
 */
export function composeCliPostRunTail(input: ComposeCliPostRunTailInput): PostRunTailHandle {
  return runPostRunTail({
    ...(input.maxAblations === undefined ? {} : { maxAblations: input.maxAblations }),
    canaryAblation: input.canaryAblation ?? createCanaryAblationForHost({
      configPath: resolve(input.configFilePath), agentQaRoot: resolve(input.configDir, '.agent-qa'),
      ...(input.maxAblations === undefined ? {} : { maxAblations: input.maxAblations }),
    }),
    runId: input.runId,
    agentQaRoot: resolve(input.configDir, '.agent-qa'),
    configPath: resolve(input.configFilePath),
    knowledgeConfig: input.knowledgeConfig,
    configDir: input.configDir,
    auditSink: input.auditSink,
    policy: input.policy ?? defaultPostRunGuardrailPolicy(),
    log: input.log,
    ...(input.maskingContext === undefined ? {} : { maskingContext: input.maskingContext }),
    ...(input.modelDeps === undefined ? {} : { modelDeps: input.modelDeps }),
    ...(input.signal === undefined ? {} : { signal: input.signal }),
    ...(input.enqueueOutcome === undefined ? {} : { enqueueOutcome: input.enqueueOutcome }),
    ...(input.relay === undefined ? {} : { relay: input.relay }),
    ...(input.operations === undefined ? {} : { operations: input.operations }),
  })
}
