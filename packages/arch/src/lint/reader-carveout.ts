import type { OwnershipContract } from '../contract-types.js'
import type { SpecifierHit } from './extract-specifiers.js'

const KNOWLEDGE_LOCAL_MAIN_ENTRY = '@vostride/agent-qa-knowledge-local'
const KNOWLEDGE_LOCAL_READER_ENTRY = `${KNOWLEDGE_LOCAL_MAIN_ENTRY}/reader`

export const KNOWLEDGE_WRITER_ALLOWLIST = [
  'packages/cli/src/curation/',
  'packages/cli/src/commands/knowledge-maintain.ts',
] as const

const KNOWLEDGE_READER_FILES = [
  'packages/cli/src/composition/knowledge-reader.ts',
  'packages/cli/src/commands/knowledge-read.ts',
] as const

const KNOWLEDGE_LOCAL_WALL_RATIONALES = {
  'packages/eval': 'replay-hermeticity',
  'packages/eval-local': 'replay-hermeticity',
  'packages/dashboard-server': 'spawn-until-M5',
  'packages/runner': 'port-type-only',
} as const

function normalizeRepoPath(file: string): string {
  return file.replaceAll('\\', '/')
}

function isKnowledgeLocalSpecifier(specifier: string): boolean {
  return specifier === KNOWLEDGE_LOCAL_MAIN_ENTRY
    || specifier.startsWith(`${KNOWLEDGE_LOCAL_MAIN_ENTRY}/`)
}

function isWriterFile(file: string): boolean {
  return KNOWLEDGE_WRITER_ALLOWLIST.some((entry) => (
    entry.endsWith('/') ? file.startsWith(entry) : file === entry
  ))
}

function isReaderFile(file: string): boolean {
  return KNOWLEDGE_READER_FILES.includes(file as (typeof KNOWLEDGE_READER_FILES)[number])
}

export function findReaderCarveoutOffenders(hits: readonly SpecifierHit[]): string[] {
  const offenders: string[] = []

  for (const hit of hits) {
    const file = normalizeRepoPath(hit.file)

    if (
      isReaderFile(file)
      && isKnowledgeLocalSpecifier(hit.specifier)
      && hit.specifier !== KNOWLEDGE_LOCAL_READER_ENTRY
    ) {
      offenders.push(
        `reader-carveout: ${file}:${hit.line} ⇏ ${hit.specifier} (reader file requires /reader)`,
      )
      continue
    }

    if (hit.specifier === KNOWLEDGE_LOCAL_MAIN_ENTRY && !isWriterFile(file)) {
      offenders.push(
        `reader-carveout: ${file}:${hit.line} ⇏ ${hit.specifier} (main entry requires writer allowlist)`,
      )
    }
  }

  return offenders
}

export function findKnowledgeLocalWallOffenders(
  contract: OwnershipContract,
  hits: readonly SpecifierHit[],
): string[] {
  const rationale = KNOWLEDGE_LOCAL_WALL_RATIONALES[
    contract.packageDir as keyof typeof KNOWLEDGE_LOCAL_WALL_RATIONALES
  ]
  if (rationale === undefined) return []

  return hits
    .filter(hit => isKnowledgeLocalSpecifier(hit.specifier))
    .map((hit) => {
      const file = normalizeRepoPath(hit.file)
      return `knowledge-local-wall: ${contract.packageDir} (${rationale}) ⇏ ${hit.specifier} at ${file}:${hit.line}`
    })
}
