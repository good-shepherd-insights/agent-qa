import { z } from 'zod'

// D-07/D-11: targeted migration errors for the v51 Phase 373 config collapse
// (knowledge-store.md §5). This scan is a zod pipe PRE-stage in front of the strict
// root schema — a superRefine chained after .strict() never runs when strict rejects
// (verified on zod 4.4.2), so the migration messages must fire first. The scan only
// ADDS issues; the strict stage-B parse remains the acceptance authority.
const RETIRED_MEMORY_KEY_MESSAGES: Record<string, string> = {
  dir: 'services.memory.dir was removed in v2 — use knowledge.dir (default agent-qa-knowledge)',
  enabled: 'services.memory.enabled was removed in v2 — memory is always on; delete this key (no disable switch)',
  provider: 'services.memory.provider was removed in v2 — internalized — delete this key',
  minTrust: 'services.memory.minTrust was removed in v2 — internalized — delete this key',
  maxInjections: 'services.memory.maxInjections was removed in v2 — internalized — delete this key',
  curatorEnabled: 'services.memory.curatorEnabled was removed in v2 — internalized — delete this key',
  curatorLockTimeout: 'services.memory.curatorLockTimeout was removed in v2 — internalized — delete this key',
  trustConfirmDelta: 'services.memory.trustConfirmDelta was removed in v2 — internalized — delete this key',
  trustContradictDelta: 'services.memory.trustContradictDelta was removed in v2 — internalized — delete this key',
  ablationEnabled: 'services.memory.ablationEnabled was removed — no ablation exists',
  circuitBreakerEnabled: 'services.memory.circuitBreakerEnabled was removed — no circuit breaker exists',
  circuitBreakerWindowSize: 'services.memory.circuitBreakerWindowSize was removed — no circuit breaker exists',
  circuitBreakerBaselineSize: 'services.memory.circuitBreakerBaselineSize was removed — no circuit breaker exists',
  circuitBreakerThreshold: 'services.memory.circuitBreakerThreshold was removed — no circuit breaker exists',
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export const retiredKeyScan = z.any().superRefine((value, ctx) => {
  if (!isPlainObject(value)) return

  if (isPlainObject(value.services) && value.services.memory !== undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['services', 'memory'],
      message: 'services.memory was removed in v2 — the memory config surface collapsed into the top-level knowledge block (knowledge-store.md §5)',
    })
    const memory = value.services.memory
    if (isPlainObject(memory)) {
      for (const key of Object.keys(memory)) {
        const message = RETIRED_MEMORY_KEY_MESSAGES[key]
        if (message) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['services', 'memory', key],
            message,
          })
        }
      }
    }
  }

  if (isPlainObject(value.workspace) && value.workspace.agentRules !== undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['workspace', 'agentRules'],
      message: 'workspace.agentRules was removed in v2 — rules dissolve into agent-qa-knowledge/policies/<scope>.md files (served from Phase 380)',
    })
  }
})
