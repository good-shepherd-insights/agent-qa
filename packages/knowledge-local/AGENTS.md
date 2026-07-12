# agent-qa package instructions: @vostride/agent-qa-knowledge-local

Inherit the root `agent-qa/AGENTS.md` branding, security, and release rules.

## Scope

This package implements the local memidex bundle store. Phase 374 establishes
the event-sourced bundle substrate beneath the agent and runner ports.

## Read First

- `package.json`
- `src/index.ts`
- `src/ownership-contract.ts`
- `src/bundle-egress.ts`
- `src/artifact-copy.ts`
- `src/bundle-publish.ts` (later Phase 374 plan)
- `src/bundle-append.ts` (later Phase 374 plan)
- `src/bundle-read.ts` (later Phase 374 plan)

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
- Route every committed knowledge-root text write through the bundle-egress
  checkpoint before bytes reach the tree (KDIR-02).
- Rewrite mutable committed files through a same-directory temp file and atomic
  rename; never use filesystem append APIs for committed bundle state.
- This package does not implement `KnowledgePort`: the Phase 374 API is the
  bundle-store layer beneath it, and `LocalKnowledgeStore` remains a type alias
  until Phase 378 (D-04).
- Keep sqlite and derived-index code out until Phase 375.
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
