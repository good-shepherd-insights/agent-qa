import type { ProviderRequestParams } from '../hooks/interfaces'

type LeafFn = (text: string) => string
type PromptMessage = ProviderRequestParams['prompt'][number]
type UserMessage = Extract<PromptMessage, { role: 'user' }>
type AssistantMessage = Extract<PromptMessage, { role: 'assistant' }>
type ToolMessage = Extract<PromptMessage, { role: 'tool' }>
type UserContentPart = UserMessage['content'][number]
type AssistantContentPart = AssistantMessage['content'][number]
type ToolContentPart = ToolMessage['content'][number]
type FileContentPart = Extract<UserContentPart | AssistantContentPart, { type: 'file' }>
type ToolResultOutput = Extract<AssistantContentPart, { type: 'tool-result' }>['output']
type ToolResultContentPart = Extract<ToolResultOutput, { type: 'content' }>['value'][number]

// The single place the AI-SDK V3 prompt tree is walked. Both egress hooks (masking,
// guardrail) delegate here so a new prompt part type is handled in one place. `fn` MAY
// throw (guardrail's block closure): the walker never catches it, so a block propagates
// out through the .map() chain and halts egress.
export function mapPromptLeaves(
  params: ProviderRequestParams,
  fn: LeafFn,
): ProviderRequestParams {
  // Only params.prompt is run content. Top-level headers carry provider auth, while
  // stopSequences, tools, responseFormat, and providerOptions are caller/transport config
  // outside egress scope.
  return {
    ...params,
    prompt: params.prompt.map((message) => mapMessage(message, fn)),
  }
}

function mapMessage(message: PromptMessage, fn: LeafFn): PromptMessage {
  switch (message.role) {
    case 'system':
      return { ...message, content: fn(message.content) }
    case 'user':
      return { ...message, content: message.content.map((part) => mapUserPart(part, fn)) }
    case 'assistant':
      return { ...message, content: message.content.map((part) => mapAssistantPart(part, fn)) }
    case 'tool':
      return { ...message, content: message.content.map((part) => mapToolPart(part, fn)) }
  }
}

function mapUserPart(part: UserContentPart, fn: LeafFn): UserContentPart {
  if (part.type === 'text') {
    return { ...part, text: fn(part.text) }
  }

  if (part.type === 'file') {
    return mapFilePart(part, fn)
  }

  return part
}

function mapAssistantPart(part: AssistantContentPart, fn: LeafFn): AssistantContentPart {
  if (part.type === 'text' || part.type === 'reasoning') {
    return { ...part, text: fn(part.text) }
  }

  if (part.type === 'file') {
    return mapFilePart(part, fn)
  }

  if (part.type === 'tool-call') {
    return { ...part, input: mapJsonLike(part.input, fn) }
  }

  if (part.type === 'tool-result') {
    return { ...part, output: mapToolResultOutput(part.output, fn) }
  }

  return part
}

function mapToolPart(part: ToolContentPart, fn: LeafFn): ToolContentPart {
  if (part.type === 'tool-result') {
    return { ...part, output: mapToolResultOutput(part.output, fn) }
  }

  if (part.type === 'tool-approval-response') {
    return part.reason === undefined ? part : { ...part, reason: fn(part.reason) }
  }

  return part
}

function mapFilePart(part: FileContentPart, fn: LeafFn): FileContentPart {
  return {
    ...part,
    ...(part.filename === undefined ? {} : { filename: fn(part.filename) }),
    data: typeof part.data === 'string' ? fn(part.data) : part.data,
  }
}

function mapToolResultOutput(output: ToolResultOutput, fn: LeafFn): ToolResultOutput {
  if (output.type === 'text' || output.type === 'error-text') {
    return { ...output, value: fn(output.value) }
  }

  if (output.type === 'execution-denied') {
    return output.reason === undefined ? output : { ...output, reason: fn(output.reason) }
  }

  if (output.type === 'json' || output.type === 'error-json') {
    return { ...output, value: mapJsonLike(output.value, fn) }
  }

  if (output.type === 'content') {
    return { ...output, value: output.value.map((part) => mapToolResultContentPart(part, fn)) }
  }

  return output
}

function mapToolResultContentPart(
  part: ToolResultContentPart,
  fn: LeafFn,
): ToolResultContentPart {
  switch (part.type) {
    case 'text':
      return { ...part, text: fn(part.text) }
    case 'file-data':
      return {
        ...part,
        ...(part.filename === undefined ? {} : { filename: fn(part.filename) }),
        data: fn(part.data),
      }
    case 'image-data':
      return { ...part, data: fn(part.data) }
    case 'file-url':
    case 'image-url':
      return { ...part, url: fn(part.url) }
    case 'file-id':
    case 'image-file-id':
      return typeof part.fileId === 'string' ? { ...part, fileId: fn(part.fileId) } : part
  }

  return part
}

// The one load-bearing edge (D-03): fn is called OUTSIDE the try/catch so a thrown
// GuardrailBlockError propagates and halts egress — a block on a JSON-shaped leaf is never
// swallowed. Masking's fn never throws, so masking behavior is unchanged. Any serialize or
// parse failure returns the leaf unchanged (never throws for a non-block reason).
function mapJsonLike<T>(input: T, fn: LeafFn): T {
  let serialized: string | undefined

  try {
    serialized = JSON.stringify(input)
  } catch {
    return input
  }

  if (serialized === undefined) {
    return input
  }

  const mapped = fn(serialized)

  try {
    return JSON.parse(mapped) as T
  } catch {
    return input
  }
}
