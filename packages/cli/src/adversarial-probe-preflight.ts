import {
  assessPanelEligibility, resolveJudgeFamilies,
  resolveReplayProfileDeclaration, selectedEvalJudgeNames,
  type AuthoringModel, type EvalSession,
  type JudgeCalibrationEntryDiagnostic, type JudgeCalibrationGapReason,
  type ModelProfile, type ResolvedModelAuth,
} from './eval-session-composition.js'
import {
  resolveNamedConfig, resolveModelAuth, toModelProfileAndAuth,
  type NamedLLMConfigLike, type ResolvedLLMAuth,
} from './llm-utils.js'

export interface AdversarialProbePreflightDeps {
  resolveNamedConfig?: typeof resolveNamedConfig
  resolveModelAuth?: typeof resolveModelAuth
}

/**
 * The selected author, ready to bind.
 *
 * Ephemeral binding DATA contains credentials: never serialize this arm wholesale. `entries`
 * beside it is the disclosure surface, and it is masked.
 */
export interface AdversarialProbeAuthorSelection {
  /** Declaration index of the winning entry, so a report can say WHICH entry was chosen. */
  index: number
  /** Raw registry name — binding data, never disclosure. */
  name: string
  /** What D-11 persists on every entry this author writes. */
  authoringModel: AuthoringModel
  profile: ModelProfile
  auth: ResolvedModelAuth
}

interface ProbePreflightCommon {
  entries: readonly JudgeCalibrationEntryDiagnostic[]
}

export type AdversarialProbeCapability =
  | (ProbePreflightCommon & { kind: 'no-probe-model'; reason: JudgeCalibrationGapReason })
  | (ProbePreflightCommon & { kind: 'probe-author'; author: AdversarialProbeAuthorSelection })

export async function resolveAdversarialProbeCapability(
  _session: EvalSession,
  _deps: AdversarialProbePreflightDeps = {},
): Promise<AdversarialProbeCapability> {
  return { kind: 'no-probe-model', reason: 'panel-not-configured', entries: [] }
}

// The skeleton keeps the real collaborators referenced so the RED run fails on the named
// behaviour rather than on an unused-import type error.
export const PROBE_PREFLIGHT_COLLABORATORS = {
  assessPanelEligibility, resolveJudgeFamilies, resolveReplayProfileDeclaration,
  selectedEvalJudgeNames, resolveNamedConfig, resolveModelAuth, toModelProfileAndAuth,
} as const
export type ProbePreflightRow = { config?: NamedLLMConfigLike; auth?: ResolvedLLMAuth }
