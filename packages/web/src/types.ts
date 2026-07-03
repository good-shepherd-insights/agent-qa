import type { PlatformConfig } from '@vostride/agent-qa-runner'
import type { LaunchOptions, BrowserContextOptions } from 'playwright-core'

// Adapter-private execute-time resolution record, re-fed from the buildScreenState
// binding after each observe: role/name/nth reconstruct the getByRole locator, and
// `ariaRef` (the ai-mode native handle) lets the resolver prefer Playwright's own
// aria-ref locator when it is available.
export type RefMap = Record<string, { role: string; name?: string; nth?: number; ariaRef?: string; bounds?: { x: number; y: number; width: number; height: number } }>

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
