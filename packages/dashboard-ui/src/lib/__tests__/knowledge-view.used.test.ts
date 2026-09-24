// 427 · D-02, D-04, D-05, D-07 — the section set, the grouped used rows and the step-reference text.

import { describe, expect, it } from 'vitest'
import { RunKnowledgeProjectionSchema, type RunKnowledgeProjection } from '@vostride/agent-qa-schema'

import {
  KNOWLEDGE_SECTIONS,
  USE_VERBS,
  formatStepRefs,
  usedCountLine,
  usedRecordViews,
  type StepAddress,
  type StepRefSegment,
} from '@/lib/knowledge-view'

type ReadyProjection = Extract<RunKnowledgeProjection, { kind: 'ready' }>

function line(id: string, summary: string) {
  return { id, kind: 'fact', summary, trust: 0.9, status: 'active', servedAsCanary: false, tier: 'confirmed' }
}

function step(stepIndex: number, channel1: ReturnType<typeof line>[], testIndex = 0) {
  return {
    testId: 't_used',
    testIndex,
    stepIndex,
    stepText: `step text ${String(stepIndex)}`,
    served: { channel1, channel2: [], channel3: [] },
    trace: { kind: 'no-trace', reason: 'pre-trace-run' },
  }
}

function projection(steps: ReturnType<typeof step>[]): ReadyProjection {
  const parsed = RunKnowledgeProjectionSchema.parse({
    kind: 'ready',
    runId: 'run-427-01-used',
    buildOrdinal: 1,
    knowledgeStore: 'bound',
    steps,
    curation: { status: 'done' },
    learned: { changes: [], canaryAttributions: [] },
  })
  if (parsed.kind !== 'ready') throw new Error('expected a ready projection')
  return parsed
}

const at = (stepIndex: number, testIndex = 0): StepAddress => ({ testIndex, stepIndex })

function text(segments: readonly StepRefSegment[]): string {
  return segments.map(segment => (segment.kind === 'text' ? segment.text : segment.label)).join('')
}

describe('the 427 closed sets are exactly the published members', () => {
  it('CLOSED-SETS-427: the sections and the use verbs', () => {
    expect(KNOWLEDGE_SECTIONS).toEqual(['used', 'effect', 'changes', 'retrieval-details'])
    expect(USE_VERBS).toEqual(['given', 'opened', 'caution', 'replayed', 'hint'])
  })
})

describe('a record used in several steps is one row (D-05)', () => {
  it('GROUPED-ONE-ROW: one id across three steps is one view; equal summaries under two ids stay two; first use orders rows', () => {
    const shared = line('rec_shared', 'the cart page lives at /view_cart')
    const grouped = usedRecordViews(projection([step(0, [shared]), step(1, [shared]), step(2, [shared])]))
    expect(grouped).toEqual([
      { key: '0', primary: shared.summary, uses: [{ verb: 'given', addresses: [at(0), at(1), at(2)] }] },
    ])

    const twins = usedRecordViews(projection([
      step(0, [line('rec_a', 'same words'), line('rec_b', 'same words')]),
    ]))
    expect(twins.map(view => view.primary)).toEqual(['same words', 'same words'])
    expect(twins.length).toBe(2)

    const ordered = usedRecordViews(projection([
      step(3, [line('rec_late', 'late')]),
      step(1, [line('rec_first', 'first'), line('rec_second', 'second')]),
      step(2, [line('rec_late', 'late')]),
    ]))
    expect(ordered.map(view => view.primary)).toEqual(['first', 'second', 'late'])
    expect(ordered[2]?.uses[0]?.addresses).toEqual([at(2), at(3)])
    expect(JSON.stringify(ordered)).not.toContain('rec_')
  })

  it('counts records as the heading line reads them', () => {
    expect(usedCountLine(1)).toBe('1 record')
    expect(usedCountLine(4)).toBe('4 records')
  })
})

describe('step references read as a person counts them (UI-SPEC S3)', () => {
  it('FORMAT-STEP-REFS: one, two, a range, a range plus one, a list — de-duplicated and order-free', () => {
    expect(text(formatStepRefs([at(1)]))).toBe('step 2')
    expect(text(formatStepRefs([at(0), at(1)]))).toBe('steps 1 and 2')

    const range = formatStepRefs([at(0), at(1), at(2)])
    expect(text(range)).toBe('steps 1–3')
    expect(range).toEqual([
      { kind: 'text', text: 'steps ' },
      { kind: 'step', address: at(0), label: '1' },
      { kind: 'text', text: '–' },
      { kind: 'step', address: at(2), label: '3' },
    ])

    expect(text(formatStepRefs([at(0), at(1), at(2), at(4)]))).toBe('steps 1–3 and 5')
    expect(text(formatStepRefs([at(0), at(2), at(4)]))).toBe('steps 1, 3 and 5')
    expect(text(formatStepRefs([at(4), at(0), at(2), at(0), at(2)]))).toBe('steps 1, 3 and 5')
    expect(text(formatStepRefs([at(2), at(1), at(1), at(0)]))).toBe('steps 1–3')
  })
})
