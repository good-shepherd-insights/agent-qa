// Per-mutation bundle writes are one D-11 checkpoint unit over the new content and rewritten
// manifest. BNDL-03 deduplicates before checkpointing, while the schema fold repeats that defense
// in depth. Every mutable file uses a full same-directory temp rewrite plus atomic rename (§4).

import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'

import {
  BUNDLE_SCHEMA_VERSION,
  BundleOutcomeEventSchema,
  canonicalJson,
  committedFileText,
  computeMutableStateHash,
  emitRecordMarkdown,
  eventDedupKey,
  guardBundleManifest,
  guardBundleProvenance,
  guardBundleRelations,
  parseRecordMarkdown,
  renderEmbeddingInput,
  slugBranch,
} from '@vostride/agent-qa-schema'
import type {
  BundleManifest,
  BundleOutcomeEvent,
  CurationAuthorship,
  BundleRelation,
  BundleRelations,
  RecordId,
} from '@vostride/agent-qa-schema'

import { checkpointCommittedParts } from './bundle-egress.js'
import type { BundleStoreConfig } from './bundle-publish.js'
import { commitBundleMutation } from './journal/bundle-mutation.js'

export type AppendOutcome =
  | { kind: 'appended' }
  | { kind: 'duplicate' }
  | { kind: 'egress-blocked'; detections: readonly { label: string; detector: string }[] }
  | { kind: 'not-found' }

export type AppendEnrichedOutcome =
  | { kind: 'appended' | 'duplicate'; enriched: boolean }
  | { kind: 'egress-blocked'; detections: readonly { label: string; detector: string }[] }
  | { kind: 'not-found' }

export interface BundleProseEnrichment {
  summary: string
  body: string
  authorship: CurationAuthorship
}

const OUTCOMES_REL_PATH = 'evidence/outcomes.jsonl'
const RELATIONS_REL_PATH = 'relations.json'
const ARTIFACTS_INDEX_REL_PATH = 'artifacts.index.json'

function textSha(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

function bundleDir(config: BundleStoreConfig, id: RecordId): string {
  if (!isAbsolute(config.knowledgeRoot)) {
    throw new TypeError('BundleStoreConfig.knowledgeRoot must be absolute')
  }
  return join(
    config.knowledgeRoot,
    'memory',
    slugBranch(config.productKey),
    'bundles',
    slugBranch(id),
  )
}

function completeManifest(dir: string): BundleManifest | null {
  const file = join(dir, 'manifest.json')
  if (!existsSync(file)) return null
  const manifest = guardBundleManifest(JSON.parse(readFileSync(file, 'utf8')))
  return manifest.complete === true ? manifest : null
}

function mutableStateHash(contentHashes: BundleManifest['contentHashes']): string {
  return computeMutableStateHash({
    outcomes: contentHashes[OUTCOMES_REL_PATH] ?? null,
    relations: contentHashes[RELATIONS_REL_PATH] ?? null,
    artifactsIndex: contentHashes[ARTIFACTS_INDEX_REL_PATH] ?? null,
  })
}

function rewriteManifest(
  manifest: BundleManifest,
  relPath: string,
  rewrittenText: string,
): string {
  const contentHashes = {
    ...manifest.contentHashes,
    [relPath]: textSha(rewrittenText),
  }
  return committedFileText({
    ...manifest,
    contentHashes,
    mutableStateHash: mutableStateHash(contentHashes),
  })
}

function rewriteManifestParts(
  manifest: BundleManifest,
  rewrittenParts: Readonly<Record<string, string>>,
  embeddingInput: string,
): string {
  const contentHashes = { ...manifest.contentHashes }
  for (const [relPath, rewrittenText] of Object.entries(rewrittenParts)) {
    contentHashes[relPath] = textSha(rewrittenText)
  }
  return committedFileText({
    ...manifest,
    embeddingInput,
    contentHashes,
    mutableStateHash: mutableStateHash(contentHashes),
  })
}

function checkpointAndRewrite(
  config: BundleStoreConfig,
  dir: string,
  id: RecordId,
  relPath: string,
  appendedText: string,
  rewrittenText: string,
  manifestText: string,
): AppendOutcome {
  const checkpoint = checkpointCommittedParts(
    [
      { label: relPath, text: appendedText },
      { label: 'manifest.json', text: manifestText },
    ],
    {
      auditBaseDir: config.auditBaseDir,
      ...(config.policy === undefined ? {} : { policy: config.policy }),
    },
  )
  if (checkpoint.kind === 'egress-blocked') return checkpoint

  commitBundleMutation({
    knowledgeRoot: config.knowledgeRoot,
    bundleDir: dir,
    bundleId: id,
    writerLeaseId: config.writerLeaseId,
    replacements: [
      { targetRelPath: relPath, text: rewrittenText },
      { targetRelPath: 'manifest.json', text: manifestText },
    ],
    afterMutableReplacement: config.hooks?.afterMutableReplacement,
  })
  return { kind: 'appended' }
}

function parseOutcomeLog(text: string): BundleOutcomeEvent[] {
  if (text === '') return []
  if (!text.endsWith('\n')) {
    throw new SyntaxError(`${OUTCOMES_REL_PATH} must end with a newline`)
  }
  return text
    .slice(0, -1)
    .split('\n')
    .map((line) => BundleOutcomeEventSchema.parse(JSON.parse(line)))
}

export function appendOutcomeEvent(
  config: BundleStoreConfig,
  id: RecordId,
  event: BundleOutcomeEvent,
): AppendOutcome {
  const dir = bundleDir(config, id)
  const manifest = completeManifest(dir)
  if (manifest === null) return { kind: 'not-found' }

  const file = join(dir, OUTCOMES_REL_PATH)
  const existingText = readFileSync(file, 'utf8')
  const existingEvents = parseOutcomeLog(existingText)
  const parsedEvent = BundleOutcomeEventSchema.parse(event)
  if (existingEvents.some((candidate) => eventDedupKey(candidate) === eventDedupKey(parsedEvent))) {
    return { kind: 'duplicate' }
  }

  const appendedText = `${canonicalJson(parsedEvent)}\n`
  const rewrittenText = `${existingText}${appendedText}`
  const manifestText = rewriteManifest(manifest, OUTCOMES_REL_PATH, rewrittenText)
  return checkpointAndRewrite(
    config,
    dir,
    id,
    OUTCOMES_REL_PATH,
    appendedText,
    rewrittenText,
    manifestText,
  )
}

/**
 * Confirm a capable-model duplicate Add while backfilling only the mutable prose and provenance
 * fields of a fallback bundle. The identity frontmatter is parsed and re-emitted unchanged; the
 * stable content address therefore cannot drift during CUR-02 enrichment.
 */
export function appendOutcomeEventWithEnrichment(
  config: BundleStoreConfig,
  id: RecordId,
  event: BundleOutcomeEvent,
  enrichment: BundleProseEnrichment,
): AppendEnrichedOutcome {
  const dir = bundleDir(config, id)
  const manifest = completeManifest(dir)
  if (manifest === null) return { kind: 'not-found' }

  const provenanceFile = join(dir, 'provenance.json')
  const provenance = guardBundleProvenance(
    JSON.parse(readFileSync(provenanceFile, 'utf8')),
  )
  if (provenance.mode !== 'run-linked' || provenance.needsEnrichment !== true) {
    const appended = appendOutcomeEvent(config, id, event)
    return appended.kind === 'appended' || appended.kind === 'duplicate'
      ? { ...appended, enriched: false }
      : appended
  }

  const recordFile = join(dir, 'record.md')
  const record = parseRecordMarkdown(readFileSync(recordFile, 'utf8'))
  const recordText = emitRecordMarkdown(record.frontmatter, {
    summary: enrichment.summary,
    body: enrichment.body,
  })
  const provenanceText = committedFileText({
    ...provenance,
    authorship: enrichment.authorship,
    needsEnrichment: false,
  })

  const outcomesFile = join(dir, OUTCOMES_REL_PATH)
  const existingOutcomesText = readFileSync(outcomesFile, 'utf8')
  const existingEvents = parseOutcomeLog(existingOutcomesText)
  const parsedEvent = BundleOutcomeEventSchema.parse(event)
  const duplicate = existingEvents.some(
    (candidate) => eventDedupKey(candidate) === eventDedupKey(parsedEvent),
  )
  const appendedText = duplicate ? '' : `${canonicalJson(parsedEvent)}\n`
  const outcomesText = `${existingOutcomesText}${appendedText}`
  const embeddingInput = renderEmbeddingInput({
    summary: enrichment.summary,
    body: enrichment.body,
    anchors: record.frontmatter.anchors.map(({ raw }) => raw),
  })
  const rewrittenParts = {
    'record.md': recordText,
    'provenance.json': provenanceText,
    [OUTCOMES_REL_PATH]: outcomesText,
  }
  const manifestText = rewriteManifestParts(manifest, rewrittenParts, embeddingInput)
  const checkpoint = checkpointCommittedParts(
    [
      { label: 'record.md', text: recordText },
      { label: 'provenance.json', text: provenanceText },
      ...(duplicate ? [] : [{ label: OUTCOMES_REL_PATH, text: appendedText }]),
      { label: 'manifest.json', text: manifestText },
    ],
    {
      auditBaseDir: config.auditBaseDir,
      ...(config.policy === undefined ? {} : { policy: config.policy }),
    },
  )
  if (checkpoint.kind === 'egress-blocked') return checkpoint

  commitBundleMutation({
    knowledgeRoot: config.knowledgeRoot,
    bundleDir: dir,
    bundleId: id,
    writerLeaseId: config.writerLeaseId,
    replacements: [
      { targetRelPath: 'record.md', text: recordText },
      { targetRelPath: 'provenance.json', text: provenanceText },
      ...(duplicate
        ? []
        : [{ targetRelPath: OUTCOMES_REL_PATH, text: outcomesText }]),
      { targetRelPath: 'manifest.json', text: manifestText },
    ],
    afterMutableReplacement: config.hooks?.afterMutableReplacement,
  })
  return { kind: duplicate ? 'duplicate' : 'appended', enriched: true }
}

function relationDedupKey(relation: BundleRelation): string {
  return `${relation.type}:${relation.targetId}:${relation.curationJobId}`
}

function parseRelation(relation: BundleRelation): BundleRelation {
  const parsed = guardBundleRelations({
    schemaVersion: BUNDLE_SCHEMA_VERSION,
    relations: [relation],
  })
  return parsed.relations[0]!
}

export function appendRelation(
  config: BundleStoreConfig,
  id: RecordId,
  relation: BundleRelation,
): AppendOutcome {
  const dir = bundleDir(config, id)
  const manifest = completeManifest(dir)
  if (manifest === null) return { kind: 'not-found' }

  const file = join(dir, RELATIONS_REL_PATH)
  const existing = guardBundleRelations(JSON.parse(readFileSync(file, 'utf8')))
  const parsedRelation = parseRelation(relation)
  if (
    existing.relations.some(
      (candidate) => relationDedupKey(candidate) === relationDedupKey(parsedRelation),
    )
  ) {
    return { kind: 'duplicate' }
  }

  const rewritten: BundleRelations = {
    ...existing,
    relations: [...existing.relations, parsedRelation],
  }
  const appendedText = `${canonicalJson(parsedRelation)}\n`
  const rewrittenText = committedFileText(rewritten)
  const manifestText = rewriteManifest(manifest, RELATIONS_REL_PATH, rewrittenText)
  return checkpointAndRewrite(
    config,
    dir,
    id,
    RELATIONS_REL_PATH,
    appendedText,
    rewrittenText,
    manifestText,
  )
}
