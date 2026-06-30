# agent-qa package instructions: @vostride/agent-qa-knowledge-local

Inherit the root `agent-qa/AGENTS.md` branding, security, and release rules.

## Scope

This package is the storageImplementation home for the local memidex knowledge
store. It binds the agent `KnowledgePort` write seam and runner
`KnowledgeHintReader` read seam to future concrete local storage adapters.

## Read First

- `package.json`
- `src/index.ts`
- `src/ownership-contract.ts`

## Commands

- Test: `pnpm --filter @vostride/agent-qa-knowledge-local test`
- Typecheck: `pnpm --filter @vostride/agent-qa-knowledge-local typecheck`
- Build: `pnpm --filter @vostride/agent-qa-knowledge-local build`

## Local Rules

- Depend on neutral `@vostride/agent-qa-agent` and
  `@vostride/agent-qa-runner` ports; never push local storage dependencies back
  into those neutral packages.
- Keep the read face aligned with `KnowledgeHintReader` and the write face
  aligned with `KnowledgePort`.
- Do not add memidex, index, filesystem, or sqlite implementation code until the
  milestone that fills the local knowledge store.
- Keep provider invocation, platform execution, and agent planning semantics out
  of this package.
- Keep knowledge writes local to this storageImplementation package or the
  abstract agent port; runner-facing code remains read-only.

## Verification

Run focused package checks:

```bash
pnpm --filter @vostride/agent-qa-knowledge-local test
pnpm --filter @vostride/agent-qa-knowledge-local typecheck
```
