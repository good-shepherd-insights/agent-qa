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
// NON-TTY IS FAIL-CLOSED AND UNCHANGED (D-03). This command binds no confirm port, so an ask-tier
// clause reaches `evaluate()`'s deny-by-default exactly as v48 specified — a scripted `ask` in CI
// cannot approve anything on a person's behalf, and the refusal arrives as a failed receipt.

import { dirname, resolve } from 'node:path'

import {
  AGENT_ASK_FUNCTION_ID,
  createMaskingContext,
  invokeFunction,
  unmaskForHumanOutput,
} from '@vostride/agent-qa-agent'
import type { AgentAskResult, ClauseReceipt } from '@vostride/agent-qa-schema'
import { Command } from 'commander'
import pc from 'picocolors'

import { CLI_FUNCTION_CALLER, composeCliLocalAgent } from '../composition/local-agent-host.js'

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
function compositionInput(command: Command): { agentQaRoot: string; configPath: string } {
  const configPath = resolve(globalOptions(command).config ?? 'agent-qa.config.yaml')
  return { agentQaRoot: resolve(dirname(configPath), '.agent-qa'), configPath }
}

/** One receipt line: what ran, how it went, and the op's own name — never its payload (D-18). */
function receiptLine(receipt: ClauseReceipt): string {
  const status =
    receipt.status === 'executed'
      ? pc.green(receipt.status)
      : receipt.status === 'failed'
        ? pc.red(receipt.status)
        : pc.dim(receipt.status)
  return `  ${status}  ${pc.bold(receipt.functionId)}  ${pc.dim(receipt.clause)}`
}

function renderTurn(result: AgentAskResult): string {
  const lines = [pc.dim(`session ${result.sessionId} · turn ${result.turnId}`)]
  if (result.receipts.length > 0) {
    lines.push(...result.receipts.map(receiptLine))
  }
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
          const { registry } = composeCliLocalAgent(composition)
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
