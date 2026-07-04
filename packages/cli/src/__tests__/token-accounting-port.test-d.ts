// D-05 structural conformance proof (the 354↔355 seam). cli is the only package that may
// import BOTH runner and model (core does not depend on model), so this type-level proof lives
// here. It asserts that model's `createTokenAccounting` return structurally conforms to the
// runner's provider-neutral `TokenAccounting` port. Both sides type the same pinned ai@6.0.174
// `ModelMessage`/`LanguageModelUsage`, so the match is real — and any drift becomes a tsc error.

import { expectTypeOf } from 'vitest'
import { createTokenAccounting } from '@vostride/agent-qa-model'
import type { TokenAccounting as RunnerTokenAccounting } from '@vostride/agent-qa-runner'

type ModelAccounting = ReturnType<typeof createTokenAccounting>

// Load-bearing gate: a `satisfies` binding of the model factory's return type to the runner
// port. A non-conforming shape (a dropped method, a diverged signature) is a tsc error under
// `pnpm --filter @vostride/agent-qa-cli exec tsc --noEmit`.
const _proof = (undefined as unknown as ModelAccounting) satisfies RunnerTokenAccounting
void _proof

// Readability mirror of the same assertion for vitest --typecheck (knowledge-hint-reader idiom).
expectTypeOf<ModelAccounting>().toExtend<RunnerTokenAccounting>()
