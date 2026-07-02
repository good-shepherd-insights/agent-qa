import { stdin, stdout } from 'node:process'
import { createInterface } from 'node:readline/promises'
import type { Readable, Writable } from 'node:stream'

import type { ConfirmPort } from '@vostride/agent-qa-safety'

export interface ReadlineConfirmIO {
  input: Readable
  output: Writable & { isTTY?: boolean }
}

export function createReadlineConfirm(
  io: ReadlineConfirmIO = { input: stdin, output: stdout },
): ConfirmPort {
  return async (action) => {
    if (!io.output.isTTY) {
      return false
    }

    const rl = createInterface({
      input: io.input,
      output: io.output,
    })

    try {
      const answer = (await rl.question(`Proceed with ${action.name}? [Y/n] `)).trim().toLowerCase()
      return answer === '' || answer === 'y' || answer === 'yes'
    } finally {
      rl.close()
    }
  }
}
