import type { GuardrailPolicy } from '@vostride/agent-qa-schema'

import type { ProviderRequestHook, ProviderRequestParams } from '../hooks/interfaces'
import type { AuditSink } from '../ports/audit-sink'
import { scan } from './scan'

type ScanString = (text: string) => string
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

export class GuardrailBlockError extends Error {
  constructor(readonly detector: string) {
    super(`Guardrail blocked outbound prompt leaf: ${detector}`)
    this.name = 'GuardrailBlockError'
  }
}

export function createGuardrailProviderRequestHook(
  policy: GuardrailPolicy,
  auditSink?: AuditSink,
  channel = 'request',
): ProviderRequestHook {
  const scanLeaf = (text: string): string => {
    const output = scan(text, policy)

    for (const fired of output.fired) {
      auditSink?.appendGuardrailAudit({
        channel,
        action: fired.action,
        detector: fired.detector,
        redactedFingerprint: fired.redactedFingerprint,
      })
    }

    if (output.result.action === 'block') {
      throw new GuardrailBlockError(output.result.detector ?? 'unknown')
    }

    if (output.result.action === 'redact') {
      return output.redactedText
    }

    return text
  }

  return (params) => scanCallOptions(params, scanLeaf)
}

function scanCallOptions(params: ProviderRequestParams, scanString: ScanString): ProviderRequestParams {
  // Only params.prompt is run content. Top-level headers carry provider auth, while stopSequences,
  // tools, responseFormat, and providerOptions are caller/transport config outside GUARD-02 scope.
  return {
    ...params,
    prompt: params.prompt.map((message) => scanMessage(message, scanString)),
  }
}

function scanMessage(message: PromptMessage, scanString: ScanString): PromptMessage {
  switch (message.role) {
    case 'system':
      return { ...message, content: scanString(message.content) }
    case 'user':
      return { ...message, content: message.content.map((part) => scanUserPart(part, scanString)) }
    case 'assistant':
      return {
        ...message,
        content: message.content.map((part) => scanAssistantPart(part, scanString)),
      }
    case 'tool':
      return { ...message, content: message.content.map((part) => scanToolPart(part, scanString)) }
  }
}

function scanUserPart(part: UserContentPart, scanString: ScanString): UserContentPart {
  if (part.type === 'text') {
    return { ...part, text: scanString(part.text) }
  }

  if (part.type === 'file') {
    return scanFilePart(part, scanString)
  }

  return part
}

function scanAssistantPart(
  part: AssistantContentPart,
  scanString: ScanString,
): AssistantContentPart {
  if (part.type === 'text' || part.type === 'reasoning') {
    return { ...part, text: scanString(part.text) }
  }

  if (part.type === 'file') {
    return scanFilePart(part, scanString)
  }

  if (part.type === 'tool-call') {
    return { ...part, input: scanJsonLike(part.input, scanString) }
  }

  if (part.type === 'tool-result') {
    return { ...part, output: scanToolResultOutput(part.output, scanString) }
  }

  return part
}

function scanToolPart(part: ToolContentPart, scanString: ScanString): ToolContentPart {
  if (part.type === 'tool-result') {
    return { ...part, output: scanToolResultOutput(part.output, scanString) }
  }

  if (part.type === 'tool-approval-response') {
    return part.reason === undefined ? part : { ...part, reason: scanString(part.reason) }
  }

  return part
}

function scanFilePart(part: FileContentPart, scanString: ScanString): FileContentPart {
  return {
    ...part,
    ...(part.filename === undefined ? {} : { filename: scanString(part.filename) }),
    data: typeof part.data === 'string' ? scanString(part.data) : part.data,
  }
}

function scanToolResultOutput(
  output: ToolResultOutput,
  scanString: ScanString,
): ToolResultOutput {
  if (output.type === 'text' || output.type === 'error-text') {
    return { ...output, value: scanString(output.value) }
  }

  if (output.type === 'execution-denied') {
    return output.reason === undefined ? output : { ...output, reason: scanString(output.reason) }
  }

  if (output.type === 'json' || output.type === 'error-json') {
    return { ...output, value: scanJsonLike(output.value, scanString) }
  }

  if (output.type === 'content') {
    return {
      ...output,
      value: output.value.map((part) => scanToolResultContentPart(part, scanString)),
    }
  }

  return output
}

function scanToolResultContentPart(
  part: ToolResultContentPart,
  scanString: ScanString,
): ToolResultContentPart {
  switch (part.type) {
    case 'text':
      return { ...part, text: scanString(part.text) }
    case 'file-data':
      return {
        ...part,
        ...(part.filename === undefined ? {} : { filename: scanString(part.filename) }),
        data: scanString(part.data),
      }
    case 'image-data':
      return { ...part, data: scanString(part.data) }
    case 'file-url':
    case 'image-url':
      return { ...part, url: scanString(part.url) }
    case 'file-id':
    case 'image-file-id':
      return typeof part.fileId === 'string' ? { ...part, fileId: scanString(part.fileId) } : part
  }

  return part
}

function scanJsonLike<T>(input: T, scanString: ScanString): T {
  let serialized: string | undefined

  try {
    serialized = JSON.stringify(input)
  } catch {
    return input
  }

  if (serialized === undefined) {
    return input
  }

  const scanned = scanString(serialized)

  try {
    return JSON.parse(scanned) as T
  } catch {
    return input
  }
}
