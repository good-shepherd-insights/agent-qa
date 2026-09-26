import type { ConfigChange } from '@vostride/agent-qa-schema'

export const REQUIRED_SIBLING_BLOCKS: Readonly<Record<string, Readonly<Record<string, string | number | boolean>>>> = {}

export function completeRequiredSiblings(changes: readonly ConfigChange[], _config: unknown): ConfigChange[] {
  return [...changes]
}

export type DurationInputParse = { valid: true; value: string } | { valid: false; error: string }

export function parseDurationInput(raw: string): DurationInputParse {
  return { valid: true, value: raw }
}

export function listToText(_value: unknown): string {
  return ''
}

export function textToList(_text: string): string[] {
  return []
}
