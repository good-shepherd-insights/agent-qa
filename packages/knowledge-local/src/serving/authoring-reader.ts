/**
 * knowledge-local implementation of the agent-side AuthoringReadPort (D-13): the 4th channel's
 * composition boundary. Shares the serving reader's hydration internals and the one derived
 * index SQLite; keeps servingReader/KnowledgeHintReader untouched.
 */
import { existsSync } from 'node:fs'

import type { AuthoringReadPort } from '@vostride/agent-qa-agent'
import {
  normalizeAnchor,
  slugBranch,
  type Anchor,
  type AuthoringBrief,
  type ScopeKey,
} from '@vostride/agent-qa-schema'

import type { EmbedderPort } from '../embedder-port.js'
import { indexDbPath, openIndexReaderConnection } from '../index-open.js'
import { hasDenseCandidates } from '../retrieve.js'
import { denseLeg, type RetrievalLegScope } from '../retrieval/legs.js'
import {
  assembleAuthoringBrief,
  type AuthoringExemplarRow,
  type AuthoringTestRef,
} from './get-authoring-brief.js'
import {
  hydrateRows,
  readIndexRows,
  type OpenServingKnowledgeReaderConfig,
} from './reader.js'

/**
 * PROVISIONAL authoring-brief budget, computed as a plain number at this composition boundary
 * (377 D-07 lineage: budgets are numbers passed down, never config reads inside assemblies).
 */
export const AUTHORING_BRIEF_DEFAULT_BUDGET = 2_000

/** PROVISIONAL dense candidate cap pending authoring-channel retrieval telemetry. */
export const AUTHORING_DENSE_K = 32

export interface AuthoringReaderDependencies {
  /** Consumer-owned test inventory; wired into the identity-only universe in Task 2. */
  discoverKnownTests?: () => readonly AuthoringTestRef[]
  /** Test/integration seam; production omission uses denseLeg's automatic acquisition ladder. */
  embedder?: EmbedderPort
}

interface OutcomeRow {
  file_path: string
  test_name: string
  passes: number
  failures: number
  heals: number
  flake_count: number
  quarantined: number
  last_outcomes_json: string
}

function parseLastOutcomes(json: string): { buildOrdinal: number; passed: boolean }[] {
  try {
    const parsed: unknown = JSON.parse(json)
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((entry) => (
      typeof entry === 'object'
        && entry !== null
        && typeof (entry as { buildOrdinal?: unknown }).buildOrdinal === 'number'
        && typeof (entry as { passed?: unknown }).passed === 'boolean'
        ? [{
            buildOrdinal: (entry as { buildOrdinal: number }).buildOrdinal,
            passed: (entry as { passed: boolean }).passed,
          }]
        : []
    ))
  } catch {
    // A malformed window heals through the projection rebuild; serve the row without it.
    return []
  }
}

/**
 * Read the 381-05 run-outcome projection through the one index reader connection. The
 * projection tables are deliberately outside REQUIRED_INDEX_TABLES, so their absence (an
 * older index, a cold store) is an empty projection — the ABRF-02 empty edge, never a throw.
 */
function readProjectionRows(knowledgeRoot: string): AuthoringExemplarRow[] {
  if (!existsSync(indexDbPath(knowledgeRoot))) return []

  const reader = openIndexReaderConnection(knowledgeRoot)
  try {
    const present = reader.db.prepare(`
      SELECT count(*) AS tables
      FROM sqlite_master
      WHERE type = 'table' AND name IN ('run_test_outcomes', 'run_test_anchors')
    `).get() as { tables: number } | undefined
    if (Number(present?.tables ?? 0) < 2) return []

    const anchorsByTest = new Map<string, string[]>()
    const anchorRows = reader.db.prepare(`
      SELECT file_path, test_name, anchor_normalized_json
      FROM run_test_anchors
      ORDER BY file_path, test_name, anchor_normalized_json
    `).all()
    for (const row of anchorRows) {
      const key = `${String(row.file_path)}::${String(row.test_name)}`
      const keys = anchorsByTest.get(key)
      if (keys === undefined) anchorsByTest.set(key, [String(row.anchor_normalized_json)])
      else keys.push(String(row.anchor_normalized_json))
    }

    return (reader.db.prepare(`
      SELECT file_path, test_name, passes, failures, heals, flake_count, quarantined,
        last_outcomes_json
      FROM run_test_outcomes
      ORDER BY file_path, test_name
    `).all() as unknown as OutcomeRow[]).map((row) => ({
      filePath: String(row.file_path),
      testName: String(row.test_name),
      passes: Number(row.passes),
      failures: Number(row.failures),
      heals: Number(row.heals),
      flakeCount: Number(row.flake_count),
      quarantined: Number(row.quarantined) !== 0,
      lastOutcomes: parseLastOutcomes(String(row.last_outcomes_json)),
      anchorKeys: anchorsByTest.get(`${String(row.file_path)}::${String(row.test_name)}`) ?? [],
    }))
  } finally {
    reader.db.close()
  }
}

/**
 * PROVISIONAL screenless target-anchor derivation (D-13: intent on the dense leg, page:/flow:
 * anchors on the lexical leg). Every derived anchor goes through the one normalizeAnchor
 * authority: '/'-prefixed and 'page:'-prefixed intent tokens become page anchors;
 * 'flow:'-prefixed tokens and the whole intent become flow-name candidates. The scope key
 * contributes through the SQL scope ladder, not through anchors.
 */
function deriveTargetAnchors(intent: string): Anchor[] {
  const anchors: Anchor[] = []
  for (const token of intent.split(/\s+/)) {
    if (token.startsWith('/')) anchors.push({ t: 'page', route: token })
    else if (token.startsWith('page:')) anchors.push({ t: 'page', route: token.slice(5) })
    else if (token.startsWith('flow:')) anchors.push({ t: 'flow', name: token.slice(5) })
  }
  if (intent.trim() !== '') anchors.push({ t: 'flow', name: intent })

  const seen = new Set<string>()
  return anchors.map(normalizeAnchor).filter((anchor) => {
    const key = JSON.stringify(anchor)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function authoringRetrievalScope(
  config: OpenServingKnowledgeReaderConfig,
  scope: ScopeKey,
): RetrievalLegScope {
  const containingScopes = [scope, ...(config.scopeDefaults?.parentScopes ?? [])]
  const productKey = config.product
    ?? containingScopes.find((candidate) => candidate.tier === 'product')?.key
    ?? scope.key
  return {
    product: slugBranch(productKey),
    testKey: containingScopes.find((candidate) => candidate.tier === 'test')?.key
      ?? `__missing_test_scope__:${productKey}`,
    suiteKey: containingScopes.find((candidate) => candidate.tier === 'suite')?.key
      ?? `__missing_suite_scope__:${productKey}`,
    productKey,
    globalKey: 'global',
  }
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

async function readDenseScores(
  config: OpenServingKnowledgeReaderConfig,
  deps: AuthoringReaderDependencies,
  intent: string,
  scope: ScopeKey,
): Promise<ReadonlyMap<string, number> | undefined> {
  if (!existsSync(indexDbPath(config.knowledgeRoot))) return undefined

  const connection = openIndexReaderConnection(config.knowledgeRoot)
  try {
    const legScope = authoringRetrievalScope(config, scope)
    if (!hasDenseCandidates(connection.db, legScope)) return undefined

    const candidates = await denseLeg(
      connection,
      [intent],
      legScope,
      AUTHORING_DENSE_K,
      deps.embedder === undefined ? {} : { embedder: deps.embedder },
    )
    if (candidates.length === 0) return undefined
    return new Map(candidates.map((candidate) => [
      String(candidate.bundleId),
      clamp01(candidate.rawScores.cosine ?? 0),
    ]))
  } finally {
    connection.db.close()
  }
}

/** Open the screenless authoring channel over the same store config as the serving reader. */
export function createAuthoringReader(
  config: OpenServingKnowledgeReaderConfig,
  deps: AuthoringReaderDependencies = {},
): AuthoringReadPort {
  return {
    async getAuthoringBrief(intent: string, scope: ScopeKey): Promise<AuthoringBrief> {
      const entries = hydrateRows(config, readIndexRows(config, scope), false)
      const projectionRows = readProjectionRows(config.knowledgeRoot)
      const denseScoreByRecordId = await readDenseScores(config, deps, intent, scope)
      return assembleAuthoringBrief({
        entries,
        projectionRows,
        // M2 discovery universe: projection-known identities. M4's consumer owns the
        // filesystem and widens this to its authored shelf through the assembly seam.
        knownTests: projectionRows.map(({ filePath, testName }) => ({ filePath, testName })),
        intent,
        scope,
        targetAnchors: deriveTargetAnchors(intent),
        budget: AUTHORING_BRIEF_DEFAULT_BUDGET,
        ...(denseScoreByRecordId === undefined ? {} : { denseScoreByRecordId }),
      })
    },
  }
}
