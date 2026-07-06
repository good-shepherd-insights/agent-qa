// Platform-agnostic types for the PlatformAdapter contract.
// CRITICAL: No imports from playwright-core, webdriverio, or any platform package.

import type {
  Action as SchemaAction,
  ActionsFor as SchemaActionsFor,
  Platform,
  ScreenState,
} from '@vostride/agent-qa-schema'
import type { ConsoleLogEntry, NetworkLogEntry } from './result.js'

export interface ObserveOptions {
  extractDom?: boolean
}

// D-15 (Phase 360): the runner's action world IS the schema `ActionsFor<P>` projection. The
// legacy runner-owned action union and its folded/runtime-only verb groups plus the local shape
// declarations were demolished here — `Extract` keyed on the `type` string only, so the legacy
// member shapes silently won over the schema shapes (RESEARCH §Type-Level Flip). The
// planner-reachable surface is now the single schema truth; adapters read schema execution shapes.
//
// `RunnerRuntimeVerbs` is a documented named alias re-exporting the three author-channel verbs that
// already exist as schema members — NOT new union members. It marks the surviving runner-runtime
// surface so a future reader knows these three are runtime-owned, not planner catalog verbs:
//   - executeScript → Phase 363 author-facing variable resolution + lifecycle-hook plumbing
//   - setVariable   → Phase 363 author-facing variable resolution + lifecycle-hook plumbing
//   - stopApp       → author channel (test lifecycle app teardown)
export type RunnerRuntimeVerbs =
  | Extract<SchemaAction, { type: 'executeScript' }>
  | Extract<SchemaAction, { type: 'setVariable' }>
  | Extract<SchemaAction, { type: 'stopApp' }>

// The runner action world = the schema union (D-15). Re-exported under the runner's historical
// `Action` name so the ~40 runner-internal structural consumers keep importing from `./platform.js`.
export type Action = SchemaAction

// Platform-projected action surface = the schema projection verbatim (D-15). `desiredState` on
// click/tap is now schema-owned (Plan 03), so no runner-side intersection widening is needed.
export type ActionsFor<P extends Platform = Platform> = SchemaActionsFor<P>

export interface PlatformAdapter<P extends Platform = Platform> {
  readonly platform: P

  setup(config: PlatformConfig): Promise<void>
  cleanup(): Promise<void>
  observe(options?: ObserveOptions): Promise<ScreenState>
  execute(action: ActionsFor<P>): Promise<ActionResult>
  screenshot?(): Promise<Buffer | undefined>
  drainConsoleLogs?(level?: string): ConsoleLogEntry[]
  drainNetworkLogs?(urlPattern?: string): NetworkLogEntry[]
}

export function assertNever(value: never): never {
  const type = (value as { type?: string }).type
  throw new Error(`Unhandled action type: ${type ?? String(value)}`)
}

export interface ActionResult {
  success: boolean
  error?: string
  screenshot?: Buffer
  metadata?: Record<string, unknown>
  coordinates?: { x: number; y: number }
  boundingBox?: { x: number; y: number; width: number; height: number }
  startCoordinates?: { x: number; y: number }
  endCoordinates?: { x: number; y: number }
  data?: unknown
}

export interface RuntimeAuthStateConfig {
  version: number
  kind: 'web'
  targetName: string
  stateName: string
  capturedAt: string
  storageStatePath: string
}

export interface PlatformConfig {
  platform: 'web' | 'android' | 'ios'
  browser?: BrowserConfig
  device?: DeviceConfig
  bundleId?: string
  appPackage?: string
  appActivity?: string
  deepLinkAppId?: string
  appState?: 'preserve' | 'reset'
  appPath?: string
  browserstackApp?: string
  appiumUrl?: string
  timeouts?: TimeoutConfig
  recording?: { enabled: boolean; videoDir: string; videoSize?: { width: number; height: number } }
  verbose?: boolean
  farmSession?: { hostname: string; port: number; path: string; capabilities: Record<string, unknown> }
  logCapture?: { console?: boolean; network?: boolean }
  authState?: RuntimeAuthStateConfig
}

export interface BrowserConfig {
  name: 'chromium' | 'firefox' | 'webkit'
  headless?: boolean
  viewport?: { width: number; height: number }
}

export interface DeviceConfig {
  name: string
  platform: 'android' | 'ios'
  transport: 'local' | 'browserstack'
  match: Record<string, unknown>
}

export interface TimeoutConfig {
  step?: number
  test?: number
  navigation?: number
}
