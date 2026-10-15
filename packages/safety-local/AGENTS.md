# agent-qa package instructions: @vostride/agent-qa-safety-local

Inherit the root `agent-qa/AGENTS.md` branding, security, and release rules.

## Scope

This package is the host-adapter home for the safety kernel. It owns the host
APIs the browser-safe `@vostride/agent-qa-safety` package deliberately excludes:

- the `AsyncLocalStorage` run-safety scope (`runSafetyScope` and its
  `SafetyScopeBundle` type), which binds a run's execution context behind the
  safety execution-context resolver seam;
- the host execution-context detector (`detectExecutionContext`), which reads
  `process` signals;
- the one-way `fingerprint` helper.

## Read First

- `package.json`
- `src/index.ts`
- `src/safety-scope.ts`
- `src/execution-context-detector.ts`
- `src/fingerprint.ts`

## Commands

- Test: `pnpm --filter @vostride/agent-qa-safety-local test`
- Typecheck: `pnpm --filter @vostride/agent-qa-safety-local typecheck`
- Build: `pnpm --filter @vostride/agent-qa-safety-local build`

## Local Rules

- This is the ONLY place host APIs bind to the safety kernel: `process` and
  `AsyncLocalStorage` live here, never in `@vostride/agent-qa-safety`.
- Enforce the direction firewall: safety-local depends on safety and never the
  reverse. The browser-safe kernel stays storage-neutral; the scope binding and
  the host detector land here.
- Export host adapters through the package root; do not leak private process
  handles.

## Verification

Run focused package checks:

```bash
pnpm --filter @vostride/agent-qa-safety-local test
pnpm --filter @vostride/agent-qa-safety-local typecheck
```
