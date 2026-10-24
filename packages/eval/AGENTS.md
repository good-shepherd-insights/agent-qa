# agent-qa package instructions: @vostride/agent-qa-eval

Inherit the root `agent-qa/AGENTS.md` branding, security, and release rules.

## Scope

This package owns provider- and storage-neutral eval contracts plus pure,
deterministic cassette extraction from in-memory run evidence.

## Read First

- `package.json`
- `src/index.ts`
- `src/ownership-contract.ts`
- `src/ports.ts`

## Commands

- Test: `pnpm --filter @vostride/agent-qa-eval test`
- Typecheck: `pnpm --filter @vostride/agent-qa-eval typecheck`
- Build: `pnpm --filter @vostride/agent-qa-eval build`

## Local Rules

- Keep this package browserSafe, providerNeutral, and storageNeutral. All host
  IO belongs behind ports implemented by `@vostride/agent-qa-eval-local`.
- Keep provider invocation, agent planning, platform execution, and scoring
  policy out of this package.
- Treat recorded tool exchanges as opaque evidence. Never interpret or execute
  their model-authored contents.
- The module-discipline test scans every non-test source file textually: avoid
  host APIs, nondeterministic clocks, and host hashing APIs even in comments.
- Use extension-less relative imports. Cassette timestamps must come from
  persisted handoff evidence and must never be minted during extraction.

## Verification

Run focused package checks:

```bash
pnpm --filter @vostride/agent-qa-eval test
pnpm --filter @vostride/agent-qa-eval typecheck
pnpm --filter @vostride/agent-qa-eval build
```
