// THE OLD WIRE'S ENVELOPE-SEQUENCE ANCHOR (Phase 401 plan 07, D-09 / INVK-01 truth 2).
//
// THIS CELL IS A MEASUREMENT TAKEN BEFORE A DELETION. `TestRunner` — the spawn plus the
// `AGENT_QA_EVENT:` stdout scrape — is deleted in this plan's next task, and with it goes the only
// way to observe what the db / SSE / step-projection consumers actually received. So the anchor is
// captured here, from the real class, driven by a real child process, and committed as
// `__fixtures__/envelope-parity-golden.json` in the commit that PRECEDES the deletion.
//
// WHAT IT DRIVES IS THE SHIPPED PRODUCER, not a stand-in: `TestRunner.execute` spawns the binary it
// is given, the child prints the fixture's envelopes on stdout, and the class's own scrape, buffer
// and `execution-event` emission do the rest. The only thing substituted is the binary, which is
// what makes the envelope sequence a controlled input instead of whatever a real run happened to
// produce.
//
// RE-CAPTURE, DELIBERATELY GATED. `AGENT_QA_401_07_CAPTURE=1` rewrites the golden; anything else
// asserts against it. A golden that regenerates itself on a red is not an anchor.
//
// THIS FILE DIES WITH `test-runner.ts` IN TASK 2, and its commit is the record. The golden it
// leaves behind is what `in-process-backend.test.ts` asserts the NEW wire against.

import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

import { TestRunner, type LiveExecutionEvent } from '../test-runner.js'
import {
  PARITY_ENVELOPES,
  PARITY_MALFORMED_WIRE_LINE,
  PARITY_PLAIN_STDOUT_LINE,
  PARITY_RUN_ID,
  scrubParityEvents,
} from './envelope-parity-fixture.js'

const GOLDEN_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '__fixtures__',
  'envelope-parity-golden.json',
)

let workdir: string | undefined

afterEach(() => {
  if (workdir) {
    rmSync(workdir, { recursive: true, force: true })
    workdir = undefined
  }
})

/**
 * A binary that prints the fixture's wire lines and exits 0.
 *
 * The two non-envelope lines are interleaved rather than appended, so their absence from the buffer
 * is a claim about the scrape's filter and not about ordering luck.
 */
function writeWireBinary(): string {
  workdir = mkdtempSync(join(tmpdir(), 'agent-qa-401-07-oldwire-'))
  const binPath = join(workdir, 'fake-agent-qa')
  const lines: string[] = []
  for (const [index, envelope] of PARITY_ENVELOPES.entries()) {
    if (index === 2) lines.push(PARITY_PLAIN_STDOUT_LINE)
    if (index === 5) lines.push(PARITY_MALFORMED_WIRE_LINE)
    lines.push(`AGENT_QA_EVENT:${JSON.stringify(envelope)}`)
  }
  writeFileSync(
    binPath,
    [
      '#!/usr/bin/env node',
      `const lines = ${JSON.stringify(lines)}`,
      'for (const line of lines) process.stdout.write(line + "\\n")',
      'process.exit(0)',
      '',
    ].join('\n'),
  )
  chmodSync(binPath, 0o755)
  return binPath
}

/** Drive the old wire once and hand back BOTH consumer surfaces. */
async function driveOldWire(): Promise<{
  buffered: LiveExecutionEvent[]
  emitted: LiveExecutionEvent[]
  emittedRunIds: string[]
}> {
  const cliBin = writeWireBinary()
  const runner = new TestRunner({ cliBin })
  const emitted: LiveExecutionEvent[] = []
  const emittedRunIds: string[] = []
  runner.on('execution-event', (runId: string, event: LiveExecutionEvent) => {
    emittedRunIds.push(runId)
    emitted.push(event)
  })

  const closed = new Promise<void>((resolve) => {
    const poll = setInterval(() => {
      const handle = runner.getHandle(PARITY_RUN_ID)
      if (handle && handle.status !== 'running') {
        clearInterval(poll)
        // The `run-complete` push happens in the same `close` handler that set the status; give the
        // microtask queue one turn so the buffer is complete when it is read.
        setTimeout(resolve, 20)
      }
    }, 5)
  })

  runner.execute({ runId: PARITY_RUN_ID, args: ['tests/parity.yaml'], source: 'dashboard' })
  await closed
  const buffered = runner.getBufferedEvents(PARITY_RUN_ID)
  runner.killAll()
  return { buffered, emitted, emittedRunIds }
}

describe('the retiring wire’s envelope sequence — the anchor 401-07 measures parity against', () => {
  it('THE ANCHOR — the spawn + scrape hands the consumers this exact LiveExecutionEvent[]', async () => {
    const { buffered } = await driveOldWire()
    const reading = scrubParityEvents(buffered)

    if (process.env.AGENT_QA_401_07_CAPTURE === '1') {
      writeFileSync(GOLDEN_PATH, `${JSON.stringify(reading, null, 2)}\n`)
    }

    expect(existsSync(GOLDEN_PATH)).toBe(true)
    const golden = JSON.parse(readFileSync(GOLDEN_PATH, 'utf8')) as unknown[]
    // NON-VACUITY, before any verdict about the reading: a golden that had been truncated to an
    // empty list would make every assertion below pass while measuring nothing.
    expect(golden.length).toBeGreaterThan(PARITY_ENVELOPES.length)
    expect(reading).toEqual(golden)
  })

  it('THE EMITTED STREAM IS THE BUFFER — one push, two surfaces, same order, run-scoped', async () => {
    const { buffered, emitted, emittedRunIds } = await driveOldWire()
    expect(scrubParityEvents(emitted)).toEqual(scrubParityEvents(buffered))
    expect(new Set(emittedRunIds)).toEqual(new Set([PARITY_RUN_ID]))
  })

  it('NEITHER NON-ENVELOPE LINE REACHED THE BUFFER — the scrape’s filter, stated as an absence', async () => {
    const { buffered } = await driveOldWire()
    const serialised = JSON.stringify(buffered)
    expect(serialised).not.toContain(PARITY_PLAIN_STDOUT_LINE)
    expect(serialised).not.toContain('"seq":9')
  })
})
