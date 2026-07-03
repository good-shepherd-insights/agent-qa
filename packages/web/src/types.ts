import type { PlatformConfig } from '@vostride/agent-qa-runner'
import type { LaunchOptions, BrowserContextOptions } from 'playwright-core'

// Adapter-private execute-time resolution record, re-fed from the buildScreenState
// binding after each observe: role/name/nth reconstruct the live getByRole/nth locator
// against the current DOM (robust across the observe -> decide -> execute gap).
export type RefMap = Record<string, { role: string; name?: string; nth?: number; bounds?: { x: number; y: number; width: number; height: number } }>

export interface WebAdapterConfig extends PlatformConfig {
  launchOptions?: LaunchOptions
  contextOptions?: BrowserContextOptions
  filterSelector?: string
}

export interface SnapshotResult {
  tree: string
  refs: RefMap
  elementCount: number
}
