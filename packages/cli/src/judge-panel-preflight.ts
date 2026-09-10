import {
  assessPanelEligibility, createPanelIdentity, judgeFamiliesIntersect, resolveJudgeFamilies,
  resolveJudgeCalibrationMinimum,
  type JudgeCalibrationEntryDiagnostic, type JudgeCalibrationGapReason,
  type JudgeCalibrationMinimum, type JudgeIdentityBlock,
} from '@vostride/agent-qa-eval'
import type { ModelProfile, ResolvedModelAuth } from '@vostride/agent-qa-model'
import {
  resolveReplayProfileDeclaration, selectedEvalJudgeNames, type EvalSession,
} from './eval-session-composition.js'
import {
  resolveNamedConfig, resolveModelAuth, toModelProfileAndAuth,
  type NamedLLMConfigLike, type ResolvedLLMAuth,
} from './llm-utils.js'

export interface JudgePanelPreflightDeps {
  resolveNamedConfig?: typeof resolveNamedConfig
  resolveModelAuth?: typeof resolveModelAuth
}
interface PreflightCommon {
  minN: JudgeCalibrationMinimum
  entries: readonly JudgeCalibrationEntryDiagnostic[]
}
export type JudgePanelPreflightResult =
  | (PreflightCommon & { kind: 'capability-gap'; status: 'capability-gap';
      reason: JudgeCalibrationGapReason; identity?: JudgeIdentityBlock })
  | (PreflightCommon & { kind: 'eligible'; status: 'uncalibrated'; n: 0;
      identity: JudgeIdentityBlock; replayProfile: ModelProfile;
      /** Ephemeral binding DATA contains credentials: never serialize this arm wholesale. */
      members: readonly { profile: ModelProfile; auth: ResolvedModelAuth }[] })

/** Local presence only, never a remote authentication test. Every observation must still
 * reassess the complete declaration with its actual recordedModelId before binding. */
export async function preflightJudgePanel(
  session: EvalSession,
  options: { minN?: number } = {},
  deps: JudgePanelPreflightDeps = {},
): Promise<JudgePanelPreflightResult> {
  const minN = resolveJudgeCalibrationMinimum(options.minN)
  const names = selectedEvalJudgeNames(session.evalConfig)
  if (names.length < 2) return { kind: 'capability-gap', status: 'capability-gap',
    reason: 'panel-not-configured', minN, entries: [] }

  const named = deps.resolveNamedConfig ?? resolveNamedConfig
  const resolveAuth = deps.resolveModelAuth ?? resolveModelAuth
  const masker = session.maskingContextFactory()
  try {
    const rows: { config?: NamedLLMConfigLike; auth?: ResolvedLLMAuth;
      diagnostic: JudgeCalibrationEntryDiagnostic }[] = []
    // Preserve declaration order and aliases. A failing entry never short-circuits its siblings.
    for (const [index, name] of names.entries()) {
      const diagnostic: JudgeCalibrationEntryDiagnostic = {
        index, name, families: [], credential: 'resolution-failed', failures: [],
      }
      const row: (typeof rows)[number] = { diagnostic }
      try {
        const { config } = await named(name, session.configPath, { keyOnly: true })
        row.config = config
        diagnostic.modelId = config.model
        diagnostic.families = [...resolveJudgeFamilies(config.model)].sort()
      } catch {
        diagnostic.failures = ['config-unresolved']
      }
      if (row.config) {
        try {
          const auth = await resolveAuth(row.config.name, row.config)
          row.auth = auth
          diagnostic.credential = auth.kind === 'missing' || auth.kind === 'unauthenticated'
            ? auth.kind : 'present'
          if (auth.kind === 'api-key') masker.register(auth.apiKey)
          if (auth.kind === 'bearer-token') masker.register(auth.token)
        } catch { /* Exception text is never disclosure. */ }
      }
      if (diagnostic.credential !== 'present') diagnostic.failures = [...diagnostic.failures, 'no-credential']
      rows.push(row)
    }

    // Shared replay declaration, key-only: do not ask for planner credentials.
    let replayProfile: ModelProfile
    try {
      replayProfile = await resolveReplayProfileDeclaration(session, named)
    } catch {
      // Resolver messages can contain registry names or provider details. Keep the refusal
      // actionable without forwarding untrusted text, even when credential resolution failed.
      throw new Error('Cannot resolve the replay profile for judge panel preflight. Check use.llm and its registry.llms entry.')
    }
    const replayFamilies = resolveJudgeFamilies(replayProfile.model)
    const sets = rows.map(row => resolveJudgeFamilies(row.config?.model ?? ''))
    for (const [index, row] of rows.entries()) {
      const failures = [...row.diagnostic.failures]
      if (row.config && (sets[index]!.size === 0 || replayFamilies.size === 0)) failures.push('unknown-family')
      if (judgeFamiliesIntersect(sets[index]!, replayFamilies)) failures.push('replay-family-collision')
      if (sets.some((set, other) => other !== index && judgeFamiliesIntersect(sets[index]!, set))) failures.push('member-family-collision')
      row.diagnostic.failures = failures
    }
    // Mask only disclosure, after all credentials are registered (a later entry can mask an
    // earlier name). Family assessment and canonical identity always use the raw model ids.
    const entries = rows.map(({ diagnostic }) => ({ ...diagnostic,
      name: masker.mask(diagnostic.name),
      ...(diagnostic.modelId === undefined ? {} : { modelId: masker.mask(diagnostic.modelId) }),
    }))
    const modelIds = rows.flatMap(row => row.config ? [row.config.model] : [])
    const complete = modelIds.length === names.length
    const identity = complete ? createPanelIdentity(modelIds) : undefined
    // A credential embedded in a model id cannot be published as a canonical identity.
    // Never fabricate a replacement identity from masked model ids.
    const safeIdentity = modelIds.every(id => masker.mask(id) === id) ? identity : undefined
    const gap = (reason: JudgeCalibrationGapReason): JudgePanelPreflightResult => ({
      kind: 'capability-gap', status: 'capability-gap', reason, minN, entries,
      ...(safeIdentity === undefined ? {} : { identity: safeIdentity }),
    })
    if (rows.some(row => row.diagnostic.credential !== 'present')) return gap('no-credential')
    const eligibility = assessPanelEligibility({ memberModelIds: modelIds, replayedModelId: replayProfile.model })
    if (!eligibility.eligible) return gap('single-family-host')
    return { kind: 'eligible', status: 'uncalibrated', n: 0, minN, entries,
      identity: identity!, replayProfile,
      members: rows.map(row => toModelProfileAndAuth(row.config!, row.auth!)),
    }
  } finally { masker.dispose() }
}
