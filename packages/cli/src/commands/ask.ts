// `agent-qa ask "<message>"` — the one-shot chat verb (Phase 392, D-01 / D-24).
//
// A THIN CLIENT, on `fn.ts`'s idiom and for its reason. It resolves a root, composes the local
// host, and calls `invokeFunction` with `agent.ask`. It owns no turn capability of its own: the
// routing, the execution and the session log all live behind a registered op, so this file could
// be deleted and every one of them would still be reachable from the MCP surface, the daemon and
// the scenario harness (§3's L10 law made structural by D-24).
//
// THE ONE-SHOT AND THE REPL ARE THE SAME TURN. D-01's two surfaces exist so scripting and
// conversation do not diverge, and the mechanism for that is not discipline — it is that both go
// through this same op with the same input contract. `ask` is a single-turn session on the same
// log grammar (D-17), which is why it needs no special case in the adapter.
//
// AT A TERMINAL THIS COMMAND ASKS, SO IT MUST SHOW (395-22 · CR-03 · CFGM-05 · the owner's
// 2026-08-15 CR-04 ruling). The paragraph that used to stand here said this command binds no
// confirm port and that an ask-tier clause therefore meets `evaluate()`'s deny-by-default exactly
// as v48 specified. It passes no confirm — but `composeCliLocalAgent` supplies
// `createTtyConfirmPort()` in its place, which is a real `readline` prompt whenever both streams
// are TTYs. 395-VERIFICATION (gap round 4) measured the consequence end to end on the from-zero
// `write_test` road: the complete set of bytes reaching the person's terminal before the decision
// was the approval prompt itself. That comment was the belief that left the hole.
//
// So this command binds `chatPresent` on the SAME stream its inherited confirm prompts on — what is
// being asked about is shown before the prompt, which is what the 2026-08-14 ruling means by
// "reviewable binds at approval time". The binder below is `chat.ts:289`'s, verbatim in shape:
// through the masker, unconditional, `process.stdout`.
//
// NON-TTY IS STILL FAIL-CLOSED (D-03). Where there is nobody to prompt, `createTtyConfirmPort`
// answers `undefined`, the field stays absent and the gate's deny-by-default is what answers — a
// scripted `ask` in CI cannot approve anything on a person's behalf, and the refusal arrives as a
// failed receipt. And where a proposal cannot be displayed at all, the route refuses above the gate
// rather than walking a person into it blind (`turn-engine.ts`'s displayability precondition).

import { dirname, resolve } from 'node:path'

import {
  AGENT_ASK_FUNCTION_ID,
  createMaskingContext,
  invokeFunction,
  unmaskForHumanOutput,
} from '@vostride/agent-qa-agent'
import type { AgentAskResult } from '@vostride/agent-qa-schema'
import { Command } from 'commander'
import pc from 'picocolors'

import { CLI_FUNCTION_CALLER, composeCliLocalAgent } from '../composition/local-agent-host.js'
import { receiptLine } from './receipt-line.js'
import { renderClauseResults } from './result-render.js'

type AskErrorCode = 'missing-message' | 'fail-closed' | 'clause-failed'

class AskCommandError extends Error {
  constructor(
    readonly code: AskErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'AskCommandError'
  }
}

function globalOptions(command: Command): { config?: string } {
  return command.parent?.opts<{ config?: string }>() ?? {}
}

/** Everything the composition root needs, derived from one flag — the `fn.ts` derivation. */
function compositionInput(
  command: Command,
): { agentQaRoot: string; configPath: string; mintingSurface: string } {
  const configPath = resolve(globalOptions(command).config ?? 'agent-qa.config.yaml')
  return {
    agentQaRoot: resolve(dirname(configPath), '.agent-qa'),
    configPath,
    // 400-05: `agent-qa ask` is one scripted turn taken by the caller one line below — the `cli`
    // surface — so that is the word its proposals carry.
    mintingSurface: CLI_FUNCTION_CALLER.surface,
  }
}

function renderTurn(result: AgentAskResult): string {
  const lines = [pc.dim(`session ${result.sessionId} · turn ${result.turnId}`)]
  // A `--session` resume can land on a damaged log, and a scripted caller that heard nothing about
  // it would carry on against a conversation quietly missing part of itself (392-03).
  if (result.refusedLineCount !== undefined) {
    lines.push(
      pc.yellow(`${result.refusedLineCount} line(s) of this session could not be read.`),
    )
  }
  if (result.receipts.length > 0) {
    lines.push(...result.receipts.map(receiptLine))
  }
  // 399.1 (D-04/D-05): the same payload block the REPL prints, from the same module — the one-shot
  // and the conversation are the same turn, and a scripted caller that was shown less than the
  // person at the prompt would be the drift D-01 forbids.
  lines.push(...renderClauseResults(result.results, result.receipts.length))
  if (result.answer !== undefined) lines.push(result.answer)
  return lines.join('\n')
}

/**
 * Everything a surface prints goes through the masker (`fn.ts:143-150`).
 *
 * The turn result is composed from op results, and an op result is exactly the kind of value a
 * masked config read can put a credential into. Printing it raw would be a disclosure boundary
 * this file does not own.
 */
function emitHuman(text: string): void {
  const maskingContext = createMaskingContext()
  try {
    console.log(unmaskForHumanOutput(maskingContext, text))
  } finally {
    maskingContext.dispose()
  }
}

/**
 * The mid-turn render, on THE SAME STREAM the inherited TTY confirm prompts on (395-22 · D-14).
 *
 * `chat.ts:289`'s binder, adapted to a surface that owns no stream of its own. Three properties and
 * they are all load-bearing:
 *
 *   THE STREAM — `process.stdout`, which is where `createTtyConfirmPort` writes its prompt. A
 *   proposal rendered anywhere else is a proposal the person answering the prompt is not reading.
 *
 *   UNCONDITIONAL, INCLUDING UNDER PIPED STDIN. A scripted `ask` is still a transcript somebody
 *   reads, and it is the surface the live lane greps; suppressing the render for non-TTY would make
 *   the one automatable reading of this clause unavailable.
 *
 *   THROUGH THE MASKER, on `emitHuman`'s law above: everything this file prints crosses it. The
 *   bytes here already passed the construction scan (D-12), so this is the second of two
 *   independent passes rather than the only one.
 */
function chatPresent(text: string): void {
  const maskingContext = createMaskingContext()
  try {
    process.stdout.write(`${unmaskForHumanOutput(maskingContext, text)}\n`)
  } finally {
    maskingContext.dispose()
  }
}

function reportError(error: unknown): void {
  if (error instanceof AskCommandError) {
    console.error(pc.red(`Ask error [${error.code}]: ${error.message}`))
  } else if (error instanceof Error) {
    console.error(pc.red(`Ask error [${error.name}]: ${error.message}`))
  } else {
    console.error(pc.red(`Ask error: ${String(error)}`))
  }
  process.exitCode = 1
}

export function createAskCommand(): Command {
  return new Command('ask')
    .description('Ask agent-qa to do one thing and report what it did')
    .argument('[message...]', 'what to do, in words')
    .option('--session <id>', 'continue an existing chat session instead of starting one')
    .action(
      async (
        message: string[] | undefined,
        options: { session?: string },
        command: Command,
      ) => {
        try {
          const utterance = (message ?? []).join(' ').trim()
          if (utterance === '') {
            throw new AskCommandError('missing-message', 'Say what you want done, e.g. agent-qa ask "proposals".')
          }

          const composition = compositionInput(command)
          const { registry } = composeCliLocalAgent({ ...composition, chatPresent })
          const result = (await invokeFunction(
            registry,
            AGENT_ASK_FUNCTION_ID,
            options.session === undefined
              ? { message: utterance }
              : { message: utterance, sessionId: options.session },
            CLI_FUNCTION_CALLER,
          )) as AgentAskResult

          emitHuman(renderTurn(result))

          // A scripted `ask` whose request was not carried out must not look like success to the
          // shell that called it. Both non-success statuses raise, so the exit code and the
          // rendered receipts agree — reporting one without the other is how a CI step goes green
          // on a turn that refused everything (D-08 / D-11).
          //
          // 2026-08-20 (399.1-09, D-12) — WHAT THIS GATE NOW SEES, AND WHAT IT DELIBERATELY DOES
          // NOT. Nothing below changed; what changed is upstream. The turn aggregate is derived
          // from the receipt vocabulary rather than from whether the op threw, so a `failed`
          // receipt — thrown OR returned — reaches the `clause-failed` branch below. Until then
          // that branch was dead for every returned failure: a typed refusal returns, the flag was
          // set only in the engine's catch, and a turn carrying a `failed` receipt exited 0.
          //
          // A REFUSED-ONLY TURN DELIBERATELY KEEPS THE SUCCESS EXIT. `refused` means the control
          // worked and the op answered (D-02), so it is not a failure to stop or to raise on; and
          // the `fn` door was measured exiting 0 on the identical blocked payload. E2E-02 clause 2
          // makes door DISAGREEMENT the defect class, so moving this door alone would mint a parity
          // break inside the phase that exists to close one. The refusal reaches a reader on the
          // receipt word, the rendered payload beneath it, and `agent.ask`'s own outer verdict.
          if (result.status === 'fail_closed') {
            throw new AskCommandError(
              'fail-closed',
              result.unhandled?.reason
                ?? 'The turn was refused before anything ran, and nothing was carried out.',
            )
          }
          if (result.status === 'failed') {
            const failure = result.receipts.find((receipt) => receipt.status === 'failed')
            throw new AskCommandError(
              'clause-failed',
              `"${failure?.clause ?? utterance}" failed: ${failure?.outcome ?? 'unknown failure'}`,
            )
          }
        } catch (error) {
          reportError(error)
        }
      },
    )
}
