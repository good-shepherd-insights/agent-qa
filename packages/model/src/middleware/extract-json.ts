const MAX_SCAN_LENGTH = 200_000

export function extractJsonStrategy(text: string): string {
  const bounded = text.slice(0, MAX_SCAN_LENGTH)
  const fenced = bounded.match(/```(?:json)?[^\S\r\n]*(?:\r?\n)?([\s\S]*?)```/i)
  if (fenced?.[1] !== undefined) return fenced[1].trim()

  const span = firstJsonSpan(bounded)
  if (span) return span.trim()

  return bounded.trim()
}

function firstJsonSpan(text: string): string | undefined {
  const start = firstJsonStart(text)
  if (start < 0) return undefined

  const opener = text[start]
  const closer = opener === '{' ? '}' : ']'
  let depth = 0
  let inString = false
  let escaped = false

  for (let index = start; index < text.length; index += 1) {
    const char = text[index]

    if (inString) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '"') {
        inString = false
      }
      continue
    }

    if (char === '"') {
      inString = true
    } else if (char === opener) {
      depth += 1
    } else if (char === closer) {
      depth -= 1
      if (depth === 0) return text.slice(start, index + 1)
    }
  }

  return undefined
}

function firstJsonStart(text: string): number {
  const objectStart = text.indexOf('{')
  const arrayStart = text.indexOf('[')
  if (objectStart < 0) return arrayStart
  if (arrayStart < 0) return objectStart
  return Math.min(objectStart, arrayStart)
}
