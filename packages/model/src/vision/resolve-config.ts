export interface VisionSizingConfig {
  screenshotSize?: number
  effectiveResolution?: number
}

export function resolveVisionConfig(
  servicesVision: VisionSizingConfig | undefined,
): VisionSizingConfig {
  return {
    screenshotSize: servicesVision?.screenshotSize,
    effectiveResolution: servicesVision?.effectiveResolution,
  }
}
