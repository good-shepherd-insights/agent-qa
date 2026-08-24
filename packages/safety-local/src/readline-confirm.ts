import { stdin, stdout } from 'node:process'
import { createInterface } from 'node:readline'
import type { Readable, Writable } from 'node:stream'

import type { ConfirmPort } from '@vostride/agent-qa-safety'

export interface ReadlineConfirmIO {
  input: Readable & { isTTY?: boolean }
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
    ask: (action) => new Promise<boolean>((answer) => {
      // NEITHER STREAM MAY CONTRADICT THE SURFACE DECLARED ABOVE. The output check is the original
      // one; the input check is the half that was missing, and it is deliberately asymmetric — it
      // refuses only an EXPLICIT `false`. An injected stream carries no `isTTY` at all, and reading
      // `undefined` as "not a terminal" would make this port deny every answer it was handed.
      if (!io.output.isTTY || io.input.isTTY === false) {
        answer(false)
        return
      }

      const rl = createInterface({
        input: io.input,
        output: io.output,
      })

      let settled = false
      const settle = (approved: boolean): void => {
        if (settled) return
        settled = true
        rl.close()
        answer(approved)
      }

      // EOF IS A REFUSAL, and it needs its own handler rather than falling out of the question.
      // `question` never settles when the stream simply ends — it waits for a line that is not
      // coming — so a piped or closed stdin that slipped past the checks above would leave a
      // capability call hanging forever instead of denying. Measured, not anticipated: the
      // stream-ends-with-no-line case in this port's own suite timed out at 3s until this handler
      // existed, and the mismatched-stream case at 30s. It is also the half that closes that risk
      // without any assumption about `isTTY` being present on an injected stream at all.
      //
      // The `settled` guard is what keeps this handler and the answer callback from both resolving:
      // `settle` closes the interface, which fires `close`, which re-enters here.
      rl.on('close', () => {
        settle(false)
      })

      // DENY ON EMPTY (DF-2). The prompt reads `[y/N]` and only an explicit y/yes approves. It used
      // to read `[Y/n]` and treat an empty line as approval, so someone who pressed Enter without
      // reading approved an ask-tier action — a default that answers for a person is not a confirm.
      rl.question(`Proceed with ${action.name}? [y/N] `, (typed: string) => {
        const normalized = typed.trim().toLowerCase()
        settle(normalized === 'y' || normalized === 'yes')
      })
    }),
  }
}
