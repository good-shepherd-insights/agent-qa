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
  /**
   * A per-invocation DISCLOSURE for the person the confirm prompt reaches (394-08, D-03 · WTST-08).
   *
   * WHY THE DESCRIPTOR NEEDED A FIELD AT ALL. Every other member here is a static property of the
   * action CLASS, and that is exactly right for classification. WTST-08's control is not a class
   * property: it is what THIS invocation is about to cost, and a person asked to approve nine child
   * processes needs to be told nine. There was no channel for that, so a confirm could only ever
   * name the class — which is why the field exists rather than a friendlier prompt string.
   *
   * DISPLAY-ONLY, AND NEVER CLASSIFIED. `classifyRisk` reads `name`, `command`, `recognized`,
   * `readOnly` and `declaredTier`, and it must never read this. A free-text field feeding the tier
   * decision would be a channel through which whatever composed the disclosure could move an action
   * up or down the ladder. It is likewise not part of the action CLASS: a standing grant matches on
   * `name`, the audit row records `name`, and the session deny overlay keys on `name`, so two
   * invocations with different disclosures are the same class to every one of them.
   *
   * COMPOSITION-DERIVED, NEVER CALLER INPUT. What a caller may put in front of a person at the
   * moment they are deciding is a capability, not a convenience.
   */
  disclosure?: string
}
