import { PassThrough, Readable, Writable } from 'node:stream'

import type { RiskActionDescriptor } from '@vostride/agent-qa-schema'
import { describe, expect, it } from 'vitest'

import { createReadlineConfirm } from '../readline-confirm'

const action: RiskActionDescriptor = {
  name: 'deploy_service',
  recognized: true,
}

function createOutput(isTTY: boolean): Writable & { isTTY: boolean } {
  const output = new Writable({
    write(_chunk, _encoding, callback) {
      callback()
    },
  }) as Writable & { isTTY: boolean }
  output.isTTY = isTTY
  return output
}

class ThrowIfRead extends Readable {
  readCalls = 0

  _read() {
    this.readCalls += 1
    this.destroy(new Error('input should not be consumed'))
  }
}

describe('createReadlineConfirm', () => {
  it('denies without consuming input when output is not a TTY', async () => {
    const input = new ThrowIfRead()
    const confirm = createReadlineConfirm({
      input,
      output: createOutput(false),
    })

    await expect(confirm.ask(action)).resolves.toBe(false)
    expect(input.readCalls).toBe(0)
    // G-401-17: the readline port speaks for a terminal, and says so at the site that builds it.
    expect(confirm.surface).toBe('tty-prompt')
  })

  it.each([
    ['y\n', true],
    ['yes\n', true],
    // A BARE ENTER IS A REFUSAL, NOT AN APPROVAL (DF-2). This cell used to pin `true`: someone who
    // pressed Enter without reading approved an ask-tier action. The prompt reads `[y/N]` and only
    // an explicit y/yes approves.
    ['\n', false],
    ['n\n', false],
    ['no\n', false],
    ['garbage\n', false],
  ] as const)('parses %j from injected TTY io', async (answer, expected) => {
    const input = new PassThrough()
    const confirm = createReadlineConfirm({
      input,
      output: createOutput(true),
    })

    const result = confirm.ask(action)
    input.end(answer)

    await expect(result).resolves.toBe(expected)
  })

  // EOF IS A REFUSAL (DF-2, defect 2). The stream simply ends with no line at all — `question` waits
  // forever for a line that is not coming unless a `close` handler settles it. The explicit timeout
  // is what turns that hang into a reported failure instead of a 30s suite stall.
  it(
    'denies when the input stream ends without a line',
    async () => {
      const input = new PassThrough()
      const confirm = createReadlineConfirm({
        input,
        output: createOutput(true),
      })

      const result = confirm.ask(action)
      input.end()

      await expect(result).resolves.toBe(false)
    },
    3000,
  )

  // THE MISMATCHED-STREAM CASE (DF-2). A TTY output paired with an explicitly non-TTY input is the
  // piped-stdin shape that slipped past the output-only gate; it must deny without reading.
  it('denies without consuming input when input is explicitly not a TTY', async () => {
    const input = new ThrowIfRead() as ThrowIfRead & { isTTY: boolean }
    input.isTTY = false
    const confirm = createReadlineConfirm({
      input,
      output: createOutput(true),
    })

    await expect(confirm.ask(action)).resolves.toBe(false)
    expect(input.readCalls).toBe(0)
  })
})
