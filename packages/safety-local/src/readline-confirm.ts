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
  return {
    // THE SURFACE, DECLARED WHERE THE CHANNEL IS BUILT (G-401-17). This port writes a question to a
    // stream and reads a line back, so the person answering it is at a terminal — and this function
    // is the only place in the workspace that knows that about this port. The gate used to assume
    // it for every confirm binding, which is how a click in a browser came to be recorded as a
    // terminal prompt.
    surface: 'tty-prompt',
    ask: async (action) => {
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
    },
  }
}
