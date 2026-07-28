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
}

type FnErrorCode = 'invalid-input-json' | 'missing-function-id'

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
          parsedInput(options.input),
          CLI_FUNCTION_CALLER,
        )

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
