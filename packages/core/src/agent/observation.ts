import { createHash } from 'node:crypto'
import { asRef } from '@vostride/agent-qa-schema'
import type { ScreenState } from '@vostride/agent-qa-schema'

export function truncateScreenState(state: ScreenState): string {
  const parts: string[] = []

  if (state.url) {
    parts.push(`Current page: ${state.url}`)
  }

  const viewportHeight = state.metadata.viewportHeight

  if (viewportHeight) {
    const allRefs = Object.keys(state.refMap).map(key => state.refMap[asRef(key)])
    const visible = allRefs.filter(r => r.bounds.y + r.bounds.height > 0 && r.bounds.y < viewportHeight)
    const above = allRefs.filter(r => r.bounds.y + r.bounds.height <= 0)
    const below = allRefs.filter(r => r.bounds.y >= viewportHeight)
    parts.push(`[viewport: ${visible.length} elements visible, ${above.length} scrolled above, ${below.length} below viewport]`)
  }

  return parts.length > 0
    ? parts.join('\n') + '\n\n' + state.tree
    : state.tree
}

export function hashScreenState(state: ScreenState): string {
  const normalized = state.elements
    .map((el) => `${el.role}:${el.name}`)
    .join('|')

  // Include element positions from the refMap to detect scroll/viewport changes.
  // Without this, scrolling on mobile produces identical hashes since the full page
  // source always contains every element regardless of visibility.
  // Sample 20 refs (not 10) for better differentiation on native mobile apps.
  const posInfo = Object.keys(state.refMap)
    .map(key => state.refMap[asRef(key)])
    .slice(0, 20)
    .map(r => r.bounds.y)
    .join(',')

  // Include viewport height to differentiate device sizes
  const vh = state.metadata.viewportHeight ?? ''

  return createHash('sha256').update(normalized + '||' + posInfo + '||' + vh).digest('hex').slice(0, 16)
}

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
