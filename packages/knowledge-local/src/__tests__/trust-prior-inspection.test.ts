import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { BundleOutcomeEventSchema, type TrustPriorTable } from '@vostride/agent-qa-schema'
import ts from 'typescript'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { appendOutcomeEvent } from '../bundle-append.js'
import { publishBundle, type PublishBundleInput } from '../bundle-publish.test-helper.js'
import { diffSince } from '../diff-since.js'
import { runKnowledgeGc } from '../gc.js'
import { inspectRecords } from '../inspect.js'
import { scanCanonicalBundles } from '../lineage-fold.js'
import { acquireWriterLease } from '../lease/writer-lease.js'
import { showRecord } from '../show-record.js'

const fold = vi.hoisted(() => ({ priors: undefined as TrustPriorTable | undefined, calls: 0 }))
vi.mock('../bundle-read.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../bundle-read.js')>()
  return { ...actual, deriveBundleTrust: (...args: Parameters<typeof actual.deriveBundleTrust>) => {
    fold.calls += 1
    return new Proxy(actual.deriveBundleTrust(args[0], fold.priors), {
      get(target, property, receiver) {
        if (property === 'trust') throw new Error('status-only maintenance consumed numerical trust')
        return Reflect.get(target, property, receiver)
      },
    })
  } }
})

const baseline = JSON.parse(readFileSync(new URL('./fixtures/420-prior-baseline.json', import.meta.url), 'utf8')) as {
  cases: { name: string; input: PublishBundleInput; appended: unknown[]; snapshots: { expectedBytes: string }[] }[]
}
const roots: string[] = []
afterEach(() => {
  fold.priors = undefined
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function persist(entry = baseline.cases.find(row => row.name === 'agent-observed-clean')!, stage = 5) {
  const root = mkdtempSync(join(tmpdir(), 'agent-qa-prior-inspect-'))
  roots.push(root)
  const config = { knowledgeRoot: join(root, 'knowledge'), productKey: 'fixture-storefront', commitArtifacts: 'none' as const }
  const published = publishBundle(config, entry.input)
  if (published.kind !== 'published') throw new Error('fixture publication refused')
  for (const event of entry.appended.slice(0, stage)) expect(appendOutcomeEvent(config, published.id, BundleOutcomeEventSchema.parse(event)).kind).toBe('appended')
  return { ...config, ...published, expected: JSON.parse(entry.snapshots[stage]!.expectedBytes) }
}

// Complete no-prior call census. Immediate status projections may stay; maintenance
// boundaries must expose only these fields so a future scalar use fails the compiler.
// Canary facts now receive the caller's prior argument, so they need no no-prior exception.
const statusOnlyCalls: Record<string, number> = {
  'gc.ts': 1, 'inspect.ts': 1, 'show-records.ts': 1, 'lineage-fold.ts': 1,
  'gates/gate-receipt-read.ts': 1,
  'rollback.ts': 3, 'review/propose-review.ts': 1, 'review/apply-review.ts': 1,
}

describe('420 maintenance prior dispositions', () => {
  // 2026-10-02 (quick 261002-tmo): a whole-program static census, CPU-bound and synchronous,
  // so there is nothing to wait on. Its program now roots only the non-test sources it
  // visits (the visited file set is asserted unchanged below): 886 ms -> 432 ms to build.
  // The budget is a hang ceiling, not a claim: 0.97 s alone, over 15 s under the forced
  // gate at load 20-37 (432-04 #2, 432-11 #4), so it carries 120 s as C432-EXPLICIT-ALL-CONTEXTS does.
  it('restricts every unpriorized fold to a semantic status counter or validity boundary', { timeout: 120_000 }, () => {
    const config = ts.readConfigFile('tsconfig.json', ts.sys.readFile)
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, process.cwd())
    const sourceRoots = parsed.fileNames.filter(name => !relative(resolve('src'), name).includes('__tests__'))
    const program = ts.createProgram(sourceRoots, parsed.options)
    const checker = program.getTypeChecker()
    const census: Record<string, number> = {}
    const unsafe: string[] = []
    const visited: string[] = []
    const sourceRoot = resolve('src')
    for (const source of program.getSourceFiles()) {
      const file = relative(sourceRoot, source.fileName)
      if (file.startsWith('..') || file.includes('__tests__') || source.isDeclarationFile) continue
      const aliases = new Set<string>()
      for (const statement of source.statements) {
        if (!ts.isImportDeclaration(statement)) continue
        const bindings = statement.importClause?.namedBindings
        if (bindings === undefined || !ts.isNamedImports(bindings)) continue
        for (const name of bindings.elements) {
          if ((name.propertyName ?? name.name).text === 'deriveBundleTrust') aliases.add(name.name.text)
        }
      }
      function visit(node: ts.Node): void {
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)
          && aliases.has(node.expression.text) && node.arguments.length === 1) {
          census[file] = (census[file] ?? 0) + 1
          const parent = node.parent
          const directStatus = ts.isPropertyAccessExpression(parent) && parent.name.text === 'status'
          const contextual = checker.getContextualType(node)
          const fields = contextual?.getProperties().map(property => property.name)
          const narrowed = fields !== undefined && fields.length > 0
            && fields.every(field => ['status', 'counters', 'validity'].includes(field))
          if (!directStatus && !narrowed) unsafe.push(`${file}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`)
        }
        ts.forEachChild(node, visit)
      }
      visited.push(source.fileName)
      visit(source)
    }
    expect(visited.sort()).toEqual(sourceRoots.map(name => resolve(name)).sort())
    expect(census).toEqual(statusOnlyCalls)
    expect(unsafe, 'unpriorized trust remains numerically accessible at these boundaries').toEqual([])
  })

  // 2026-10-02 (quick 261002-tmo): one cell per origin. The loop over all eight origins
  // shared one 15 s budget (5.2 s alone beside the other two trust-prior files). Each
  // origin keeps every assertion and carries its own budget; trust-prior-serving pins
  // the eight origin names of the shared fixture.
  it.each(baseline.cases)('keeps inspect show and lineage projections identical across absent empty and altered priors: $name', entry => {
    const f = persist(entry)
    const original = inspectRecords({ knowledgeRoot: f.knowledgeRoot, filter: {} })
    expect(original).toHaveLength(1)
    expect(original[0]).toMatchObject({ status: f.expected.status, confirmations: f.expected.counters.confirmed,
      contradictions: f.expected.counters.contradicted, openedAtOrdinal: f.expected.validity.openedAtOrdinal })
    expect(Object.keys(original[0]!).sort()).toEqual(['anchors', 'confirmations', 'contradictions', 'evidenceTokens', 'kind', 'lastEventOrdinal', 'openedAtOrdinal', 'product', 'recordId', 'schemaVersion', 'scope', 'status'])
    const lineage = scanCanonicalBundles(f.knowledgeRoot)
    expect(Object.keys(lineage[0]!).sort()).toEqual(['anchors', 'createdAtOrdinal', 'events', 'kind', 'recordId', 'scope', 'status'])
    for (const priors of [undefined, {}, { 'agent-observed': { alpha: 1.8, beta: 0.2 } }]) {
      fold.priors = priors
      expect(inspectRecords({ knowledgeRoot: f.knowledgeRoot, filter: {} })).toEqual(original)
      const shown = showRecord({ knowledgeRoot: f.knowledgeRoot, recordId: f.id })
      if (shown.kind !== 'found') throw new Error('saved record not found')
      expect(shown.record).toEqual(original[0])
      expect(scanCanonicalBundles(f.knowledgeRoot)).toEqual(lineage)
    }
  })

  it('diffSince returns change identity and evidence without folding trust', () => {
    const f = persist()
    const before = fold.calls
    const changes = diffSince({ knowledgeRoot: f.knowledgeRoot, sinceOrdinal: 0 })
    expect(changes.length).toBeGreaterThan(0)
    expect(changes.every(change => change.recordId === f.id && !('trust' in change))).toBe(true)
    expect(fold.calls).toBe(before)
  })

  it('GC uses lifecycle and horizon under real writer authority without reading the scalar', () => {
    const f = persist(undefined, 8)
    const lease = acquireWriterLease(f.knowledgeRoot)
    if (lease.kind !== 'acquired') throw new Error('fixture lease unavailable')
    const authority = { knowledgeRoot: f.knowledgeRoot, leaseId: lease.leaseId, epoch: lease.epoch }
    const input = { knowledgeRoot: f.knowledgeRoot, retainK: 0, horizon: { kind: 'ordinal' as const, deepestGateOrdinal: 15 } }
    const original = runKnowledgeGc(input, authority)
    expect(original).toEqual({ trimmedRecordIds: [], skipped: { unknownRef: 0, withinK: 0, userOrigin: 0, horizon: 1 } })
    fold.priors = { 'agent-observed': { alpha: 1.8, beta: 0.2 } }
    expect(runKnowledgeGc(input, authority)).toEqual(original)
    expect(runKnowledgeGc({ ...input, horizon: { kind: 'none' } }, authority).trimmedRecordIds).toEqual([f.id])
  })
})
