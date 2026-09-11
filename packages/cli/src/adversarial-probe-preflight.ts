/**
 * 422 D-09: which configured model — if any — may author adversarial probes.
 *
 * THE POOL IS `eval.judge` / `eval.judges`, AND THERE IS NO NEW CONFIG KEY. A host that has
 * already declared a judge has already declared the models it trusts to reason about its own
 * screens; a dedicated `eval.probeModel` would be a second place to say the same thing and a
 * second place to get it wrong.
 *
 * THIS IS NOT THE PANEL PREFLIGHT, AND THE DIFFERENCE IS THE POINT. `preflightJudgePanel`
 * refuses a DECLARATION: two or more members, every one credentialed, all pairwise
 * family-disjoint, or nothing. A probe author is a CAPABILITY, so one eligible member is enough
 * and a sibling that is missing, unresolvable or planner-family is that sibling's gap rather
 * than this host's. Concretely, three of that function's rules are deliberately NOT reused here:
 * the `names.length < 2` floor, the all-members-credentialed requirement, and
 * member/member family collision — author-author disjointness is meaningless when exactly one
 * author writes each probe.
 *
 * WHAT IS REUSED VERBATIM is the part that must not fork: the per-entry resolution loop that
 * resolves a named config and its credential WITHOUT a provider call, the masker registration
 * of every resolved credential before any disclosure is built, and `assessPanelEligibility`
 * against the REPLAY PLANNER's model id. A probe author from the planner's own family is the
 * self-preference the judge law forbids — it would author bait its own family is least likely
 * to fall for — so that exclusion is enforced here and nowhere else (the pure eval package
 * cannot even spell it).
 *
 * THE SAME-FAMILY OPT-IN IS NOT HONOURED ON THIS PATH. `eval.judgeAllowSameFamily` lets an
 * operator knowingly accept a same-family PANEL, a measurement whose bias they can then read.
 * A planner-family probe author is not a biased measurement, it is a corpus entry whose
 * adversarial claim is false, and no committed entry records that an override was in force.
 *
 * ZERO PROVIDER CALLS ON EVERY GAP. Config resolution, credential presence and family
 * arithmetic are all local; nothing here constructs a model. A host that cannot author probes
 * finds that out for free.
 */
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
 * Ephemeral binding DATA contains credentials: never serialize this arm wholesale. The masked
 * `entries` beside it is the disclosure surface, and it is the only one.
 */
export interface AdversarialProbeAuthorSelection {
  /** Declaration index of the winning entry, so a report can say WHICH entry was chosen. */
  index: number
  /** Raw registry name — binding data, never disclosure. */
  name: string
  /** Exactly what D-11 persists on every entry this author writes. */
  authoringModel: AuthoringModel
  profile: ModelProfile
  auth: ResolvedModelAuth
}

interface ProbePreflightCommon {
  /** Safe, serializable per-entry diagnostics. Names and model ids are masked. */
  entries: readonly JudgeCalibrationEntryDiagnostic[]
}

export type AdversarialProbeCapability =
  | (ProbePreflightCommon & { kind: 'no-probe-model'; reason: JudgeCalibrationGapReason })
  | (ProbePreflightCommon & { kind: 'probe-author'; author: AdversarialProbeAuthorSelection })

interface PreflightRow {
  config?: NamedLLMConfigLike
  auth?: ResolvedLLMAuth
  /** Decided once, by the shared eligibility law, and read by both the label and the choice. */
  eligible?: boolean
  diagnostic: JudgeCalibrationEntryDiagnostic
}

/** The family string D-11 persists beside the author's id, spelled as the resolver spells it. */
function authoringFamily(modelId: string): string {
  return [...resolveJudgeFamilies(modelId)].sort().join(',')
}

/**
 * Resolve the probe-authoring capability for one eval session (D-09).
 *
 * Local presence only, never a remote authentication test, and never a model construction.
 */
export async function resolveAdversarialProbeCapability(
  session: EvalSession,
  deps: AdversarialProbePreflightDeps = {},
): Promise<AdversarialProbeCapability> {
  const names = selectedEvalJudgeNames(session.evalConfig)
  // No declared pool at all: the one gap that costs nothing to reach, so it is reached first
  // and neither the registry nor any credential store is touched.
  if (names.length === 0) {
    return { kind: 'no-probe-model', reason: 'panel-not-configured', entries: [] }
  }

  const named = deps.resolveNamedConfig ?? resolveNamedConfig
  const resolveAuth = deps.resolveModelAuth ?? resolveModelAuth
  const masker = session.maskingContextFactory()
  try {
    const rows: PreflightRow[] = []
    // Preserve declaration order and aliases. A failing entry never short-circuits its siblings:
    // on this path a broken entry is precisely the case a later one is allowed to rescue.
    for (const [index, name] of names.entries()) {
      const diagnostic: JudgeCalibrationEntryDiagnostic = {
        index, name, families: [], credential: 'resolution-failed', failures: [],
      }
      const row: PreflightRow = { diagnostic }
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
      if (diagnostic.credential !== 'present') {
        diagnostic.failures = [...diagnostic.failures, 'no-credential']
      }
      rows.push(row)
    }

    // Shared replay declaration, key-only: do not ask for planner credentials.
    let replayProfile: ModelProfile
    try {
      replayProfile = await resolveReplayProfileDeclaration(session, named)
    } catch {
      // Resolver messages can contain registry names or provider details. Keep the refusal
      // actionable without forwarding untrusted text.
      throw new Error('Cannot resolve the replay profile for adversarial probe preflight. Check use.llm and its registry.llms entry.')
    }
    const replayFamilies = resolveJudgeFamilies(replayProfile.model)
    for (const row of rows) {
      if (!row.config) continue
      const families = resolveJudgeFamilies(row.config.model)
      // ONE eligibility site, the shared law, against the actual replay planner id.
      row.eligible = assessPanelEligibility({
        memberModelIds: [row.config.model], replayedModelId: replayProfile.model,
      }).eligible
      const failures = [...row.diagnostic.failures]
      // Unknown or unresolvable family is INELIGIBLE and says so in its own diagnostic; it is
      // never a new gap reason, because the host's situation is still one of the three.
      if (families.size === 0 || replayFamilies.size === 0) failures.push('unknown-family')
      else if (!row.eligible) failures.push('replay-family-collision')
      row.diagnostic.failures = failures
    }

    // Mask only disclosure, after all credentials are registered (a later entry can mask an
    // earlier name). Family assessment and the bound identity always use the raw model ids.
    const entries = rows.map(({ diagnostic }) => ({ ...diagnostic,
      name: masker.mask(diagnostic.name),
      ...(diagnostic.modelId === undefined ? {} : { modelId: masker.mask(diagnostic.modelId) }),
    }))
    const gap = (reason: JudgeCalibrationGapReason): AdversarialProbeCapability =>
      ({ kind: 'no-probe-model', reason, entries })

    // Precedence, and it is ordered from the most general cause to the most specific: nothing
    // declared, then nothing credentialed, then nothing family-disjoint. Each reason is only
    // reached once the one above it is false, so a host reads the FIRST thing it must fix.
    if (rows.every(row => row.diagnostic.credential !== 'present')) return gap('no-credential')
    const selected = rows.find(row =>
      row.diagnostic.credential === 'present' && row.config !== undefined && row.eligible === true)
    if (!selected) return gap('single-family-host')

    const { profile, auth } = toModelProfileAndAuth(selected.config!, selected.auth!)
    return {
      kind: 'probe-author',
      entries,
      author: {
        index: selected.diagnostic.index,
        name: selected.config!.name,
        authoringModel: { id: profile.model, family: authoringFamily(profile.model) },
        profile,
        auth,
      },
    }
  } finally { masker.dispose() }
}
