// Transitional core-side screenshot compressor — Phase 356 owns the redesign.
// Owns `sharp` (storageNeutral forbids it in runner, Pitfall 9): `compress` wraps the
// v1 compressScreenshot; `dimensions` absorbs the v1 inline sharp-metadata
// action-space-width fallback (loop.ts:199-201). The runner loop applies
// `stampCaptureMode` itself (runner-owned since 352), so this port stays purely
// pixel-level and returns v1's CompressResult shape.
import sharp from 'sharp'
import type { CompressedScreenshot, ScreenshotCompressor } from '@vostride/agent-qa-runner'
import type { ScopedLogger } from '../logging/types.js'
import { compressScreenshot } from './compress.js'

export class CoreScreenshotCompressor implements ScreenshotCompressor {
  constructor(private readonly logger?: ScopedLogger) {}

  async compress(
    screenshot: Buffer,
    options: { effectiveResolution: number; maxBytes?: number; actionSpaceWidth: number },
  ): Promise<CompressedScreenshot> {
    return compressScreenshot(screenshot, options, this.logger)
  }

  async dimensions(screenshot: Buffer): Promise<{ width: number; height: number }> {
    const meta = await sharp(screenshot).metadata()
    return { width: meta.width ?? 0, height: meta.height ?? 0 }
  }
}
