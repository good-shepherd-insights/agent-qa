export {
  anchorScopeKey,
  foldFirstSeenAnchorsByScope,
  foldSupersessionLineage,
  scanCanonicalBundles,
  SCOPE_BURST_THRESHOLD,
  SCOPE_BURST_WINDOW_BUILDS,
  STABLE_WINDOW_BUILDS,
  THRASH_MAX_SUPERSESSIONS,
  THRASH_WINDOW_BUILDS,
} from '../lineage-fold.js'
export type {
  CanonicalBundleSnapshot,
  FirstSeenScopeFold,
  OrdinalWindowOptions,
  SupersessionLineageFold,
} from '../lineage-fold.js'
