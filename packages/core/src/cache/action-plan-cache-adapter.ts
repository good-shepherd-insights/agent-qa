// Transitional v1-shaped adapter — Phase 356 replaces both the port shape and the
// implementation (branded computeCacheKey 8-tuple, replay→re-ground→replan ladder).
// It wraps the v1 FileActionCache (which stays in core, D-03) behind the runner-owned
// `ActionPlanCache` port: the loop owns only `StepKeyInput` (stepInstruction); the
// per-test/per-step constants that key the v1 hash live here, closed over by the
// adapter, so `node:crypto` stays core-side (runner is storageNeutral).
import { createHash } from 'node:crypto'
import type { ActionPlan as RunnerActionPlan, ActionPlanCache, StepKeyInput } from '@vostride/agent-qa-runner'
import type { ActionCache } from '../agent/types.js'

/**
 * The per-test/per-step cache-key constants formerly carried on AgentLoopConfig
 * (configContent/testFileContent/stepIndex/suiteFileContent/suiteTestIndex + platform).
 * They no longer ride on the loop's StepKeyInput — the adapter closes over them (D-03).
 */
export interface CacheKeyConstants {
  platform?: string
  configContent?: string
  testFileContent?: string
  stepIndex?: number
  suiteFileContent?: string
  suiteTestIndex?: number
}

/**
 * The v1 `hashStepInstruction` composition, copied byte-for-byte from
 * core/src/agent/observation.ts so on-disk cache entries stay valid and
 * `CACHE_SCHEMA_VERSION` stays 9 — no migration (D-03, Runtime State Inventory).
 * Copied here (not imported) so observation.ts can be deleted in 353-07.
 */
export function computeSubActionStepHash(step: string, constants: CacheKeyConstants): string {
  return createHash('sha256')
    .update(
      (constants.configContent ?? '') + '||' +
      (constants.suiteFileContent ?? '') + '||' +
      String(constants.suiteTestIndex ?? 0) + '||' +
      (constants.testFileContent ?? '') + '||' +
      step + '||' +
      (constants.platform ?? 'web') + '||' +
      String(constants.stepIndex ?? 0),
    )
    .digest('hex')
    .slice(0, 16)
}

export class CoreActionPlanCacheAdapter implements ActionPlanCache {
  constructor(
    private readonly cache: ActionCache,
    private readonly constants: CacheKeyConstants,
  ) {}

  private hash(key: StepKeyInput): string {
    return computeSubActionStepHash(key.stepInstruction, this.constants)
  }

  async getSubAction(key: StepKeyInput, index: number): Promise<RunnerActionPlan | null> {
    return this.cache.getSubAction(this.hash(key), index)
  }

  async setSubAction(key: StepKeyInput, index: number, plan: RunnerActionPlan): Promise<void> {
    // Normalize the optional v45 envelope field to its v1 zod default so the on-disk
    // entry stays byte-identical to what the core ActionPlanSchema output produced.
    await this.cache.setSubAction(this.hash(key), index, { ...plan, stepFailed: plan.stepFailed ?? false })
  }

  async invalidateSubActionsFrom(key: StepKeyInput, fromIndex: number): Promise<void> {
    await this.cache.invalidateSubActionsFrom(this.hash(key), fromIndex)
  }
}
