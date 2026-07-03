import { createHash } from 'node:crypto'

/**
 * Cache-key hashing for a step instruction. Relocated from the deleted v1
 * `agent/observation.ts` (Phase 353-07): cache-key computation belongs to the
 * cache subsystem, which stays in core behind the runner-owned ActionPlanCache
 * port (D-03) until Phase 356 redesigns it. The byte composition is unchanged so
 * on-disk entries stay valid and `CACHE_SCHEMA_VERSION` stays 9 (no migration).
 *
 * Consumed by the CLI (`cache`/`run` cache-purge paths) and dashboard-server
 * (route-level cache inspection) via the core barrel, and by
 * `CoreActionPlanCacheAdapter` for the loop's sub-action cache keys.
 */
export interface StepHashInputs {
  step: string
  platform?: string
  configContent?: string
  testFileContent?: string
  stepIndex?: number
  suiteFileContent?: string
  suiteTestIndex?: number
}

export function hashStepInstruction(inputs: StepHashInputs): string
export function hashStepInstruction(step: string, platform?: string, configContent?: string, testFileContent?: string, stepIndex?: number): string
export function hashStepInstruction(stepOrInputs: string | StepHashInputs, platform?: string, configContent?: string, testFileContent?: string, stepIndex?: number): string {
  const i: StepHashInputs = typeof stepOrInputs === 'string'
    ? { step: stepOrInputs, platform, configContent, testFileContent, stepIndex }
    : stepOrInputs
  return createHash('sha256')
    .update(
      (i.configContent ?? '') + '||' +
      (i.suiteFileContent ?? '') + '||' +
      String(i.suiteTestIndex ?? 0) + '||' +
      (i.testFileContent ?? '') + '||' +
      i.step + '||' +
      (i.platform ?? 'web') + '||' +
      String(i.stepIndex ?? 0)
    )
    .digest('hex')
    .slice(0, 16)
}
