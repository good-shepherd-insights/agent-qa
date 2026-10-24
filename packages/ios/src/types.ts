import type { PlatformConfig } from '@vostride/agent-qa-runner'

export interface IOSAdapterConfig extends PlatformConfig {
  appiumUrl?: string
  bundleId?: string
  udid?: string
}
