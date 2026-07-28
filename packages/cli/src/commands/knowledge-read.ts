// The knowledge read verbs, and the phase-384 exemplar thin client (D-05/D-07).
//
// `bundles` is the exemplar: it owns no data access of its own, asks the function layer for
// `knowledge.bundles.list`, and renders what it is handed. `inspect` and `diff` are still
// record-level reads over the knowledge-local reader entry; migrating them into the layer
// belongs to 387, which owns the review verbs, so their data imports stay and are carried
// by the plan-06 firewall ledger with a clearing milestone.
//
// The masking helpers this file imports are the agent barrel's re-exports, so the IMPORT
// ROUTE is firewall-correct for all three verbs and needs no direct dependency on the safety
// package. What they do today is nothing: each verb builds a fresh masking context and
// registers nothing in it, and unmasking an empty context is the identity function. The
// helpers are STAGED for Phase 386, which owns the run-scoped context and the live surfaces;
// they are wired through here now so that change stays non-breaking.

import { dirname, resolve } from 'node:path'

import {
  createMaskingContext,
  invokeFunction,
  unmaskForHumanOutput,
} from '@vostride/agent-qa-agent'
import { resolveKnowledgeRoot } from '@vostride/agent-qa-core'
import {
  diffSince,
  inspectRecords,
} from '@vostride/agent-qa-knowledge-local/reader'
import { resolveBuildTag } from '@vostride/agent-qa-runner-local'
import {
  guardInspectRecordView,
  guardRecordChange,
  InspectFilterSchema,
} from '@vostride/agent-qa-schema'
import type {
  InspectFilter,
  InspectRecordView,
  KnowledgeBundleSummary,
  RecordChange,
} from '@vostride/agent-qa-schema'
import { Command } from 'commander'
import pc from 'picocolors'
import { z } from 'zod'

import { resolveConfig } from '../config.js'
import {
  CLI_FUNCTION_CALLER,
  createFunctionRegistryComposition,
} from '../composition/function-registry.js'

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

interface BundlesOptions {
  json?: boolean
}

/**
 * The capability the `bundles` verb is a client of. The id is all this file knows: what
 * enumerates the store, how trust is folded, and which package reads the disk are the
 * function layer's business, reached only through `invokeFunction`.
 */
const KNOWLEDGE_BUNDLES_LIST_ID = 'knowledge.bundles.list'

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

/**
 * Everything the function-layer composition root needs, derived from the one global flag.
 *
 * Deliberately path-only and synchronous: a thin client resolves WHERE the project is and
 * nothing else. Config resolution, the knowledge root, and every host read happen inside
 * the composition's injected ports, which is why this verb needs no data package.
 */
function functionLayerInput(command: Command): { agentQaRoot: string; configPath: string } {
  const configPath = resolve(globalOptions(command).config ?? 'agent-qa.config.yaml')
  return { agentQaRoot: resolve(dirname(configPath), '.agent-qa'), configPath }
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

function formatBundleSummary(row: KnowledgeBundleSummary): string {
  const kind = row.subtype === undefined ? row.kind : `${row.kind} / ${row.subtype}`
  return [
    pc.bold(row.bundleId),
    `  product: ${row.product}`,
    `  kind: ${kind}`,
    `  scope: ${row.scope.tier}:${row.scope.key}`,
    `  status: ${row.status}`,
    `  trust: ${row.trust.toFixed(3)}${row.evidenceIncomplete ? pc.dim(' (evidence incomplete)') : ''}`,
    `  counters: confirmed=${row.counters.confirmed} contradicted=${row.counters.contradicted}`
      + ` helpful=${row.counters.helpful} harmful=${row.counters.harmful}`,
    `  validity: ${row.openedAtOrdinal}..${row.closedAtOrdinal ?? 'open'}`,
    `  last confirmed: ${row.lastConfirmedOrdinal}`,
    `  dir: ${row.dir}`,
    `  summary: ${row.summary}`,
  ].join('\n')
}

/**
 * Rows are rendered in the order the capability returned them. The op owns the total order
 * (product, then bundle id) so every surface listing the same store agrees — sorting again
 * here would be a second, surface-local ordering nobody else shares.
 */
function renderBundles(rows: readonly KnowledgeBundleSummary[]): string {
  if (rows.length === 0) {
    return pc.dim('No committed knowledge bundles.')
  }
  return [
    pc.bold(`Knowledge bundles (${rows.length})`),
    '',
    ...rows.flatMap((row, index) => (
      index === rows.length - 1
        ? [formatBundleSummary(row)]
        : [formatBundleSummary(row), '']
    )),
  ].join('\n')
}

function reportError(action: 'inspect' | 'diff' | 'bundles', error: unknown): void {
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

  // The exemplar thin client (D-05/D-07). Registered LAST on purpose: the source-shape
  // assertion in knowledge-bundles-command.test.ts reads this verb's whole registration as
  // the slice running to the end of the file, and fails loudly if a later verb is appended
  // after it rather than silently covering less.
  command
    .command('bundles')
    .description('List committed knowledge bundles through the agent function layer')
    .option('--json', 'output schema-validated masked JSON')
    .action(async (options: BundlesOptions, bundlesCommand: Command) => {
      try {
        // Everything behind this call — enumerating the store, folding trust, ordering the
        // rows, crossing the policy gate, writing the audit row — belongs to the capability.
        // This verb supplies a caller record and a project root, and renders the result.
        const rows = await invokeFunction(
          createFunctionRegistryComposition(functionLayerInput(bundlesCommand)),
          KNOWLEDGE_BUNDLES_LIST_ID,
          {},
          CLI_FUNCTION_CALLER,
        ) as readonly KnowledgeBundleSummary[]

        if (options.json === true) {
          emitJson(rows)
          return
        }
        emitHuman(renderBundles(rows))
      } catch (error) {
        reportError('bundles', error)
      }
    })
}
