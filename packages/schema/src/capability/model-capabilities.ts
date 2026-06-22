export interface ModelCapabilities {
  /**
   * Defaults to true. When false, producers emit captureMode: 'textOnly'
   * metadata with no image dimensions.
   */
  vision: boolean
}
