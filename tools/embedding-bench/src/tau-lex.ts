import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'

import type { BenchCorpus } from './runner'

export type TauLexCorpus = BenchCorpus

export interface TauLexPair {
  queryId: string
  goldId: string
  bm25Positive: number
}

export interface TauLexUnmatchedPair {
  queryId: string
  goldId: string
}

export interface TauLexReceipt {
  schemaVersion: 2
  calibrationDate: string
  tauLex: number
  percentile05: number
  rule: 'p05-linear-floor2'
  signConvention: string
  weights: {
    identity: number
    content: number
    context: number
  }
  ftsShape: {
    columns: ['identity', 'content', 'context']
    tokenizer: string
    productionShapeSource: string
    productionWeightSource: string
    querySemantics: string
    productionQuerySource: string
    queryMode: string
    contextProjection: string
  }
  corpusId: string
  corpusHash: string
  corpusPath: string
  corpusManifestHash: string | null
  corpusManifestPath: string | null
  sourceDataset: string
  corpusStats: {
    documents: number
    recordedQueries: number
    goldPairs: number
    scoredPairs: number
    unmatchedPairs: number
  }
  servingReplay: {
    evaluatedCandidates: number
    matchedCandidates: number
    admittedCandidates: number
    goldPairs: number
    matchedGoldPairs: number
    admittedGoldPairs: number
    goldRecall: number
  }
  pairs: TauLexPair[]
  unmatchedPairs: TauLexUnmatchedPair[]
}

export interface CalibrateTauLexOptions {
  corpus: TauLexCorpus
  corpusPath: string
  corpusRaw?: string
  corpusManifestPath?: string
  corpusManifestRaw?: string
  jsonPath: string
  markdownPath: string
  calibrationDate?: string
}

const CALIBRATION_DATE = '2026-07-15'
const COMPARISON_TOLERANCE = 1e-12
const FTS_TOKENIZER = "unicode61 tokenchars '#-_./:[]=>@'"
const PRODUCTION_SHAPE_SOURCE = 'packages/knowledge-local/src/index-open.ts'
const PRODUCTION_WEIGHT_SOURCE = 'packages/knowledge-local/src/retrieval/constants.ts'
const PRODUCTION_QUERY_SOURCE = 'packages/knowledge-local/src/retrieval/fts-match.ts'
const SIGN_CONVENTION =
  'SQLite FTS5 bm25() returns negated raw scores (better matches are more negative); calibration stores bm25Positive = -bm25(...) and applies TAU_LEX on that positive scale.'
const QUERY_MODE =
  'Full serving replay over every in-app corpus document using the live production MATCH constructor, final FTS columns and tokenizer, bm25() weights, and positive-score convention.'
const CONTEXT_PROJECTION =
  'The recorded corpus predates graph neighbors, so the v2 context column is present and populated with the empty string for every corpus document.'

interface ProductionFtsContract {
  weights: TauLexReceipt['weights']
  querySemantics: string
  buildLexicalMatchExpression(text: string): string
}

interface ProductionMatchModule {
  LEXICAL_MATCH_SEMANTICS?: unknown
  buildLexicalMatchExpression?: unknown
}

function sha256(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

function parseNumericConstant(source: string, name: string): number {
  const match = source.match(new RegExp(`export const ${name} = (-?\\d+(?:\\.\\d+)?)`))
  if (match?.[1] === undefined) {
    throw new Error(`production constant ${name} is missing or is not a numeric literal`)
  }
  const value = Number(match[1])
  if (!Number.isFinite(value)) throw new TypeError(`production constant ${name} is not finite`)
  return value
}

async function loadProductionFtsContract(): Promise<ProductionFtsContract> {
  const constantsSource = await readFile(
    new URL('../../../packages/knowledge-local/src/retrieval/constants.ts', import.meta.url),
    'utf8',
  )
  const indexOpenSource = await readFile(
    new URL('../../../packages/knowledge-local/src/index-open.ts', import.meta.url),
    'utf8',
  )
  const ftsShape = /CREATE VIRTUAL TABLE IF NOT EXISTS fts_records USING fts5\(\s*identity,\s*content,\s*context,/u
  if (!ftsShape.test(indexOpenSource) || !indexOpenSource.includes(FTS_TOKENIZER)) {
    throw new Error('production FTS shape no longer matches the calibrated three-column tokenizer')
  }
  const matchModule = await import(
    new URL(
      '../../../packages/knowledge-local/src/retrieval/fts-match.ts',
      import.meta.url,
    ).href
  ) as ProductionMatchModule
  if (
    typeof matchModule.LEXICAL_MATCH_SEMANTICS !== 'string'
    || typeof matchModule.buildLexicalMatchExpression !== 'function'
  ) {
    throw new TypeError('production lexical MATCH module does not expose its semantic contract')
  }
  return {
    weights: {
      identity: parseNumericConstant(constantsSource, 'FTS_WEIGHT_IDENTITY'),
      content: parseNumericConstant(constantsSource, 'FTS_WEIGHT_CONTENT'),
      context: parseNumericConstant(constantsSource, 'FTS_WEIGHT_CONTEXT'),
    },
    querySemantics: matchModule.LEXICAL_MATCH_SEMANTICS,
    buildLexicalMatchExpression:
      matchModule.buildLexicalMatchExpression as (text: string) => string,
  }
}

function roundScore(value: number): number {
  return Number(value.toFixed(12))
}

export function deriveTauLex(values: readonly number[]): {
  percentile05: number
  tauLex: number
} {
  if (values.length === 0) throw new TypeError('tau lexical calibration requires scored pairs')
  if (values.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new TypeError('tau lexical calibration requires finite positive-scale scores')
  }
  const sorted = [...values].sort((left, right) => left - right)
  const position = (sorted.length - 1) * 0.05
  const lowerIndex = Math.floor(position)
  const upperIndex = Math.ceil(position)
  const lower = sorted[lowerIndex]!
  const upper = sorted[upperIndex]!
  const percentile05 = roundScore(lower + (upper - lower) * (position - lowerIndex))
  return {
    percentile05,
    tauLex: Math.floor(percentile05 * 100 + COMPARISON_TOLERANCE) / 100,
  }
}

function assertCorpus(corpus: TauLexCorpus): Map<string, number> {
  if (!Array.isArray(corpus.documents) || corpus.documents.length === 0) {
    throw new TypeError('tau lexical corpus requires documents')
  }
  if (!Array.isArray(corpus.recordedQueries) || corpus.recordedQueries.length === 0) {
    throw new TypeError('tau lexical corpus requires recorded queries')
  }
  const rowids = new Map<string, number>()
  corpus.documents.forEach((document, index) => {
    if (rowids.has(document.id)) throw new Error(`duplicate corpus document ${document.id}`)
    rowids.set(document.id, index + 1)
  })
  const queryIds = new Set<string>()
  for (const query of corpus.recordedQueries) {
    if (queryIds.has(query.id)) throw new Error(`duplicate recorded query ${query.id}`)
    queryIds.add(query.id)
    if (query.goldDocIds.length === 0) {
      throw new Error(`recorded query ${query.id} has an empty gold set`)
    }
    for (const goldId of new Set(query.goldDocIds)) {
      const document = corpus.documents[rowids.get(goldId)! - 1]
      if (document === undefined) {
        throw new Error(`recorded query ${query.id} references missing gold document ${goldId}`)
      }
      if (!document.apps.includes(query.app)) {
        throw new Error(
          `recorded query ${query.id} gold document ${goldId} is not in app ${query.app}`,
        )
      }
    }
  }
  return rowids
}

function identityProjection(rendering: string): string {
  return rendering
    .split(/\r?\n/u)
    .filter((line) => line.startsWith('anchor: '))
    .join('\n')
}

interface CollectedServingReplay {
  pairs: TauLexPair[]
  unmatchedPairs: TauLexUnmatchedPair[]
  evaluatedCandidates: number
  matchedCandidates: number
  candidateScores: number[]
}

function collectServingReplay(
  corpus: TauLexCorpus,
  rowids: ReadonlyMap<string, number>,
  production: ProductionFtsContract,
): CollectedServingReplay {
  const db = new DatabaseSync(':memory:')
  try {
    db.exec(`
      CREATE VIRTUAL TABLE fts_records USING fts5(
        identity,
        content,
        context,
        tokenize = "${FTS_TOKENIZER}"
      );
      CREATE TABLE corpus_apps (
        record_rowid INTEGER NOT NULL,
        app TEXT NOT NULL,
        PRIMARY KEY (record_rowid, app)
      ) STRICT;
    `)
    const insert = db.prepare(`
      INSERT INTO fts_records (rowid, identity, content, context)
      VALUES (?, ?, ?, ?)
    `)
    const insertApp = db.prepare(`
      INSERT INTO corpus_apps (record_rowid, app)
      VALUES (?, ?)
    `)
    const documentsPerApp = new Map<string, number>()
    corpus.documents.forEach((document, index) => {
      const rowid = index + 1
      insert.run(rowid, identityProjection(document.text), document.text, '')
      for (const app of new Set(document.apps)) {
        insertApp.run(rowid, app)
        documentsPerApp.set(app, (documentsPerApp.get(app) ?? 0) + 1)
      }
    })
    const score = db.prepare(`
      SELECT fts_records.rowid AS record_rowid,
        -bm25(fts_records, ?, ?, ?) AS bm25_positive
      FROM fts_records
      JOIN corpus_apps apps ON apps.record_rowid = fts_records.rowid
      WHERE fts_records MATCH ? AND apps.app = ?
      ORDER BY fts_records.rowid
    `)
    const pairs: TauLexPair[] = []
    const unmatchedPairs: TauLexUnmatchedPair[] = []
    const candidateScores: number[] = []
    let evaluatedCandidates = 0
    let matchedCandidates = 0
    for (const query of corpus.recordedQueries) {
      const match = production.buildLexicalMatchExpression(query.query)
      if (match === '') throw new TypeError(`recorded query ${query.id} text must not be empty`)
      const eligibleDocuments = documentsPerApp.get(query.app) ?? 0
      evaluatedCandidates += eligibleDocuments
      const rows = score.all(
        production.weights.identity,
        production.weights.content,
        production.weights.context,
        match,
        query.app,
      )
      if (rows.length > eligibleDocuments) {
        throw new Error(`serving replay returned too many candidates for ${query.id}`)
      }
      matchedCandidates += rows.length
      const scoresByRowid = new Map<number, number>()
      for (const row of rows) {
        const recordRowid = Number(row.record_rowid)
        const bm25Positive = roundScore(Number(row.bm25_positive))
        if (
          !Number.isSafeInteger(recordRowid)
          || recordRowid <= 0
          || !Number.isFinite(bm25Positive)
          || bm25Positive < 0
        ) {
          throw new TypeError(`invalid serving replay candidate for ${query.id}`)
        }
        if (scoresByRowid.has(recordRowid)) {
          throw new Error(`duplicate serving replay candidate ${query.id}/${recordRowid}`)
        }
        scoresByRowid.set(recordRowid, bm25Positive)
        candidateScores.push(bm25Positive)
      }
      for (const goldId of [...new Set(query.goldDocIds)].sort()) {
        const rowid = rowids.get(goldId)
        if (rowid === undefined) {
          throw new Error(`recorded query ${query.id} references missing gold document ${goldId}`)
        }
        const bm25Positive = scoresByRowid.get(rowid)
        if (bm25Positive === undefined) {
          unmatchedPairs.push({ queryId: query.id, goldId })
          continue
        }
        pairs.push({ queryId: query.id, goldId, bm25Positive })
      }
    }
    const byIdentity = (
      left: TauLexPair | TauLexUnmatchedPair,
      right: TauLexPair | TauLexUnmatchedPair,
    ) => left.queryId.localeCompare(right.queryId) || left.goldId.localeCompare(right.goldId)
    pairs.sort(byIdentity)
    unmatchedPairs.sort(byIdentity)
    if (candidateScores.length !== matchedCandidates) {
      throw new Error('serving replay candidate count is inconsistent')
    }
    return {
      pairs,
      unmatchedPairs,
      evaluatedCandidates,
      matchedCandidates,
      candidateScores,
    }
  } finally {
    db.close()
  }
}

function servingReplayMetrics(
  collected: CollectedServingReplay,
  goldPairs: number,
  tauLex: number,
): TauLexReceipt['servingReplay'] {
  const matchedGoldPairs = collected.pairs.length
  const admittedCandidates = collected.candidateScores.filter(
    (bm25Positive) => bm25Positive >= tauLex,
  ).length
  const admittedGoldPairs = collected.pairs.filter(
    ({ bm25Positive }) => bm25Positive >= tauLex,
  ).length
  const replay: TauLexReceipt['servingReplay'] = {
    evaluatedCandidates: collected.evaluatedCandidates,
    matchedCandidates: collected.matchedCandidates,
    admittedCandidates,
    goldPairs,
    matchedGoldPairs,
    admittedGoldPairs,
    goldRecall: matchedGoldPairs / goldPairs,
  }
  const counts = [
    replay.evaluatedCandidates,
    replay.matchedCandidates,
    replay.admittedCandidates,
    replay.goldPairs,
    replay.matchedGoldPairs,
    replay.admittedGoldPairs,
  ]
  if (counts.some((count) => !Number.isSafeInteger(count) || count < 0)) {
    throw new TypeError('serving replay produced an invalid count')
  }
  if (
    replay.matchedGoldPairs === 0
    || replay.admittedCandidates === 0
    || replay.admittedCandidates >= replay.matchedCandidates
    || replay.matchedCandidates > replay.evaluatedCandidates
    || replay.matchedGoldPairs > replay.goldPairs
    || replay.matchedGoldPairs > replay.matchedCandidates
    || replay.admittedGoldPairs > replay.matchedGoldPairs
    || replay.admittedGoldPairs > replay.admittedCandidates
    || collected.pairs.length + collected.unmatchedPairs.length !== replay.goldPairs
    || replay.goldRecall <= 0
    || replay.goldRecall > 1
  ) {
    throw new Error('serving replay failed its recall or admission invariants')
  }
  return replay
}

function markdownCell(value: string): string {
  return value.replaceAll('|', '\\|').replaceAll('\n', ' ')
}

function renderMarkdown(receipt: TauLexReceipt): string {
  const lines = [
    '# TAU_LEX Calibration Receipt',
    '',
    `**Calibration date:** ${receipt.calibrationDate}`,
    '',
    `**Pinned floor:** \`TAU_LEX = ${receipt.tauLex}\``,
    '',
    '## Derivation',
    '',
    `- Rule: \`${receipt.rule}\` — p05 linear interpolation over the recorded scored gold-pair distribution, then floor to two decimals.`,
    `- Recorded p05: \`${receipt.percentile05}\`.`,
    `- Sign convention: ${receipt.signConvention}`,
    `- Query replay: ${receipt.ftsShape.queryMode}`,
    `- Context caveat: ${receipt.ftsShape.contextProjection}`,
    '',
    '## Production FTS Contract',
    '',
    '| Field | Recorded value |',
    '| --- | --- |',
    `| Columns | ${receipt.ftsShape.columns.join(', ')} |`,
    `| Tokenizer | \`${receipt.ftsShape.tokenizer}\` |`,
    `| \`bm25()\` weights | identity=${receipt.weights.identity}, content=${receipt.weights.content}, context=${receipt.weights.context} |`,
    `| Shape source | \`${receipt.ftsShape.productionShapeSource}\` |`,
    `| Weight source | \`${receipt.ftsShape.productionWeightSource}\` |`,
    `| Query semantics | \`${receipt.ftsShape.querySemantics}\` |`,
    `| Query source | \`${receipt.ftsShape.productionQuerySource}\` |`,
    '',
    '## Serving Replay',
    '',
    '| Metric | Recorded value |',
    '| --- | ---: |',
    `| Evaluated in-app query/document pairs | ${receipt.servingReplay.evaluatedCandidates} |`,
    `| MATCH candidates | ${receipt.servingReplay.matchedCandidates} |`,
    `| Admitted candidates | ${receipt.servingReplay.admittedCandidates} |`,
    `| Gold pairs | ${receipt.servingReplay.goldPairs} |`,
    `| Matched gold pairs | ${receipt.servingReplay.matchedGoldPairs} |`,
    `| Admitted gold pairs | ${receipt.servingReplay.admittedGoldPairs} |`,
    `| Gold recall | ${receipt.servingReplay.goldRecall} |`,
    '',
    '## Corpus Identity',
    '',
    '| Field | Value |',
    '| --- | --- |',
    `| Corpus | \`${receipt.corpusPath}\` |`,
    `| Corpus ID | \`${receipt.corpusId}\` |`,
    `| Corpus SHA-256 | \`${receipt.corpusHash}\` |`,
    `| Manifest | ${receipt.corpusManifestPath === null ? 'not supplied' : `\`${receipt.corpusManifestPath}\``} |`,
    `| Manifest SHA-256 | ${receipt.corpusManifestHash === null ? 'not supplied' : `\`${receipt.corpusManifestHash}\``} |`,
    `| Source dataset | \`${receipt.sourceDataset}\` |`,
    `| Documents | ${receipt.corpusStats.documents} |`,
    `| Recorded queries | ${receipt.corpusStats.recordedQueries} |`,
    `| Gold pairs | ${receipt.corpusStats.goldPairs} |`,
    `| Matched gold pairs | ${receipt.corpusStats.scoredPairs} |`,
    `| Unmatched gold pairs | ${receipt.corpusStats.unmatchedPairs} |`,
    '',
    '## Scored Gold Pairs',
    '',
    '| Query ID | Gold document ID | bm25Positive |',
    '| --- | --- | ---: |',
    ...receipt.pairs.map(
      ({ queryId, goldId, bm25Positive }) =>
        `| ${markdownCell(queryId)} | ${markdownCell(goldId)} | ${bm25Positive} |`,
    ),
    '',
    '## Gold Pairs Unmatched by Serving',
    '',
    'These members were resolved and validated against the recorded corpus, but the live production MATCH constructor did not return them. They are excluded from the lexical-candidate floor rather than represented as fabricated BM25 scores.',
    '',
    '| Query ID | Gold document ID |',
    '| --- | --- |',
    ...receipt.unmatchedPairs.map(
      ({ queryId, goldId }) => `| ${markdownCell(queryId)} | ${markdownCell(goldId)} |`,
    ),
    '',
    'M3 owns later refinement of this admission floor. D-05 requires no human lock gate.',
  ]
  return `${lines.join('\n').trimEnd()}\n`
}

export async function calibrateTauLex(options: CalibrateTauLexOptions): Promise<{
  receipt: TauLexReceipt
  jsonPath: string
  markdownPath: string
}> {
  const production = await loadProductionFtsContract()
  const rowids = assertCorpus(options.corpus)
  const collected = collectServingReplay(options.corpus, rowids, production)
  const goldPairs = options.corpus.recordedQueries.reduce(
    (count, query) => count + new Set(query.goldDocIds).size,
    0,
  )
  if (collected.pairs.length === 0) {
    throw new Error('serving replay matched zero recorded gold pairs')
  }
  const derived = deriveTauLex(
    collected.pairs.map(({ bm25Positive }) => bm25Positive),
  )
  const servingReplay = servingReplayMetrics(collected, goldPairs, derived.tauLex)
  const corpusRaw = options.corpusRaw ?? JSON.stringify(options.corpus)
  const corpusHash = sha256(corpusRaw)
  const receipt: TauLexReceipt = {
    schemaVersion: 2,
    calibrationDate: options.calibrationDate ?? CALIBRATION_DATE,
    tauLex: derived.tauLex,
    percentile05: derived.percentile05,
    rule: 'p05-linear-floor2',
    signConvention: SIGN_CONVENTION,
    weights: production.weights,
    ftsShape: {
      columns: ['identity', 'content', 'context'],
      tokenizer: FTS_TOKENIZER,
      productionShapeSource: PRODUCTION_SHAPE_SOURCE,
      productionWeightSource: PRODUCTION_WEIGHT_SOURCE,
      querySemantics: production.querySemantics,
      productionQuerySource: PRODUCTION_QUERY_SOURCE,
      queryMode: QUERY_MODE,
      contextProjection: CONTEXT_PROJECTION,
    },
    corpusId: `sha256:${corpusHash}`,
    corpusHash,
    corpusPath: options.corpusPath,
    corpusManifestHash:
      options.corpusManifestRaw === undefined ? null : sha256(options.corpusManifestRaw),
    corpusManifestPath: options.corpusManifestPath ?? null,
    sourceDataset: 'demo/init/agent-qa-eval (resolved by the committed 376.08.1 corpus)',
    corpusStats: {
      documents: options.corpus.documents.length,
      recordedQueries: options.corpus.recordedQueries.length,
      goldPairs,
      scoredPairs: collected.pairs.length,
      unmatchedPairs: collected.unmatchedPairs.length,
    },
    servingReplay,
    pairs: collected.pairs,
    unmatchedPairs: collected.unmatchedPairs,
  }
  const jsonPath = resolve(options.jsonPath)
  const markdownPath = resolve(options.markdownPath)
  await Promise.all([
    mkdir(dirname(jsonPath), { recursive: true }),
    mkdir(dirname(markdownPath), { recursive: true }),
  ])
  await Promise.all([
    writeFile(jsonPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8'),
    writeFile(markdownPath, renderMarkdown(receipt), 'utf8'),
  ])
  return { receipt, jsonPath, markdownPath }
}

interface CliOptions {
  corpusPath: string
  corpusManifestPath: string
  jsonPath: string
  markdownPath: string
  calibrationDate: string
}

function parseCliOptions(args: readonly string[]): CliOptions {
  const defaults: CliOptions = {
    corpusPath: fileURLToPath(new URL('../corpus/corpus.json', import.meta.url)),
    corpusManifestPath: fileURLToPath(
      new URL('../corpus/corpus-manifest.json', import.meta.url),
    ),
    jsonPath: fileURLToPath(new URL('../reports/tau-lex-receipt.json', import.meta.url)),
    markdownPath: fileURLToPath(new URL('../reports/TAU-LEX-RECEIPT.md', import.meta.url)),
    calibrationDate: CALIBRATION_DATE,
  }
  const options = { ...defaults }
  const flags = {
    '--corpus': 'corpusPath',
    '--manifest': 'corpusManifestPath',
    '--json': 'jsonPath',
    '--markdown': 'markdownPath',
    '--date': 'calibrationDate',
  } as const
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!
    if (argument === '--') continue
    const key = flags[argument as keyof typeof flags]
    if (key === undefined) throw new TypeError(`unknown argument: ${argument}`)
    const value = args[index + 1]
    if (value === undefined || value === '') throw new TypeError(`${argument} requires a value`)
    options[key] = value
    index += 1
  }
  return options
}

async function runCli(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2))
  const [corpusRaw, corpusManifestRaw] = await Promise.all([
    readFile(resolve(options.corpusPath), 'utf8'),
    readFile(resolve(options.corpusManifestPath), 'utf8'),
  ])
  const result = await calibrateTauLex({
    corpus: JSON.parse(corpusRaw) as TauLexCorpus,
    corpusPath: 'tools/embedding-bench/corpus/corpus.json',
    corpusRaw,
    corpusManifestPath: 'tools/embedding-bench/corpus/corpus-manifest.json',
    corpusManifestRaw,
    jsonPath: options.jsonPath,
    markdownPath: options.markdownPath,
    calibrationDate: options.calibrationDate,
  })
  process.stdout.write(
    `${JSON.stringify({
      json: result.jsonPath,
      markdown: result.markdownPath,
      tauLex: result.receipt.tauLex,
      pairs: result.receipt.pairs.length,
      matchedCandidates: result.receipt.servingReplay.matchedCandidates,
      admittedCandidates: result.receipt.servingReplay.admittedCandidates,
      goldRecall: result.receipt.servingReplay.goldRecall,
    })}\n`,
  )
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  runCli().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`)
    process.exitCode = 1
  })
}
