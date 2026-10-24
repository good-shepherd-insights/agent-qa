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
  this package. It owns local persistence storage and the local composition root
  (2026-07-29, Phase 385 D-13/D-15: `src/composition/` assembles the run session
  and the function registry every host shares; the semantics still live
  elsewhere).
- Concrete store code belongs here now (2026-07-29, Phase 385 JOBQ-01/JOBQ-02).
  This line previously forbade it, deferring to "the milestone that fills the
  local agent persistence implementation" — that milestone is v52, and
  `src/store/` is its output. The sqlite job store and the file checkpoint store
  are this package's, by design.
- Keep filesystem and sqlite access confined to this package and out of
  provider-neutral ones; `packages/agent` reaches storage only through injected
  ports.
- Do not import model provider SDKs here: this package never CONSTRUCTS a model
  (its ownership contract forbids provider invocation, and its external
  dependency set is empty). Model capabilities and run executors arrive already
  built, as ports. Platform adapters are likewise injected — `src/composition/`
  wires an adapter it is handed and implements none (2026-07-29, Phase 385 D-13;
  the arch rule named composition-carveout scopes which packages that subtree
  may name at all).

## Verification

Run focused package checks:

```bash
pnpm --filter @vostride/agent-qa-agent-local test
pnpm --filter @vostride/agent-qa-agent-local typecheck
```
