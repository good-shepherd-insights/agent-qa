/**
 * 441 GAP3-D1 (WR-C02): the D-18 text of a run, a cassette or a label record, masked with the
 * declared secrets before anything is written into the git-committed eval corpus.
 *
 * The D-18 fields a case copies from a handoff are the step text, the screen state before a
 * decision and the planned action; the writer's check refuses every other string leaf still
 * holding a declared value, except the kept members. A caller masks the HANDOFF and extracts from
 * the masked copy, so every digest a committed case carries (`promptInputHash`, `screenStateHash`,
 * `receiptDigest`) is computed over the committed text and is never a guessing oracle for a raw
 * value. A served brief's two prompt tiers are masked too, with their digests and the brief digest
 * recomputed over the masked text, so the committed brief still guards.
 *
 * Closed vocabulary is kept as written, because masking it would break the cassette guard under a
 * short declared value: the screen state's platform, element refs, roles, hierarchy refs, state
 * flags, `refMap` and every metadata member but `domContext`; an action's `type`, its refs and the
 * members its wire schema (`ACTION_WIRE_SCHEMAS_BY_TYPE`) types as a closed literal or enum, chosen
 * per action type by path; an anchor's role, ordinal and ref. Every unclassified string leaf of
 * those members is masked, so the walk fails closed. `rerunOrigin` is the digest-verified record of
 * an earlier attempt that no committed file copies; it is never walked.
 */
import { computeBriefDigest, sha256hex } from '@vostride/agent-qa-schema'
import type { Action, MaskFn, ServedBrief } from '@vostride/agent-qa-schema'

type Json = unknown

// Kept string paths per action type, beside `type` itself. `[]` steps into an array element.
const KEPT_ACTION_PATHS: { readonly [T in Action['type']]: readonly string[] } = {
  navigate: ['to'],
  waitForUrl: [],
  click: ['ref', 'desiredState'],
  doubleClick: ['ref'],
  rightClick: ['ref'],
  fill: ['ref', 'clearMode'],
  select: ['ref'],
  hover: ['ref'],
  paste: ['ref'],
  copy: ['ref'],
  fileUpload: ['ref'],
  tab: ['action'],
  inspect: ['what', 'level'],
  route: [],
  unroute: [],
  networkState: ['mode'],
  storageState: ['op'],
  handleDialog: [],
  uniqueValue: [],
  focus: ['ref'],
  setCookies: ['cookies[].sameSite'],
  setLocalStorage: [],
  tap: ['ref', 'desiredState'],
  doubleTap: ['ref'],
  multiTap: ['ref', 'coordSpace'],
  tapCoordinate: ['coordSpace'],
  swipe: ['mode', 'direction', 'ref', 'coordSpace'],
  longpress: ['ref'],
  pinch: ['ref', 'coordSpace'],
  drag: ['fromRef', 'toRef'],
  nativeSelect: ['ref'],
  hideKeyboard: [],
  setOrientation: ['orientation'],
  stopApp: [],
  pressBack: [],
  pressHome: [],
  pressRecent: [],
  openNotifications: [],
  openQuickSettings: [],
  intent: ['extras[].type'],
  keyevent: [],
  pressButton: ['button'],
  pickerSelect: ['ref'],
  swipeFromEdge: ['edge'],
  openUniversalLink: [],
  assertAI: ['mode', 'effort'],
  assertValue: ['source', 'op'],
  extractAI: ['scope', 'schema[].type', 'schema[].item.type'],
  waitFor: ['on'],
  delay: [],
  scroll: ['mode', 'direction', 'ref', 'amount'],
  clearText: ['ref'],
  reportValue: [],
  openApp: [],
  executeScript: [],
  setVariable: [],
  keypress: ['mode'],
}

const TEXT_MEMBERS = new Set(['stepText', 'goldValue', 'correctedExpectation'])
const ACTION_MEMBERS = new Set(['plannedAction', 'goldAction', 'correctedAction'])

// The `everyLeaf` check's closed members of a committed cassette, label record and corpus entry:
// minted identifiers, digests and enum- or literal-typed members. Honored only for string leaves
// (or string arrays), and never inside recorded exchanges.
const CLOSED_MEMBERS = new Set([
  'schemaVersion', 'id', 'runId', 'runSlug', 'testId', 'cassetteId', 'pairedCassetteId', 'seedCassetteId',
  'sourceCassetteId', 'predecessorId', 'generationId', 'supersedes', 'markId', 'attributedObservationId',
  'unresolvedAnchorRef', 'captured_at',
  'blobs', 'missingBlobShas', 'sha', 'promptInputHash', 'screenStateHash', 'pairedScreenStateHash',
  'toolSchemaDigest', 'memoryBriefDigest', 'briefDigest', 'bodyDigest', 'receiptDigest', 'evidenceDigest',
  'originalEvidenceDigest', 'corpusDigest', 'tableHash',
  'granularity', 'status', 'kind', 'sourceChannel', 'tier', 'relation', 'quarantine', 'split',
  'heldOutVisibility', 'targetEnvironment', 'source', 'verdictSource', 'capabilityTier', 'mutator',
  'producer', 'class', 'subtype', 'op', 'outcome', 'opClass', 't', 'direction', 'detailLevel', 'truncation',
  'verdict', 'benefit',
])

// The `everyLeaf` check's kept paths inside a served brief, by type path rather than member name:
// the digest, date, enum, literal and minted-id paths of LosslessServedBriefSchema, plus channel
// 1's kind, status and tier, which their producers write from closed unions.
const SERVED_BRIEF_KEPT_PATHS: ReadonlySet<string> = new Set([
  'scope.tier', 'briefDigest',
  'channel1[].id', 'channel1[].kind', 'channel1[].status', 'channel1[].tier',
  'channel2[].id', 'channel2[].bodyDigest',
  'channel3[].id', 'channel3[].anchors[].t', 'channel3[].anchors[].platform',
  'proof.completeness', 'proof.admissionEvents[].id', 'proof.admissionEvents[].surface',
  'proof.promptTurns[].runDate', 'proof.promptTurns[].policyDigest',
  'proof.promptTurns[].contextTierDigest', 'proof.promptTurns[].volatileTierDigest',
])

const PROMPT_TIERS = [
  ['contextTier', 'contextTierDigest'],
  ['volatileTier', 'volatileTierDigest'],
] as const

export interface MaskCorpusTextOptions {
  /**
   * Also mask every other string leaf except the closed members: the committed-corpus writer's
   * check that no committed string still holds a declared value raw.
   */
  everyLeaf?: boolean
}

interface Scope {
  everyLeaf: boolean
  closedHonored: boolean
}

function isClosedLeaf(value: Json): boolean {
  return typeof value === 'string' || (Array.isArray(value) && value.every(item => typeof item === 'string'))
}

function isRecord(value: Json): value is Record<string, Json> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function mapEntries(value: Record<string, Json>, map: (key: string, item: Json) => Json): Record<string, Json> {
  // fromEntries defines own properties, so a `__proto__` key survives instead of setting the prototype.
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, map(key, item)]))
}

function maskLeaves(value: Json, mask: MaskFn): Json {
  if (typeof value === 'string') return mask(value)
  if (Array.isArray(value)) return value.map(item => maskLeaves(item, mask))
  if (isRecord(value)) return mapEntries(value, (_key, item) => maskLeaves(item, mask))
  return value
}

function maskByPath(value: Json, mask: MaskFn, path: string, kept: ReadonlySet<string>): Json {
  if (typeof value === 'string') return kept.has(path) ? value : mask(value)
  if (Array.isArray(value)) return value.map(item => maskByPath(item, mask, `${path}[]`, kept))
  if (isRecord(value)) {
    return mapEntries(value, (key, item) => maskByPath(item, mask, path === '' ? key : `${path}.${key}`, kept))
  }
  return value
}

function maskAction(value: Json, mask: MaskFn): Json {
  if (!isRecord(value)) return maskLeaves(value, mask)
  const type = value.type
  const typed = typeof type === 'string' && Object.hasOwn(KEPT_ACTION_PATHS, type)
    ? KEPT_ACTION_PATHS[type as Action['type']]
    : []
  return maskByPath(value, mask, '', new Set(['type', ...typed]))
}

function maskElement(value: Json, mask: MaskFn): Json {
  if (!isRecord(value)) return maskLeaves(value, mask)
  return mapEntries(value, (key, item) => {
    if (key === 'ref' || key === 'role' || key === 'state') return item
    if (key === 'hierarchy' && isRecord(item)) {
      return mapEntries(item, (member, ref) =>
        member === 'parentRef' || member === 'childRefs' ? ref : maskLeaves(ref, mask))
    }
    return maskLeaves(item, mask)
  })
}

function maskScreenState(value: Json, mask: MaskFn): Json {
  if (!isRecord(value)) return maskLeaves(value, mask)
  return mapEntries(value, (key, item) => {
    if (key === 'platform' || key === 'refMap') return item
    if (key === 'elements' && Array.isArray(item)) return item.map(element => maskElement(element, mask))
    if (key === 'metadata' && isRecord(item)) {
      return mapEntries(item, (member, entry) => member === 'domContext' ? maskLeaves(entry, mask) : entry)
    }
    return maskLeaves(item, mask)
  })
}

function maskAnchor(value: Json, mask: MaskFn): Json {
  if (!isRecord(value)) return maskLeaves(value, mask)
  return mapEntries(value, (key, item) =>
    key === 'role' || key === 'ordinal' || key === 'ref' ? item : maskLeaves(item, mask))
}

// A changed tier gets its digest and the brief digest recomputed; an unchanged brief keeps its bytes.
function maskPromptTiers(brief: Record<string, Json>, mask: MaskFn): Record<string, Json> {
  const proof = brief.proof
  if (!isRecord(proof) || !Array.isArray(proof.promptTurns)) return brief
  let changed = false
  const promptTurns = proof.promptTurns.map(turn => {
    if (!isRecord(turn)) return turn
    let next = turn
    for (const [tier, digest] of PROMPT_TIERS) {
      const text = next[tier]
      if (typeof text !== 'string') continue
      const masked = mask(text)
      if (masked === text) continue
      next = { ...next, [tier]: masked, [digest]: sha256hex(masked) }
      changed = true
    }
    return next
  })
  if (!changed) return brief
  const masked = { ...brief, proof: { ...proof, promptTurns } }
  return { ...masked, briefDigest: computeBriefDigest(masked as unknown as ServedBrief) }
}

function maskServedBrief(value: Json, mask: MaskFn, scope: Scope): Json {
  const brief = isRecord(value) ? maskPromptTiers(value, mask) : value
  if (!scope.everyLeaf) return brief
  return scope.closedHonored && isRecord(brief)
    ? maskByPath(brief, mask, '', SERVED_BRIEF_KEPT_PATHS)
    : maskLeaves(brief, mask)
}

function maskMember(key: string, item: Json, mask: MaskFn, scope: Scope): Json {
  if (key === 'rerunOrigin') return item
  if (key === 'servedBrief') return maskServedBrief(item, mask, scope)
  if (TEXT_MEMBERS.has(key)) return maskLeaves(item, mask)
  if (key === 'stateBefore') return maskScreenState(item, mask)
  if (ACTION_MEMBERS.has(key)) return maskAction(item, mask)
  if (key === 'goldAnchor') return maskAnchor(item, mask)
  if (key === 'equivalenceSet' && Array.isArray(item)) return item.map(anchor => maskAnchor(anchor, mask))
  if (scope.everyLeaf && scope.closedHonored && CLOSED_MEMBERS.has(key) && isClosedLeaf(item)) return item
  if (scope.everyLeaf && key === 'exchanges') return walk(item, mask, { everyLeaf: true, closedHonored: false })
  return walk(item, mask, scope)
}

function walk(value: Json, mask: MaskFn, scope: Scope): Json {
  if (typeof value === 'string') return scope.everyLeaf ? mask(value) : value
  if (Array.isArray(value)) return value.map(item => walk(item, mask, scope))
  if (isRecord(value)) return mapEntries(value, (key, item) => maskMember(key, item, mask, scope))
  return value
}

/** Mask the D-18 text of a handoff, cassette or label record; pure, and it never renames a key. */
export function maskCorpusText<T>(value: T, mask: MaskFn, options: MaskCorpusTextOptions = {}): T {
  if (typeof mask !== 'function') {
    throw new TypeError('maskCorpusText requires the declared-secret mask')
  }
  return walk(value, mask, { everyLeaf: options.everyLeaf === true, closedHonored: true }) as T
}
