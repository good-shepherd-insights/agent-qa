import { Brain, Play, ShieldCheck, Target } from "lucide-react"

import { ReasoningPipeline } from "@/components/reasoning-pipeline"
import type { SectionDef, ReasoningPipelineHandle } from "@/components/reasoning-pipeline"
import { MaskedText } from "@/components/run-detail/masked-text"
import {
  screenStateChangeLabel,
  screenStateChip,
  stepTokenTotals,
  tokenSummaryLine,
} from "@/lib/run-detail-view"
import type { DisplayStep } from "@/lib/display-step"
import type { RunDetailSubAction } from "@vostride/agent-qa-schema"

import { Player, type PlayerProps } from "./player"

export interface OverviewPlayerProps {
  model?: PlayerProps["model"] | null
  playhead?: PlayerProps["playhead"]
  recording?: PlayerProps["recording"]
  frame?: PlayerProps["frame"]
  playerSource?: PlayerProps["source"]
  onPlayerSourceChange?: PlayerProps["onSourceChange"]
  onPlayheadChange?: PlayerProps["onPlayheadChange"]
  seekFraction?: number
  isTimelineKeyIgnored?: PlayerProps["isTimelineKeyIgnored"]
}

interface TabOverviewProps extends OverviewPlayerProps {
  step: DisplayStep
  subAction: RunDetailSubAction | null
  runId: string | null
  pipelineRef?: React.RefObject<ReasoningPipelineHandle | null>
}

/** The two words a recorded result can be — raw, closed, and never a sentence. */
function resultWord(sub: RunDetailSubAction): "success" | "failure" {
  return sub.result.success ? "success" : "failure"
}

function buildSubActionSections(sub: RunDetailSubAction): SectionDef[] {
  const sections: SectionDef[] = []

  sections.push({
    key: "reasoning",
    label: "Reasoning",
    icon: Brain,
    content: null,
    duration: null,
    children: (
      <p
        data-sub-action-plan
        className="m-0 whitespace-pre-wrap break-words text-sm text-muted-foreground [overflow-wrap:anywhere]"
      >
        <MaskedText text={sub.plan} />
      </p>
    ),
  })

  sections.push({
    key: "plannedAction",
    label: "Planned Action",
    icon: Play,
    content: null,
    duration: null,
    children: (
      <pre
        data-sub-action-planned-action
        className="max-w-full min-w-0 text-[10px] font-mono bg-muted/30 rounded-sm p-2 overflow-x-auto whitespace-pre-wrap break-words"
      >
        <MaskedText text={JSON.stringify(sub.plannedAction, null, 2)} />
      </pre>
    ),
  })

  sections.push({
    key: "result",
    label: "Result",
    icon: ShieldCheck,
    content: null,
    duration: null,
    outcome: (
      <span
        className={`text-xs font-medium ${sub.result.success ? "text-emerald-500" : "text-red-500"}`}
      >
        {resultWord(sub)}
      </span>
    ),
    children:
      sub.result.error === undefined ? null : (
        <div className="bg-destructive/10 text-destructive rounded-sm p-2 text-xs break-words [overflow-wrap:anywhere]">
          <MaskedText text={sub.result.error} />
        </div>
      ),
  })

  if (sub.grounding !== undefined) {
    const { role, name } = sub.grounding.descriptor
    const descriptor = [role, name].filter((part) => part !== undefined && part !== "").join(" ")
    if (descriptor !== "") {
      sections.push({
        key: "grounding",
        label: "Grounding",
        icon: Target,
        content: null,
        duration: null,
        children: (
          <p data-grounding-descriptor className="m-0 text-sm text-muted-foreground break-words">
            <MaskedText text={descriptor} />
          </p>
        ),
      })
    }
  }

  return sections
}

/**
 * The screen this turn moved, as the only form of it the bus records (RESEARCH D2).
 *
 * A SHORT ID AND A VERDICT, not a tree. `ScreenState` is collapsed to a sha256 before it reaches
 * the wire, so "screen context" on this page honestly means the hash pair — and a full sha is not
 * something a reader can hold in their head long enough to compare two rows. The raw hash rides
 * `data-screen-state` for the DOM cells; the chip text is the part a person reads.
 */
function ScreenStateChips({ sub }: { sub: RunDetailSubAction }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span
        data-screen-state={sub.screenStateHash}
        className="font-mono rounded-sm bg-muted/40 px-1.5 py-0.5 text-muted-foreground"
      >
        {screenStateChip(sub.screenStateHash)}
      </span>
      <span data-screen-state-change className="text-muted-foreground">
        {screenStateChangeLabel(sub)}
      </span>
    </div>
  )
}

export function TabOverview({
  step,
  subAction,
  runId,
  model, playhead = null, recording, frame, playerSource = "frames",
  onPlayerSourceChange = () => {}, onPlayheadChange = () => {}, seekFraction, isTimelineKeyIgnored,
  pipelineRef,
}: TabOverviewProps) {
  return (
    <div data-overview>
      {model && runId && <Player model={model} playhead={playhead} recording={recording} frame={frame}
        source={playerSource} runId={runId} onSourceChange={onPlayerSourceChange}
        onPlayheadChange={onPlayheadChange} seekFraction={seekFraction} isTimelineKeyIgnored={isTimelineKeyIgnored} />}
      <div className="border-t">
        <div className="p-3 space-y-3 min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            {subAction === null ? null : (
              <span className="font-medium">Sub-action #{subAction.subActionIndex + 1}</span>
            )}
            {/* D-06: the step's own spend, keyed on the ABSENCE of a sum rather than on a count,
                so an unmeasured step can never read as a step that spent nothing. */}
            <span data-token-summary className="text-xs text-muted-foreground">
              {tokenSummaryLine(stepTokenTotals(step))}
            </span>
          </div>

          {subAction === null ? null : <ScreenStateChips sub={subAction} />}

          {subAction === null ? null : (
            <ReasoningPipeline
              ref={pipelineRef}
              mode="static"
              sections={buildSubActionSections(subAction)}
            />
          )}

          {step.error ? (
            <div>
              <p className="text-xs text-muted-foreground font-medium mb-0.5">Error</p>
              <div
                data-step-error
                className="bg-destructive/10 text-destructive rounded-sm p-2 text-sm break-words [overflow-wrap:anywhere]"
              >
                <MaskedText text={step.error} />
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
