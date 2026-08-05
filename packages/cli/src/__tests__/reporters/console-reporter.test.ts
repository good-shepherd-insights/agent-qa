import { describe, expect, it } from 'vitest'

import type { QuarantineAppliedEntry } from '@vostride/agent-qa-schema'

import {
  QUARANTINE_TEST_ANNOTATION,
  createConsoleReporter,
  renderQuarantineSummarySegment,
} from '../../reporters/console-reporter.js'
import {
  QUARANTINED_CHECKOUT,
  QUARANTINED_ELSEWHERE,
  buildReporterFixture,
  createCapture,
} from './fixtures.js'

function renderFixture(
  verbose = true,
  quarantined?: readonly QuarantineAppliedEntry[],
): { output: string; secrets: ReturnType<typeof buildReporterFixture> } {
  const fixture = buildReporterFixture()
  const capture = createCapture()
  const reporter = createConsoleReporter(fixture.ctx, {
    plain: true,
    colorize: false,
    verbose,
    write: capture.write,
    isTTY: false,
    ...(quarantined === undefined ? {} : { quarantined }),
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

// ---- 390 D-15: the disposition a human reads --------------------------------------------------
//
// "QUARANTINED — failed, not counted" is the line that keeps the un-quarantine evidence flowing: it
// tells the reader the test ran, that it failed, and why the build is nonetheless green. The
// summary segment is what makes the green build's arithmetic add up.
//
// The byte-unchanged claim is pinned as a DIFFERENTIAL over one envelope stream, because an
// assertion that the zero case changed nothing is only load-bearing if the same code path WOULD
// have changed under a snapshot.

describe('createConsoleReporter — the 390 D-15 quarantine disposition', () => {
  const ANNOTATION = ` ${QUARANTINE_TEST_ANNOTATION}`
  const SEGMENT = ' · 1 quarantined failure'

  it('annotates the failing member and counts it separately in the summary', () => {
    const { output } = renderFixture(true, [QUARANTINED_CHECKOUT])
    expect(output).toContain(`FAIL Checkout test 1s${ANNOTATION}`)
    expect(output).toContain(`Tests:  1 of 2 passed${SEGMENT}`)
    // the failed-tests block names it too — the reader scanning red rows learns why the build is green
    expect(output).toContain(`  x Checkout test${ANNOTATION}`)
  })

  it('never rewrites the outcome — the member still reads FAIL and still counts as failed', () => {
    const { output } = renderFixture(true, [QUARANTINED_CHECKOUT])
    expect(output).toContain('FAIL Checkout test')
    expect(output).not.toContain('PASS Checkout test')
    // 1 of 2 passed: the quarantined failure is NOT promoted into the passed tally
    expect(output).toMatch(/Tests:  1 of 2 passed/)
    // the failed-tests block is still rendered at all
    expect(output).toContain('Failed tests:')
  })

  it('the annotation and the segment are the ONLY byte differences', () => {
    const baseline = renderFixture(true).output
    const marked = renderFixture(true, [QUARANTINED_CHECKOUT]).output

    // (a) the same stream DID change
    expect(marked).not.toBe(baseline)
    // (b) the annotation appears exactly twice: the per-test line and the failed-tests entry
    expect(marked.split(ANNOTATION)).toHaveLength(3)
    // (c) stripping both additions reproduces the un-quarantined output BYTE for BYTE
    expect(marked.split(ANNOTATION).join('').split(SEGMENT).join('')).toBe(baseline)
  })

  it('renders byte-identically when the snapshot is empty or addresses another test', () => {
    const baseline = renderFixture(true).output
    expect(renderFixture(true, []).output).toBe(baseline)
    expect(renderFixture(true, [QUARANTINED_ELSEWHERE]).output).toBe(baseline)
    expect(baseline).not.toContain('QUARANTINED')
  })

  it('says nothing about a PASSING member carrying an entry', () => {
    const { output } = renderFixture(true, [
      { ...QUARANTINED_CHECKOUT, filePath: 'tests/login.yaml', testName: 'Login test' },
    ])
    expect(output).toBe(renderFixture(true).output)
  })
})

describe('renderQuarantineSummarySegment (the pure composer)', () => {
  it('is SILENT at zero — every pre-390 summary line stays byte-frozen', () => {
    expect(renderQuarantineSummarySegment(0)).toBe('')
    expect(renderQuarantineSummarySegment(-1)).toBe('')
  })

  it('pins the rendered bytes and the plural', () => {
    expect(renderQuarantineSummarySegment(1)).toBe(' · 1 quarantined failure')
    expect(renderQuarantineSummarySegment(2)).toBe(' · 2 quarantined failures')
  })
})
