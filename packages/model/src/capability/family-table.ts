import type { ModelCapabilities } from '@vostride/agent-qa-schema'

export interface FamilyEntry {
  match: readonly string[]
  caps: ModelCapabilities
}

function caps(
  contextWindow: number,
  maxOutput: number,
  vision: boolean,
  visionToolMessages: boolean,
): ModelCapabilities {
  return {
    text: true,
    vision,
    visionToolMessages,
    toolCalling: true,
    structuredOutput: true,
    streaming: true,
    contextWindow,
    maxOutput,
  }
}

export const UNKNOWN_FLOOR: ModelCapabilities = caps(8192, 4096, false, false)

export const FAMILIES: readonly FamilyEntry[] = [
  { match: ['claude-3-5-haiku', 'claude-haiku'], caps: caps(200000, 8192, true, true) },
  { match: ['claude-opus', 'claude-sonnet', 'claude-'], caps: caps(200000, 32000, true, true) },
  { match: ['gpt-4o'], caps: caps(128000, 16384, true, false) },
  { match: ['gpt-4.1'], caps: caps(1047576, 32768, true, false) },
  { match: ['gpt-5'], caps: caps(400000, 128000, true, false) },
  { match: ['o1', 'o3', 'o4'], caps: caps(200000, 100000, true, false) },
  { match: ['gpt-4'], caps: caps(8192, 4096, false, false) },
  { match: ['gpt-3.5'], caps: caps(16385, 4096, false, false) },
  { match: ['gpt-'], caps: caps(128000, 16384, true, false) },
  { match: ['gemini-2.5', 'gemini-3', 'gemini-1.5', 'gemini-'], caps: caps(1048576, 65536, true, true) },
  { match: ['gemini-2.0-flash'], caps: caps(1048576, 8192, true, true) },
  { match: ['deepseek-chat', 'deepseek-r1', 'deepseek-'], caps: caps(65536, 8192, false, false) },
  { match: ['qwen2.5-vl', 'qwen-vl', 'qwen2-vl'], caps: caps(32768, 8192, true, false) },
  { match: ['qwen'], caps: caps(32768, 8192, false, false) },
  { match: ['llava'], caps: caps(8192, 4096, true, false) },
  { match: ['llama-3-vision', 'llama3.2-vision', 'vision'], caps: caps(128000, 8192, true, false) },
  { match: ['llama-3', 'llama3'], caps: caps(128000, 8192, false, false) },
  { match: ['llama'], caps: caps(8192, 4096, false, false) },
  { match: ['pixtral'], caps: caps(128000, 8192, true, false) },
  { match: ['mixtral', 'mistral'], caps: caps(32768, 8192, false, false) },
]

const BOUNDARIES = new Set(['-', '_', '.', '/', ':'])

function matchesAtBoundary(id: string, token: string): boolean {
  let from = 0
  for (;;) {
    const idx = id.indexOf(token, from)
    if (idx === -1) return false
    if (idx === 0 || BOUNDARIES.has(id[idx - 1])) return true
    from = idx + 1
  }
}

export function matchFamily(model: string): ModelCapabilities | undefined {
  const id = model.toLowerCase()
  let best: { length: number; caps: ModelCapabilities } | undefined

  for (const family of FAMILIES) {
    for (const match of family.match) {
      const normalized = match.toLowerCase()
      if (!matchesAtBoundary(id, normalized)) continue
      if (!best || normalized.length > best.length) {
        best = { length: normalized.length, caps: family.caps }
      }
    }
  }

  return best?.caps
}
