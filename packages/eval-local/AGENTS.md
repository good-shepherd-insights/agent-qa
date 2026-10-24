# agent-qa package instructions: @vostride/agent-qa-eval-local

Inherit the root `agent-qa/AGENTS.md` branding, security, and release rules.

## Scope

This package is the storageImplementation home for local eval filesystem IO. It
binds eval read ports and owns cassette bundle writes under runtime workdirs.

## Read First

- `package.json`
- `src/index.ts`
- `src/ownership-contract.ts`

## Commands

- Test: `pnpm --filter @vostride/agent-qa-eval-local test`
- Typecheck: `pnpm --filter @vostride/agent-qa-eval-local typecheck`
- Build: `pnpm --filter @vostride/agent-qa-eval-local build`

## Local Rules

- Implement neutral `@vostride/agent-qa-eval` ports without pushing host or
  storage dependencies back into eval core.
- Keep every eval filesystem read and write in this storageImplementation
  package.
- Keep provider invocation, agent planning, platform-adapter execution,
  extraction, scoring, and projection logic out of this package.
- Declare runner-local or schema dependencies only with their first real import;
  package metadata, ownership metadata, and source imports must stay exact-set.

## Verification

Run focused package checks:

```bash
pnpm --filter @vostride/agent-qa-eval-local test
pnpm --filter @vostride/agent-qa-eval-local typecheck
pnpm --filter @vostride/agent-qa-eval-local build
```
