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
  schemaVersion: 1
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
const SIGN_CONVENTION =
  'SQLite FTS5 bm25() returns negated raw scores (better matches are more negative); calibration stores bm25Positive = -bm25(...) and applies TAU_LEX on that positive scale.'
const QUERY_MODE =
  'Per-gold score probe over deduplicated, double-quote-escaped query tokens joined with FTS5 OR; serving uses the same FTS5 tokenizer, columns, bm25() weights, and positive-score convention.'
const CONTEXT_PROJECTION =
  'The recorded corpus predates graph neighbors, so the v2 context column is present and populated with the empty string for every corpus document.'

interface ProductionFtsContract {
  weights: TauLexReceipt['weights']
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
  return {
    weights: {
      identity: parseNumericConstant(constantsSource, 'FTS_WEIGHT_IDENTITY'),
      content: parseNumericConstant(constantsSource, 'FTS_WEIGHT_CONTENT'),
      context: parseNumericConstant(constantsSource, 'FTS_WEIGHT_CONTEXT'),
    },
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

function scoreQuery(query: string): string {
  const tokens = [
    ...new Set(
      query
        .split(/\s+/u)
        .filter((token) => token !== '')
        .map((token) => token.replaceAll('"', '""')),
    ),
  ]
  if (tokens.length === 0) throw new TypeError('recorded query text must not be empty')
  return tokens.map((token) => `"${token}"`).join(' OR ')
}

function collectPairs(
  corpus: TauLexCorpus,
  rowids: ReadonlyMap<string, number>,
  weights: TauLexReceipt['weights'],
): { pairs: TauLexPair[]; unmatchedPairs: TauLexUnmatchedPair[] } {
  const db = new DatabaseSync(':memory:')
  try {
    db.exec(`
      CREATE VIRTUAL TABLE fts_records USING fts5(
        identity,
        content,
        context,
        tokenize = "${FTS_TOKENIZER}"
      )
    `)
    const insert = db.prepare(`
      INSERT INTO fts_records (rowid, identity, content, context)
      VALUES (?, ?, ?, ?)
    `)
    corpus.documents.forEach((document, index) => {
      insert.run(index + 1, identityProjection(document.text), document.text, '')
    })
    const score = db.prepare(`
      SELECT -bm25(fts_records, ?, ?, ?) AS bm25_positive
      FROM fts_records
      WHERE fts_records MATCH ? AND rowid = ?
    `)
    const pairs: TauLexPair[] = []
    const unmatchedPairs: TauLexUnmatchedPair[] = []
    for (const query of corpus.recordedQueries) {
      const match = scoreQuery(query.query)
      for (const goldId of [...new Set(query.goldDocIds)].sort()) {
        const rowid = rowids.get(goldId)
        if (rowid === undefined) {
          throw new Error(`recorded query ${query.id} references missing gold document ${goldId}`)
        }
        const row = score.get(
          weights.identity,
          weights.content,
          weights.context,
          match,
          rowid,
        )
        if (row === undefined) {
          unmatchedPairs.push({ queryId: query.id, goldId })
          continue
        }
        const bm25Positive = Number(row.bm25_positive)
        if (!Number.isFinite(bm25Positive) || bm25Positive < 0) {
          throw new TypeError(`invalid positive BM25 score for ${query.id}/${goldId}`)
        }
        pairs.push({ queryId: query.id, goldId, bm25Positive: roundScore(bm25Positive) })
      }
    }
    const byIdentity = (
      left: TauLexPair | TauLexUnmatchedPair,
      right: TauLexPair | TauLexUnmatchedPair,
    ) => left.queryId.localeCompare(right.queryId) || left.goldId.localeCompare(right.goldId)
    pairs.sort(byIdentity)
    unmatchedPairs.sort(byIdentity)
    return { pairs, unmatchedPairs }
  } finally {
    db.close()
  }
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
    `- Query score probe: ${receipt.ftsShape.queryMode}`,
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
    `| Scored lexical pairs | ${receipt.corpusStats.scoredPairs} |`,
    `| No-overlap pairs | ${receipt.corpusStats.unmatchedPairs} |`,
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
    '## Gold Pairs Without Lexical Overlap',
    '',
    'These members were resolved and validated against the recorded corpus, but the score-probe query had no matching FTS token. They are excluded from the lexical-candidate floor rather than represented as fabricated BM25 scores.',
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
  const { pairs, unmatchedPairs } = collectPairs(options.corpus, rowids, production.weights)
  const derived = deriveTauLex(pairs.map(({ bm25Positive }) => bm25Positive))
  const corpusRaw = options.corpusRaw ?? JSON.stringify(options.corpus)
  const corpusHash = sha256(corpusRaw)
  const goldPairs = options.corpus.recordedQueries.reduce(
    (count, query) => count + new Set(query.goldDocIds).size,
    0,
  )
  const receipt: TauLexReceipt = {
    schemaVersion: 1,
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
      scoredPairs: pairs.length,
      unmatchedPairs: unmatchedPairs.length,
    },
    pairs,
    unmatchedPairs,
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
