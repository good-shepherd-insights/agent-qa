# agent-qa package instructions: @vostride/agent-qa-safety

Inherit the root `agent-qa/AGENTS.md` branding, security, and release rules.

## Scope

This package is the browser-safe safety kernel. It owns the masking, guardrail,
and policy contracts, the first-party interception-hook registrar, and the
egress seam. Key exports: `createMaskingProviderRequestHook`,
`createGuardrailProviderRequestHook`, `GuardrailBlockError`,
`registerFirstPartySafetyHooks`, `evaluate`, `classifyRisk`, and `scan`.

## Read First

- `package.json`
- `src/index.ts`
- `src/hooks/first-party.ts`
- `src/policy/gate.ts`
- `src/masking/egress-hook.ts`

## Commands

- Test: `pnpm --filter @vostride/agent-qa-safety test`
- Typecheck: `pnpm --filter @vostride/agent-qa-safety typecheck`
- Build: `pnpm --filter @vostride/agent-qa-safety build`

## Local Rules

- This package is browser-safe and uses NO host APIs: no `fs`, no `process`, no
  database, no `AsyncLocalStorage`. Host adapters live in
  `@vostride/agent-qa-safety-local`; safety never depends on safety-local.
- Keep the AI-SDK-derived interception-hook interfaces here rather than in
  `@vostride/agent-qa-schema`, because `@ai-sdk/*` types are not browser-safe
  (the deliberate SAFE-02 override). Schema stays host-free and SDK-free.
- Keep `registerFirstPartySafetyHooks` the only public registration path; the raw
  hook registry construction stays private (D-03).
- Export safety contracts through the package root; do not leak private registry
  or ownership internals.

## Verification

Run focused package checks:

```bash
pnpm --filter @vostride/agent-qa-safety test
pnpm --filter @vostride/agent-qa-safety typecheck
```
