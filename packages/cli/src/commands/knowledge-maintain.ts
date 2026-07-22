import { userInfo } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { createInterface } from 'node:readline'

import { resolveKnowledgeRoot } from '@vostride/agent-qa-core'
import {
  acquireWriterLease,
  purgeAffectedSetFingerprint,
  purgeRecord,
  rebuildIndex,
  refreshWriterLeaseAuthority,
  releaseLease,
  resolvePurgeAffectedSet,
  resolveRollbackAffectedSet,
  rollbackAffectedSetFingerprint,
  rollbackCampaign,
  rollbackCurationJob,
} from '@vostride/agent-qa-knowledge-local'
import type {
  PurgeAffectedSet,
  PurgeReceipt,
  RebuildReport,
  RollbackAffectedSet,
  RollbackCampaignInput,
  RollbackCurationJobInput,
  RollbackReport,
  WriterLeaseAuthority,
} from '@vostride/agent-qa-knowledge-local'
import {
  BuildOrdinalReservationError,
  reserveBuildOrdinalForProducts,
} from '@vostride/agent-qa-runner-local'
import {
  createMaskingContext,
  unmaskForHumanOutput,
} from '@vostride/agent-qa-safety'
import { asRecordId } from '@vostride/agent-qa-schema'
import type { OriginClass } from '@vostride/agent-qa-schema'
import { Command } from 'commander'
import pc from 'picocolors'

import { resolveConfig } from '../config.js'

interface RebuildOptions {
  json?: boolean
}

interface RollbackOptions {
  job?: string
  fromBuild?: string
  toBuild?: string
  anchorCluster?: string
  originClass?: string
  yes?: boolean
  json?: boolean
}

interface PurgeOptions {
  confirm?: string
  json?: boolean
}

interface KnowledgePaths {
  knowledgeRoot: string
  runtimeRoot: string
  auditBaseDir: string
}

type OutputStream = 'stdout' | 'stderr'

interface PromptDestination {
  name: OutputStream
  stream: typeof process.stdout | typeof process.stderr
}

type MaintainErrorCode =
  | 'invalid-selector'
  | 'invalid-ordinal'
  | 'invalid-origin-class'
  | 'preview-changed'
  | 'release-refused'

class KnowledgeMaintainCommandError extends Error {
  constructor(
    readonly code: MaintainErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'KnowledgeMaintainCommandError'
  }
}

type LeaseRunOutcome<T> =
  | { kind: 'completed'; value: T }
  | { kind: 'refused' }

type RollbackSelector =
  | { kind: 'job'; curationJobId: string }
  | {
      kind: 'campaign'
      fromOrdinal?: number
      toOrdinal?: number
      anchorClusterKey?: string
      originClass?: OriginClass
    }

type RollbackExecutionOutcome =
  | { kind: 'aborted' }
  | { kind: 'completed'; report: RollbackReport }

type PurgeExecutionOutcome =
  | { kind: 'aborted' }
  | { kind: 'completed'; receipt: PurgeReceipt; alreadyPurged: boolean }
  | { kind: 'failed' }

const ORIGIN_CLASSES = new Set<OriginClass>([
  'user',
  'agent-verified',
  'agent-observed',
  'import',
])

/** Five seconds is strictly below the writer lease's fixed 30-second TTL divided by three. */
const WRITER_LEASE_HEARTBEAT_INTERVAL_MS = 5_000

function globalOptions(command: Command): { config?: string } {
  return command.parent?.parent?.opts<{ config?: string }>() ?? {}
}

async function resolveKnowledgePaths(command: Command): Promise<KnowledgePaths> {
  const global = globalOptions(command)
  const configPath = resolve(global.config ?? 'agent-qa.config.yaml')
  const configDir = dirname(configPath)
  const config = await resolveConfig({
    configPath,
    loadAuthPlugins: false,
  })
  const knowledgeRoot = resolveKnowledgeRoot(config.knowledge, configDir)
  const runtimeRoot = resolve(configDir, '.agent-qa')
  return {
    knowledgeRoot,
    runtimeRoot,
    auditBaseDir: runtimeRoot,
  }
}

function emitJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2))
}

function emitHuman(maskedText: string, stream: OutputStream = 'stdout'): void {
  const maskingContext = createMaskingContext()
  try {
    const rendered = `${unmaskForHumanOutput(maskingContext, maskedText)}\n`
    if (stream === 'stderr') process.stderr.write(rendered)
    else process.stdout.write(rendered)
  } finally {
    maskingContext.dispose()
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function reportError(verb: 'rebuild-index' | 'rollback' | 'purge', error: unknown): void {
  const message = error instanceof KnowledgeMaintainCommandError
    ? `knowledge ${verb}: error [${error.code}]: ${error.message}`
    : error instanceof BuildOrdinalReservationError
      ? `knowledge ${verb}: error [${error.code}]: ${error.message}`
      : `knowledge ${verb}: error: ${errorMessage(error)}`
  emitHuman(pc.red(message), 'stderr')
  process.exitCode = 1
}

function renderLeaseRefusal(
  verb: 'rebuild-index' | 'rollback' | 'purge',
  holder: { leaseId: string; pid: number; epoch: number },
): string {
  return pc.red(
    `knowledge ${verb}: refusal [writer-lease-held]: writer lease is held by `
    + `pid ${holder.pid}, lease ${holder.leaseId}, epoch ${holder.epoch}`,
  )
}

async function withWriterLease<T>(
  verb: 'rebuild-index' | 'rollback' | 'purge',
  knowledgeRoot: string,
  operation: (writerAuthority: WriterLeaseAuthority) => Promise<T> | T,
): Promise<LeaseRunOutcome<T>> {
  const lease = acquireWriterLease(knowledgeRoot)
  if (lease.kind === 'held') {
    emitHuman(renderLeaseRefusal(verb, lease.holder), 'stderr')
    process.exitCode = 1
    return { kind: 'refused' }
  }

  const writerAuthority: WriterLeaseAuthority = {
    knowledgeRoot,
    leaseId: lease.leaseId,
    epoch: lease.epoch,
  }
  let heartbeatError: unknown
  const heartbeatTimer = setInterval(() => {
    if (heartbeatError !== undefined) return
    try {
      refreshWriterLeaseAuthority(writerAuthority)
    } catch (error) {
      heartbeatError = error
    }
  }, WRITER_LEASE_HEARTBEAT_INTERVAL_MS)
  heartbeatTimer.unref()

  let operationError: unknown
  try {
    const value = await operation(writerAuthority)
    if (heartbeatError !== undefined) throw heartbeatError
    refreshWriterLeaseAuthority(writerAuthority)
    return { kind: 'completed', value }
  } catch (error) {
    operationError = error
    throw error
  } finally {
    clearInterval(heartbeatTimer)
    const release = releaseLease({ knowledgeRoot, leaseId: lease.leaseId })
    if (release.kind === 'refused' && operationError === undefined) {
      throw new KnowledgeMaintainCommandError(
        'release-refused',
        `writer lease release was refused (${release.reason})`,
      )
    }
  }
}

function promptDestination(json: boolean): PromptDestination {
  return json
    ? { name: 'stderr', stream: process.stderr }
    : { name: 'stdout', stream: process.stdout }
}

function canPromptInteractively(destination: PromptDestination): boolean {
  return process.stdin.isTTY === true && destination.stream.isTTY === true
}

function promptForAnswer(question: string, destination: PromptDestination): Promise<string> {
  const readline = createInterface({ input: process.stdin, output: destination.stream })
  return new Promise((resolveAnswer) => {
    readline.question(question, (answer) => {
      readline.close()
      resolveAnswer(answer)
    })
  })
}

function renderRebuildReport(report: RebuildReport): string {
  return [
    pc.bold('Knowledge index rebuild complete'),
    `  projected: ${report.projected}`,
    `  removed: ${report.removed}`,
    `  backfilled: ${report.backfilled}`,
    `  vector capability: ${report.vec}`,
    `  pending embeddings: ${report.pendingEmbeddings}`,
    `  maintenance remaining: ${report.maintenanceRemaining ? 'yes' : 'no'}`,
    ...(report.skippedIncomplete === 0
      ? []
      : [`  skipped incomplete bundles: ${report.skippedIncomplete}`]),
    ...(report.scanIssues.length === 0
      ? []
      : [
          `  scan issues (${report.scanIssues.length}):`,
          ...report.scanIssues.map((issue) => `    ${issue}`),
        ]),
  ].join('\n')
}

function parseOrdinal(value: string | undefined, label: string): number | undefined {
  if (value === undefined) return undefined
  if (!/^(0|[1-9][0-9]*)$/u.test(value)) {
    throw new KnowledgeMaintainCommandError(
      'invalid-ordinal',
      `${label} must be a non-negative safe integer`,
    )
  }
  const ordinal = Number(value)
  if (!Number.isSafeInteger(ordinal)) {
    throw new KnowledgeMaintainCommandError(
      'invalid-ordinal',
      `${label} must be a non-negative safe integer`,
    )
  }
  return ordinal
}

function rollbackSelector(options: RollbackOptions): RollbackSelector {
  const campaignSelected = options.fromBuild !== undefined
    || options.toBuild !== undefined
    || options.anchorCluster !== undefined
    || options.originClass !== undefined

  if (options.job !== undefined && campaignSelected) {
    throw new KnowledgeMaintainCommandError(
      'invalid-selector',
      '--job cannot be combined with campaign selectors',
    )
  }
  if (options.job !== undefined) {
    if (options.job.trim() === '') {
      throw new KnowledgeMaintainCommandError('invalid-selector', '--job must be non-empty')
    }
    return { kind: 'job', curationJobId: options.job }
  }
  if (!campaignSelected) {
    throw new KnowledgeMaintainCommandError(
      'invalid-selector',
      'provide --job or at least one campaign selector',
    )
  }

  let originClass: OriginClass | undefined
  if (options.originClass !== undefined) {
    if (!ORIGIN_CLASSES.has(options.originClass as OriginClass)) {
      throw new KnowledgeMaintainCommandError(
        'invalid-origin-class',
        '--origin-class must be user|agent-verified|agent-observed|import',
      )
    }
    originClass = options.originClass as OriginClass
  }

  return {
    ...(options.fromBuild === undefined
      ? {}
      : { fromOrdinal: parseOrdinal(options.fromBuild, '--from-build')! }),
    ...(options.toBuild === undefined
      ? {}
      : { toOrdinal: parseOrdinal(options.toBuild, '--to-build')! }),
    ...(options.anchorCluster === undefined
      ? {}
      : { anchorClusterKey: options.anchorCluster }),
    ...(originClass === undefined ? {} : { originClass }),
    kind: 'campaign',
  }
}

function rollbackInput(
  selector: RollbackSelector,
  paths: KnowledgePaths,
  resolvedAtOrdinal: number,
  writerAuthority?: WriterLeaseAuthority,
  expectedAffectedSetFingerprint?: string,
): RollbackCurationJobInput | RollbackCampaignInput {
  const base = {
    knowledgeRoot: paths.knowledgeRoot,
    auditBaseDir: paths.auditBaseDir,
    resolvedAtOrdinal,
    ...(writerAuthority === undefined ? {} : { writerAuthority }),
    ...(expectedAffectedSetFingerprint === undefined
      ? {}
      : { expectedAffectedSetFingerprint }),
  }
  return selector.kind === 'job'
    ? { ...base, curationJobId: selector.curationJobId }
    : {
        ...base,
        ...(selector.fromOrdinal === undefined ? {} : { fromOrdinal: selector.fromOrdinal }),
        ...(selector.toOrdinal === undefined ? {} : { toOrdinal: selector.toOrdinal }),
        ...(selector.anchorClusterKey === undefined
          ? {}
          : { anchorClusterKey: selector.anchorClusterKey }),
        ...(selector.originClass === undefined ? {} : { originClass: selector.originClass }),
      }
}

async function rollbackOrdinal(
  paths: KnowledgePaths,
  affected: RollbackAffectedSet,
  writerAuthority: WriterLeaseAuthority,
): Promise<number> {
  if (!rollbackNeedsOrdinal(affected)) return 0
  return (await reserveBuildOrdinalForProducts({
    root: paths.runtimeRoot,
    products: affected.products,
    beforePersist: () => refreshWriterLeaseAuthority(writerAuthority),
  })) ?? 0
}

function rollbackNeedsOrdinal(affected: RollbackAffectedSet): boolean {
  return affected.plannedEffects.some((effect) =>
    effect.kind === 'deprecate-bundle'
    || effect.kind === 'retract-counter'
    || effect.kind === 'retract-window-close'
    || effect.kind === 'retract-promotion',
  )
}

function rollbackPreviewFingerprint(affected: RollbackAffectedSet): string {
  return rollbackAffectedSetFingerprint(affected)
}

function renderRollbackPreview(affected: RollbackAffectedSet): string {
  return [
    pc.bold('Rollback preview'),
    `  minted bundles (${affected.mintedBundleIds.length}):`,
    ...(affected.mintedBundleIds.length === 0
      ? ['    none']
      : affected.mintedBundleIds.map((recordId) => `    ${recordId}`)),
    `  counter events (${affected.counterEvents.length}):`,
    ...(affected.counterEvents.length === 0
      ? ['    none']
      : affected.counterEvents.map((event) => (
          `    ${event.type} ${event.recordId} `
          + `(job ${event.curationJobId}, evidence ${event.evidenceToken})`
        ))),
    `  complete inverse effects (${affected.plannedEffects.length}):`,
    ...(affected.plannedEffects.length === 0
      ? ['    none']
      : affected.plannedEffects.map((effect) => (
          effect.kind === 'deprecate-bundle'
            ? `    ${effect.kind} ${effect.product}/${effect.recordId}`
            : `    ${effect.kind} ${effect.product}/${effect.recordId} (${effect.eventKey})`
        ))),
  ].join('\n')
}

function renderRollbackReport(report: RollbackReport): string {
  return [
    pc.green(pc.bold('Rollback complete')),
    `  receipt: ${report.receiptId}`,
    `  inverse events appended: ${report.inverseCount}`,
    `  deprecated bundles: ${report.deprecatedBundles.join(', ') || 'none'}`,
    `  restored victims: ${report.restoredVictims.join(', ') || 'none'}`,
    `  retracted promotions: ${report.retractedPromotions.join(', ') || 'none'}`,
  ].join('\n')
}

function renderPurgePreview(affected: PurgeAffectedSet): string {
  return [
    pc.bold(`Purge preview for ${affected.recordId}`),
    `  state: ${affected.state}`,
    `  bundle trees (${affected.bundles.length}):`,
    ...(affected.bundles.length === 0
      ? ['    none']
      : affected.bundles.flatMap((bundle) => [
          `    ${bundle.bundleDir} (product ${bundle.product}, kind ${bundle.kind})`,
          ...bundle.affectedPaths.map((path) => `      ${path}`),
        ])),
    `  receipt-named affected paths (${affected.receiptAffectedPaths.length}):`,
    ...(affected.receiptAffectedPaths.length === 0
      ? ['    none']
      : affected.receiptAffectedPaths.map((path) => `    ${path}`)),
    `  queue targets (${affected.queueTargets.length}):`,
    ...(affected.queueTargets.length === 0
      ? ['    none']
      : affected.queueTargets.flatMap((target) => [
          `    payload: ${target.candidateDir} (${target.candidateId})`,
          `    job state: ${target.jobStatePath}`,
        ])),
    `  projections: ${affected.projectionTargets.join(', ')}`,
    `  embed cache: ${affected.embedCacheAction}`,
    `  intent: ${affected.intentPath}`,
    `  receipt: ${affected.receiptPath}`,
  ].join('\n')
}

function assertPreviewUnchanged(verb: 'rollback' | 'purge', before: string, after: string): void {
  if (before === after) return
  throw new KnowledgeMaintainCommandError(
    'preview-changed',
    `authorized ${verb} target changed before writer authority was acquired; rerun the command`,
  )
}

function renderPurgeReceipt(receipt: PurgeReceipt, alreadyPurged: boolean): string {
  return [
    pc.green(pc.bold(alreadyPurged ? 'Record already purged' : 'Purge complete')),
    `  record: ${receipt.purgedRecordId}`,
    `  purge ordinal: ${receipt.purgedAtOrdinal}`,
    `  initiator: ${receipt.initiator}`,
    '',
    pc.bold('Git history rewrite guidance'),
    '  The working-tree purge does not remove prior Git history.',
    `  The record first appeared at build ordinal ${receipt.firstCommittedOrdinal}.`,
    '  If repository history must also be rewritten, review these receipt-named paths:',
    ...receipt.affectedPaths.map((path) => `    ${path}`),
    '  Coordinate the history rewrite and any force-push with every repository consumer.',
  ].join('\n')
}

export function registerKnowledgeMaintainCommands(command: Command): void {
  command
    .command('rebuild-index')
    .description('Rebuild derived knowledge index projections')
    .option('--json', 'output the typed RebuildReport as masked JSON')
    .action(async (options: RebuildOptions, rebuildCommand: Command) => {
      try {
        const paths = await resolveKnowledgePaths(rebuildCommand)
        const result = await withWriterLease('rebuild-index', paths.knowledgeRoot, (writerAuthority) => (
          rebuildIndex({ knowledgeRoot: paths.knowledgeRoot, writerAuthority })
        ))
        if (result.kind === 'refused') return
        if (options.json === true) emitJson(result.value)
        else emitHuman(renderRebuildReport(result.value))
      } catch (error) {
        reportError('rebuild-index', error)
      }
    })

  command
    .command('rollback')
    .description('Append inverse events for a curation job or provenance campaign')
    .option('--job <id>', 'rollback one curation job')
    .option('--from-build <n>', 'campaign lower build ordinal (inclusive)')
    .option('--to-build <n>', 'campaign upper build ordinal (inclusive)')
    .option('--anchor-cluster <key>', 'campaign canonical 64-hex anchor cluster key')
    .option('--origin-class <class>', 'campaign origin: user|agent-verified|agent-observed|import')
    .option('--yes', 'approve the preview without an interactive prompt')
    .option('--json', 'output the typed RollbackReport as masked JSON')
    .action(async (options: RollbackOptions, rollbackCommand: Command) => {
      try {
        const selector = rollbackSelector(options)
        const paths = await resolveKnowledgePaths(rollbackCommand)
        const prompt = promptDestination(options.json === true)
        const previewInput = rollbackInput(selector, paths, 0)
        const previewAffected = resolveRollbackAffectedSet(previewInput)
        const previewFingerprint = rollbackPreviewFingerprint(previewAffected)
        emitHuman(renderRollbackPreview(previewAffected), prompt.name)

        if (options.yes !== true) {
          if (!canPromptInteractively(prompt)) {
            emitHuman(
              pc.red(
                'knowledge rollback: refusal [confirmation-required]: '
                + 'non-interactive use requires --yes',
              ),
              'stderr',
            )
            process.exitCode = 1
            return
          }
          const answer = await promptForAnswer('Apply this rollback? (y/N) ', prompt)
          if (answer.trim().toLowerCase() !== 'y') {
            emitHuman(pc.dim('Rollback aborted.'), prompt.name)
            process.exitCode = 1
            return
          }
        }

        const leaseResult = await withWriterLease(
          'rollback',
          paths.knowledgeRoot,
          async (writerAuthority): Promise<RollbackExecutionOutcome> => {
            const affected = resolveRollbackAffectedSet(previewInput)
            assertPreviewUnchanged(
              'rollback',
              previewFingerprint,
              rollbackPreviewFingerprint(affected),
            )
            const resolvedAtOrdinal = await rollbackOrdinal(paths, affected, writerAuthority)
            const input = rollbackInput(
              selector,
              paths,
              resolvedAtOrdinal,
              writerAuthority,
              rollbackPreviewFingerprint(affected),
            )
            const report = selector.kind === 'job'
              ? rollbackCurationJob(input as RollbackCurationJobInput)
              : rollbackCampaign(input as RollbackCampaignInput)
            return { kind: 'completed', report }
          },
        )
        if (leaseResult.kind === 'refused' || leaseResult.value.kind === 'aborted') return
        if (options.json === true) emitJson(leaseResult.value.report)
        else emitHuman(renderRollbackReport(leaseResult.value.report))
      } catch (error) {
        reportError('rollback', error)
      }
    })

  command
    .command('purge')
    .description('Irreversibly purge a knowledge record from local store surfaces')
    .argument('<record-id>', 'record id to purge')
    .option('--confirm <id>', 'confirm non-interactively by repeating the exact record id')
    .option('--json', 'output the typed PurgeReceipt as masked JSON')
    .action(async (recordIdValue: string, options: PurgeOptions, purgeCommand: Command) => {
      try {
        const recordId = asRecordId(recordIdValue)
        const paths = await resolveKnowledgePaths(purgeCommand)
        const prompt = promptDestination(options.json === true)
        const preview = resolvePurgeAffectedSet({
          knowledgeRoot: paths.knowledgeRoot,
          recordId,
        })
        const previewFingerprint = purgeAffectedSetFingerprint(preview)
        emitHuman(renderPurgePreview(preview), prompt.name)

        if (options.confirm !== undefined) {
          if (options.confirm !== recordId) {
            emitHuman(
              pc.red(
                'knowledge purge: refusal [confirmation-mismatch]: '
                + '--confirm must exactly match the record id',
              ),
              'stderr',
            )
            process.exitCode = 1
            return
          }
        } else {
          if (!canPromptInteractively(prompt)) {
            emitHuman(
              pc.red(
                'knowledge purge: refusal [confirmation-required]: '
                + 'non-interactive use requires --confirm <record-id>',
              ),
              'stderr',
            )
            process.exitCode = 1
            return
          }
          const answer = await promptForAnswer(
            `Type ${recordId} to confirm irreversible purge: `,
            prompt,
          )
          if (answer !== recordId) {
            emitHuman(
              pc.red('knowledge purge: refusal [confirmation-mismatch]: record id did not match'),
              'stderr',
            )
            process.exitCode = 1
            return
          }
        }

        const leaseResult = await withWriterLease(
          'purge',
          paths.knowledgeRoot,
          async (writerAuthority): Promise<PurgeExecutionOutcome> => {
            const underLeaseAffectedSet = resolvePurgeAffectedSet({
              knowledgeRoot: paths.knowledgeRoot,
              recordId,
            })
            const underLeaseFingerprint = purgeAffectedSetFingerprint(underLeaseAffectedSet)
            assertPreviewUnchanged(
              'purge',
              previewFingerprint,
              underLeaseFingerprint,
            )
            const outcome = purgeRecord({
              knowledgeRoot: paths.knowledgeRoot,
              recordId,
              initiator: `cli:${userInfo().username}`,
              auditBaseDir: paths.auditBaseDir,
              writerAuthority,
              expectedAffectedSetFingerprint: underLeaseFingerprint,
            })
            switch (outcome.kind) {
              case 'purged':
                return { kind: 'completed', receipt: outcome.receipt, alreadyPurged: false }
              case 'already-purged':
                return { kind: 'completed', receipt: outcome.receipt, alreadyPurged: true }
              case 'egress-blocked':
                emitHuman(
                  pc.red([
                    'knowledge purge: refusal [egress-blocked]: receipt failed committed egress',
                    ...outcome.detections.map((detection) => (
                      `  ${detection.label}: ${detection.detector}`
                    )),
                  ].join('\n')),
                  'stderr',
                )
                process.exitCode = 1
                return { kind: 'failed' }
              case 'not-found':
                emitHuman(
                  pc.red(`knowledge purge: error [not-found]: record ${recordId} was not found`),
                  'stderr',
                )
                process.exitCode = 1
                return { kind: 'failed' }
            }
          },
        )
        if (leaseResult.kind === 'refused' || leaseResult.value.kind !== 'completed') return
        if (options.json === true) emitJson(leaseResult.value.receipt)
        else emitHuman(
          renderPurgeReceipt(
            leaseResult.value.receipt,
            leaseResult.value.alreadyPurged,
          ),
        )
      } catch (error) {
        reportError('purge', error)
      }
    })
}
