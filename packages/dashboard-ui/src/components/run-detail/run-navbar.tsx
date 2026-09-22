import type * as React from "react"
import { useNavigate } from "react-router"
import { routes } from "@/lib/routes"
import { toast } from "sonner"
import {
  ArrowUpRight, Clock, Brain, Cpu, ExternalLink,
  RotateCcw, ChevronRight, Keyboard, PanelRightOpen,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ShortcutLegend } from "@/components/shortcut-hints"
import { PostProcessingChips } from "@/components/run-detail/post-processing-chips"
import { RetrievalRungBanner } from "@/components/run-detail/retrieval-rung-banner"
import type { PostProcessingView } from "@/lib/post-processing-view"
import type { RunRow } from "@/lib/api"
import { triggerRun } from "@/lib/api"
import { tokenSummaryLine } from "@/lib/run-detail-view"
import { statusBadgeLook } from "@/lib/status"
import { cn, formatDuration } from "@/lib/utils"
import type { RecordedRetrievalRung, RunTokenTotals } from "@vostride/agent-qa-schema"

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
 *
 * ENLARGED, NOT RE-PALETTED (2026-09-22, Phase 425 · D-02, PXH-RUN-01). Dominance comes from size
 * and fill in an unchanged row order: the size classes go through `cn` so tailwind-merge drops the
 * `Badge` base `text-xs px-2 py-0.5`, while `statusBadgeLook` keeps deciding the colour. A second
 * palette would be two answers to one question about one run.
 */
function StatusBadge({ status }: { status: string }) {
  const { label, ...look } = statusBadgeLook(status)
  return (
    <Badge
      data-verdict-badge={status}
      {...look}
      className={cn(look.className, "text-sm font-medium px-2 py-1 rounded-sm")}
    >
      {label}
    </Badge>
  )
}

interface RunNavbarProps {
  run: RunRow
  /**
   * The run's model spend, as the read op summed it (405-11 · D-06).
   *
   * OPTIONAL BECAUSE THE READ MAY NOT HAVE LANDED — `undefined` here means "nobody has answered
   * yet", which is a different fact from a projection that answered "nothing was measured". The
   * first renders no line at all; the second renders the not-measured sentence, because a run
   * that recorded no usage is a fact worth stating. The header previously summed three counters
   * off v1 step rows and guarded the span on a positive total, which spelled "unmeasured" and
   * "zero" identically — the exact collapse D-06 exists to prevent.
   */
  tokens?: RunTokenTotals
  shortcutsOpen: boolean
  onToggleShortcuts: () => void
  /**
   * The drawer tabs this header can ASK FOR. Narrowed to the two the artifact record feeds
   * (407-05 · D-02): the v1 `memory` tab is deleted, and `m` reaches the Knowledge tab through
   * the page's own shortcut map rather than through this prop.
   */
  onOpenArtifacts?: (tab: "test" | "config") => void
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
  /**
   * What pressing the `curation` chip should do (407-09 · LERN-02, D-01).
   *
   * FORWARDED, NOT DECIDED. The navbar is presentational and owns no tab state; the page passes
   * `() => setActiveTab('knowledge')`. Absent → the chip stays the shipped `<span>`, which is what
   * every surface rendering this header without a run-detail page behind it should get.
   */
  onCurationClick?: () => void
  /**
   * The rung that served THIS run, as the durable `runs.knowledge` read recorded it (407-10 · D-13).
   *
   * UNDEFINED IS TWO FACTS THIS HEADER CANNOT TELL APART, and both render the same nothing: the
   * read has not landed, or the run recorded no rung (a pre-407 run, or a project with no
   * knowledge reader bound — D-16). That collapse is deliberate here, unlike `postProcessing`
   * above: a chip area exists to say WHICH stage is pending, whereas the only honest thing to
   * paint about a rung nobody has stated is no element at all.
   *
   * IT IS THE RECORDED VALUE AND NEVER A HOST PROBE. Fixing the machine tomorrow must not change
   * what this header says about a run that already happened; the page reads it through
   * `bannerRung`, which is where the "no store bound is not a rung" judgement lives.
   */
  retrievalRung?: RecordedRetrievalRung
}

export function RunNavbar({
  run,
  tokens,
  shortcutsOpen,
  onToggleShortcuts,
  onOpenArtifacts,
  postProcessing,
  hasPostProcessing = false,
  onCurationClick,
  retrievalRung,
}: RunNavbarProps) {
  const navigate = useNavigate()
  const isSuiteParent = run.suiteId != null && run.parentRunId == null
  const sourceHref = isSuiteParent && run.suiteId
    ? routes.suiteView(run.suiteId)
    : run.testId
      ? routes.testView(run.testId)
      : null
  const sourceLabel = isSuiteParent && run.suiteId ? "Open suite" : "Open test"

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
    // TWO ROWS, ONE HEADER BLOCK. The banner is a second full-width row inside this `shrink-0`
    // wrapper rather than a sibling of the page's panel group, so the header stays one block the
    // layout can measure — 56px, or 56 + 28 when a run says its retrieval was degraded (D-14).
    // It is NOT a third pane and NOT a toast: 403's two-pane rule holds on the live page and the
    // same discipline holds here.
    <div className="shrink-0">
    <div className="flex h-14 items-center justify-between border-b px-4 min-w-0">
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
        {hasPostProcessing ? (
          <PostProcessingChips view={postProcessing} onCurationClick={onCurationClick} />
        ) : null}
      </div>

      <div className="flex items-center gap-3 shrink-0">
        {run.modelName && (
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <Brain className="h-3.5 w-3.5" />
            {run.modelName}
          </span>
        )}
        {tokens === undefined ? null : (
          <span
            data-run-token-summary
            className="text-xs text-muted-foreground flex items-center gap-1 cursor-default"
          >
            <Cpu className="h-3.5 w-3.5" />
            {tokenSummaryLine(tokens)}
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
          onClick={() => onOpenArtifacts?.("test")}
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
                    { key: '← →', label: 'Previous / next action' },
                    { key: 'Space', label: 'Play / pause' },
                    { key: 'V', label: 'Frames / Video' },
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
                    { key: "7", label: "Knowledge" },
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
                    { key: "M", label: "Knowledge tab" },
                    { key: "R", label: "Re-run" },
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

        {farmUrl && (
          <a href={farmUrl} target="_blank" rel="noopener noreferrer" title="BrowserStack">
            <Button variant="ghost" size="icon-sm">
              <ExternalLink className="h-3.5 w-3.5" />
            </Button>
          </a>
        )}
      </div>
    </div>
    <RetrievalRungBanner rung={retrievalRung?.rung} reason={retrievalRung?.reason} />
    </div>
  )
}
