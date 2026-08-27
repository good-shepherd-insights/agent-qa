import type { MaskingContext } from '@vostride/agent-qa-schema'

import { type MaskCategory, formatPlaceholder } from './categories'
import { detectEmails } from './detectors'

/**
 * One registered masking entry, as `snapshotRegistered()` reports it.
 *
 * The `value` is the CLEAR registered value. It never leaves the process in clear: the ONE
 * consumer is the run-scoped digest sidecar writer (405-02, D-08), which turns each value into an
 * HMAC-SHA256 keyed by a host-local key and writes only the digest. Nothing here is serialized,
 * logged, or handed across a wire.
 */
export interface RegisteredMaskingEntry {
  placeholder: string
  category: MaskCategory
  value: string
}

/**
 * The placeholder prefix for a category, derived from the ONE placeholder spelling.
 *
 * `formatPlaceholder(category, 0)` is `<SECRET_0>`; dropping its final `0>` leaves `<SECRET_`.
 * Deriving it keeps a single source of truth for the format — a hand-typed prefix would silently
 * stop matching the day `formatPlaceholder` changed.
 */
function placeholderPrefix(category: MaskCategory): string {
  return formatPlaceholder(category, 0).slice(0, -2)
}

export function createMaskingContext(options: { minRegisteredLength?: number } = {}): MaskingContext & {
  register(value: string, category?: MaskCategory): void
  snapshotRegistered(): ReadonlyArray<RegisteredMaskingEntry>
  dispose(): void
  clear(): void
} {
  const minRegisteredLength = options.minRegisteredLength ?? 4
  const valueToPlaceholder = new Map<string, string>()
  const placeholderToValue = new Map<string, string>()
  const counters: Record<MaskCategory, number> = {
    SECRET: 0,
    EMAIL: 0,
  }

  function mint(value: string, category: MaskCategory): string {
    const existing = valueToPlaceholder.get(value)
    if (existing !== undefined) return existing

    const placeholder = formatPlaceholder(category, counters[category]++)
    valueToPlaceholder.set(value, placeholder)
    placeholderToValue.set(placeholder, value)
    return placeholder
  }

  function register(value: string, category: MaskCategory = 'SECRET'): void {
    if (value.length < minRegisteredLength) return
    mint(value, category)
  }

  function mask(text: string): string {
    let out = text
    const registeredValues = [...valueToPlaceholder.keys()].sort(
      (left, right) => right.length - left.length,
    )

    for (const value of registeredValues) {
      const placeholder = valueToPlaceholder.get(value)
      if (placeholder === undefined) continue
      out = out.split(value).join(placeholder)
    }

    for (const email of detectEmails(out)) {
      out = out.split(email).join(mint(email, 'EMAIL'))
    }

    return out
  }

  function unmask(text: string): string {
    let out = text

    for (const [placeholder, value] of placeholderToValue) {
      out = out.split(placeholder).join(value)
    }

    return out
  }

  /**
   * Enumerate this context's SECRET registrations, in registration order (405-02, D-08).
   *
   * ONLY SECRET, BY DESIGN. `<EMAIL_n>` placeholders are minted lazily inside `mask()` by
   * `detectEmails` from text the host never declared, so no host secret source can re-derive them
   * later; a digest of one would be an entry nothing could ever match, and D-10 says such a
   * placeholder renders as a typed masked chip instead. Excluding them here is that decision.
   *
   * ORDER IS THE PLACEHOLDER ORDER because the index in `<SECRET_n>` IS the registration index —
   * `placeholderToValue` is insertion-ordered and `mint` inserts at the moment it allocates the
   * index, so the two can never disagree.
   *
   * The returned rows are a fresh array each call; the private maps are never handed out.
   */
  function snapshotRegistered(): ReadonlyArray<RegisteredMaskingEntry> {
    const prefix = placeholderPrefix('SECRET')
    const entries: RegisteredMaskingEntry[] = []

    for (const [placeholder, value] of placeholderToValue) {
      if (!placeholder.startsWith(prefix)) continue
      entries.push({ placeholder, category: 'SECRET', value })
    }

    return entries
  }

  function dispose(): void {
    valueToPlaceholder.clear()
    placeholderToValue.clear()
    counters.SECRET = 0
    counters.EMAIL = 0
  }

  return {
    mask,
    unmask,
    register,
    snapshotRegistered,
    dispose,
    clear: dispose,
  }
}
