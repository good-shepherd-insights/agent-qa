import type { LanguageModelMiddleware } from 'ai'
import type { LanguageModelV3Message, LanguageModelV3Prompt } from '@ai-sdk/provider'

// RUNX-01 defense-in-depth (D2). Strips empty-content messages from `params.prompt` just
// before the provider wire, so an empty message (e.g. a `{ role:'system', content:'' }`
// tier a future caller reintroduces) can never reach the OpenAI Responses API — which
// rejects empty message content with HTTP 400. The primary fix filters empty tiers at
// planner assembly (runner); this is the second layer at the model egress. Pure
// transformParams: it never drops a message that carries any non-empty text or any
// non-text part (image/file/tool/reasoning), and it preserves order and every other
// param field.

// A message is "empty" when it contributes no content to the wire:
//   - system: its string content trims to empty
//   - user/assistant/tool: its content array has no part with non-empty text AND no
//     non-text part (a file/tool/reasoning part always keeps the message)
function isEmptyMessage(message: LanguageModelV3Message): boolean {
  if (message.role === 'system') {
    return typeof message.content === 'string' && message.content.trim().length === 0
  }
  const parts = message.content
  if (!Array.isArray(parts) || parts.length === 0) return true
  for (const part of parts) {
    if (part.type === 'text' || part.type === 'reasoning') {
      if (typeof part.text === 'string' && part.text.trim().length > 0) return false
    } else {
      // Any non-text part (file/tool-call/tool-result/approval) is meaningful content.
      return false
    }
  }
  return true
}

export function dropEmptyMessagesMiddleware(): LanguageModelMiddleware {
  return {
    specificationVersion: 'v3',

    transformParams: async ({ params }) => {
      const prompt = params.prompt as LanguageModelV3Prompt | undefined
      if (!prompt) return params
      const filtered = prompt.filter((message) => !isEmptyMessage(message))
      if (filtered.length === prompt.length) return params
      return { ...params, prompt: filtered }
    },
  }
}
