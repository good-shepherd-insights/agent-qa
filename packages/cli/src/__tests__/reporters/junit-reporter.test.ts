import { describe, expect, it } from 'vitest'

import { createJunitReporter } from '../../reporters/junit-reporter'
import { buildReporterFixture } from './fixtures'

async function runJunit(): Promise<{ path: string; xml: string; fixture: ReturnType<typeof buildReporterFixture> }> {
  const fixture = buildReporterFixture()
  let path = ''
  let xml = ''
  const reporter = createJunitReporter({
    outputPath: 'out/junit.xml',
    write: async (p: string, content: string) => {
      path = p
      xml = content
    },
  })
  for (const envelope of fixture.envelopes) reporter.handler(envelope)
  await reporter.flush()
  return { path, xml, fixture }
}

describe('createJunitReporter', () => {
  it('writes classname/file from testStarted.filePath and per-step status', async () => {
    const { xml } = await runJunit()
    expect(xml).toContain('file="tests/login.yaml"')
    expect(xml).toContain('classname="tests/login.yaml"')
    expect(xml).toContain('file="tests/checkout.yaml"')
    // per-step status appears in the system-out step summary
    expect(xml).toMatch(/\[PASSED\]/)
    expect(xml).toMatch(/\[FAILED\]/)
  })

  it('stays MASKED — placeholders preserved, originals never written (D-11)', async () => {
    const { xml, fixture } = await runJunit()
    expect(xml).toMatch(/<SECRET_\d+>/)
    expect(xml).not.toContain(fixture.stepSecret)
    expect(xml).not.toContain(fixture.hookSecret)
    expect(xml).not.toContain(fixture.summarySecret)
  })

  it('emits a failure element for the failed member test', async () => {
    const { xml } = await runJunit()
    expect(xml).toContain('<failure')
    expect(xml).toContain('Checkout test')
  })

  it('dual-mode: a suite-grouped stream produces one suite-level document', async () => {
    const { xml } = await runJunit()
    // one suite-level <testsuite name="Auth"> holding both member testcases
    expect(xml).toContain('name="Auth"')
    const suiteOpens = xml.match(/<testsuite\s/g) ?? []
    expect(suiteOpens.length).toBe(1)
  })

  it('flush() resolves only after the XML is fully written to the injected target', async () => {
    const fixture = buildReporterFixture()
    let written = false
    let capturedXml = ''
    const reporter = createJunitReporter({
      outputPath: 'out/junit.xml',
      write: async (_p: string, content: string) => {
        await Promise.resolve()
        capturedXml = content
        written = true
      },
    })
    for (const envelope of fixture.envelopes) reporter.handler(envelope)
    expect(written).toBe(false)
    await reporter.flush()
    expect(written).toBe(true)
    expect(capturedXml).toContain('<testsuites')
  })
})
