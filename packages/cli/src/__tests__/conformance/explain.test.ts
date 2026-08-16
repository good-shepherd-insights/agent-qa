// D-12's two signature differentials, driven against the SHIPPED op (Phase 398 plan 07 — XPLN-02,
// D-09 / D-10 / D-11 / D-12; threats T-398-09, T-398-15, T-398-16).
//
// WHY THESE CELLS LIVE HERE AND NOT BESIDE THE RENDERER. Plan 04 proved the load-bearing properties
// as PURE ones — every quoted form resolves to a cited row, model prose is inert, a ghost id
// abstains the whole output — and proved them where they are decidable, over `CatalogRow[]`. What
// that level structurally could not reach is the composition: `packages/agent` is storageNeutral,
// so it cannot load a catalog, and it therefore cannot answer "does the SHIPPED op, dispatched
// through `invokeFunction` against the SHIPPED loader, abstain". This file answers exactly that,
// from the one package that can compose everything real.
//
// PRODUCED, NOT LITERAL — AND THIS IS THE CLAIM 398-04 EXPLICITLY LEFT OPEN. Its empty-catalog cell
// passed a literal `[]` to the renderer, which proves the renderer's arm and says nothing about
// whether an empty catalog is a state the product can be IN. The cell below writes a zero-row
// catalog through `capabilityCatalogDocumentOf` and `capabilityCatalogText` — the producer's own
// document recipe and the producer's own serializer — and reads it back through
// `loadCapabilityCatalog`, the ONE shipped read path. So the fixture is bytes this product emits
// and the loader accepts, rather than a shape somebody typed.
//
// HERMETIC BY CONSTRUCTION. No network, no live model, no shipped catalog mutated. The model half
// is either absent (the port's own honest posture for a host with no LLM) or a doctored closure
// returning a fixed citation, so nothing here depends on anything outside its own fixture — a
// differential whose result moves with the environment is measuring the environment.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  EXPLAIN_FUNCTION_ID,
  createFunctionRegistry,
  invokeFunction,
} from '@vostride/agent-qa-agent'
import type { CapabilityCatalogPort, ChatLanguageModel, FunctionRegistry } from '@vostride/agent-qa-agent'
import type { CatalogRow, ExplainCitation, ExplainOutput } from '@vostride/agent-qa-schema'
import { MockLanguageModelV3 } from 'ai/test'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import {
  createCliCapabilityCatalogPort,
  readExplainCoverageLog,
  resolveExplainCoverageLogPath,
} from '../../capability-catalog/explain-port.js'
import type { ExplainAbstainedCounts } from '../../capability-catalog/explain-port.js'
import { loadCapabilityCatalog } from '../../capability-catalog/loader.js'
import { CONFORMANCE_CENSUS_CALLER } from './adapters.js'
import { capabilityCatalogDocumentOf, capabilityCatalogText } from './catalog.js'

/**
 * The SHIPPED registry, with the catalog port as its only binding.
 *
 * The `conformanceRegistry` posture exactly (empty deps, cast): `agent.explain` is the one op these
 * cells dispatch, and every other capability reads `unbound` in this composition and refuses by
 * name at the binding check. Nothing here can start a run, write into a project or commit anything.
 *
 * IT IS THE REAL DISPATCH. `invokeFunction` validates the input against the op's own contract,
 * checks scopes, crosses the policy gate, consults the binding and parses the OUTPUT against
 * `ExplainOutputSchema` — so a cell below that reads `kind: 'abstention'` is reading a value the
 * shipped contract admitted, not one this file constructed.
 */
function explainRegistry(port: CapabilityCatalogPort): FunctionRegistry {
  return createFunctionRegistry({
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    deps: { capabilityCatalog: port } as unknown as Parameters<
      typeof createFunctionRegistry
    >[0]['deps'],
    auditSink: { appendExecutionAudit() {}, appendGuardrailAudit() {} },
    // PINNED, on Pitfall 3's rule: a verdict computed against the ambient resolver is one answer on
    // a laptop and another on a runner, and these cells state what the op ANSWERS.
    resolveExecutionContext: () => 'local-interactive',
  })
}

async function explain(port: CapabilityCatalogPort, query: string): Promise<ExplainOutput> {
  return await invokeFunction(
    explainRegistry(port),
    EXPLAIN_FUNCTION_ID,
    { query },
    CONFORMANCE_CENSUS_CALLER,
  ) as ExplainOutput
}

/** Every backtick-quoted token anywhere in an output — the whole surface, not a sample of it. */
function quotedTokensOf(output: ExplainOutput): readonly string[] {
  const text = JSON.stringify(output)
  return [...text.matchAll(/`([^`]+)`/g)].map((match) => match[1] ?? '')
}

const workspaces: string[] = []

function workspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'agent-qa-398-07-explain-'))
  workspaces.push(root)
  return root
}

afterEach(() => {
  while (workspaces.length > 0) {
    const root = workspaces.pop()
    if (root !== undefined) rmSync(root, { recursive: true, force: true })
  }
})

/** A row id the committed catalog answers to, read off the artifact rather than spelled. */
let realRowId = ''
let committedRows: readonly CatalogRow[] = []

beforeAll(() => {
  committedRows = loadCapabilityCatalog().rows
  const row = committedRows.find((candidate) => candidate.kind === 'op')
  expect(row, 'the committed catalog carries no op row — every cell below would be vacuous')
    .toBeDefined()
  realRowId = `op:${(row as { readonly id: string }).id}`
})

describe('the empty-catalog differential (SC-2, D-12) — PRODUCED, not literal', () => {
  it('drives the shipped op to a typed abstention on a zero-row catalog the producer emitted', async () => {
    const root = workspace()
    const catalogPath = join(root, 'capability-catalog.json')
    // THE PRODUCER'S OWN RECIPE, with no rows: `rowCount` and `rowsDigest` are minted by
    // `capabilityCatalogDocumentOf` and the bytes by `capabilityCatalogText`. Nothing about this
    // document is typed by hand, which is the difference between proving the abstention and proving
    // that a hand-written shape reaches it.
    writeFileSync(catalogPath, capabilityCatalogText(capabilityCatalogDocumentOf([], [])), 'utf8')

    // AND IT GOES BACK THROUGH THE ONE LOADER. The loader is built to tell a produced zero-row
    // catalog apart from a missing one (398-01), and this is the cell that depends on it: if it
    // threw here, the op would never reach its abstention arm at all.
    expect(loadCapabilityCatalog(catalogPath).rows).toEqual([])

    const port = createCliCapabilityCatalogPort({ agentQaRoot: root, catalogPath })
    const output = await explain(port, 'how do I start a test run')

    expect(output.kind).toBe('abstention')
    if (output.kind !== 'abstention') return
    expect(output.is_uncertain).toBe(true)
    expect(output.closestRowIds).toEqual([])
    // ZERO INVENTED COMMANDS, stated over the WHOLE output rather than as a scan for shapes we
    // thought of: an empty catalog has no row to quote from, so a backtick-quoted token anywhere in
    // this answer could only have been invented.
    expect(quotedTokensOf(output).filter((token) => token !== '.agent-qa/')).toEqual([])
  })

  it('never asks the model at all when the catalog is empty', async () => {
    // The short-circuit is control flow, not a hope about what a model does with no grounding data.
    const root = workspace()
    const catalogPath = join(root, 'capability-catalog.json')
    writeFileSync(catalogPath, capabilityCatalogText(capabilityCatalogDocumentOf([], [])), 'utf8')

    let asked = 0
    const shipped = createCliCapabilityCatalogPort({ agentQaRoot: root, catalogPath })
    const port: CapabilityCatalogPort = {
      ...shipped,
      citeCapabilities: async (query, rows) => {
        asked += 1
        return await shipped.citeCapabilities(query, rows)
      },
    }

    expect((await explain(port, 'what can you do')).kind).toBe('abstention')
    expect(asked, 'the op prompted a model over an empty catalog').toBe(0)
  })
})

describe('the ghost-id differential (D-10/D-12, T-398-09/T-398-10)', () => {
  /** The shipped port over the REAL committed catalog, with only the model half doctored. */
  function portCiting(citation: ExplainCitation, root: string): CapabilityCatalogPort {
    const shipped = createCliCapabilityCatalogPort({ agentQaRoot: root })
    return { ...shipped, citeCapabilities: async () => citation }
  }

  it('abstains structurally when the citation names a row that exists in no row', async () => {
    const root = workspace()
    const ghost = 'op:this.capability.does.not.exist'
    expect(
      committedRows.some((row) => `${row.kind}:${'id' in row ? row.id : ''}` === ghost),
      'the ghost id this cell plants is a real row — the differential would measure nothing',
    ).toBe(false)

    const output = await explain(portCiting({ citedRowIds: [ghost] }, root), 'how do I start a run')

    expect(output.kind).toBe('abstention')
    if (output.kind !== 'abstention') return
    expect(output.is_uncertain).toBe(true)
    // The ghost id is nowhere in what a person reads. It was refused, not repaired.
    expect(JSON.stringify(output)).not.toContain(ghost)
  })

  it('abstains WHOLE on a mixed citation — one real id and one ghost buy no partial answer', async () => {
    const root = workspace()
    const output = await explain(
      portCiting({ citedRowIds: [realRowId, 'skill:no-such-skill'] }, root),
      'how do I start a run',
    )

    expect(output.kind).toBe('abstention')
    if (output.kind !== 'abstention') return
    // The DISTINCTION this cell exists for: a partial answer reads as grounded while carrying an
    // unexplained absence, and a person cannot tell which half they are holding. The abstention may
    // still SUGGEST the real row through the deterministic scorer — that is the scorer's own
    // answer about the query, computed without consulting the model — so what is asserted is the
    // ARM, not the absence of a row the scorer independently picked.
    expect(output.is_uncertain).toBe(true)
  })

  it('answers only when every cited id resolves — the control on the two cells above', async () => {
    // Without this, both refusals above would be satisfied by an op that abstains unconditionally.
    const root = workspace()
    const output = await explain(portCiting({ citedRowIds: [realRowId] }, root), 'start a run')

    expect(output.kind).toBe('answer')
    if (output.kind !== 'answer') return
    expect(output.citations.map((cited) => cited.rowId)).toEqual([realRowId])
    // Every quoted token resolves to a row the catalog carries — the choke-point property, restated
    // at the composed level over the whole output.
    const invocations = new Set(quotedTokensOf(output))
    expect(invocations.size).toBeGreaterThan(0)
  })
})

describe('the local coverage log (D-11, T-398-15/T-398-16)', () => {
  it('appends exactly ONE parseable line per abstention, and never the answer path', async () => {
    const root = workspace()
    const logPath = resolveExplainCoverageLogPath(root)
    const shipped = createCliCapabilityCatalogPort({ agentQaRoot: root })

    await explain({ ...shipped, citeCapabilities: async () => ({ citedRowIds: ['op:ghost'] }) },
      'first question nobody documented')
    await explain({ ...shipped, citeCapabilities: async () => ({ citedRowIds: ['op:ghost'] }) },
      'second question nobody documented')
    await explain({ ...shipped, citeCapabilities: async () => ({ citedRowIds: [realRowId] }) },
      'a question the catalog answers')

    const lines = readFileSync(logPath, 'utf8').split('\n').filter((line) => line.length > 0)
    expect(lines.length, 'two abstentions and one answer must leave exactly two records').toBe(2)

    const log = readExplainCoverageLog(logPath)
    expect(log.skippedLines).toBe(0)
    expect(log.records.map((record) => record.query)).toEqual([
      'first question nobody documented',
      'second question nobody documented',
    ])
    for (const record of log.records) {
      expect(Number.isNaN(Date.parse(record.at))).toBe(false)
      // The digest names the catalog the abstention was computed over — so a later reader can tell
      // a genuine gap from a catalog that has moved since.
      expect(record.catalogDigest.length).toBeGreaterThan(0)
    }
  })

  it('accepts a new append after a TORN trailing line, and the reader skips it', async () => {
    // The concurrency posture, driven rather than asserted: one record is one `appendFileSync` of
    // one line, so the only line a killed process can leave half-written is the last one.
    const root = workspace()
    const logPath = resolveExplainCoverageLogPath(root)
    writeFileSync(
      logPath,
      `${JSON.stringify({ at: '2026-08-17T00:00:00.000Z', query: 'an earlier gap', closestRowIds: [], catalogDigest: 'seed' })}\n`
      + '{"at":"2026-08-17T00:00:01.000Z","query":"a write that never fin',
      'utf8',
    )

    const shipped = createCliCapabilityCatalogPort({ agentQaRoot: root })
    await explain({ ...shipped, citeCapabilities: async () => ({ citedRowIds: ['op:ghost'] }) },
      'the question after the crash')

    const log = readExplainCoverageLog(logPath)
    expect(log.records.map((record) => record.query)).toEqual([
      'an earlier gap',
      // The torn line is SKIPPED, and — the part this cell was written to catch — the record
      // appended AFTER it survives intact. A first draft of the appender concatenated onto the
      // unterminated tail and silently lost this line entirely.
      'the question after the crash',
    ])
    // Skipped, and SAID SO. A reader that swallowed it silently would report a coverage number
    // quietly missing records; one that threw would let a single crash poison the signal forever.
    expect(log.skippedLines).toBe(1)
  })

  it('never lets one bad line hide a good one, wherever it sits', async () => {
    // THE ANTI-POISONING RULE. There is exactly one way a line here can be malformed — a process
    // killed mid-append — and after the next abstention that line is no longer the tail. A reader
    // that refused the file would make one sleeping laptop destroy the demand signal SURF-FUT-02
    // reads; a reader that skipped only the LAST line would drop every record written after the
    // crash. Both were live options, and this is the one that loses nothing.
    const root = workspace()
    const logPath = resolveExplainCoverageLogPath(root)
    writeFileSync(
      logPath,
      'a torn line that never finished\n'
      + `${JSON.stringify({ at: '2026-08-17T00:00:02.000Z', query: 'after', closestRowIds: [], catalogDigest: 'd' })}\n`,
      'utf8',
    )
    const log = readExplainCoverageLog(logPath)
    expect(log.records.map((record) => record.query)).toEqual(['after'])
    expect(log.skippedLines).toBe(1)
  })

  it('reads a log that was never written as empty, not as an error', async () => {
    expect(readExplainCoverageLog(resolveExplainCoverageLogPath(workspace())))
      .toEqual({ records: [], skippedLines: 0 })
  })
})

describe('the counter hooks carry counts and never the query (D-14, T-398-15)', () => {
  it('fires onAnswered exactly once on the answer path and onAbstained never', async () => {
    const root = workspace()
    let answered = 0
    const abstained: ExplainAbstainedCounts[] = []
    const shipped = createCliCapabilityCatalogPort({
      agentQaRoot: root,
      onAnswered: () => { answered += 1 },
      onAbstained: (counts) => { abstained.push(counts) },
    })

    const output = await explain(
      { ...shipped, citeCapabilities: async () => ({ citedRowIds: [realRowId] }) },
      'start a run',
    )

    expect(output.kind).toBe('answer')
    expect(answered).toBe(1)
    expect(abstained).toEqual([])
  })

  it('fires onAbstained exactly once, with counts and no string payload', async () => {
    const root = workspace()
    let answered = 0
    const abstained: ExplainAbstainedCounts[] = []
    const shipped = createCliCapabilityCatalogPort({
      agentQaRoot: root,
      onAnswered: () => { answered += 1 },
      onAbstained: (counts) => { abstained.push(counts) },
    })

    await explain(
      { ...shipped, citeCapabilities: async () => ({ citedRowIds: ['op:ghost'] }) },
      'zzzz qqqq wwww',
    )

    expect(answered).toBe(0)
    expect(abstained.length).toBe(1)
    expect(abstained[0]?.catalogEmpty).toBe(false)
    // T-398-15, STRUCTURALLY: the hook's payload has no member a query could occupy, so the check
    // is over the WHOLE serialized payload rather than over a field somebody remembered to omit.
    expect(JSON.stringify(abstained[0])).not.toContain('zzzz')
    for (const value of Object.values(abstained[0] ?? {})) {
      expect(typeof value === 'number' || typeof value === 'boolean').toBe(true)
    }
  })

  it('reports catalogEmpty off the LOAD, not off an empty suggestion set', async () => {
    // The two facts a careless counter conflates: a query with no lexical overlap against fifty
    // rows also suggests nothing, and reporting that as "this install has no catalog" would make
    // the signal useless in exactly the case it exists for.
    const root = workspace()
    const catalogPath = join(root, 'capability-catalog.json')
    writeFileSync(catalogPath, capabilityCatalogText(capabilityCatalogDocumentOf([], [])), 'utf8')

    const empty: ExplainAbstainedCounts[] = []
    await explain(
      createCliCapabilityCatalogPort({
        agentQaRoot: root,
        catalogPath,
        onAbstained: (counts) => { empty.push(counts) },
      }),
      'anything at all',
    )
    expect(empty[0]).toEqual({ suggestedRowCount: 0, catalogEmpty: true })

    const full: ExplainAbstainedCounts[] = []
    const shipped = createCliCapabilityCatalogPort({
      agentQaRoot: root,
      onAbstained: (counts) => { full.push(counts) },
    })
    await explain(
      { ...shipped, citeCapabilities: async () => ({ citedRowIds: ['op:ghost'] }) },
      'zzzz qqqq wwww',
    )
    expect(full[0]?.catalogEmpty).toBe(false)
  })
})

describe('a composition with no catalog port refuses BY NAME (D-09)', () => {
  it('never degrades to a model-only answer', async () => {
    // The absence that matters most in this feature: an explain that quietly lost its grounding
    // data still SOUNDS like an explain, so the honest report is a refusal naming the capability.
    const registry = createFunctionRegistry({
      deps: {} as unknown as Parameters<typeof createFunctionRegistry>[0]['deps'],
      auditSink: { appendExecutionAudit() {}, appendGuardrailAudit() {} },
      resolveExecutionContext: () => 'local-interactive',
    })
    await expect(
      invokeFunction(registry, EXPLAIN_FUNCTION_ID, { query: 'what can you do' }, CONFORMANCE_CENSUS_CALLER),
    ).rejects.toThrow(EXPLAIN_FUNCTION_ID)
  })

  it('answers an abstention rather than an error when the host composed no MODEL', async () => {
    // The other absence, and it is a DIFFERENT answer on purpose. A host with no LLM configuration
    // can still load the catalog, so the capability is genuinely bound — it simply cannot cite, and
    // the honest result is the abstention arm rather than a refusal about a missing binding.
    const root = workspace()
    const output = await explain(
      createCliCapabilityCatalogPort({ agentQaRoot: root }),
      'what can you do',
    )
    expect(output.kind).toBe('abstention')
    if (output.kind !== 'abstention') return
    expect(output.docsGap.logged).toBe(true)
  })
})

describe('the grounding obligation, driven through the SHIPPED model path (398-04 note 1)', () => {
  // THE CELLS ABOVE ALL DOCTOR `citeCapabilities`, WHICH IS WHY THIS BLOCK EXISTS. Measured
  // 2026-08-17: a mutation that deleted the catalog from the prompt entirely left all fourteen of
  // them green. That is precisely the gap plan 04 flagged and said nothing in `packages/agent` could
  // close — "a binding that prompts WITHOUT the rows degrades every answer to a ghost citation,
  // which abstains, so it is safe and useless" — and safe-and-useless is a state no assertion about
  // the ANSWER can see. So these cells watch what the port actually SENDS, through a mock model, and
  // they range over every row rather than sampling one.

  function recordingModel(answer: string): { readonly model: ChatLanguageModel; prompts: string[] } {
    const prompts: string[] = []
    const model = new MockLanguageModelV3({
      // The parameter type is INFERRED from the mock's own constructor rather than annotated:
      // annotating it would mean naming `LanguageModelV3CallOptions`, i.e. naming the provider
      // protocol package in a `cli` source file, which is the dependency edge the model firewall
      // exists to keep out of every package but `model` (CHAT-06).
      doGenerate: async (options) => {
        prompts.push(JSON.stringify(options.prompt))
        return {
          content: [{ type: 'text' as const, text: answer }],
          finishReason: { unified: 'stop' as const, raw: 'stop' },
          usage: {
            inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
            outputTokens: { total: 0, text: 0, reasoning: 0 },
          },
          warnings: [],
        }
      },
    })
    return { model: model as unknown as ChatLanguageModel, prompts }
  }

  it('puts EVERY loaded catalog row in the prompt — the obligation, ranged not sampled', async () => {
    const root = workspace()
    const { model, prompts } = recordingModel('{"citedRowIds": []}')
    await explain(createCliCapabilityCatalogPort({ agentQaRoot: root, model }), 'what can you do')

    expect(prompts.length, 'the shipped port never reached the model at all').toBe(1)
    const sent = prompts[0] ?? ''
    const missing = committedRows
      .map((row) => (row.kind === 'op' ? row.id : row.kind === 'alias' ? row.alias : row.name))
      .filter((key) => !sent.includes(key))
    expect(missing, 'rows the model was never shown — it cannot cite what it did not receive')
      .toEqual([])
  })

  it('never shows the model an invocation form (D-10)', async () => {
    // The other half of the same prompt, and the reason it is a separate claim: the model may only
    // answer with row ids, and every character of a command a person reads is quoted out of a row by
    // the renderer. A prompt carrying `/fn <id>` would be handing the model the exact text it must
    // never be the source of — which the inertness property would still survive, and which would
    // make the no-invention guarantee rest on the renderer alone rather than on both halves.
    const root = workspace()
    const { model, prompts } = recordingModel('{"citedRowIds": []}')
    await explain(createCliCapabilityCatalogPort({ agentQaRoot: root, model }), 'how do I start a run')
    expect(prompts[0] ?? '').not.toContain('/fn ')
  })

  it('degrades a command-carrying model answer to abstention, end to end', async () => {
    // T-398-09 at the composed level, through the REAL parse rather than a doctored closure: the
    // citation contract is `.strict()` and has no field a command fits in, so a model that answered
    // with one produces a parse failure, which is an empty citation, which is the abstention arm.
    // No retry loop, no free-form passthrough, and no command anywhere in what a person reads.
    const root = workspace()
    const { model } = recordingModel(
      '{"citedRowIds": ["op:runs.start"], "command": "agent-qa deploy --prod --force"}',
    )
    const output = await explain(
      createCliCapabilityCatalogPort({ agentQaRoot: root, model }),
      'how do I deploy',
    )
    expect(output.kind).toBe('abstention')
    expect(JSON.stringify(output)).not.toContain('deploy --prod')
  })

  it('reads a fenced JSON answer, and only that one tolerance', async () => {
    // A model that produced the right answer in the wrong envelope has answered correctly, so ONE
    // extraction step is honest. Everything past it is a parse failure — never a retry, which would
    // spend a person's money arguing with a model about syntax.
    const root = workspace()
    const { model } = recordingModel(
      `Here you go:\n\`\`\`json\n{"citedRowIds": ["${realRowId}"]}\n\`\`\``,
    )
    const output = await explain(
      createCliCapabilityCatalogPort({ agentQaRoot: root, model }),
      'start a run',
    )
    expect(output.kind).toBe('answer')
  })
})
