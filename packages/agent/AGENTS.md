# agent-qa package instructions: @vostride/agent-qa-agent

Inherit the root `agent-qa/AGENTS.md` branding, security, and release rules.

## Scope

This package owns provider-neutral and storage-neutral agent port contracts for
knowledge curation, tool execution, agent persistence, approvals, and clock
access. It defines abstract seams consumed by storage implementations and must
not contain concrete runtime adapters.

## Read First

- `package.json`
- `src/index.ts`
- `src/ownership-contract.ts`
- `src/ports/knowledge.ts`
- `src/ports/tools.ts`
- `src/ports/persistence.ts`
- `src/ports/approvals.ts`
- `src/ports/clock.ts`

## Commands

- Test: `pnpm --filter @vostride/agent-qa-agent test`
- Typecheck: `pnpm --filter @vostride/agent-qa-agent typecheck`
- Build: `pnpm --filter @vostride/agent-qa-agent build`

## Local Rules

- Keep this package providerNeutral and storageNeutral. Do not import model SDKs,
  filesystem APIs, database clients, process APIs, or concrete local adapters.
- Depend only on shared schema types and private architecture metadata needed by
  the ownership contract.
- Keep `src/index.ts` as a type-only public port barrel. Do not export local
  implementations or runtime factories from this package.
- Knowledge writes belong to `KnowledgePort` as an abstract agent seam; concrete
  knowledge storage belongs in a storageImplementation package.
- Preserve the direction boundary: local packages may depend on these ports, but
  these ports must not depend on local packages.

## Verification

Run focused package checks:

```bash
pnpm --filter @vostride/agent-qa-agent test
pnpm --filter @vostride/agent-qa-agent typecheck
```
