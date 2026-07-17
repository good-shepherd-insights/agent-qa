import { describe, expect, it } from 'vitest'
import type { ModelCapabilities } from '@vostride/agent-qa-schema'
import {
  BRIEF_CEILING,
  BRIEF_FRACTION,
  GLOBAL_RECORD_CAP,
  MIN_BRIEF,
  MIN_CAUTION,
  MIN_MEMORY_TOOL_CONTEXT_WINDOW,
  WEAK_MODEL_CAP_SCALE,
  computeKnowledgeBudgets,
  memoryToolGate,
  scaledRecordCap,
} from '../knowledge-budgets.js'

function capabilities(overrides: Partial<ModelCapabilities> = {}): ModelCapabilities {
  return {
    text: true,
    vision: true,
    visionToolMessages: true,
    toolCalling: true,
    structuredOutput: true,
    streaming: true,
    contextWindow: MIN_MEMORY_TOOL_CONTEXT_WINDOW,
    maxOutput: 4_096,
    ...overrides,
  }
}

function budgetsForAvailable(available: number) {
  return computeKnowledgeBudgets({
    contextWindow: available,
    reservedOutput: 0,
    qaRulesTokens: 0,
    workingContextTokens: 0,
  })
}

describe('computeKnowledgeBudgets', () => {
  it('clamps a below-floor brief to a non-zero minimum and preserves the first raw token above it', () => {
    const availableForBelowFloor = Math.ceil((MIN_BRIEF - 1) / BRIEF_FRACTION)
    const availableForOneAboveFloor = Math.ceil((MIN_BRIEF + 1) / BRIEF_FRACTION)

    expect(budgetsForAvailable(availableForBelowFloor).brief).toBe(MIN_BRIEF)
    expect(MIN_BRIEF).toBeGreaterThan(0)
    expect(budgetsForAvailable(availableForOneAboveFloor).brief).toBe(MIN_BRIEF + 1)
  })

  it('floors the fractional product before clamping and caps oversized briefs', () => {
    const fractionalAvailable = Math.ceil((MIN_BRIEF + 10.75) / BRIEF_FRACTION)
    const expectedRaw = Math.floor(fractionalAvailable * BRIEF_FRACTION)

    expect(budgetsForAvailable(fractionalAvailable).brief).toBe(expectedRaw)
    expect(budgetsForAvailable(Number.MAX_SAFE_INTEGER).brief).toBe(BRIEF_CEILING)
  })

  it('keeps the caution budget at a non-zero floor when no usable context remains', () => {
    const result = computeKnowledgeBudgets({
      contextWindow: 1_024,
      reservedOutput: 1_024,
      qaRulesTokens: 4_000,
      workingContextTokens: 4_000,
    })

    expect(result.caution).toBe(MIN_CAUTION)
    expect(result.caution).toBeGreaterThan(0)
  })
})

describe('memoryToolGate', () => {
  it('rejects each weak-model axis and accepts a fully capable profile', () => {
    expect(memoryToolGate(capabilities({ toolCalling: false }))).toBe(false)
    expect(memoryToolGate(capabilities({ vision: false }))).toBe(false)
    expect(memoryToolGate(capabilities({ contextWindow: MIN_MEMORY_TOOL_CONTEXT_WINDOW - 1 }))).toBe(false)
    expect(memoryToolGate(capabilities())).toBe(true)
  })

  it('uses the same predicate to scale the global distinct-record cap', () => {
    expect(scaledRecordCap(capabilities({ vision: false }))).toBe(
      Math.max(1, Math.floor(GLOBAL_RECORD_CAP * WEAK_MODEL_CAP_SCALE)),
    )
    expect(scaledRecordCap(capabilities())).toBe(GLOBAL_RECORD_CAP)
  })
})
