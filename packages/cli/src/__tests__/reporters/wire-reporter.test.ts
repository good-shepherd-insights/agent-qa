import { afterEach, describe, expect, it, vi } from 'vitest'

import { createWireReporter } from '../../reporters/wire-reporter'
import { buildReporterFixture, createCapture } from './fixtures'

const PREFIX = 'AGENT_QA_EVENT:'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('createWireReporter', () => {
  it('with AGENT_QA_LIVE_EVENTS=true prints one verbatim envelope line each', () => {
    vi.stubEnv('AGENT_QA_LIVE_EVENTS', 'true')
    const fixture = buildReporterFixture()
    const capture = createCapture()
    const reporter = createWireReporter({ write: capture.write })
    for (const envelope of fixture.envelopes) reporter.handler(envelope)

    const lines = capture.output().split('\n').filter(Boolean)
    expect(lines.length).toBe(fixture.envelopes.length)
    lines.forEach((line, index) => {
      expect(line.startsWith(PREFIX)).toBe(true)
      // round-trip: the envelope is emitted VERBATIM after the 15-char prefix
      expect(JSON.parse(line.slice(PREFIX.length))).toEqual(fixture.envelopes[index])
    })
  })

  it('stays MASKED — placeholders travel, originals never do', () => {
    vi.stubEnv('AGENT_QA_LIVE_EVENTS', 'true')
    const fixture = buildReporterFixture()
    const capture = createCapture()
    const reporter = createWireReporter({ write: capture.write })
    for (const envelope of fixture.envelopes) reporter.handler(envelope)
    const output = capture.output()
    expect(output).toMatch(/<SECRET_\d+>/)
    expect(output).not.toContain(fixture.stepSecret)
    expect(output).not.toContain(fixture.hookSecret)
    expect(output).not.toContain(fixture.summarySecret)
  })

  it('with the gate unset, nothing prints', () => {
    vi.stubEnv('AGENT_QA_LIVE_EVENTS', '')
    const fixture = buildReporterFixture()
    const capture = createCapture()
    const reporter = createWireReporter({ write: capture.write })
    for (const envelope of fixture.envelopes) reporter.handler(envelope)
    expect(capture.output()).toBe('')
  })

  it('the prefix is exactly 15 characters (slice(15) round-trip contract)', () => {
    expect(PREFIX.length).toBe(15)
  })
})
