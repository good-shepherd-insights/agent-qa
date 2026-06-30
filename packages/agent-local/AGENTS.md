# agent-qa package instructions: @vostride/agent-qa-agent-local

Inherit the root `agent-qa/AGENTS.md` branding, security, and release rules.

## Scope

This package is the storageImplementation home for local agent persistence
stores behind the neutral `PersistencePort`. It is currently a shell for future
M4 implementation work and should expose only the local persistence adapter
surface needed by that milestone.

## Read First

- `package.json`
- `src/index.ts`
- `src/ownership-contract.ts`

## Commands

- Test: `pnpm --filter @vostride/agent-qa-agent-local test`
- Typecheck: `pnpm --filter @vostride/agent-qa-agent-local typecheck`
- Build: `pnpm --filter @vostride/agent-qa-agent-local build`

## Local Rules

- Depend on `@vostride/agent-qa-agent` for neutral ports; never make the neutral
  agent package depend back on this local package.
- Keep agent decision-making, planning, and knowledge curation semantics out of
  this package. It owns local persistence storage only.
- Do not add concrete store code until the milestone that fills the local agent
  persistence implementation.
- Keep any future filesystem or sqlite access confined behind the persistence
  port and out of provider-neutral packages.
- Do not import model provider SDKs or platform adapters here.

## Verification

Run focused package checks:

```bash
pnpm --filter @vostride/agent-qa-agent-local test
pnpm --filter @vostride/agent-qa-agent-local typecheck
```
