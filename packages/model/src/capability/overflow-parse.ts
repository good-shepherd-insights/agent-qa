import { APICallError } from '@ai-sdk/provider'

const PATTERNS = [
  /maximum context length is (\d+) tokens/i,
  />\s*(\d+)\s*maximum/i,
  /maximum number of tokens allowed \((\d+)\)/i,
] as const

const MIN_WINDOW = 512
const MAX_WINDOW = 10_000_000

export function parseRealWindow(error: unknown): number | undefined {
  if (!APICallError.isInstance(error) || error.statusCode !== 400) return undefined

  const text = `${error.message ?? ''}\n${error.responseBody ?? ''}`
  for (const pattern of PATTERNS) {
    const match = pattern.exec(text)
    if (!match) continue

    const parsed = Number.parseInt(match[1], 10)
    if (Number.isFinite(parsed) && parsed >= MIN_WINDOW && parsed <= MAX_WINDOW) {
      return parsed
    }
  }

  return undefined
}

export function isContextOverflow(error: unknown): boolean {
  return parseRealWindow(error) !== undefined
}
