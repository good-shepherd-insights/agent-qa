import type { ModelCapabilities, ModelProfile } from '@vostride/agent-qa-schema'

import { matchFamily, UNKNOWN_FLOOR } from './family-table.js'
import { capabilityKey, getObservedWindow } from './override-store.js'

export function resolveCapabilities(profile: ModelProfile): ModelCapabilities {
  const base = matchFamily(profile.model) ?? UNKNOWN_FLOOR
  const declared = { ...base, ...(profile.capabilities ?? {}) }
  const observed = getObservedWindow(capabilityKey(profile.provider, profile.model))

  if (observed !== undefined) {
    return { ...declared, contextWindow: observed }
  }

  return declared
}
