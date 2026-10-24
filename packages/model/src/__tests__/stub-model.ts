import type {
  LanguageModelV3,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamResult,
} from '@ai-sdk/provider'

export type StubModelOverrides = Partial<LanguageModelV3> & {
  generate?: () => Promise<LanguageModelV3GenerateResult>
  content?: LanguageModelV3GenerateResult['content']
}

export function stubGenerateResult(
  content: LanguageModelV3GenerateResult['content'] = [],
): LanguageModelV3GenerateResult {
  return {
    content,
    finishReason: { unified: 'stop', raw: 'stop' },
    usage: {
      inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 0, text: 0, reasoning: 0 },
    },
    warnings: [],
  }
}

export function stubStreamResult(): LanguageModelV3StreamResult {
  return { stream: new ReadableStream() }
}

export function stubModel(over: StubModelOverrides = {}): LanguageModelV3 {
  const { generate, content, ...modelOverrides } = over

  return {
    specificationVersion: 'v3',
    provider: 'stub',
    modelId: 'stub',
    supportedUrls: {},
    async doGenerate() {
      if (generate) return generate()
      return stubGenerateResult(content)
    },
    async doStream() {
      return stubStreamResult()
    },
    ...modelOverrides,
  }
}
