# agent-qa package instructions: @vostride/agent-qa-runner-local

Inherit the root `agent-qa/AGENTS.md` branding, security, and release rules.

## Scope

This package is the host-adapter home for the runner action-plan cache. It owns
the host APIs the storage-neutral `@vostride/agent-qa-runner` package deliberately
excludes: the concrete filesystem `FsActionCache` store behind the runner
`ActionPlanCache` port, git-branch detection for cache namespacing, and branch
write-skip policy evaluation. Planned key exports (Plan 05): `FsActionCache`,
`resolveBranch`, `shouldWrite`. The barrel is intentionally empty until Plan 05
fills it.

## Read First

- `package.json`
- `src/index.ts`
- `src/ownership-contract.ts`

## Commands

- Test: `pnpm --filter @vostride/agent-qa-runner-local test`
- Typecheck: `pnpm --filter @vostride/agent-qa-runner-local typecheck`
- Build: `pnpm --filter @vostride/agent-qa-runner-local build`

## Local Rules

- This is the ONLY place host APIs bind to the runner cache: `fs`, `process`,
  and git detection live here, never in `@vostride/agent-qa-runner`.
- Enforce the direction firewall: runner-local depends on runner and never the
  reverse. The storage-neutral runner defines the `ActionPlanCache` port; the
  concrete host store lands here.
- Keep `FsActionCache` the filesystem implementation of the neutral
  `ActionPlanCache` port defined in runner; do not push host details upstream.
- Cache-key assembly, hashing, and cacheable/non-cacheable classification are
  NOT this package's job — they live in `@vostride/agent-qa-runner`.
- Export host adapters through the package root; do not leak private file or
  process handles.

## Verification

Run focused package checks:

```bash
pnpm --filter @vostride/agent-qa-runner-local test
pnpm --filter @vostride/agent-qa-runner-local typecheck
```
