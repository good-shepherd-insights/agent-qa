# agent-qa package instructions: @vostride/agent-qa-safety-local

Inherit the root `agent-qa/AGENTS.md` branding, security, and release rules.

## Scope

This package is the host-adapter home for the safety kernel. It owns the host
APIs the browser-safe `@vostride/agent-qa-safety` package deliberately excludes:
the filesystem `JsonlAuditSink`, the `AsyncLocalStorage` masking-scope binding
(`runMaskingScope`), the host `process`-reading execution-context detector, and
the `fingerprint` helper. Key exports: `JsonlAuditSink`, `runMaskingScope`,
`detectExecutionContext`, `fingerprint`, `createReadlineConfirm`.

## Read First

- `package.json`
- `src/index.ts`
- `src/jsonl-audit-sink.ts`
- `src/masking-scope.ts`
- `src/execution-context-detector.ts`

## Commands

- Test: `pnpm --filter @vostride/agent-qa-safety-local test`
- Typecheck: `pnpm --filter @vostride/agent-qa-safety-local typecheck`
- Build: `pnpm --filter @vostride/agent-qa-safety-local build`

## Local Rules

- This is the ONLY place host APIs bind to the safety kernel: `fs`, `process`,
  and `AsyncLocalStorage` live here, never in `@vostride/agent-qa-safety`.
- Enforce the direction firewall: safety-local depends on safety and never the
  reverse. The browser-safe kernel stays storage-neutral; concrete host sinks and
  scope binding land here.
- Keep the `JsonlAuditSink` the filesystem implementation of the neutral
  `AuditSink` port defined in safety; do not push host details back upstream.
- Export host adapters through the package root; do not leak private file or
  process handles.

## Verification

Run focused package checks:

```bash
pnpm --filter @vostride/agent-qa-safety-local test
pnpm --filter @vostride/agent-qa-safety-local typecheck
```
