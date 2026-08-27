// THE OVERVIEW PANEL, ON THE DURABLE PROJECTION (405-11 · DETL-01/02/03, D-06, D-10, D-14, D-15,
// RESEARCH D2).
//
// FIVE FACTS AND WHERE EACH ONE COMES FROM. The reasoning is the planner's own `plan` sentence; the
// screenshot is minted from an `artifactRefs` entry through the one route minter; the screen
// context is the recorded state-hash pair, because the bus carries no screen TEXT; the tokens are
// the step's own measurement, absent-and-all; the result is the raw recorded word. Nothing here is
// re-derived from something adjacent — the panel renders what the read returned, and says so when
// the read returned nothing.
//
// EVERY PRODUCER STRING GOES THROUGH `MaskedText` (D-10, T-405-40). The plan, the planned action,
// the recorded error and the step error all travel through the display-unmask seam, which rewrites
// a placeholder it could not restore into a typed marker. Rendering one of those directly would put
// a marker — or a raw placeholder — into a text node a person reads. There is no
// `dangerouslySetInnerHTML` in this file.
//
// AN ABSENT BLOB IS A STATE, NOT A BROKEN IMAGE (D-15). A ref carrying `evidenceIncomplete` is not
// requested at all, and a request that 404s flips the pane to the same visible node. "The evidence
// is gone" and "the page is broken" must never look the same.

import { useState } from "react"
import { Brain, Camera, ImageOff, Play, ShieldCheck, Target } from "lucide-react"

import { ScreenshotViewer } from "@/components/screenshot-viewer"
import { ReasoningPipeline } from "@/components/reasoning-pipeline"
import type { SectionDef, ReasoningPipelineHandle } from "@/components/reasoning-pipeline"
import { MaskedText } from "@/components/run-detail/masked-text"
import { routes } from "@/lib/routes"
import {
  SCREENSHOT_UNAVAILABLE_LABEL,
  decisionScreenshotRef,
  screenStateChangeLabel,
  screenStateChip,
  stepTokenTotals,
  tokenSummaryLine,
} from "@/lib/run-detail-view"
import type { DisplayStep } from "@/lib/display-step"
import type { RunDetailSubAction } from "@vostride/agent-qa-schema"

/** What the pane says when this turn recorded no screenshot at all — distinct from an absent blob. */
export const NO_SCREENSHOT_LABEL = "No screenshot captured"

/** What the pane says while a screenshot is still expected on a run that has not finished. */
export const PENDING_SCREENSHOT_LABEL = "Waiting for screenshot"

export type ScreenshotEmptyState = "pending" | "absent"

interface TabOverviewProps {
  step: DisplayStep
  subAction: RunDetailSubAction | null
  runId: string | null
  screenshotEmptyState?: ScreenshotEmptyState
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

function ScreenshotAbsent({ label }: { label: string }) {
  return (
    <div className="h-full w-full py-12">
      <div className="flex min-h-[16rem] w-full flex-col items-center justify-center gap-2 text-center text-muted-foreground">
        <Camera className="h-8 w-8" />
        <span className="text-sm font-medium text-foreground">{label}</span>
      </div>
    </div>
  )
}

function ScreenshotUnavailable() {
  return (
    <div data-artifact-state="unavailable" className="h-full w-full py-12">
      <div className="flex min-h-[16rem] w-full flex-col items-center justify-center gap-2 text-center text-muted-foreground">
        <ImageOff className="h-8 w-8" />
        <span className="text-sm font-medium text-foreground">{SCREENSHOT_UNAVAILABLE_LABEL}</span>
      </div>
    </div>
  )
}

/**
 * The screenshot the planner looked at when it decided this turn (D-14 / D-15).
 *
 * ONE SHOT, NO SIDES. The bus records a single decision screenshot per sub-action, so there is no
 * before/after pair to toggle between; the segmented control that used to sit here selected between
 * two path-addressed captures whose producer is gone.
 *
 * A REF CARRYING `evidenceIncomplete` IS NEVER REQUESTED. The producer already told us the bytes
 * are not there; asking anyway would turn a known fact into a network round-trip whose 404 we would
 * then have to interpret. Both roads end at the same visible node — this one just does not lie
 * about having looked.
 */
function DecisionScreenshot({
  runId,
  subAction,
  emptyState,
}: {
  runId: string | null
  subAction: RunDetailSubAction | null
  emptyState: ScreenshotEmptyState
}) {
  const [failedSha, setFailedSha] = useState<string | null>(null)

  const ref = subAction === null ? undefined : decisionScreenshotRef(subAction)
  if (ref === undefined || runId === null) {
    return (
      <ScreenshotAbsent
        label={emptyState === "pending" ? PENDING_SCREENSHOT_LABEL : NO_SCREENSHOT_LABEL}
      />
    )
  }

  if (ref.evidenceIncomplete === true || failedSha === ref.sha) return <ScreenshotUnavailable />

  return (
    <div data-artifact-state="available" className="p-3 min-w-0">
      <ScreenshotViewer
        src={routes.runArtifact(runId, ref.sha)}
        className="w-full rounded-sm overflow-hidden"
        onUnavailable={() => setFailedSha(ref.sha)}
      />
    </div>
  )
}

export function TabOverview({
  step,
  subAction,
  runId,
  screenshotEmptyState = "absent",
  pipelineRef,
}: TabOverviewProps) {
  return (
    <>
      <DecisionScreenshot runId={runId} subAction={subAction} emptyState={screenshotEmptyState} />
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
    </>
  )
}
