import type { MaskingContext } from '@vostride/agent-qa-schema'

import { type MaskCategory, formatPlaceholder } from './categories'
import { detectEmails } from './detectors'

export function createMaskingContext(options: { minRegisteredLength?: number } = {}): MaskingContext & {
  register(value: string, category?: MaskCategory): void
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
    dispose,
    clear: dispose,
  }
}
