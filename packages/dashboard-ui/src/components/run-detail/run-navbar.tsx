import type * as React from "react"
import { useNavigate } from "react-router"
import { routes } from "@/lib/routes"
import { toast } from "sonner"
import {
  ArrowUpRight, Clock, Brain, Cpu, Video, ExternalLink,
  RotateCcw, ChevronRight, Keyboard, PanelRightOpen,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ShortcutLegend } from "@/components/shortcut-hints"
import { PostProcessingChips } from "@/components/run-detail/post-processing-chips"
import type { PostProcessingView } from "@/lib/post-processing-view"
import type { RunRow, StepRow } from "@/lib/api"
import { triggerRun } from "@/lib/api"
import { resolveVideoSrc } from "@/lib/artifact-media"
import { formatDuration } from "@/lib/utils"
import { formatTokens } from "@/lib/format"

type StatusBadgeLook = Pick<React.ComponentProps<typeof Badge>, "variant" | "className"> & { label: string }

/** The closed switch, as data. One arm per word, unchanged in what it paints. */
function statusBadgeLook(status: string): StatusBadgeLook {
  switch (status) {
    case "passed":
      return { label: "Passed", className: "bg-emerald-500/15 text-emerald-500 border-emerald-500/20" }
    case "failed":
      return { label: "Failed", variant: "destructive" }
    case "healed":
      return { label: "Healed", className: "bg-amber-500/15 text-amber-500 border-amber-500/20" }
    case "flaky":
      return { label: "Flaky", className: "bg-amber-500/15 text-amber-500 border-amber-500/20" }
    case "skipped":
      return { label: "Skipped", variant: "secondary" }
    case "cancelled":
      return { label: "Cancelled", className: "bg-muted text-muted-foreground border-border" }
    default:
      return { label: status, variant: "outline" }
  }
}

/**
 * THE HEADER'S VERDICT BADGE, ADDRESSABLE (2026-08-26, Phase 404 · LIFE-01, D-13/D-15).
 *
 * The badge's visible text is a LABEL — title-cased, and `Cancelled` for a row that says
 * `cancelled`. A DOM cell reading that text would be asserting on presentation, and a page that
 * painted the right word into the wrong element would still pass. The hook below carries the RAW
 * status string instead — the same bytes the dashboard subscriber wrote to the run row at the
 * `verdict` envelope — so "the viewer was moved to run detail AND the verdict is painted in its
 * header" is one selector against one fact.
 *
 * WHY THE SWITCH BECAME A LOOKUP. The attribute belongs on the badge ROOT, and seven `return`
 * arms meant seven places for it to drift out of. One render site is one place it can be wrong.
 * Nothing about what is painted changed.
 */
function StatusBadge({ status }: { status: string }) {
  const { label, ...look } = statusBadgeLook(status)
  return <Badge data-verdict-badge={status} {...look}>{label}</Badge>
}

interface RunNavbarProps {
  run: RunRow
  steps: StepRow[]
  shortcutsOpen: boolean
  onToggleShortcuts: () => void
  onOpenArtifacts?: (tab: "attributes" | "config" | "memory") => void
  /**
   * The post-processing projection to paint beside the verdict badge (404-07, D-20).
   *
   * TWO PROPS AND NOT ONE, because "no read has landed yet" and "this header was never wired for
   * chips" are different facts that a single optional prop would spell identically. The navbar is
   * PRESENTATIONAL (400 D-13): it neither knows a run id nor asks anything, so it cannot tell those
   * two apart on its own, and a chip area that appeared out of a `undefined` would put a permanent
   * placeholder into every surface that renders this header without a client behind it.
   */
  postProcessing?: PostProcessingView | undefined
  /** Whether a chip client is wired at all. See {@link RunNavbarProps.postProcessing}. */
  hasPostProcessing?: boolean
}

export function RunNavbar({
  run,
  steps,
  shortcutsOpen,
  onToggleShortcuts,
  onOpenArtifacts,
  postProcessing,
  hasPostProcessing = false,
}: RunNavbarProps) {
  const navigate = useNavigate()
  const totalTokens = steps.reduce((sum, s) => sum + (s.totalTokens ?? 0), 0)
  const totalPrompt = steps.reduce((sum, s) => sum + (s.promptTokens ?? 0), 0)
  const totalCompletion = steps.reduce((sum, s) => sum + (s.completionTokens ?? 0), 0)
  const isSuiteParent = run.suiteId != null && run.parentRunId == null
  const sourceHref = isSuiteParent && run.suiteId
    ? routes.suiteView(run.suiteId)
    : run.testId
      ? routes.testView(run.testId)
      : null
  const sourceLabel = isSuiteParent && run.suiteId ? "Open suite" : "Open test"

  const videoSrc = resolveVideoSrc(run.id, run.videoPath)
  const farmUrl = (run.metadata as Record<string, unknown>)?.farmSessionUrl as string | undefined

  const handleRerun = () => {
    const wasLocal = run.attributes["agent-qa.runner"] === "local"
    triggerRun({ file: run.filePath ?? run.name, local: wasLocal })
      .then((result) => {
        toast.success("Re-run started")
        navigate(routes.runLive(result.runId))
      })
      .catch(() => toast.error("Failed to start re-run"))
  }

  return (
    <div className="flex h-14 shrink-0 items-center justify-between border-b px-4 min-w-0">
      <div className="flex items-center gap-2 min-w-0">
        <button
          onClick={() => navigate(routes.runs)}
          className="text-sm text-muted-foreground hover:text-foreground transition-colors shrink-0"
        >
          Runs
        </button>
        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="text-sm font-medium truncate">{run.name}</span>
        {sourceHref ? (
          <a
            href={sourceHref}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={sourceLabel}
            className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowUpRight className="h-3.5 w-3.5" />
          </a>
        ) : null}
        <StatusBadge status={run.status} />
        {/* D-20: the lifecycle story on one line — execution truth, then post-processing truth. */}
        {hasPostProcessing ? <PostProcessingChips view={postProcessing} /> : null}
      </div>

      <div className="flex items-center gap-3 shrink-0">
        {run.modelName && (
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <Brain className="h-3.5 w-3.5" />
            {run.modelName}
          </span>
        )}
        {totalTokens > 0 && (
          <span
            className="text-xs text-muted-foreground flex items-center gap-1 cursor-default"
            title="Prompt tokens / Completion tokens"
          >
            <Cpu className="h-3.5 w-3.5" />
            {formatTokens(totalPrompt)} / {formatTokens(totalCompletion)}
          </span>
        )}
        <span className="text-xs text-muted-foreground flex items-center gap-1">
          <Clock className="h-3.5 w-3.5" />
          {formatDuration(run.duration)}
        </span>

        <div className="h-4 w-px bg-border" />

        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Open run artifacts"
          title="Run details (I/C/M)"
          onClick={() => onOpenArtifacts?.("attributes")}
        >
          <PanelRightOpen className="h-3.5 w-3.5" />
        </Button>

        <div className="relative">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Keyboard shortcuts"
            aria-expanded={shortcutsOpen}
            title="Shortcuts (Shift+?)"
            onClick={onToggleShortcuts}
          >
            <Keyboard className="h-3.5 w-3.5" />
          </Button>
          {shortcutsOpen ? (
            <div
              role="dialog"
              aria-label="Keyboard shortcuts"
              className="absolute right-0 top-full z-50 mt-2 w-72 rounded-md border border-border bg-popover p-4 text-popover-foreground shadow-md"
            >
              <div className="space-y-3">
                <div>
                  <h4 className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-2">Navigation</h4>
                  <ShortcutLegend hints={[
                    { key: "\u2191 / K", label: "Previous item" },
                    { key: "\u2193 / J", label: "Next item" },
                    { key: "Shift+\u2191", label: "Previous step" },
                    { key: "Shift+\u2193", label: "Next step" },
                  ]} />
                </div>
                <div>
                  <h4 className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-2">Tabs</h4>
                  <ShortcutLegend hints={[
                    { key: "1", label: "Overview" },
                    { key: "2", label: "Env" },
                    { key: "3", label: "Network" },
                    { key: "4", label: "Console" },
                    { key: "5", label: "ARIA" },
                    { key: "6", label: "A11y" },
                  ]} />
                </div>
                <div>
                  <h4 className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-2">Screenshots</h4>
                  <ShortcutLegend hints={[
                    { key: "B", label: "Before screenshot" },
                    { key: "A", label: "After screenshot" },
                  ]} />
                </div>
                <div>
                  <h4 className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-2">Phases</h4>
                  <ShortcutLegend hints={[
                    { key: "Shift+1", label: "Toggle Observe" },
                    { key: "Shift+2", label: "Toggle Plan" },
                    { key: "Shift+3", label: "Toggle Execute" },
                    { key: "Shift+4", label: "Toggle Verify" },
                  ]} />
                </div>
                <div>
                  <h4 className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-2">Actions</h4>
                  <ShortcutLegend hints={[
                    { key: "I", label: "Details: Attributes" },
                    { key: "C", label: "Artifacts: Config" },
                    { key: "M", label: "Artifacts: Memory" },
                    { key: "R", label: "Re-run" },
                    { key: "V", label: "Video" },
                    { key: "Shift+?", label: "Shortcuts" },
                    { key: "Esc", label: "Close" },
                  ]} />
                </div>
              </div>
            </div>
          ) : null}
        </div>

        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Re-run"
          title="Re-run (R)"
          onClick={handleRerun}
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </Button>

        {videoSrc && (
          <a href={videoSrc} target="_blank" rel="noopener noreferrer" aria-label="Open recording" title="Recording (V)">
            <Button variant="ghost" size="icon-sm">
              <Video className="h-3.5 w-3.5" />
            </Button>
          </a>
        )}

        {farmUrl && (
          <a href={farmUrl} target="_blank" rel="noopener noreferrer" title="BrowserStack">
            <Button variant="ghost" size="icon-sm">
              <ExternalLink className="h-3.5 w-3.5" />
            </Button>
          </a>
        )}
      </div>
    </div>
  )
}
