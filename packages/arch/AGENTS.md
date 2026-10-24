# agent-qa package instructions: @vostride/agent-qa-arch

Inherit the root `agent-qa/AGENTS.md` branding, security, and release rules.

## Scope

This private utility package owns the architecture-as-code vocabulary, manifest,
and `validate:arch` lint engine. It enforces package class rules, dependency
direction, knowledge-write firewalls, native-store/provider denylist checks, and
the transitional core ratchet baseline.

## Read First

- `package.json`
- `src/index.ts`
- `src/manifest.ts`
- `src/contract-types.ts`
- `src/lint/classify-rule.ts`
- `src/lint/apply-ledger.ts`
- `src/lint/direction.ts`
- `src/lint/extract-specifiers.ts`
- `src/lint/knowledge-write.ts`
- `src/lint/reconcile-deps.ts`
- `src/lint/workspace-members.ts`

## Commands

- Test: `pnpm --filter @vostride/agent-qa-arch test`
- Typecheck: `pnpm --filter @vostride/agent-qa-arch typecheck`

## Local Rules

- Keep lint behavior in `src/lint/` with focused tests for every new offender
  rule or matcher.
- Keep this package private and used as a devDependency by ownership metadata
  consumers.
- Do not invent runtime product behavior here. This package owns architecture
  contracts and validation only.
- Keep denylist, manifest, workspace-member, and transitional-ledger logic using
  shared helpers so the named gate and full tests cannot drift.
- Preserve explicit package-class semantics when adding rules: browserSafe,
  providerNeutral, storageNeutral, storageImplementation, modelOwner, adapter,
  surface, util, and transitional each mean something different.

## Verification

Run focused package checks:

```bash
pnpm --filter @vostride/agent-qa-arch test
pnpm --filter @vostride/agent-qa-arch typecheck
```
