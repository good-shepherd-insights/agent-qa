import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { cassetteSchema } from '@vostride/agent-qa-eval'
import { renderEmbeddingInput, sha256hex, type Anchor } from '@vostride/agent-qa-schema'

/**
 * D-01: benchmark documents come only from validated cassette screen states. Every on-screen
 * element is represented; corpus scale comes from real screen density, never synthetic text.
 */
export const CORPUS_BUILDER_VERSION = '376.08.1'

export interface CorpusDocument {
  id: string
  kind: 'element' | 'page'
  text: string
  apps: string[]
  sourcePaths: string[]
}

export interface RecordedQuery {
  id: string
  app: string
  query: string
  goldDocIds: string[]
  sourceCassetteId: string
  sourcePath: string
}

export interface CorpusSource {
  path: string
  sha256: string
  app: string
  granularity: 'leaf'
  kind: 'canonical' | 'extracted' | 'fixture'
}

export interface CorpusManifest {
  builderVersion: string
  totals: {
    documents: number
    recordedQueries: number
    sourceCassettes: number
  }
  perApp: Record<string, { documents: number; recordedQueries: number }>
  sources: CorpusSource[]
}

export interface BuiltCorpus {
  documents: CorpusDocument[]
  recordedQueries: RecordedQuery[]
  manifest: CorpusManifest
}

interface MutableDocument {
  id: string
  kind: 'element' | 'page'
  text: string
  apps: Set<string>
  sourcePaths: Set<string>
}

type ParsedCassette = ReturnType<typeof cassetteSchema.parse>
type LeafCassette = Extract<ParsedCassette, { granularity: 'leaf' }>
type InputLeg = LeafCassette['input']
type ScreenState = InputLeg['stateBefore']
type RecordLegs = Pick<LeafCassette, 'input' | 'sidecar'>

function stableSourcePath(path: string): string {
  const pathFromCwd = relative(process.cwd(), resolve(path)) || basename(path)
  return pathFromCwd.split(sep).join('/')
}

function sourceKind(path: string): CorpusSource['kind'] {
  if (path.includes('/.agent-qa/eval/cassettes/')) return 'extracted'
  if (path.includes('/agent-qa-eval/cassettes/')) return 'canonical'
  return 'fixture'
}

function explicitAppFromPath(path: string): string | undefined {
  const parts = path.split('/')
  const cassetteIndex = parts.lastIndexOf('cassettes')
  const candidate = cassetteIndex === -1 ? undefined : parts[cassetteIndex + 1]
  return candidate === undefined || candidate.startsWith('r_') ? undefined : candidate
}

function inferApp(path: string, input: InputLeg): string {
  const explicit = explicitAppFromPath(path)
  if (explicit !== undefined) return explicit

  const state = input.stateBefore
  const signal = [state.url ?? '', input.stepText, state.tree.slice(0, 2_000)]
    .join('\n')
    .toLowerCase()
  if (state.platform === 'ios' || signal.includes('apple maps')) return 'apple-maps'
  if (signal.includes('automationexercise')) return 'automation-exercise'
  if (state.platform === 'android' || signal.includes('google maps')) return 'google-maps'
  return 'example-web'
}

function pageRoute(state: ScreenState): string {
  return state.url ?? `${state.platform}://screen/${sha256hex(state.tree)}`
}

function elementIdentity(role: string, nameNormalized: string, ordinal: number): string {
  return `${role}\u0000${nameNormalized}\u0000${ordinal}`
}

function addDocument(
  documents: Map<string, MutableDocument>,
  input: { kind: 'element' | 'page'; text: string; app: string; sourcePath: string },
): string {
  const id = `doc:${sha256hex(input.text)}`
  const existing = documents.get(id)
  if (existing === undefined) {
    documents.set(id, {
      id,
      kind: input.kind,
      text: input.text,
      apps: new Set([input.app]),
      sourcePaths: new Set([input.sourcePath]),
    })
  } else {
    if (existing.text !== input.text || existing.kind !== input.kind) {
      throw new Error(`document digest collision for ${id}`)
    }
    existing.apps.add(input.app)
    existing.sourcePaths.add(input.sourcePath)
  }
  return id
}

function renderPage(state: ScreenState): string {
  const route = pageRoute(state)
  return renderEmbeddingInput({
    summary: `page "${state.url ?? state.platform}"`,
    body: [
      `platform: ${state.platform}`,
      `page url: ${state.url ?? ''}`,
      'screen tree:',
      state.tree,
    ].join('\n'),
    anchors: [{ t: 'page', route }],
  })
}

function processRecord(
  record: RecordLegs,
  context: {
    cassetteId: string
    sourcePath: string
    app: string
    documents: Map<string, MutableDocument>
    queries: RecordedQuery[]
  },
): void {
  const state = record.input.stateBefore
  const route = pageRoute(state)
  addDocument(context.documents, {
    kind: 'page',
    text: renderPage(state),
    app: context.app,
    sourcePath: context.sourcePath,
  })

  const identityCounts = new Map<string, number>()
  const identityToDocId = new Map<string, string>()
  for (const element of state.elements) {
    const identityWithoutOrdinal = `${element.role}\u0000${element.nameNormalized}`
    const ordinal = identityCounts.get(identityWithoutOrdinal) ?? 0
    identityCounts.set(identityWithoutOrdinal, ordinal + 1)

    const anchors: Anchor[] = [
      { t: 'el', role: element.role, name: element.name, ordinal },
      { t: 'page', route },
    ]
    const text = renderEmbeddingInput({
      summary: `${element.role} "${element.name}"`,
      body: [
        `role: ${element.role}`,
        `name: ${element.name}`,
        `nameNormalized: ${element.nameNormalized}`,
        `page url: ${state.url ?? ''}`,
      ].join('\n'),
      anchors,
    })
    const docId = addDocument(context.documents, {
      kind: 'element',
      text,
      app: context.app,
      sourcePath: context.sourcePath,
    })
    identityToDocId.set(elementIdentity(element.role, element.nameNormalized, ordinal), docId)
  }

  const goldAnchor = record.sidecar.goldAnchor
  if (goldAnchor === undefined) return

  const goldDocIds = new Set<string>()
  for (const gold of [goldAnchor, ...record.sidecar.equivalenceSet]) {
    const docId = identityToDocId.get(
      elementIdentity(gold.role, gold.nameNormalized, gold.ordinal),
    )
    if (docId === undefined) {
      throw new Error(
        `gold member ${gold.role}/${gold.nameNormalized}/${gold.ordinal} is not on this screen (${context.sourcePath})`,
      )
    }
    goldDocIds.add(docId)
  }

  const orderedGoldDocIds = [...goldDocIds].sort()
  const queryPreimage = [
    context.sourcePath,
    context.cassetteId,
    record.input.stepText,
    ...orderedGoldDocIds,
  ].join('\u0000')
  context.queries.push({
    id: `query:${sha256hex(queryPreimage)}`,
    app: context.app,
    query: record.input.stepText,
    goldDocIds: orderedGoldDocIds,
    sourceCassetteId: context.cassetteId,
    sourcePath: context.sourcePath,
  })
}

export async function buildCorpus(options: {
  cassettePaths: readonly string[]
}): Promise<BuiltCorpus> {
  const cassettePaths = [...new Set(options.cassettePaths.map((path) => resolve(path)))].sort()
  if (cassettePaths.length === 0) throw new TypeError('at least one cassette path is required')

  const documents = new Map<string, MutableDocument>()
  const queries: RecordedQuery[] = []
  const sources: CorpusSource[] = []

  for (const cassettePath of cassettePaths) {
    const raw = await readFile(cassettePath, 'utf8')
    const sourcePath = stableSourcePath(cassettePath)
    let json: unknown
    try {
      json = JSON.parse(raw)
    } catch (error) {
      throw new TypeError(`invalid cassette JSON at ${sourcePath}`, { cause: error })
    }
    const cassette = cassetteSchema.parse(json)
    if (cassette.granularity !== 'leaf') {
      throw new TypeError(`corpus sources must be leaf cassettes: ${sourcePath}`)
    }
    const app = inferApp(sourcePath, cassette.input)
    processRecord(cassette, {
      cassetteId: cassette.id,
      sourcePath,
      app,
      documents,
      queries,
    })
    sources.push({
      path: sourcePath,
      sha256: sha256hex(raw),
      app,
      granularity: 'leaf',
      kind: sourceKind(sourcePath),
    })
  }

  const orderedDocuments: CorpusDocument[] = [...documents.values()]
    .map((document) => ({
      id: document.id,
      kind: document.kind,
      text: document.text,
      apps: [...document.apps].sort(),
      sourcePaths: [...document.sourcePaths].sort(),
    }))
    .sort((left, right) => left.id.localeCompare(right.id))
  const orderedQueries = queries.sort(
    (left, right) =>
      left.app.localeCompare(right.app) ||
      left.query.localeCompare(right.query) ||
      left.sourcePath.localeCompare(right.sourcePath) ||
      left.id.localeCompare(right.id),
  )

  const appNames = new Set<string>(sources.map((source) => source.app))
  const perApp: CorpusManifest['perApp'] = {}
  for (const app of [...appNames].sort()) {
    perApp[app] = {
      documents: orderedDocuments.filter((document) => document.apps.includes(app)).length,
      recordedQueries: orderedQueries.filter((query) => query.app === app).length,
    }
  }

  return {
    documents: orderedDocuments,
    recordedQueries: orderedQueries,
    manifest: {
      builderVersion: CORPUS_BUILDER_VERSION,
      totals: {
        documents: orderedDocuments.length,
        recordedQueries: orderedQueries.length,
        sourceCassettes: sources.length,
      },
      perApp,
      sources,
    },
  }
}

async function findLeafCassettes(root: string): Promise<string[]> {
  const rootPath = resolve(root)
  const rootStat = await stat(rootPath)
  if (rootStat.isFile()) return [rootPath]
  if (!rootStat.isDirectory()) throw new TypeError(`cassette root is not a directory: ${root}`)

  const found: string[] = []
  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true })
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        await visit(path)
      } else if (
        entry.isFile() &&
        entry.name === 'cassette.json' &&
        basename(dirname(path)).endsWith('-leaf')
      ) {
        found.push(path)
      }
    }
  }
  await visit(rootPath)
  return found
}

function parseCliArgs(args: readonly string[]): { cassetteRoots: string[]; outDir: string } {
  const cassetteRoots: string[] = []
  let outDir: string | undefined
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--') continue
    if (arg === '--cassette-root') {
      const value = args[index + 1]
      if (value === undefined) throw new TypeError('--cassette-root requires a path')
      cassetteRoots.push(value)
      index += 1
      continue
    }
    if (arg?.startsWith('--cassette-root=')) {
      cassetteRoots.push(arg.slice('--cassette-root='.length))
      continue
    }
    if (arg === '--out') {
      outDir = args[index + 1]
      index += 1
      continue
    }
    if (arg?.startsWith('--out=')) {
      outDir = arg.slice('--out='.length)
      continue
    }
    throw new TypeError(`unknown argument: ${String(arg)}`)
  }
  if (cassetteRoots.length === 0 || outDir === undefined || outDir.trim() === '') {
    throw new TypeError(
      'usage: build-corpus --cassette-root <path> [--cassette-root <path> ...] --out <directory>',
    )
  }
  return { cassetteRoots, outDir: resolve(outDir) }
}

async function runCli(args: readonly string[]): Promise<void> {
  const { cassetteRoots, outDir } = parseCliArgs(args)
  const paths = (await Promise.all(cassetteRoots.map(findLeafCassettes))).flat()
  const built = await buildCorpus({ cassettePaths: paths })
  await mkdir(outDir, { recursive: true })
  await Promise.all([
    writeFile(
      join(outDir, 'corpus.json'),
      `${JSON.stringify(
        { documents: built.documents, recordedQueries: built.recordedQueries },
        null,
        2,
      )}\n`,
    ),
    writeFile(
      join(outDir, 'corpus-manifest.json'),
      `${JSON.stringify(built.manifest, null, 2)}\n`,
    ),
  ])
  console.log(
    `built ${built.documents.length} documents and ${built.recordedQueries.length} recorded queries from ${built.manifest.sources.length} leaf cassettes`,
  )
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && fileURLToPath(import.meta.url) === resolve(invokedPath)) {
  runCli(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
