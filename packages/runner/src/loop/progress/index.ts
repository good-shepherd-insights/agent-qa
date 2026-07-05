// Progress subsystem barrel (Phase 358 · CYCLE-01..03). The pure, provider/storage-neutral
// machinery the loop consumes in Plan 08:
//   - oracle:          per-verb intended-effect check with signal-presence degradation
//   - classifier:      deterministic five-class stagnation classifier
//   - stagnation-tree: identity-keyed bounded remediation counters
//   - revisitation:    W=5 combined-rule cycle detector
// Loop wiring lives in Plan 08; this barrel is the single import surface for it.

export {
  evaluateLocalEffect,
  toLocalEffectEvidence,
  type EvaluateLocalEffectInput,
  type LocalEffectResult,
  type LocalEffectOracle,
  type EffectAnchor,
} from './oracle.js'

export {
  classifyStagnation,
  OBSTRUCTION_ROLES,
  LOADING_ROLES,
  type ClassifyStagnationInput,
  type StagnationAnchor,
  type StagnationClass,
} from './classifier.js'

export {
  StagnationTree,
  buildAnchorKey,
  DEFAULT_STAGNATION_CLASS_BOUND,
  DEFAULT_STAGNATION_ANCHOR_BOUND,
  type StagnationAnchorIdentity,
  type RecordNoEffectResult,
  type StagnationSnapshotEntry,
  type StagnationTreeOptions,
} from './stagnation-tree.js'

export {
  RevisitationWindow,
  buildRevisitationKey,
  DEFAULT_REVISITATION_WINDOW,
  type RevisitationRecord,
  type RevisitationResult,
  type RevisitationWindowOptions,
} from './revisitation.js'
