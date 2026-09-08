import { describe, expect, it } from 'vitest'
import { makeV2Handoff } from '../../__tests__/fixtures/handoff-fixtures'
import { extractRunCassettes } from '../../extract/extract-run'
import { committedFileText } from '../../labels/committed-file'
import { cassetteEgressText } from '../egress'

describe('validated cassette machine timestamp egress view', () => {
  it.each(['leaf', 'procedure'] as const)('preserves opaque evidence and numeric extension content in %s cassettes', granularity => {
    const handoff = makeV2Handoff()
    for (const member of handoff.tests) for (const step of member.steps) for (const sub of step.subActions) {
      sub.stateBefore.timestamp = 1_788_883_958_737
      sub.stateBefore.metadata = Object.assign({}, sub.stateBefore.metadata, { timestamp: 1_788_883_958_737 })
    }
    const cassette = extractRunCassettes({ handoff, artifacts: { getBlob: () => undefined } })
      .cassettes.find(entry => entry.cassette.granularity === granularity)!.cassette
    const before = committedFileText(cassette)
    const view = JSON.parse(cassetteEgressText(cassette))
    const inputs = cassette.granularity === 'leaf' ? [cassette.input]
      : cassette.steps.flatMap(step => step.kind === 'decision' ? [step.record.input] : [])
    const views = granularity === 'leaf' ? [view.input]
      : view.steps.filter((step: { kind: string }) => step.kind === 'decision')
        .map((step: { record: { input: unknown } }) => step.record.input)
    expect(inputs.length).toBeGreaterThan(0)
    expect(views).toHaveLength(inputs.length)
    for (const [index, input] of inputs.entries()) {
      expect(views[index].stateBefore.timestamp).toBe('1.788883958737e+12')
      expect(views[index].stateBefore.metadata.timestamp).toBe(1_788_883_958_737)
      expect(views[index].exchanges).toEqual(input.exchanges)
    }
    expect(committedFileText(cassette)).toBe(before)
    Object.assign(inputs[0]!.stateBefore, { timestamp: '1788883958737' })
    expect(() => cassetteEgressText(cassette)).toThrow()
  })
})
