import type { EmbeddingProfile } from '@vostride/agent-qa-schema'

export interface BenchCandidate {
  id: string
  model_id: string
  backend: 'node' | 'static'
  artifact: string
  revision: string
  dtype: 'q8'
  dim: number
  pooling: 'mean'
  normalize: true
  query_prefix: string
  doc_prefix: string
}

export interface BenchDocument {
  id: string
  kind: 'element' | 'page'
  text: string
  apps: string[]
  sourcePaths: string[]
}

export interface BenchQuery {
  id?: string
  app: string
  query: string
  goldDocIds: string[]
}

export interface BenchCorpus {
  documents: BenchDocument[]
  recordedQueries: Array<BenchQuery & {
    id: string
    sourceCassetteId: string
    sourcePath: string
  }>
}

export interface AuthoredQueries {
  provenance: Record<string, string>
  queries: Array<BenchQuery & { category: string }>
}

export interface HitRates {
  queries: number
  hitAt1: number
  hitAt3: number
  hitAt5: number
}

export interface SliceMetrics {
  perApp: Record<string, HitRates>
  macro: HitRates
}

export interface CandidateBenchSuccess {
  candidateId: string
  status: 'ok'
  profile: EmbeddingProfile
  slices: {
    recorded: SliceMetrics
    authored: SliceMetrics
  }
  distributions: {
    recorded: { goldPairCosines: number[]; randomPairCosines: number[] }
    authored: { goldPairCosines: number[]; randomPairCosines: number[] }
  }
}

export interface CandidateBenchError {
  candidateId: string
  status: 'error'
  error: { name: string; message: string }
}

export type CandidateBenchResult = CandidateBenchSuccess | CandidateBenchError

export interface BenchRunResult {
  schemaVersion: 1
  documents: number
  queries: { recorded: number; authored: number }
  candidates: CandidateBenchResult[]
}

export interface BenchEmbedder {
  embedDocument(rendering: string): Promise<Float32Array>
  embedQuery(rendering: string): Promise<Float32Array>
}

export interface RunBenchOptions {
  candidates: readonly BenchCandidate[]
  corpus: BenchCorpus
  authored: AuthoredQueries
  createEmbedder?: (
    candidate: BenchCandidate,
    profile: EmbeddingProfile,
  ) => Promise<BenchEmbedder>
}

export async function runBench(_options: RunBenchOptions): Promise<BenchRunResult> {
  throw new Error('runBench is not implemented')
}
