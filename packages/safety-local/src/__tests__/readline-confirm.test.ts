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
    ['\n', true],
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
})
