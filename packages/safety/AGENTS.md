# agent-qa package instructions: @vostride/agent-qa-safety

Inherit the root `agent-qa/AGENTS.md` branding, security, and release rules.

## Scope

This package is the browser-safe safety kernel. It owns the prompt walker, the
declared-secret masking middleware, the risk classifier, the execution-context
seam and the data delimiters. Key exports: `mapPromptLeaves`,
`createMaskingMiddleware`, `classifyRisk`, and `wrapAppObservedData`. The
execution policy gate and its confirm ports were deleted in Phase 432 (D-15);
the masking context, the guardrails, the hook registrar and the audit port were
deleted in Phase 441 (D-12, D-15).

## Read First

- `package.json`
- `src/index.ts`
- `src/egress/masking-middleware.ts`
- `src/egress/map-prompt-leaves.ts`
- `src/policy/risk-classifier.ts`

## Commands

- Test: `pnpm --filter @vostride/agent-qa-safety test`
- Typecheck: `pnpm --filter @vostride/agent-qa-safety typecheck`
- Build: `pnpm --filter @vostride/agent-qa-safety build`

## Local Rules

- This package is browser-safe and uses NO host APIs: no `fs`, no `process`, no
  database, no `AsyncLocalStorage`. Host adapters live in
  `@vostride/agent-qa-safety-local`; safety never depends on safety-local.
- Keep the AI-SDK-derived `ProviderRequestParams` type here rather than in
  `@vostride/agent-qa-schema`, because `@ai-sdk/*` types are not browser-safe
  (the deliberate SAFE-02 override). Schema stays host-free and SDK-free.
- Export safety contracts through the package root; do not leak ownership
  internals.

## Verification

Run focused package checks:

```bash
pnpm --filter @vostride/agent-qa-safety test
pnpm --filter @vostride/agent-qa-safety typecheck
```
