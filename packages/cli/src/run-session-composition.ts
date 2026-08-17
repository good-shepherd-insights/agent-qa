// What is left of the CLI run-session composition after the D-13 dissection (Phase 385 plan 08).
//
// Until this phase this module was 1035 lines and held the whole composition. The host-neutral
// majority now lives in the local agent package's composition subtree, beside where every other
// host will reach it, and this file holds ONLY the part that a terminal is required to run: the
// reporter attachment, the live-line seam those reporters own, the human-output unmasking confirm
// decorator, and the readline default the CLI — and only the CLI — is entitled to assume.
//
// There is deliberately NO compatibility re-export here. A module that re-published the moved
// symbols would let every call site keep naming this path, and then nothing would have moved except
// some text: the carve-out would be measuring a fiction. Consumers name the composition package
// directly, and `run-composition.test.ts` pins this file's export set so a shim cannot creep back.
//
// The dissection rule itself is written down once, in the composition package's presentation-ports
// module. Everything below is on the presentation side of it because a headless drainer would have
// to substitute something else for each one.

import { unmaskForHumanOutput } from '@vostride/agent-qa-safety'
import type { AuditSink, ConfirmPort, SafetyHookRunner } from '@vostride/agent-qa-safety'
import type { QuarantineAppliedEntry } from '@vostride/agent-qa-schema'
import { createReadlineConfirm } from '@vostride/agent-qa-safety-local'
import { buildRunSessionSafetyHooks } from '@vostride/agent-qa-agent-local'
import type {
  AttachableRunSession,
  LivePauseController,
  RunExecutionContext,
  RunMaskingContext,
  RunSubscriberHandle,
} from '@vostride/agent-qa-agent-local'
import { createAnalyticsRunSubscriber } from '@vostride/agent-qa-analytics'
import type { CliAnalyticsHost } from './composition/analytics-host.js'
import {
  createConsoleReporter,
  createJunitReporter,
  createWireReporter,
} from './reporters/index.js'
import type {
  ConsoleReporterHandle,
  ConsoleReporterOptions,
  JunitReporterHandle,
} from './reporters/index.js'

// The bus assigns sequence numbers from 1 (seq 0 never exists). Subscribing at seq 1 replays every
// retained event then goes live — a subscribe(0) would demand a seq-0 prefix the log can never supply
// and raise ReplayIncompleteError (bus.ts collectReplay/D-07). This is the full replay-then-live floor.
const REPLAY_FROM_START = 1

/**
 * The console pause/resume seam shared between the console reporter (attached at the startRun site)
 * and the D-11 confirm decorator. `bind` is called by `attachRunSubscribers` once the console
 * reporter exists; the confirm decorator reads through the live target at call time. Guards swallow
 * their own errors so a reporter fault never blocks a prompt.
 *
 * The TYPE is host-neutral vocabulary and lives in the composition package. This factory does not:
 * it exists to hold a console reporter handle, and a host with no console has nothing to bind.
 */
export function createLivePauseController(): LivePauseController {
  let active: { pauseLive(): void; resumeLive(): void } | undefined
  return {
    pauseLive() {
      try { active?.pauseLive() } catch { /* a reporter fault must never block a live prompt */ }
    },
    resumeLive() {
      try { active?.resumeLive() } catch { /* ditto */ }
    },
    bind(handle) {
      active = handle ?? undefined
    },
  }
}

/**
 * Wrap a base `ConfirmPort` with the D-11 human-output unmasking decorator (Pitfall 4). Before
 * delegating it (1) pauses the console reporter's live TTY line so the readline question is not
 * clobbered, (2) applies EXACTLY ONE `unmaskForHumanOutput` call on the final rendered prompt text
 * (the ask-tier prompt is `Proceed with <action.name>? …`, so `name` is the only human-visible
 * placeholder-bearing field) and delegates with a display-only action carrying the unmasked name,
 * and (3) resumes the live line on answer. The ORIGINAL masked action is never mutated — the gate
 * records the deny/allow decision MASKED (T-363-21). No unmasked value is retained beyond the call.
 *
 * Presentation by the dissection rule, and not a close call: restoring a secret to its real value
 * is only ever correct because a human is about to read it. A headless host doing this would be an
 * information-disclosure regression, not a feature it inherited.
 */
export function buildUnmaskingConfirm(input: {
  base: ConfirmPort
  maskingContext: RunMaskingContext
  live?: LivePauseController
}): ConfirmPort {
  return async (action) => {
    input.live?.pauseLive()
    try {
      const displayName = unmaskForHumanOutput(input.maskingContext, action.name)
      const displayAction = displayName === action.name ? action : { ...action, name: displayName }
      return await input.base(displayAction)
    } finally {
      input.live?.resumeLive()
    }
  }
}

/**
 * The CLI's assembly of the per-run safety hooks. It supplies the two things the host-neutral
 * registrar refuses to assume — a confirm channel (readline unless the caller injects one, D-15)
 * and the human-output unmasking decorator over it (D-11) — and then delegates. The signature is
 * unchanged from before the dissection, so both startRun sites and the eval path call it exactly as
 * they did; what moved is the registration underneath.
 *
 * The unmask decorator is handed over as the human-decoration hook rather than applied here, so it
 * still composes OVER the composition's pause-timing decorator exactly as it did before the
 * dissection — timing measures the human's deliberation, not the unmask call.
 */
export function buildRunSafetyHooks(input: {
  auditSink: AuditSink
  executionContext: RunExecutionContext
  trustMode: boolean
  confirm?: ConfirmPort
  /** The run MaskingContext — when supplied, the ask-tier prompt is unmasked for the human (D-11). */
  maskingContext?: RunMaskingContext
  /** Console pause/resume seam so the live TTY line is flushed around the readline question (Pitfall 4). */
  live?: LivePauseController
}): { safetyHooks: SafetyHookRunner; confirmPausedMs: () => number } {
  const maskingContext = input.maskingContext
  return buildRunSessionSafetyHooks({
    auditSink: input.auditSink,
    executionContext: input.executionContext,
    trustMode: input.trustMode,
    presentation: {
      confirm: input.confirm ?? createReadlineConfirm(),
      decorateConfirmForHuman: maskingContext
        ? (timedConfirm) => buildUnmaskingConfirm({ base: timedConfirm, maskingContext, live: input.live })
        : undefined,
    },
  })
}

/**
 * The run-completion analytics subscriber, built from the host's composed port (398-10, D-17/D-20).
 *
 * IT LIVES HERE, BESIDE `attachRunSubscribers`, FOR THE REASON THAT HELPER DOES: `run.ts` has two
 * `startRun` sites (Pitfall 8) and a subscriber constructed separately at each is a subscriber that
 * can be configured differently at each. One factory, both sites.
 *
 * WHAT MOVED IN THE REWIRE, and it is only the wiring: the subscriber now comes from
 * `@vostride/agent-qa-analytics` rather than `@vostride/agent-qa-core`, and it is handed a PORT the
 * command composed instead of a `config` it would consult itself. The bus-facing shape —
 * `{ handler, flush }` — is byte-for-byte the one `attachRunSubscribers` already subscribes.
 *
 * THREE FACTS THE V1 SUBSCRIBER READ FOR ITSELF ARE PASSED IN NOW. The trigger source and the
 * runner came from `AGENT_QA_RUN_ATTRIBUTES_JSON`, parsed inside a module a run drives; they are
 * facts about how this process was started, so the caller — which resolved those attributes to put
 * them on the run in the first place — states them. The privacy posture came from a second read of
 * the config; it is now expressed by which transport the composed port holds.
 */
export function buildAnalyticsRunSubscriber(input: {
  /** The invocation's composed analytics. Opted out ⇒ this subscriber emits into a noop transport. */
  analytics: CliAnalyticsHost
  /** `agent-qa.trigger` off the resolved run attributes. Anything unrecognised normalises to `unknown`. */
  triggerSource?: string
  /** `agent-qa.runner` off the same attributes, on the same normalisation. */
  runner?: string
}): RunSubscriberHandle {
  return createAnalyticsRunSubscriber({
    port: input.analytics.port,
    standardProperties: input.analytics.properties,
    ...(input.triggerSource === undefined ? {} : { triggerSource: input.triggerSource }),
    ...(input.runner === undefined ? {} : { runner: input.runner }),
  })
}

export interface AttachRunSubscribersInput {
  session: AttachableRunSession
  /** The run MaskingContext — the console reporter's sole unmasking authority (SEAM-05). */
  maskingContext: RunMaskingContext
  /** Console reporter options, or `false` to skip the console surface for this run. */
  console?: ConsoleReporterOptions | false
  /** JUnit output path — when set, the masked durable JUnit subscriber is attached and flushed. */
  junitOutputPath?: string
  /** Prebuilt out-of-package subscribers (dashboard ingest, analytics) constructed by run.ts. */
  extraSubscribers?: readonly RunSubscriberHandle[]
  /** Console pause/resume seam bound here so the D-11 confirm decorator can coordinate. */
  live?: LivePauseController
  /**
   * The run-start quarantine snapshot (390 D-15/D-16) — the SAME resolved set `startRun` was given.
   *
   * It arrives here rather than on the bus because this is the one place either reporter is
   * constructed (Pitfall 8), so this is the one place the disposition can be dropped. Both surfaces
   * receive it; both match through schema's single predicate.
   */
  quarantined?: readonly QuarantineAppliedEntry[]
}

/**
 * Attach the run's bus subscribers at a startRun site (used by BOTH sites — Pitfall 8). Constructs
 * the CLI-owned reporters (console unmasks; junit + wire stay masked, wire env-gated internally),
 * subscribes each via `session.subscribe(REPLAY_FROM_START, …)` alongside any `extraSubscribers`
 * (dashboard/analytics), binds the console pause/resume seam to the live controller, and returns a
 * single `flush()` awaiting every subscriber's flush (JUnit write, dashboard finalize, analytics
 * drain) — the CLI awaits this after `session.done` before mapping the verdict to the exit code.
 *
 * This is the clearest presentation symbol in the file: three of the four things it constructs
 * render for a human, and a daemon would attach its own subscribers over the same vocabulary
 * instead of inheriting these.
 */
export function attachRunSubscribers(input: AttachRunSubscribersInput): { flush: () => Promise<void> } {
  const flushes: Array<() => Promise<void>> = []

  const quarantined = input.quarantined

  let consoleHandle: ConsoleReporterHandle | undefined
  if (input.console !== false) {
    consoleHandle = createConsoleReporter(input.maskingContext, {
      ...(input.console ?? {}),
      ...(quarantined === undefined ? {} : { quarantined }),
    })
    input.session.subscribe(REPLAY_FROM_START, consoleHandle.handler)
    flushes.push(consoleHandle.flush)
  }
  // Bind (or clear) the console pause/resume seam the D-11 confirm decorator reads through.
  input.live?.bind(consoleHandle)

  if (input.junitOutputPath) {
    const junit: JunitReporterHandle = createJunitReporter({
      outputPath: input.junitOutputPath,
      ...(quarantined === undefined ? {} : { quarantined }),
    })
    input.session.subscribe(REPLAY_FROM_START, junit.handler)
    flushes.push(junit.flush)
  }

  // Wire is AGENT_QA_LIVE_EVENTS-gated internally; always attach (no flush — synchronous printer).
  const wire = createWireReporter()
  input.session.subscribe(REPLAY_FROM_START, wire.handler)

  for (const sub of input.extraSubscribers ?? []) {
    input.session.subscribe(REPLAY_FROM_START, sub.handler)
    if (sub.flush) flushes.push(sub.flush)
  }

  return {
    // `allSettled`: every subscriber's flush runs to completion and a single fault (a best-effort
    // analytics/dashboard write) never aborts the others or the run (D-08 detach-on-error philosophy,
    // RUNX-03). All flushes complete BEFORE the caller maps the verdict / exits (Pitfall 6/8).
    async flush(): Promise<void> {
      await Promise.allSettled(flushes.map((f) => f()))
    },
  }
}
