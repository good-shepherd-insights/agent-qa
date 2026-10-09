/** One element identity in a refusal: the stated target, or the element its ref named (D-05). */
export interface TargetIdentity {
  role?: string
  name: string
  row?: string
}

export type TargetMismatchReason = 'role-kind' | 'name-no-shared-word' | 'name-number' | 'row'

/**
 * A stated target refused before dispatch, keyed `targetRefusal` (438 D-05). Optional-additive at
 * handoff schema version 7. Nothing was sent, so `inputSent` is always false.
 */
export interface TargetRefusalMeta {
  kind: 'target-mismatch'
  lane: 'ref' | 'fromRef' | 'toRef'
  path: 'live' | 'heal'
  stated: TargetIdentity
  observed: TargetIdentity
  reasons: TargetMismatchReason[]
  rowStated: boolean
  inputSent: false
}

export const TARGET_REFUSAL_KEYS = [
  'kind',
  'lane',
  'path',
  'stated',
  'observed',
  'reasons',
  'rowStated',
  'inputSent',
] as const satisfies readonly (keyof TargetRefusalMeta)[]

export const TARGET_IDENTITY_KEYS = ['role', 'name', 'row'] as const satisfies readonly (keyof TargetIdentity)[]

const LANES: readonly string[] = ['ref', 'fromRef', 'toRef']
const PATHS: readonly string[] = ['live', 'heal']
const REASONS: readonly string[] = ['role-kind', 'name-no-shared-word', 'name-number', 'row']

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function readIdentity(value: unknown): TargetIdentity | undefined {
  if (!isRecord(value)) return undefined
  const { role, name, row } = value
  if (typeof name !== 'string') return undefined
  if (role !== undefined && typeof role !== 'string') return undefined
  if (row !== undefined && typeof row !== 'string') return undefined
  return {
    ...(role !== undefined ? { role } : {}),
    name,
    ...(row !== undefined ? { row } : {}),
  }
}

// Narrows field by field; any malformed or hand-edited block reads as no refusal (436 D-17).
export function readTargetRefusalMeta(
  result?: { metadata?: Record<string, unknown> },
): TargetRefusalMeta | undefined {
  const raw = result?.metadata?.['targetRefusal']
  if (!isRecord(raw)) return undefined
  const { kind, lane, path, rowStated, inputSent, reasons } = raw
  if (kind !== 'target-mismatch' || inputSent !== false || typeof rowStated !== 'boolean') {
    return undefined
  }
  if (typeof lane !== 'string' || !LANES.includes(lane)) return undefined
  if (typeof path !== 'string' || !PATHS.includes(path)) return undefined
  if (!Array.isArray(reasons)) return undefined
  if (!reasons.every((reason) => typeof reason === 'string' && REASONS.includes(reason))) {
    return undefined
  }
  const stated = readIdentity(raw['stated'])
  const observed = readIdentity(raw['observed'])
  if (stated === undefined || observed === undefined) return undefined
  return {
    kind,
    lane: lane as TargetRefusalMeta['lane'],
    path: path as TargetRefusalMeta['path'],
    stated,
    observed,
    reasons: [...reasons] as TargetMismatchReason[],
    rowStated,
    inputSent,
  }
}
