// Pure reconstruction of the planner decision context from a cassette input leg
// (RPLY-04, D-01/B1). Everything the returned ScreenState + StepContext carries is
// strictly leg-derived — nothing else may enter a replay. The captured-modality branch is
// strict: a text-only cassette gets NO screenshot bytes (the screenshot key is absent
// entirely, so prompts.ts emits no image block); a full cassette gets EXACTLY the recorded
// blob bytes resolved through the ArtifactSource port. Every unsupported input shape is a
// loud typed refusal the engine maps to a distinct ReplayRefusal reason.
//
// Two fidelity caveats hold for ALL replays, consistently and by design:
//   - agentRules are not recorded on the leg, so replay passes none (RESEARCH A1).
//   - the live vision-gate prompt note is not recorded and is NOT synthesized here
//     (RESEARCH A2) — text-only replays carry no promptNote.

import type { ArtifactRef, ScreenState } from '@vostride/agent-qa-schema'
import type { StepContext } from '@vostride/agent-qa-runner'
import type { CassetteInputLeg } from '../cassette/input-leg'
import type { ArtifactSource } from '../ports'

/**
 * A full-capture leg whose decision-screenshot blob is absent from the ArtifactSource.
 * Completeness normally refuses this upstream; this is the defense-in-depth path. Distinct
 * from {@link UnsupportedBriefError} so the engine maps it to the 'missing-blob' refusal.
 */
export class MissingDecisionBlobError extends Error {
  readonly sha: string | undefined
  constructor(sha: string | undefined) {
    super(`full-capture decision blob is unavailable${sha !== undefined ? ` for ${sha}` : ''}`)
    this.name = 'MissingDecisionBlobError'
    this.sha = sha
  }
}

/**
 * A served brief carrying content on any channel. Phase M2 must choose a faithful brief
 * rendering deliberately (RESEARCH Open Q3) — replay never inherits a silent lossy one, so
 * a non-empty brief is refused loudly here. The engine maps it to the 'unsupported-brief'
 * refusal. An empty-but-structured brief is legal and yields an omitted knowledge brief.
 */
export class UnsupportedBriefError extends Error {
  readonly channel: string
  constructor(channel: string) {
    super(`served brief carries content on ${channel}; replay brief rendering is undecided (M2)`)
    this.name = 'UnsupportedBriefError'
    this.channel = channel
  }
}

export interface ReconstructDecisionContextInput {
  leg: CassetteInputLeg
  captureMode: 'full' | 'textOnly'
  screenshotRef?: ArtifactRef
  artifacts: ArtifactSource
  model: StepContext['plannerModel']
}

export interface ReconstructedDecisionContext {
  screenState: ScreenState
  stepContext: StepContext
}

function firstNonEmptyChannel(brief: CassetteInputLeg['servedBrief']): string | undefined {
  if (brief.channel1.length > 0) return 'channel1'
  if (brief.channel2.length > 0) return 'channel2'
  if (brief.channel3.length > 0) return 'channel3'
  return undefined
}

export function reconstructDecisionContext(
  input: ReconstructDecisionContextInput,
): ReconstructedDecisionContext {
  const { leg, captureMode, screenshotRef, artifacts, model } = input

  const populatedChannel = firstNonEmptyChannel(leg.servedBrief)
  if (populatedChannel !== undefined) {
    throw new UnsupportedBriefError(populatedChannel)
  }

  const workingMemory =
    leg.workingMemory !== undefined && leg.workingMemory.length > 0
      ? leg.workingMemory
      : undefined

  let screenshot: NonNullable<StepContext['screenshot']> | undefined
  if (captureMode === 'full') {
    const sha = screenshotRef?.sha
    const bytes = sha !== undefined ? artifacts.getBlob(sha) : undefined
    if (bytes === undefined) {
      throw new MissingDecisionBlobError(sha)
    }
    // StepContext.screenshot is a Buffer field on the runner type; a Uint8Array is
    // structurally acceptable and eval core carries bytes as Uint8Array. Cast at the
    // boundary rather than importing any host module.
    screenshot = bytes as unknown as NonNullable<StepContext['screenshot']>
  }

  const stepContext: StepContext = {
    stepInstruction: leg.stepText,
    testName: leg.testId,
    previousSteps: [],
    plannerModel: model,
    // Required by the type; never consulted on the plan() path in replay.
    verifierModel: model,
    ...(workingMemory !== undefined ? { workingMemory } : {}),
    ...(screenshot !== undefined ? { screenshot } : {}),
  }

  return { screenState: leg.stateBefore, stepContext }
}
