// Per-mutation bundle writes are one D-11 checkpoint unit over the new content and rewritten
// manifest. BNDL-03 deduplicates before checkpointing, while the schema fold repeats that defense
// in depth. Every mutable file uses a full same-directory temp rewrite plus atomic rename (§4).

import { createHash, randomUUID } from 'node:crypto'
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'

import {
  BUNDLE_SCHEMA_VERSION,
  BundleOutcomeEventSchema,
  canonicalJson,
  committedFileText,
  computeMutableStateHash,
  eventDedupKey,
  guardBundleManifest,
  guardBundleRelations,
  slugBranch,
} from '@vostride/agent-qa-schema'
import type {
  BundleManifest,
  BundleOutcomeEvent,
  BundleRelation,
  BundleRelations,
  RecordId,
} from '@vostride/agent-qa-schema'

import { checkpointCommittedParts } from './bundle-egress.js'
import type { BundleStoreConfig } from './bundle-publish.js'

export type AppendOutcome =
  | { kind: 'appended' }
  | { kind: 'duplicate' }
  | { kind: 'egress-blocked'; detections: readonly { label: string; detector: string }[] }
  | { kind: 'not-found' }

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

function atomicRewrite(file: string, text: string): void {
  const temporary = `${file}.tmp-${randomUUID()}`
  try {
    writeFileSync(temporary, text, { encoding: 'utf8', flag: 'wx' })
    renameSync(temporary, file)
  } finally {
    rmSync(temporary, { force: true })
  }
}

function checkpointAndRewrite(
  config: BundleStoreConfig,
  dir: string,
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

  atomicRewrite(join(dir, relPath), rewrittenText)
  atomicRewrite(join(dir, 'manifest.json'), manifestText)
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
    OUTCOMES_REL_PATH,
    appendedText,
    rewrittenText,
    manifestText,
  )
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
    RELATIONS_REL_PATH,
    appendedText,
    rewrittenText,
    manifestText,
  )
}
