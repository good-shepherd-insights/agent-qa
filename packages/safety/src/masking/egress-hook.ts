import type { ProviderRequestHook, ProviderRequestParams } from '../hooks/interfaces'
import type { MaskingContextResolver } from './resolver'

type MaskString = (text: string) => string
type PromptMessage = ProviderRequestParams['prompt'][number]
type UserMessage = Extract<PromptMessage, { role: 'user' }>
type AssistantMessage = Extract<PromptMessage, { role: 'assistant' }>
type ToolMessage = Extract<PromptMessage, { role: 'tool' }>
type UserContentPart = UserMessage['content'][number]
type AssistantContentPart = AssistantMessage['content'][number]
type ToolContentPart = ToolMessage['content'][number]
type ToolResultOutput = Extract<AssistantContentPart, { type: 'tool-result' }>['output']

export function createMaskingProviderRequestHook(
  resolve: MaskingContextResolver,
): ProviderRequestHook {
  return (params) => {
    const ctx = resolve()
    if (!ctx) return params

    return maskCallOptions(params, ctx.mask)
  }
}

function maskCallOptions(params: ProviderRequestParams, mask: MaskString): ProviderRequestParams {
  return {
    ...params,
    prompt: params.prompt.map((message) => maskMessage(message, mask)),
  }
}

function maskMessage(message: PromptMessage, mask: MaskString): PromptMessage {
  switch (message.role) {
    case 'system':
      return { ...message, content: mask(message.content) }
    case 'user':
      return { ...message, content: message.content.map((part) => maskUserPart(part, mask)) }
    case 'assistant':
      return { ...message, content: message.content.map((part) => maskAssistantPart(part, mask)) }
    case 'tool':
      return { ...message, content: message.content.map((part) => maskToolPart(part, mask)) }
  }
}

function maskUserPart(part: UserContentPart, mask: MaskString): UserContentPart {
  if (part.type === 'text') {
    return { ...part, text: mask(part.text) }
  }

  return part
}

function maskAssistantPart(part: AssistantContentPart, mask: MaskString): AssistantContentPart {
  if (part.type === 'text' || part.type === 'reasoning') {
    return { ...part, text: mask(part.text) }
  }

  if (part.type === 'tool-call') {
    return { ...part, input: maskJsonLike(part.input, mask) }
  }

  if (part.type === 'tool-result') {
    return { ...part, output: maskToolResultOutput(part.output, mask) }
  }

  return part
}

function maskToolPart(part: ToolContentPart, mask: MaskString): ToolContentPart {
  if (part.type === 'tool-result') {
    return { ...part, output: maskToolResultOutput(part.output, mask) }
  }

  return part
}

function maskToolResultOutput(output: ToolResultOutput, mask: MaskString): ToolResultOutput {
  if (output.type === 'text' || output.type === 'error-text') {
    return { ...output, value: mask(output.value) }
  }

  if (output.type === 'execution-denied') {
    return output.reason === undefined ? output : { ...output, reason: mask(output.reason) }
  }

  if (output.type === 'json' || output.type === 'error-json') {
    return { ...output, value: maskJsonLike(output.value, mask) }
  }

  return output
}

function maskJsonLike<T>(input: T, mask: MaskString): T {
  try {
    const serialized = JSON.stringify(input)
    if (serialized === undefined) return input
    return JSON.parse(mask(serialized)) as T
  } catch {
    return input
  }
}
