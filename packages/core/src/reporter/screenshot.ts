import type { PlatformAdapter } from '@vostride/agent-qa-runner'

export async function captureFailureScreenshot(
  adapter: PlatformAdapter,
): Promise<Buffer | undefined> {
  try {
    if (!('screenshot' in adapter) || typeof (adapter as { screenshot?: () => Promise<Buffer> }).screenshot !== 'function') {
      return undefined
    }
    return await (adapter as { screenshot: () => Promise<Buffer> }).screenshot()
  } catch {
    return undefined
  }
}
