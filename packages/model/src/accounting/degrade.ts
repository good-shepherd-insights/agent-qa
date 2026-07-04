// The deterministic degrade pipeline over AI SDK `ModelMessage[]` (CTXB-05).
// Hygiene always, damage on demand (D-08): the hygiene pass runs unconditionally every call
// and is near-lossless; eviction/truncation (Task 3) run only while estimate > budget.
// Determinism is load-bearing (D-08/T-354-03): no clock, no randomness, sorted keys before
// iteration so nothing leaks nondeterminism into the downstream settle-hash signal.

import { pruneMessages, type ModelMessage, type ToolContent, type ToolResultPart } from 'ai'

import type { DegradeOptions, DegradeOutcome } from './types.js'

type ToolOutput = ToolResultPart['output']
type ToolPart = ToolContent[number]

const SCREENSHOT_OMITTED = '…[historical screenshot omitted]'
const DUPLICATE_ELIDED = '…[duplicate tool result elided]'

/**
 * Run the always-on hygiene pass over `messages`, then (Task 3) the damage loop while the
 * prompt exceeds `options.budget`. Task 2 ships hygiene only and always returns `ok:true`.
 */
export function degrade(messages: ModelMessage[], _options: DegradeOptions): DegradeOutcome {
  const hygienic = runHygiene(messages)
  return { ok: true, messages: hygienic }
}

/**
 * Near-lossless hygiene: the SDK `pruneMessages` leg (reasoning strip keeping the last
 * message's reasoning + empty-message removal) followed by the custom tool-result clearing
 * lane. `pruneMessages` only removes parts; the clearing lane does the rewriting.
 */
export function runHygiene(messages: ModelMessage[]): ModelMessage[] {
  const pruned = pruneMessages({
    messages,
    reasoning: 'before-last-message',
    emptyMessages: 'remove',
  })
  return clearHistoricalToolResults(pruned)
}

/**
 * The clearing lane. The most recent tool message is preserved verbatim; every earlier
 * (historical) tool result has its screenshot base64 stripped and content-identical results
 * hash-deduped down to a one-liner. Rewrites parts, never removes them.
 */
function clearHistoricalToolResults(messages: ModelMessage[]): ModelMessage[] {
  let lastToolIndex = -1
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'tool') {
      lastToolIndex = i
      break
    }
  }

  const seenHashes = new Set<string>()
  return messages.map((message, index) => {
    if (message.role !== 'tool' || index === lastToolIndex) return message
    const rewritten = message.content.map(part => rewriteHistoricalPart(part, seenHashes))
    return { ...message, content: rewritten }
  })
}

function rewriteHistoricalPart(part: ToolPart, seenHashes: Set<string>): ToolPart {
  if (part.type !== 'tool-result') return part

  const hash = contentHash(part.output)
  if (seenHashes.has(hash)) {
    return { ...part, output: { type: 'text', value: DUPLICATE_ELIDED } }
  }
  seenHashes.add(hash)

  const stripped = stripScreenshots(part.output)
  return stripped === part.output ? part : { ...part, output: stripped }
}

/** Replace historical `image-data`/`media` content parts with a text marker (drop the base64). */
function stripScreenshots(output: ToolOutput): ToolOutput {
  if (output.type !== 'content') return output
  let changed = false
  const value = output.value.map(item => {
    if (item.type === 'image-data' || item.type === 'media') {
      changed = true
      return { type: 'text' as const, text: SCREENSHOT_OMITTED }
    }
    return item
  })
  return changed ? { type: 'content', value } : output
}

/**
 * Non-security content-identity hash (FNV-1a over a safe stringify). Identity only — NOT a
 * security control. Used solely to collapse content-identical historical tool results.
 */
function contentHash(value: unknown): string {
  const str = safeStringify(value)
  let hash = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16)
}

/**
 * Cycle-safe, key-sorted stringify (V5): never throws on cyclic tool-result values, and
 * sorts object keys so identical content hashes identically regardless of key order.
 */
function safeStringify(value: unknown): string {
  const ancestors: object[] = []
  const walk = (node: unknown): unknown => {
    if (node === null || typeof node !== 'object') return node
    if (ancestors.includes(node as object)) return '[Circular]'
    ancestors.push(node as object)
    let result: unknown
    if (Array.isArray(node)) {
      result = node.map(walk)
    } else {
      const sortedKeys = Object.keys(node as Record<string, unknown>).sort()
      const obj: Record<string, unknown> = {}
      for (const key of sortedKeys) obj[key] = walk((node as Record<string, unknown>)[key])
      result = obj
    }
    ancestors.pop()
    return result
  }
  try {
    return JSON.stringify(walk(value)) ?? 'undefined'
  } catch {
    return '[unserializable]'
  }
}
