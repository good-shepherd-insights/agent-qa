export interface ModelCapabilities {
  /** Accepts text input. Table-stakes for every supported provider. */
  text: boolean
  /**
   * Defaults to true. When false, producers emit captureMode: 'textOnly'
   * metadata with no image dimensions.
   */
  vision: boolean
  /** Accepts image parts inside tool-result messages. */
  visionToolMessages: boolean
  /** Supports tool/function calling. */
  toolCalling: boolean
  /** Supports structured JSON/object output. */
  structuredOutput: boolean
  /** Supports streamed output. */
  streaming: boolean
  /** Max context window in tokens. */
  contextWindow: number
  /** Conservative max output tokens. */
  maxOutput: number
}
