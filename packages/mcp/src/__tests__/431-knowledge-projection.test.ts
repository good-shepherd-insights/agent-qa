// The eight 431 read tools (D-01 / D-04 / D-05 / D-07 / D-09 · PXH-AGENT-04/06/07).
//
// CANONICAL_CONTRACTS is the one table this suite restates: each new tool name, the ops it
// projects, and the exact schema objects those ops enforce with. Everything else is read off the
// registry, the mapping or a real server, so a cell here compares the table against a producer.

import { readFileSync } from 'node:fs'

import {
  createFunctionRegistry,
  invokeFunction,
  type CreateFunctionRegistryOptions,
  type FunctionDeclaration,
  type FunctionDeps,
  type FunctionRegistry,
} from '@vostride/agent-qa-agent'
import * as schema from '@vostride/agent-qa-schema'
import type { FunctionCaller, KnowledgeBundleSummary } from '@vostride/agent-qa-schema'
import { describe, expect, it } from 'vitest'

import { withoutDialect } from '../conformance-support.js'

const TARGET = { target: 'draft-2020-12' } as const

interface CanonicalContract {
  readonly ops: readonly string[]
  readonly input: unknown
  readonly output: unknown
}

const CANONICAL_CONTRACTS: Readonly<Record<string, CanonicalContract>> = {
  agent_qa_list_knowledge_bundles: {
    ops: ['knowledge.bundles.list'],
    input: schema.KnowledgeBundlesListInputSchema,
    output: schema.KnowledgeBundlesListOutputSchema,
  },
  agent_qa_inspect_knowledge_records: {
    ops: ['knowledge.records.inspect'],
    input: schema.KnowledgeRecordsInspectInputSchema,
    output: schema.KnowledgeRecordsInspectOutputSchema,
  },
  agent_qa_diff_knowledge_records: {
    ops: ['knowledge.records.diff'],
    input: schema.KnowledgeRecordsDiffInputSchema,
    output: schema.KnowledgeRecordsDiffOutputSchema,
  },
  agent_qa_show_knowledge_record: {
    ops: ['knowledge.record.show'],
    input: schema.KnowledgeRecordShowInputSchema,
    output: schema.KnowledgeRecordShowResultSchema,
  },
  agent_qa_explain_brief: {
    ops: ['knowledge.brief.why'],
    input: schema.BriefWhyInputSchema,
    output: schema.BriefWhyResultSchema,
  },
  agent_qa_get_run_knowledge: {
    ops: ['runs.knowledge'],
    input: schema.RunsKnowledgeInputSchema,
    output: schema.RunKnowledgeProjectionSchema,
  },
  agent_qa_get_run_overview: {
    ops: ['runs.overview'],
    input: schema.RunsOverviewInputSchema,
    output: schema.RunOverviewProjectionSchema,
  },
  agent_qa_get_run_evidence: {
    ops: ['runs.evidence', 'runs.artifact'],
    input: schema.RunsEvidenceFoldInputSchema,
    output: schema.RunsEvidenceFoldOutputContract,
  },
}

const auditSink = {
  appendExecutionAudit() {},
  appendGuardrailAudit() {},
} as unknown as CreateFunctionRegistryOptions['auditSink']

function registryWith(deps: Record<string, unknown> = {}): FunctionRegistry {
  return createFunctionRegistry({ deps: deps as unknown as FunctionDeps, auditSink })
}

const READ_CALLER: FunctionCaller = {
  surface: 'mcp',
  grantedScopes: ['read'],
  safeMode: false,
  origin: 'agent',
}

function declarationsById(): ReadonlyMap<string, FunctionDeclaration> {
  return new Map(registryWith().list(READ_CALLER).map((declaration) => [declaration.id, declaration]))
}

type StandardLike = {
  readonly '~standard': {
    readonly validate: (value: unknown) => unknown
    readonly jsonSchema: { readonly input: (options: typeof TARGET) => unknown }
  }
}

function inputDocument(contract: unknown): unknown {
  return withoutDialect((contract as StandardLike)['~standard'].jsonSchema.input(TARGET))
}

function bundle(bundleId: string, product = 'shop'): KnowledgeBundleSummary {
  return {
    bundleId,
    product,
    dir: `memory/${product}/${bundleId}`,
    kind: 'fact',
    subtype: 'selector',
    scope: { tier: 'product', key: product },
    status: 'active',
    trust: 0.75,
    counters: { confirmed: 2, contradicted: 0, helpful: 1, harmful: 0 },
    openedAtOrdinal: 3,
    lastConfirmedOrdinal: 5,
    summary: `summary of ${bundleId}`,
    evidenceIncomplete: false,
  }
}

const BUNDLE_OP_SOURCE = new URL(
  '../../../agent/src/functions/ops/knowledge-bundles-list.ts',
  import.meta.url,
)

describe('BUNDLES-OUTPUT-IDENTITY', () => {
  it('publishes KnowledgeBundlesListOutputSchema as an array of the bundle summary schema itself', () => {
    const named = schema.KnowledgeBundlesListOutputSchema as unknown as { element?: unknown } | undefined
    expect(named, 'KnowledgeBundlesListOutputSchema is not exported').toBeDefined()
    expect(named!.element).toBe(schema.KnowledgeBundleSummarySchema)
  })

  it('declares the bundle op output through the named schema, not an inline array', () => {
    const source = readFileSync(BUNDLE_OP_SOURCE, 'utf8')
    expect(source.match(/output: KnowledgeBundlesListOutputSchema,/g) ?? []).toHaveLength(1)
    expect(source).not.toMatch(/z\.array\(/)
    expect(source).not.toMatch(/from 'zod'/)
  })

  it('validates zero, one and many bundles through the named schema and a real invocation', async () => {
    for (const rows of [[], [bundle('b_one')], [bundle('b_two'), bundle('b_one'), bundle('b_one', 'admin')]]) {
      const parsed = schema.KnowledgeBundlesListOutputSchema.safeParse(rows)
      expect(parsed.success, `${rows.length} rows`).toBe(true)
      const registry = registryWith({ knowledge: { listBundles: () => Promise.resolve(rows) } })
      const answered = await invokeFunction(registry, 'knowledge.bundles.list', {}, READ_CALLER)
      expect(schema.KnowledgeBundlesListOutputSchema.safeParse(answered).success).toBe(true)
      expect(answered).toHaveLength(rows.length)
    }
    expect(schema.KnowledgeBundlesListOutputSchema.safeParse([{ bundleId: 'b_bad' }]).success).toBe(false)
  })

  it('matches the registry declaration of knowledge.bundles.list', () => {
    const declaration = declarationsById().get('knowledge.bundles.list')!
    expect(withoutDialect(declaration.output)).toEqual(inputDocument(schema.KnowledgeBundlesListOutputSchema))
  })
})

describe('the canonical contract table (D-04)', () => {
  it('resolves every canonical export from the built schema barrel', () => {
    for (const [tool, contract] of Object.entries(CANONICAL_CONTRACTS)) {
      expect(contract.input, `${tool} input`).toBeDefined()
      expect(contract.output, `${tool} output`).toBeDefined()
    }
    expect(schema.RunsEvidenceFoldOutputContract.runtimeSchema).toBeDefined()
    expect(schema.RunsEvidenceOutputContract.runtimeSchema).toBe(schema.RunsEvidenceResultSchema)
    expect(schema.RunsArtifactOutputContract.runtimeSchema).toBe(schema.RunsArtifactResultSchema)
  })

  it('names eight tools over nine registered read ops', () => {
    const declared = declarationsById()
    const ops = Object.values(CANONICAL_CONTRACTS).flatMap((contract) => [...contract.ops])
    expect(Object.keys(CANONICAL_CONTRACTS)).toHaveLength(8)
    expect(new Set(ops).size).toBe(9)
    for (const opId of ops) {
      const declaration = declared.get(opId)
      expect(declaration, `${opId} is not registered`).toBeDefined()
      expect(declaration!.requiredScopes, opId).toEqual(['read'])
      expect(declaration!.risk.readOnly, opId).toBe(true)
      expect(declaration!.requiresHumanOrigin, opId).not.toBe(true)
    }
  })

  it('pairs every single-op tool with the input its op declares', () => {
    const declared = declarationsById()
    for (const [tool, contract] of Object.entries(CANONICAL_CONTRACTS)) {
      if (contract.ops.length !== 1) continue
      const declaration = declared.get(contract.ops[0]!)!
      expect(inputDocument(contract.input), `${tool} input`).toEqual(withoutDialect(declaration.input))
    }
  })
})
