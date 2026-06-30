# agent-qa package instructions: @vostride/agent-qa-runner

Inherit the root `agent-qa/AGENTS.md` branding, security, and release rules.

## Scope

This package owns provider-neutral and storage-neutral runner contracts:
`PlatformAdapter`, platform action projections, run result and trace DTOs, and
the read-only `KnowledgeHintReader` contract used by runner execution.

## Read First

- `package.json`
- `src/index.ts`
- `src/platform.ts`
- `src/knowledge-hint-reader.ts`
- `src/result.ts`
- `src/ownership-contract.ts`

## Commands

- Test: `pnpm --filter @vostride/agent-qa-runner test`
- Typecheck: `pnpm --filter @vostride/agent-qa-runner typecheck`
- Build: `pnpm --filter @vostride/agent-qa-runner build`

## Local Rules

- Keep this package providerNeutral and storageNeutral. Do not import model SDKs,
  filesystem APIs, database clients, process APIs, or concrete platform/store
  implementations.
- `PlatformAdapter` is a port contract only; concrete adapters live in web,
  Android, iOS, or future implementation packages.
- `KnowledgeHintReader` must remain read-only except for the allowed canary
  outcome append seam. Do not add knowledge write methods here.
- Keep run result, trace, and platform types serializable at the contract level
  and avoid ownership of persistence behavior.
- Preserve dependency direction: implementation packages may depend on runner
  contracts, but runner must not depend on implementation packages.

## Verification

Run focused package checks:

```bash
pnpm --filter @vostride/agent-qa-runner test
pnpm --filter @vostride/agent-qa-runner typecheck
```
