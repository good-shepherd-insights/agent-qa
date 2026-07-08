import { describe, expect, it } from 'vitest'

import { createConsoleReporter } from '../../reporters/console-reporter'
import { buildReporterFixture, createCapture } from './fixtures'

function renderFixture(verbose = true): { output: string; secrets: ReturnType<typeof buildReporterFixture> } {
  const fixture = buildReporterFixture()
  const capture = createCapture()
  const reporter = createConsoleReporter(fixture.ctx, {
    plain: true,
    colorize: false,
    verbose,
    write: capture.write,
    isTTY: false,
  })
  for (const envelope of fixture.envelopes) reporter.handler(envelope)
  return { output: capture.output(), secrets: fixture }
}

describe('createConsoleReporter', () => {
  it('unmasks human prose — originals appear, placeholders never do (D-09/D-10)', () => {
    const { output, secrets } = renderFixture(true)
    expect(output).toContain(secrets.stepSecret)
    expect(output).toContain(secrets.hookSecret)
    expect(output).toContain(secrets.summarySecret)
    expect(output).not.toMatch(/<SECRET_\d+>/)
  })

  it('renders the v1 console surface — step, hook, per-test, and summary lines', () => {
    const { output } = renderFixture(true)
    expect(output).toContain('Open login page')
    expect(output).toContain('Submit credentials')
    expect(output).toContain('seed-db')
    expect(output).toContain('Login test')
    expect(output).toContain('Checkout test')
    // aggregate summary block
    expect(output).toContain('Tests:')
    expect(output).toMatch(/1 of 2 passed/)
  })

  it('testRetryScheduled resets per-test step accumulation (no double count)', () => {
    const { output } = renderFixture(true)
    // test 0 retries: only the final attempt's 1 step counts; test 1 adds 1 → 2 total.
    // Without the reset the aggregate would read 4 total.
    expect(output).toMatch(/2 total/)
    expect(output).not.toMatch(/4 total/)
    expect(output).toMatch(/1 passed/)
    expect(output).toMatch(/1 failed/)
  })

  it('is replay-equivalent — identical envelope stream yields byte-identical output (D-04)', () => {
    const fixture = buildReporterFixture()
    const a = createCapture()
    const b = createCapture()
    const repA = createConsoleReporter(fixture.ctx, { plain: true, colorize: false, verbose: true, write: a.write, isTTY: false })
    const repB = createConsoleReporter(fixture.ctx, { plain: true, colorize: false, verbose: true, write: b.write, isTTY: false })
    for (const envelope of fixture.envelopes) repA.handler(envelope)
    for (const envelope of fixture.envelopes) repB.handler(envelope)
    expect(a.output()).toBe(b.output())
  })

  it('exposes an awaitable flush()', async () => {
    const fixture = buildReporterFixture()
    const capture = createCapture()
    const reporter = createConsoleReporter(fixture.ctx, { plain: true, write: capture.write, isTTY: false })
    for (const envelope of fixture.envelopes) reporter.handler(envelope)
    await expect(reporter.flush()).resolves.toBeUndefined()
  })
})
