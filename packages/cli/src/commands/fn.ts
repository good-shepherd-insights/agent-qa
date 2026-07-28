// `agent-qa fn` — the generic function-layer invoker (Phase 384, D-05).
//
// A permanent registry debug/discovery surface: list what exists, invoke by id. It is a
// thin client by construction — it resolves a root, builds the registry at the composition
// root, and calls `invokeFunction`. It owns no capability of its own.

import { dirname, resolve } from 'node:path'

import {
  createMaskingContext,
  invokeFunction,
  unmaskForHumanOutput,
} from '@vostride/agent-qa-agent'
import type { FunctionDeclaration } from '@vostride/agent-qa-agent'
import { Command } from 'commander'
import pc from 'picocolors'

import {
  CLI_FUNCTION_CALLER,
  createFunctionRegistryComposition,
} from '../composition/function-registry.js'

interface FnOptions {
  list?: boolean
  json?: boolean
  input?: string
  from?: string
}

type FnErrorCode = 'invalid-input-json' | 'invalid-resume-token' | 'missing-function-id'

class FnCommandError extends Error {
  constructor(
    readonly code: FnErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'FnCommandError'
  }
}

function globalOptions(command: Command): { config?: string } {
  return command.parent?.opts<{ config?: string }>() ?? {}
}

/** Everything the composition root needs to build the registry, derived from one flag. */
function compositionInput(command: Command): { agentQaRoot: string; configPath: string } {
  const configPath = resolve(globalOptions(command).config ?? 'agent-qa.config.yaml')
  return { agentQaRoot: resolve(dirname(configPath), '.agent-qa'), configPath }
}

function parsedInput(raw: string | undefined): unknown {
  if (raw === undefined) return {}
  try {
    return JSON.parse(raw) as unknown
  } catch (error) {
    throw new FnCommandError(
      'invalid-input-json',
      `--input must be valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

/**
 * Fold `--from <lastEventId>` into the op input.
 *
 * The flag is sugar over the `lastEventId` field a stream op already declares, so a
 * resumed invocation and a hand-written `--input` are the same call. Rejecting a
 * non-integer here rather than letting the zod contract report it keeps the message about
 * the flag the operator actually typed.
 */
function withResumeToken(input: unknown, from: string | undefined): unknown {
  if (from === undefined) return input

  const lastEventId = Number(from)
  if (!Number.isInteger(lastEventId) || lastEventId < 0) {
    throw new FnCommandError(
      'invalid-resume-token',
      `--from must be a non-negative whole event seq, got: ${from}`,
    )
  }
  return { ...(input as Record<string, unknown>), lastEventId }
}

function isStream(value: unknown): value is AsyncIterable<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as AsyncIterable<unknown>)[Symbol.asyncIterator] === 'function'
  )
}

/** The seq-stamped shape every stream element carries; `seq` doubles as the resume token. */
interface SeqStamped {
  seq?: number
  type?: string
}

/**
 * Render a stream as it arrives.
 *
 * `--json` emits NDJSON — one self-contained JSON document per line — because a stream has
 * no closing bracket to wait for, and that stays true when 386 attaches to a live run.
 * Human mode prints one line per event and closes with the last seq observed, which is
 * exactly the value to hand back as `--from` on the next invocation.
 */
async function renderStream(stream: AsyncIterable<unknown>, json: boolean): Promise<void> {
  const maskingContext = json ? undefined : createMaskingContext()
  let count = 0
  let lastSeq: number | undefined

  try {
    for await (const element of stream) {
      count += 1
      const stamped = element as SeqStamped
      lastSeq = stamped.seq
      if (json) {
        console.log(JSON.stringify(element))
        continue
      }
      const label = `${pc.dim(`seq ${stamped.seq ?? '?'}`)}  ${pc.bold(stamped.type ?? 'event')}`
      console.log(unmaskForHumanOutput(maskingContext!, label))
    }

    if (!json) {
      console.log(pc.dim(
        `${count} event${count === 1 ? '' : 's'} · last seq ${lastSeq ?? 'none'}`,
      ))
    }
  } finally {
    maskingContext?.dispose()
  }
}

function emitJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2))
}

function emitHuman(maskedText: string): void {
  const maskingContext = createMaskingContext()
  try {
    console.log(unmaskForHumanOutput(maskingContext, maskedText))
  } finally {
    maskingContext.dispose()
  }
}

/** The listing projection: identity and contract metadata only, never zod internals. */
function declarationRow(declaration: FunctionDeclaration): {
  id: string
  summary: string
  requiredScopes: string[]
  resultKind: string
  bindingStatus: string
} {
  return {
    id: declaration.id,
    summary: declaration.summary,
    requiredScopes: [...declaration.requiredScopes],
    resultKind: declaration.resultKind,
    bindingStatus: declaration.bindingStatus,
  }
}

function renderListing(declarations: readonly FunctionDeclaration[]): string {
  if (declarations.length === 0) {
    return pc.dim('No functions are registered.')
  }
  return [
    pc.bold(`Registered functions (${declarations.length})`),
    '',
    ...declarations.flatMap((declaration) => [
      pc.bold(declaration.id),
      `  summary: ${declaration.summary}`,
      `  required scopes: ${declaration.requiredScopes.join(', ')}`,
      `  result kind: ${declaration.resultKind}`,
      `  binding: ${declaration.bindingStatus}`,
    ]),
  ].join('\n')
}

function reportError(error: unknown): void {
  if (error instanceof FnCommandError) {
    console.error(pc.red(`Function error [${error.code}]: ${error.message}`))
  } else if (error instanceof Error) {
    console.error(pc.red(`Function error [${error.name}]: ${error.message}`))
  } else {
    console.error(pc.red(`Function error: ${String(error)}`))
  }
  process.exitCode = 1
}

export function createFnCommand(): Command {
  return new Command('fn')
    .description('Invoke a registered agent function by id, or list the registry')
    .argument('[id]', 'dot-namespaced function id, e.g. runs.list')
    .option('--list', 'list every registered function instead of invoking one')
    .option('--json', 'emit machine-readable masked JSON')
    .option('--input <json>', 'JSON object passed as the function input (default {})')
    .option('--from <lastEventId>', 'resume a stream after this event seq')
    .action(async (id: string | undefined, options: FnOptions, command: Command) => {
      try {
        const registry = createFunctionRegistryComposition(compositionInput(command))

        if (options.list === true) {
          const declarations = registry.list(CLI_FUNCTION_CALLER)
          if (options.json === true) {
            emitJson(declarations.map(declarationRow))
            return
          }
          emitHuman(renderListing(declarations))
          return
        }

        if (id === undefined) {
          throw new FnCommandError(
            'missing-function-id',
            'Provide a function id, or pass --list to see what is registered.',
          )
        }

        const result = await invokeFunction(
          registry,
          id,
          withResumeToken(parsedInput(options.input), options.from),
          CLI_FUNCTION_CALLER,
        )

        // The registry knows which ops stream (D-08); the rendering follows the RESULT so
        // the invoker needs no per-id knowledge of its own.
        if (isStream(result)) {
          await renderStream(result, options.json === true)
          return
        }

        if (options.json === true) {
          emitJson(result)
          return
        }
        emitHuman(JSON.stringify(result, null, 2))
      } catch (error) {
        reportError(error)
      }
    })
}
