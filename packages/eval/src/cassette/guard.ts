import {
  createVersionGuard,
  VersionGuardError,
  type MigrationRegistry,
} from '@vostride/agent-qa-schema'
import { CASSETTE_SCHEMA_VERSION, type Cassette } from './cassette'
import type { MissingCassetteEvidence } from './completeness'
import { cassetteSchema } from './schema'

/** Typed cassette-specific rejection for unsupported schema versions (D-14). */
export class CassetteVersionError extends VersionGuardError {
  constructor(found: number, supported: number) {
    super('Cassette', found, supported)
    this.name = 'CassetteVersionError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isFullCapture(input: unknown): boolean {
  if (!isRecord(input)) return false
  const stateBefore = input.stateBefore
  if (!isRecord(stateBefore)) return false
  const metadata = stateBefore.metadata
  return isRecord(metadata) && metadata.captureMode === 'full'
}

function screenshotFact(stepIndex: unknown, decisionOrdinal: unknown): MissingCassetteEvidence {
  return {
    kind: 'decision-screenshot-ref',
    stepIndex: stepIndex as number,
    decisionOrdinal: decisionOrdinal as number,
  }
}

// Anonymous v1 blobs cannot establish screenshot identity, so full-capture decisions
// migrate to coordinate-bearing evidence-incomplete facts instead of fabricated refs (T-367-23).
function withScreenshotFacts(
  document: Record<string, unknown>,
  facts: readonly MissingCassetteEvidence[],
): Record<string, unknown> {
  if (facts.length === 0) return document
  const completeness = isRecord(document.completeness) ? document.completeness : {}
  return {
    ...document,
    completeness: { ...completeness, status: 'evidence-incomplete', missingEvidence: facts },
  }
}

function migrateLeafV1(document: Record<string, unknown>): Record<string, unknown> {
  const facts = isFullCapture(document.input)
    ? [screenshotFact(document.stepIndex, document.decisionOrdinal)]
    : []
  return withScreenshotFacts(document, facts)
}

function migrateProcedureV1(document: Record<string, unknown>): Record<string, unknown> {
  const steps = Array.isArray(document.steps) ? document.steps : []
  const facts: MissingCassetteEvidence[] = []
  const seen = new Set<string>()

  for (const step of steps) {
    if (!isRecord(step) || step.kind !== 'decision') continue
    const record = step.record
    const input = isRecord(record) ? record.input : undefined
    if (!isFullCapture(input)) continue
    const key = `${String(step.stepIndex)}:${String(step.decisionOrdinal)}`
    if (seen.has(key)) continue
    seen.add(key)
    facts.push(screenshotFact(step.stepIndex, step.decisionOrdinal))
  }

  return withScreenshotFacts(document, facts)
}

function migrateCassetteV1(document: unknown): unknown {
  if (!isRecord(document)) return document
  const cloned: Record<string, unknown> = { ...document, schemaVersion: 2 }
  if (cloned.granularity === 'procedure') return migrateProcedureV1(cloned)
  if (cloned.granularity === 'leaf') return migrateLeafV1(cloned)
  return cloned
}

/** Conservative version-1 leaf/procedure migration; the final schema is the structural authority (D-14/D-15). */
export const CASSETTE_MIGRATIONS: MigrationRegistry = {
  1: migrateCassetteV1,
}

const guardCassetteVersion = createVersionGuard<Cassette>({
  name: 'Cassette',
  current: CASSETTE_SCHEMA_VERSION,
  migrations: CASSETTE_MIGRATIONS,
  error: CassetteVersionError,
})

function issuePath(path: PropertyKey[]): string {
  return path.length === 0 ? '<root>' : path.map(String).join('.')
}

/** Version-gates, migrates, then validates every v1 cassette field (D-14/D-15). */
export function guardCassette(value: unknown): Cassette {
  const versioned = guardCassetteVersion(value)
  const parsed = cassetteSchema.safeParse(versioned)

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map(issue => `${issuePath(issue.path)}: ${issue.message}`)
      .join('; ')
    throw new TypeError(`Cassette structural validation failed: ${issues}`)
  }

  return parsed.data as Cassette
}
