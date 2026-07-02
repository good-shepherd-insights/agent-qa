import type { RiskTier } from './risk-tier'
import type { Surface } from '../action'

/**
 * Neutral, browser-safe descriptor the static risk classifier consumes.
 * Core, chat, skill, and shell actions project into this schema-owned shape.
 */
export interface RiskActionDescriptor {
  /** Action verb/id, e.g. 'web_navigate', 'git_push', or 'trigger_cloud_run'. */
  name: string
  /** True when the action is a known or registered action. */
  recognized: boolean
  /** Optional originating surface, when known. */
  surface?: Surface
  /** Advisory "has a side effect" hint, not the destructive risk tier. */
  destructive?: boolean
  /** Advisory read-only hint. */
  readOnly?: boolean
  /** Explicit static command payload for shell-style wrappers. */
  command?: string
  /** Explicit tier declaration; later classifier signals may raise this floor. */
  declaredTier?: RiskTier
}
