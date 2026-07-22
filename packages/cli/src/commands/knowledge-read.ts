import { dirname, resolve } from 'node:path'

import { resolveKnowledgeRoot } from '@vostride/agent-qa-core'
import {
  diffSince,
  inspectRecords,
} from '@vostride/agent-qa-knowledge-local/reader'
import { resolveBuildTag } from '@vostride/agent-qa-runner-local'
import {
  createMaskingContext,
  unmaskForHumanOutput,
} from '@vostride/agent-qa-safety'
import {
  guardInspectRecordView,
  guardRecordChange,
  InspectFilterSchema,
} from '@vostride/agent-qa-schema'
import type {
  InspectFilter,
  InspectRecordView,
  RecordChange,
} from '@vostride/agent-qa-schema'
import { Command } from 'commander'
import pc from 'picocolors'
import { z } from 'zod'

import { resolveConfig } from '../config.js'

interface InspectOptions {
  product?: string
  scope?: string
  kind?: string
  status?: string
  anchor?: string
  record?: string
  asOfBuild?: string
  unresolved?: boolean
  json?: boolean
}

interface DiffOptions {
  product?: string
  json?: boolean
}

type KnowledgeReadErrorCode =
  | 'invalid-filter'
  | 'invalid-ref'
  | 'missing-product'
  | 'unknown-build-tag'

class KnowledgeReadCommandError extends Error {
  constructor(
    readonly code: KnowledgeReadErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'KnowledgeReadCommandError'
  }
}

const CHANGE_ORDER: readonly RecordChange['change'][] = [
  'added',
  'confirmed',
  'superseded',
  'deprecated',
  'promoted',
  'purged',
]

// Keep the operator boundary fail-closed even when a workspace is running against stale built
// schema output. The shared contract carries the same enum and non-negative ordinal constraints.
const CliInspectFilterSchema = InspectFilterSchema.extend({
  status: z.enum(['active', 'candidate', 'superseded', 'deprecated']).optional(),
  asOfBuild: z.number().int().nonnegative().optional(),
})

function globalOptions(command: Command): { config?: string } {
  return command.parent?.parent?.opts<{ config?: string }>() ?? {}
}

async function resolveKnowledgePaths(command: Command): Promise<{
  knowledgeRoot: string
  runtimeRoot: string
}> {
  const global = globalOptions(command)
  const configPath = resolve(global.config ?? 'agent-qa.config.yaml')
  const configDir = dirname(configPath)
  const config = await resolveConfig({
    configPath,
    loadAuthPlugins: false,
  })
  return {
    knowledgeRoot: resolveKnowledgeRoot(config.knowledge, configDir),
    runtimeRoot: resolve(configDir, '.agent-qa'),
  }
}

function validationMessage(issues: readonly { path: PropertyKey[]; message: string }[]): string {
  return issues
    .map((issue) => {
      const path = issue.path.map(String).join('.')
      return path.length === 0 ? issue.message : `${path}: ${issue.message}`
    })
    .join('; ')
}

function inspectFilter(options: InspectOptions): InspectFilter {
  const result = CliInspectFilterSchema.safeParse({
    ...(options.product === undefined ? {} : { product: options.product }),
    ...(options.scope === undefined ? {} : { scope: options.scope }),
    ...(options.kind === undefined ? {} : { kind: options.kind }),
    ...(options.status === undefined ? {} : { status: options.status }),
    ...(options.anchor === undefined ? {} : { anchor: options.anchor }),
    ...(options.record === undefined ? {} : { recordId: options.record }),
    ...(options.asOfBuild === undefined ? {} : { asOfBuild: Number(options.asOfBuild) }),
    ...(options.unresolved === true ? { unresolvedOnly: true } : {}),
  })
  if (!result.success) {
    throw new KnowledgeReadCommandError(
      'invalid-filter',
      validationMessage(result.error.issues),
    )
  }
  return result.data
}

function resolvedDiffOrdinal(
  ref: string,
  product: string | undefined,
  runtimeRoot: string,
): number {
  if (/^-?\d+$/u.test(ref)) {
    const ordinal = Number(ref)
    if (!Number.isSafeInteger(ordinal) || ordinal < 0) {
      throw new KnowledgeReadCommandError(
        'invalid-ref',
        `Build ordinal must be a non-negative safe integer: ${ref}`,
      )
    }
    return ordinal
  }

  if (product === undefined || product.trim().length === 0) {
    throw new KnowledgeReadCommandError(
      'missing-product',
      'A build tag reference requires --product <p>.',
    )
  }

  const ordinal = resolveBuildTag({
    root: runtimeRoot,
    product,
    tag: ref,
  })
  if (ordinal === undefined) {
    throw new KnowledgeReadCommandError(
      'unknown-build-tag',
      `Unknown build tag "${ref}" for product "${product}".`,
    )
  }
  return ordinal
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

function formatInspectRecord(record: InspectRecordView): string {
  const evidenceTokens = record.evidenceTokens.length === 0
    ? 'none'
    : record.evidenceTokens.join(', ')
  const lines = [
    pc.bold(record.recordId),
    `  counts: confirmations=${record.confirmations} contradictions=${record.contradictions}`,
    `  evidence tokens: ${evidenceTokens}`,
    `  product: ${record.product}`,
    `  scope: ${record.scope}`,
    `  kind: ${record.kind}`,
    `  status: ${record.status}`,
    `  validity: ${record.openedAtOrdinal}..${record.closedAtOrdinal ?? 'open'}`,
    `  last event ordinal: ${record.lastEventOrdinal}`,
    `  anchors: ${record.anchors.length === 0 ? 'none' : record.anchors.join(', ')}`,
  ]

  if (record.trustNarrative !== undefined && record.trustNarrative !== null) {
    lines.push(
      pc.dim('  ┌ advisory (LLM narrative)'),
      ...record.trustNarrative
        .split('\n')
        .map((line) => pc.dim(`  │ ${line}`)),
      pc.dim('  └ end advisory'),
    )
  }

  return lines.join('\n')
}

function renderInspect(records: readonly InspectRecordView[]): string {
  if (records.length === 0) {
    return pc.dim('No knowledge records matched the filter.')
  }
  return [
    pc.bold(`Knowledge records (${records.length})`),
    '',
    ...records.flatMap((record, index) => (
      index === records.length - 1
        ? [formatInspectRecord(record)]
        : [formatInspectRecord(record), '']
    )),
  ].join('\n')
}

function renderChange(change: RecordChange): string {
  return [
    `  ${change.recordId}`,
    `@${change.atOrdinal}`,
    ...(change.byRecordId === undefined ? [] : [`by ${change.byRecordId}`]),
    ...(change.evidenceToken === undefined ? [] : [`evidence ${change.evidenceToken}`]),
  ].join('  ')
}

function renderDiff(changes: readonly RecordChange[], ordinal: number): string {
  if (changes.length === 0) {
    return pc.dim(`No knowledge changes after build ordinal ${ordinal}.`)
  }

  const lines = [pc.bold(`Knowledge changes after build ordinal ${ordinal}`)]
  for (const kind of CHANGE_ORDER) {
    const group = changes.filter((change) => change.change === kind)
    if (group.length === 0) continue
    lines.push('', pc.bold(`${kind} (${group.length})`), ...group.map(renderChange))
  }
  return lines.join('\n')
}

function reportError(action: 'inspect' | 'diff', error: unknown): void {
  if (error instanceof KnowledgeReadCommandError) {
    console.error(pc.red(`Knowledge ${action} error [${error.code}]: ${error.message}`))
  } else {
    console.error(pc.red(
      `Knowledge ${action} error: ${error instanceof Error ? error.message : String(error)}`,
    ))
  }
  process.exitCode = 1
}

export function registerKnowledgeReadCommands(command: Command): void {
  command
    .command('inspect')
    .description('Inspect committed knowledge records with structural filters')
    .option('--product <p>', 'filter by product')
    .option('--scope <s>', 'filter by canonical scope key')
    .option('--kind <k>', 'filter by kind: fact|procedure|caution|unknown|policy')
    .option(
      '--status <st>',
      'filter by status; superseded/deprecated automatically include audit-visible records',
    )
    .option('--anchor <a>', 'filter by canonical anchor JSON or normalized scalar value')
    .option('--record <id>', 'filter by record id')
    .option('--as-of-build <n>', 'show records valid at a non-negative build ordinal')
    .option('--unresolved', 'show only unresolved unknown records')
    .option('--json', 'output schema-validated masked JSON')
    .action(async (options: InspectOptions, inspectCommand: Command) => {
      try {
        const paths = await resolveKnowledgePaths(inspectCommand)
        const filter = inspectFilter(options)
        const records = inspectRecords({
          knowledgeRoot: paths.knowledgeRoot,
          filter,
        }).map(guardInspectRecordView)

        if (options.json === true) {
          emitJson(records)
          return
        }
        emitHuman(renderInspect(records))
      } catch (error) {
        reportError('inspect', error)
      }
    })

  command
    .command('diff')
    .description('Show semantic knowledge changes after a build ordinal or tag')
    .argument('<ref>', 'non-negative build ordinal or build tag')
    .option('--product <p>', 'product used to resolve a build tag')
    .option('--json', 'output schema-validated masked JSON')
    .action(async (ref: string, options: DiffOptions, diffCommand: Command) => {
      try {
        const paths = await resolveKnowledgePaths(diffCommand)
        const ordinal = resolvedDiffOrdinal(ref, options.product, paths.runtimeRoot)
        const changes = diffSince({
          knowledgeRoot: paths.knowledgeRoot,
          sinceOrdinal: ordinal,
        }).map(guardRecordChange)

        if (options.json === true) {
          emitJson(changes)
          return
        }
        emitHuman(renderDiff(changes, ordinal))
      } catch (error) {
        reportError('diff', error)
      }
    })
}
