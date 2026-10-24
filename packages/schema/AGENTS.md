# agent-qa package instructions: @vostride/agent-qa-schema

Inherit the root `agent-qa/AGENTS.md` branding, security, and release rules.

## Scope

This package is the browserSafe domain kernel for shared contracts, DTOs,
validators, branded IDs, deterministic helpers, platform config types, action
types, result shapes, reader DTOs, and model profile types.

## Read First

- `package.json`
- `src/index.ts`
- `src/ownership-contract.ts`

## Commands

- Test: `pnpm --filter @vostride/agent-qa-schema test`
- Typecheck: `pnpm --filter @vostride/agent-qa-schema typecheck`
- Build: `pnpm --filter @vostride/agent-qa-schema build`

## Local Rules

- Keep this package browserSafe, providerNeutral, and storageNeutral. Do not
  import `node:*`, native stores, host APIs, provider SDK adapters, or local
  runtime persistence packages.
- Runtime dependencies should stay limited to schema/validation needs such as
  Zod unless a dedicated plan changes the contract.
- Public exports should remain shared DTOs, validators, value objects, and pure
  deterministic helpers.
- Do not add runner execution side effects or adapter behavior here.
- Keep contracts serializable and usable by dashboard, runner, agent, model, and
  storage implementation packages.

## Verification

Run focused package checks:

```bash
pnpm --filter @vostride/agent-qa-schema test
pnpm --filter @vostride/agent-qa-schema typecheck
```
