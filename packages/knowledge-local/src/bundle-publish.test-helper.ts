// Test fixtures sometimes need to seed a canonical bundle without composing a writer lease.
// Production code must never import this module; commit paths stage through bundle-publish.ts
// and finalize only inside withCurrentWriterAuthority.

import {
  discardStagedBundle,
  finalizeStagedBundle,
  stageBundle,
} from './bundle-publish.js'
import type {
  BundleStoreConfig,
  PublishBundleInput,
  PublishBundleOutcome,
} from './bundle-publish.js'

export * from './bundle-publish.js'

/** Unfenced compatibility composition for test data setup only. */
export function publishBundle(
  config: BundleStoreConfig,
  input: PublishBundleInput,
): PublishBundleOutcome {
  const staged = stageBundle(config, input)
  if (staged.kind !== 'staged') return staged
  try {
    return finalizeStagedBundle(staged)
  } catch (error) {
    discardStagedBundle(staged)
    throw error
  }
}
