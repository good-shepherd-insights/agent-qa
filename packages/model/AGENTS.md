# agent-qa package instructions: @vostride/agent-qa-model

Inherit the root `agent-qa/AGENTS.md` branding, security, and release rules.

## Scope

This package is the sole modelOwner. It owns provider SDK adapters, provider
registry resolution, compatible-provider transport, model validation,
capability-aware profile resolution, and the central BYOM-reliability language
model middleware stack.

## Read First

- `package.json`
- `src/index.ts`
- `src/registry.ts`
- `src/middleware.ts`
- `src/ownership-contract.ts`

## Commands

- Test: `pnpm --filter @vostride/agent-qa-model test`
- Typecheck: `pnpm --filter @vostride/agent-qa-model typecheck`
- Build: `pnpm --filter @vostride/agent-qa-model build`

## Local Rules

- Keep `@ai-sdk/*` provider adapters in this package. Neutral packages must not
  import those adapters directly.
- Keep `createModel` as the central composition point for provider registry,
  transport derivation, capability resolution, validation, and middleware.
- Preserve middleware idempotency. Planner and verifier callers should be able
  to consume a centrally wrapped model without applying duplicate wrappers.
- Keep filesystem, database, process, runner side effects, and local runtime
  persistence out of this package.
- Export model-facing contracts through the package root without leaking private
  ownership metadata.

## Verification

Run focused package checks:

```bash
pnpm --filter @vostride/agent-qa-model test
pnpm --filter @vostride/agent-qa-model typecheck
```
