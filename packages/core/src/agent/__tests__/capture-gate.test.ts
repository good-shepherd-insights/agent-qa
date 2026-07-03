import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PlatformAdapter, Action, ActionResult } from '@vostride/agent-qa-runner'
import type { ScreenState } from '@vostride/agent-qa-schema'
import type { AgentLoopConfig, Planner, StepContext } from '../types.js'
import type { ActionPlan } from '../../schema/action-schema.js'
import { buildAgentScreenState } from './screen-fixtures.js'

// Spy on the compressor: text-only runs must never enter it (D-11 / SCREEN-03).
vi.mock('../../screenshot/compress.js', () => ({
  compressScreenshot: vi.fn(),
}))
import { compressScreenshot } from '../../screenshot/compress.js'
import { executeStep } from '../loop.js'

type VisionGate = NonNullable<AgentLoopConfig['visionGate']>

function makeState(): ScreenState {
  return buildAgentScreenState({
    tree: 'button "Sign In" [ref=e1]',
    url: 'https://example.com/login',
    elements: [{ ref: 'e1', role: 'button', name: 'Sign In' }],
    metadata: { viewportWidth: 1280, viewportHeight: 720 },
  })
}

function makeActionPlan(): ActionPlan {
  return {
    reasoning: 'Click Sign In to complete the step',
    action: { type: 'click', ref: 'e1' },
    confidence: 0.95,
    stepComplete: true,
    stepFailed: false,
  }
}

function makeStepContext(): StepContext {
  return {
    stepInstruction: 'Click the Sign In button',
    testName: 'Login test',
    previousSteps: [],
    plannerModel: {} as any,
    verifierModel: {} as any,
    healingConfig: { maxAttempts: 3 },
  }
}

interface CapturedPlan {
  captureMode: ScreenState['metadata']['captureMode']
  imageWidth?: number
  imageHeight?: number
  hadScreenshot: boolean
  promptNote?: string
}

function makeCapturingPlanner(captured: CapturedPlan[]): Planner {
  return {
    async plan(_step: string, screenState: ScreenState, context: StepContext) {
      const meta = screenState.metadata
      captured.push({
        captureMode: meta.captureMode,
        imageWidth: meta.captureMode === 'full' ? meta.imageWidth : undefined,
        imageHeight: meta.captureMode === 'full' ? meta.imageHeight : undefined,
        hadScreenshot: context.screenshot !== undefined,
        promptNote: context.promptNote,
      })
      return { plan: makeActionPlan() }
    },
  }
}

function makeAdapter(screenshotSpy: ReturnType<typeof vi.fn>): PlatformAdapter {
  return {
    platform: 'web',
    async setup() {},
    async cleanup() {},
    async observe() { return makeState() },
    async execute(_action: Action): Promise<ActionResult> { return { success: true } },
    screenshot: screenshotSpy,
  } as unknown as PlatformAdapter
}

function makeConfig(overrides: Partial<AgentLoopConfig>): AgentLoopConfig {
  return {
    adapter: makeAdapter(vi.fn(async () => Buffer.from('raw-png'))),
    planner: makeCapturingPlanner([]),
    healingConfig: { maxAttempts: 3 },
    // Sizing config present so the compression branch is reachable when the gate allows it.
    vision: { effectiveResolution: 1024, screenshotSize: 100_000 },
    ...overrides,
  }
}

const FULL_GATE: VisionGate = { attachImage: true, captureMode: 'full', promptNote: '' }
const TEXT_ONLY_GATE: VisionGate = {
  attachImage: false,
  captureMode: 'textOnly',
  promptNote: 'Visual screenshot is unavailable for this step. Rely on the accessibility tree.',
}

describe('capture gate (D-11 / SCREEN-03)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(compressScreenshot).mockResolvedValue({
      buffer: Buffer.from('compressed-jpeg'),
      imageWidth: 800,
      imageHeight: 600,
    })
  })

  it('text-only gate: no compression, no image block, captureMode textOnly, promptNote injected, screenshot still captured', async () => {
    const captured: CapturedPlan[] = []
    const screenshotSpy = vi.fn(async () => Buffer.from('raw-png'))
    const config = makeConfig({
      adapter: makeAdapter(screenshotSpy),
      planner: makeCapturingPlanner(captured),
      visionGate: TEXT_ONLY_GATE,
    })

    const result = await executeStep('Click the Sign In button', config, makeStepContext())

    expect(result.status).toBe('passed')
    // No LLM-bound image work.
    expect(compressScreenshot).not.toHaveBeenCalled()
    expect(captured[0].hadScreenshot).toBe(false)
    // Honest modality recorded on the state.
    expect(captured[0].captureMode).toBe('textOnly')
    // promptNote reaches the planner.
    expect(captured[0].promptNote).toBe(TEXT_ONLY_GATE.promptNote)
    // Artifact/evidence capture proceeds regardless (SCREEN-03).
    expect(screenshotSpy).toHaveBeenCalled()
  })

  it('full gate: compression runs, state re-stamped full with real dims, image block attached', async () => {
    const captured: CapturedPlan[] = []
    const config = makeConfig({
      planner: makeCapturingPlanner(captured),
      visionGate: FULL_GATE,
    })

    const result = await executeStep('Click the Sign In button', config, makeStepContext())

    expect(result.status).toBe('passed')
    expect(compressScreenshot).toHaveBeenCalledTimes(1)
    expect(captured[0].captureMode).toBe('full')
    expect(captured[0].imageWidth).toBe(800)
    expect(captured[0].imageHeight).toBe(600)
    expect(captured[0].hadScreenshot).toBe(true)
    expect(captured[0].promptNote).toBe('')
  })

  it('absent gate: full-equivalent (pre-gate default for non-CLI callers/tests)', async () => {
    const captured: CapturedPlan[] = []
    const config = makeConfig({
      planner: makeCapturingPlanner(captured),
      // no visionGate
    })

    const result = await executeStep('Click the Sign In button', config, makeStepContext())

    expect(result.status).toBe('passed')
    expect(compressScreenshot).toHaveBeenCalledTimes(1)
    expect(captured[0].captureMode).toBe('full')
    expect(captured[0].imageWidth).toBe(800)
    expect(captured[0].imageHeight).toBe(600)
    expect(captured[0].hadScreenshot).toBe(true)
  })
})
