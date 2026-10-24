import type { ReplayEscalationPredicate } from '../replay/ports'
import { scoreReplaySample } from './score'

/**
 * D-10 tiers-settle binding for the evolved replay seam. A settled first sample ends after the
 * engine's mandatory sample; only a D-09 unresolved tie spends the configured k=3 budget. The
 * downstream modal score remains a typed unresolved tie when deterministic tiers still cannot
 * settle it, which is Phase 370's judge input.
 */
export const tiersSettlePredicate: ReplayEscalationPredicate = (firstSample, context) =>
  scoreReplaySample(context.sidecar, firstSample).kind === 'unresolved-tie'
