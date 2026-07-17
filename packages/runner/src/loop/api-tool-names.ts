/**
 * Conservative cross-provider function-name grammar. OpenAI-compatible transports reject
 * punctuation such as the dots in the logical Channel-2 ids (`memory.search` / `memory.read`).
 * Keep those logical ids intact in runner contracts and evidence; only the wire alias is bound
 * here. The 64-character ceiling is the common function-name limit used by those transports.
 */
export const API_TOOL_NAME_PATTERN = /^[A-Za-z0-9_-]+$/
export const API_TOOL_NAME_MAX_LENGTH = 64

export type LogicalToolKind = 'action' | 'non-action'

export interface LogicalToolNameInput<T> {
  kind: LogicalToolKind
  logicalName: string
  value: T
}

export interface ApiToolNameBinding<T> extends LogicalToolNameInput<T> {
  apiName: string
}

const FNV_OFFSET_64 = 0xcbf29ce484222325n
const FNV_PRIME_64 = 0x100000001b3n
const UINT64_MASK = 0xffffffffffffffffn
const DIGEST_WIDTH = 13

/** Portable deterministic digest: FNV-1a over both bytes of each UTF-16 code unit. */
function stableDigest(value: string): string {
  let hash = FNV_OFFSET_64
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index)
    hash ^= BigInt(codeUnit & 0xff)
    hash = (hash * FNV_PRIME_64) & UINT64_MASK
    hash ^= BigInt(codeUnit >>> 8)
    hash = (hash * FNV_PRIME_64) & UINT64_MASK
  }
  return hash.toString(36).padStart(DIGEST_WIDTH, '0')
}

function isApiSafe(name: string): boolean {
  return name.length > 0
    && name.length <= API_TOOL_NAME_MAX_LENGTH
    && API_TOOL_NAME_PATTERN.test(name)
}

function readableStem(logicalName: string): string {
  const sanitized = logicalName.replace(/[^A-Za-z0-9_-]+/g, '_')
  return sanitized.length > 0 ? sanitized : 'tool'
}

function hashedAlias(kind: LogicalToolKind, logicalName: string): string {
  const suffix = `__${stableDigest(`${kind}\u0000${logicalName}`)}`
  const stem = readableStem(logicalName).slice(
    0,
    API_TOOL_NAME_MAX_LENGTH - suffix.length,
  )
  return `${stem}${suffix}`
}

function withCollisionOrdinal(alias: string, ordinal: number): string {
  const suffix = `_${ordinal.toString(36)}`
  return `${alias.slice(0, API_TOOL_NAME_MAX_LENGTH - suffix.length)}${suffix}`
}

function bindingKey(input: LogicalToolNameInput<unknown>): string {
  return `${input.kind}\u0000${input.logicalName}`
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

/**
 * Bind logical tool identities to provider-safe wire names.
 *
 * - A unique already-safe name is byte-preserved (all current action tools stay stable).
 * - Unsafe, overlong, or duplicate names get a readable deterministic hash suffix.
 * - Action names win an exact logical-name collision; the non-action binding is aliased.
 * - The final collision ordinal is assigned in sorted logical-key order, so registration order
 *   cannot change the mapping. The returned array still preserves caller order.
 */
export function bindApiToolNames<T>(
  inputs: readonly LogicalToolNameInput<T>[],
): ApiToolNameBinding<T>[] {
  const candidates = inputs.map((input, index) => ({ input, index, apiName: '' }))
  const safeGroups = new Map<string, typeof candidates>()

  for (const candidate of candidates) {
    if (!isApiSafe(candidate.input.logicalName)) continue
    const group = safeGroups.get(candidate.input.logicalName) ?? []
    group.push(candidate)
    safeGroups.set(candidate.input.logicalName, group)
  }

  const identityWinners = new Set<number>()
  for (const group of safeGroups.values()) {
    const winner = [...group].sort((left, right) => {
      const kindOrder = Number(left.input.kind === 'non-action')
        - Number(right.input.kind === 'non-action')
      return kindOrder
        || compareCodeUnits(bindingKey(left.input), bindingKey(right.input))
        || left.index - right.index
    })[0]
    if (winner !== undefined) identityWinners.add(winner.index)
  }

  const used = new Set<string>()
  for (const candidate of candidates) {
    if (!identityWinners.has(candidate.index)) continue
    candidate.apiName = candidate.input.logicalName
    used.add(candidate.apiName)
  }

  const aliases = candidates
    .filter((candidate) => !identityWinners.has(candidate.index))
    .sort((left, right) =>
      compareCodeUnits(bindingKey(left.input), bindingKey(right.input)) || left.index - right.index,
    )

  for (const candidate of aliases) {
    const base = hashedAlias(candidate.input.kind, candidate.input.logicalName)
    let apiName = base
    let ordinal = 2
    while (used.has(apiName)) {
      apiName = withCollisionOrdinal(base, ordinal)
      ordinal += 1
    }
    candidate.apiName = apiName
    used.add(apiName)
  }

  return candidates
    .sort((left, right) => left.index - right.index)
    .map(({ input, apiName }) => ({ ...input, apiName }))
}
