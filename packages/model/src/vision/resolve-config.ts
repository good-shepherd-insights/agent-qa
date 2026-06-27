export interface VisionSizingConfig {
  screenshotSize?: number
  effectiveResolution?: number
}

export function resolveVisionConfig(
  servicesVision: VisionSizingConfig | undefined,
  visionOverride: VisionSizingConfig | undefined,
): VisionSizingConfig {
  return {
    screenshotSize: visionOverride?.screenshotSize ?? servicesVision?.screenshotSize,
    effectiveResolution: visionOverride?.effectiveResolution ?? servicesVision?.effectiveResolution,
  }
}
