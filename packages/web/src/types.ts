import type { PlatformConfig } from '@vostride/agent-qa-runner'
import type { LaunchOptions, BrowserContextOptions } from 'playwright-core'

// Adapter-private native binding per observed ref (438 D-06): Playwright's aria-ref handle the
// dispatch acts through, and the observed role, exact name and row text the pre-dispatch check
// compares against the current page. No position is kept.
export type RefMap = Record<string, {
  nativeRef: string
  role: string
  name: string
  rowText?: string
  bounds?: { x: number; y: number; width: number; height: number }
}>

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
