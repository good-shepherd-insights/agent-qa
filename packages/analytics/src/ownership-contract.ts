import type { OwnershipContract } from '@vostride/agent-qa-arch'

export const AGENT_QA_ANALYTICS_PACKAGE_NAME = '@vostride/agent-qa-analytics'
export const AGENT_QA_ANALYTICS_PACKAGE_DIR = 'packages/analytics'
// 2026-08-17 (Phase 398 plan 03, D-17). `adapter` and nothing else. It is not `surface`: a surface
// is an invocation door with dispatch, policy and gate verdicts, and this package answers no
// request — hosts call INTO it. It is not `browserSafe`/`storageNeutral`/`providerNeutral` either,
// because the whole point of the boundary is that the one place holding a live network client to a
// third party sits inside a named wall rather than scattered through a host.
export const AGENT_QA_ANALYTICS_PACKAGE_CLASSES = ['adapter'] as const
// 2026-08-17 (Phase 398 plan 03, D-17 / ANLY-01). The v1 module this replaces had no stated
// responsibilities at all — it was a folder inside `core`, which is exactly how it acquired a
// module-level singleton, a privacy decision made inside `capture()`, and `.strip()` schemas that
// admitted free text. Each line below is one of those defects restated as something this package
// owns rather than something a reviewer has to notice.
export const AGENT_QA_ANALYTICS_ALLOWED_RESPONSIBILITIES = [
  'the product-analytics port and its transports: the `AnalyticsPort`/`AnalyticsTransport` split, '
    + 'the noop and PostHog transports behind it, and the best-effort boundary that keeps a '
    + 'telemetry failure from reaching the host',
  'the closed typed event union: which events exist, what each one carries, and the range guard '
    + 'that refuses an unconstrained string field',
  'the opt-out decision: resolving DO_NOT_TRACK or the config privacy flag ONCE, at composition, '
    + 'to a transport — never inside a send path',
  'masking composed at the send seam, before any serialization-dependent matching',
] as const
// The forbidden lines are the three v1 defects and the one boundary that keeps this package a host
// concern. `no function-layer imports` is the load-bearing one: analytics is something a HOST does
// with the result of a call, never something the agent's function layer can reach, or every op
// would acquire a telemetry side effect the gate never sees.
export const AGENT_QA_ANALYTICS_FORBIDDEN_RESPONSIBILITIES = [
  'reaching the agent function layer or any op: this is a host concern, bound at a composition '
    + 'root, and an op that could emit telemetry would be a side effect the gate never sees',
  'any free-text event field: a string that does not draw from an enum, a literal or a known-id '
    + 'codec is an exfiltration channel, and the range guard exists so that is unrepresentable '
    + 'rather than reviewed',
  'ambient singletons or module-level service state: the v1 module cached one service whose '
    + 'privacy decision belonged to whichever caller constructed it first',
  'a second opt-out decision site: any environment read outside `compose.ts`, or any transport '
    + 'constructed before the decision, re-opens the bypass D-19 closes structurally',
] as const
// 2026-08-17 (Phase 398 plan 03). `posthog-node` is PINNED at 5.33.2 and moves here from
// `packages/core` with no version change — the dependency is the same bytes already in the
// lockfile, relocated between workspace members. A bump is a separate reviewed diff, not a
// side effect of a re-derivation. It leaves core's host baseline in plan 11, with the deletion,
// so `validate:arch` reds on any straggler import at exactly the moment there is a straggler.
// `zod` is the vocabulary the closed event union is written in; it is not a validator of
// convenience here, it IS the no-free-text mechanism.
export const AGENT_QA_ANALYTICS_EXTERNAL_DEPENDENCIES = [
  'posthog-node',
] as const
// Deliberately empty at plan 03. Every entry this list will ever carry is checked against the
// package's real imports by `findDepReconciliationOffenders`, so a dependency declared in
// anticipation of a later plan is an offender, not a placeholder. `@vostride/agent-qa-safety`
// arrives with the masking seam (plan 06); `@vostride/agent-qa-mcp` and `@vostride/agent-qa-ids`
// arrive with the event union's tool-name enum and known-id codecs (plan 03 task 3).
export const AGENT_QA_ANALYTICS_INTERNAL_DEPENDENCIES = [] as const

export const AGENT_QA_ANALYTICS_OWNERSHIP_CONTRACT = {
  packageName: AGENT_QA_ANALYTICS_PACKAGE_NAME,
  packageDir: AGENT_QA_ANALYTICS_PACKAGE_DIR,
  packageClasses: AGENT_QA_ANALYTICS_PACKAGE_CLASSES,
  allowedResponsibilities: AGENT_QA_ANALYTICS_ALLOWED_RESPONSIBILITIES,
  forbiddenResponsibilities: AGENT_QA_ANALYTICS_FORBIDDEN_RESPONSIBILITIES,
  externalDependencies: AGENT_QA_ANALYTICS_EXTERNAL_DEPENDENCIES,
  internalDependencies: AGENT_QA_ANALYTICS_INTERNAL_DEPENDENCIES,
} as const satisfies OwnershipContract
