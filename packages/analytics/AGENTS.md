# agent-qa package instructions: @vostride/agent-qa-analytics

Inherit the root `agent-qa/AGENTS.md` branding, security, and release rules.

## Scope

This package is the product-analytics home. It owns the `AnalyticsPort` and
`AnalyticsTransport` interfaces, the closed typed event union, the noop and
PostHog transports, and `composeAnalytics` — the one place the opt-out decision
is made. Hosts bind it at their composition roots; the agent's function layer
never sees it.

## Read First

- `package.json`
- `src/index.ts`
- `src/compose.ts`
- `src/events.ts`
- `src/port.ts`

## Commands

- Test: `pnpm --filter @vostride/agent-qa-analytics test`
- Typecheck: `pnpm --filter @vostride/agent-qa-analytics typecheck`
- Build: `pnpm --filter @vostride/agent-qa-analytics build`

## Local Rules

- The opt-out decision is resolved exactly ONCE, in `composeAnalytics`. No other
  module in this package may read the environment, and no transport may be
  constructed before that decision. Opted out means the PostHog client is never
  constructed at all — not that a live client declines to send.
- No free-text event fields. Every string in every member of the event union
  draws from `z.enum`, `z.literal`, or a tagged known-id codec, and
  `assertNoUnconstrainedStrings` refuses anything else at test time.
- No module-level service state. There is no ambient `getAnalyticsService`
  equivalent here and there must not be one: a singleton is what let the v1
  module carry a privacy decision made by whichever caller happened to be first.
- Analytics is best-effort at the port boundary and never throws into the host.

## Verification

Run focused package checks:

```bash
pnpm --filter @vostride/agent-qa-analytics test
pnpm --filter @vostride/agent-qa-analytics typecheck
```
