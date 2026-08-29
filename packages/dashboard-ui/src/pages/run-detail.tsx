import { useState, useEffect, useMemo, useRef, useCallback } from "react"
import { useParams, useNavigate, useSearchParams, useLocation } from "react-router"
import { routes, arrivedOnVerdictFrom, VERDICT_ROW_CATCH_UP_MAX, VERDICT_ROW_CATCH_UP_MS } from "@/lib/routes"
import { toast } from "sonner"
import { FileSearch, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { TooltipProvider } from "@/components/ui/tooltip"
import {
  ResizablePanelGroup, ResizablePanel, ResizableHandle,
} from "@/components/ui/resizable"
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { DetailSkeleton } from "@/components/page-skeleton"
import { EmptyState } from "@/components/empty-state"
import { useOptionalProductTour } from "@/components/product-tour"
import { RunNavbar } from "@/components/run-detail/run-navbar"
import { ArtifactDrawer, type ArtifactDrawerTab } from "@/components/run-detail/artifact-drawer"
import { HookDetailPanel } from "@/components/run-detail/hook-detail-panel"
import { StepTree } from "@/components/run-detail/step-tree"
import { FailureBanner } from "@/components/run-detail/failure-banner"
import { TabPanels } from "@/components/run-detail/tab-panels"
import type { ReasoningPipelineHandle } from "@/components/reasoning-pipeline"
import { fetchRun, fetchRunAnalysis, fetchRunDetail, fetchRunKnowledge, triggerRun, fetchExecutionLogs, fetchRunArtifact, fetchAccessibilitySummary, watchPostProcessing } from "@/lib/api"
import type { RunRow, ExecutionLogEntry, RunArtifactResponse, AccessibilitySummary, KnowledgeRead, PostProcessingRead } from "@/lib/api"
import type { AnalysisGetOutput, RunDetailProjection, RunDetailSubAction } from "@vostride/agent-qa-schema"
import {
  MEMBER_FILTER_ALL,
  RUN_DETAIL_UNAVAILABLE_LABEL,
  filterGroups,
  groupRunDetail,
  memberDisplayName,
  parseMemberFilter,
  showMemberChrome,
} from "@/lib/run-detail-view"
import { projectPostProcessingView } from "@/lib/post-processing-view"
import { projectKnowledgeView } from "@/lib/knowledge-view"
import { projectAnalysisView } from "@/lib/analysis-view"
import { shouldRouteRunToLive } from "@/lib/status"
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts"
import { usePageTitle } from "@/hooks/use-page-title"
import { getRunFaviconState, useRunStatusFavicon } from "@/hooks/use-run-status-favicon"
import { formatTokens } from "@/lib/format"
import { hasStepId, isSubactionSelection, runDetailStepKey, type Selection } from "@/lib/selection"
import { displayStepsForGroups, type DisplayStep } from "@/lib/display-step"

/**
 * Which step a link is pointing at (405-08 · D-16).
 *
 * `?step=` NOW CARRIES THE MEMBER-SCOPED KEY `<testIndex>:<stepIndex>`, the same string the tree
 * selects by. Until 405-08 it carried a bare step ordinal disambiguated by `?run=<childRunId>` —
 * the child run id came from the parent/child walk this plan deleted, and a bare ordinal on a
 * multi-member run names one row per member.
 *
 * A KEY THAT NAMES NO RENDERED STEP FALLS BACK TO THE FIRST ONE (T-405-25). The param is
 * hand-editable, and it can also point at a member the current `?member=` filter narrowed away —
 * both land the viewer at the top of the tree they can see, never on a blank panel.
 */
function getSelectionFromUrlOrFirst(
  displaySteps: DisplayStep[],
  searchParams: URLSearchParams,
): Selection | null {
  const urlStepKey = searchParams.get("step")
  const urlSubIndex = searchParams.get("sub")

  if (urlStepKey) {
    const targetStep = displaySteps.find((step) => step.id === urlStepKey)
    if (targetStep) {
      if (urlSubIndex != null) {
        return { type: "subaction", stepId: targetStep.id, subIndex: Number.parseInt(urlSubIndex, 10) }
      }
      return { type: "step", stepId: targetStep.id }
    }
  }

  if (displaySteps.length > 0) {
    return { type: "step", stepId: displaySteps[0].id }
  }

  return null
}

function scrollElementIntoContainerView(container: HTMLElement, element: HTMLElement) {
  const containerRect = container.getBoundingClientRect()
  const elementRect = element.getBoundingClientRect()
  const padding = 12
  const topEdge = containerRect.top + padding
  const bottomEdge = containerRect.bottom - padding

  if (elementRect.top >= topEdge && elementRect.bottom <= bottomEdge) return

  const nextTop =
    elementRect.top < topEdge
      ? container.scrollTop + (elementRect.top - topEdge)
      : container.scrollTop + (elementRect.bottom - bottomEdge)

  const top = Math.max(0, nextTop)

  if (typeof container.scrollTo === "function") {
    container.scrollTo({
      top,
      behavior: "smooth",
    })
    return
  }

  container.scrollTop = top
}


export default function RunDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  // D-07. The one thing this page cannot work out from the run row: whether the viewer arrived
  // here BECAUSE the live page just watched this run's verdict land. Written by `live-run.tsx`,
  // read structurally, `undefined` for anything that is not the shape. See the loader below.
  const arrivedOnVerdict = arrivedOnVerdictFrom(location.state)
  const [searchParams, setSearchParams] = useSearchParams()
  const productTour = useOptionalProductTour()
  const recordRunDetailStatus = productTour?.recordRunDetailStatus

  const [run, setRun] = useState<RunRow | null>(null)
  const runTitle = run ? `Run - ${run.name}` : "Run"
  usePageTitle(runTitle)
  useRunStatusFavicon(getRunFaviconState(run?.status))
  // THE PAGE'S ONE DURABLE READ (D-03/D-16). `undefined` = not asked yet; `null` = the read
  // FAILED. Those are different facts and the tree renders them differently: an unasked page is
  // still loading, a failed read is an error posture, and an empty projection is a run that
  // genuinely recorded nothing. Collapsing any two of them would make a server fault look like a
  // quiet test.
  const [detail, setDetail] = useState<RunDetailProjection | null | undefined>(undefined)
  const [isLoading, setIsLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const pipelineRef = useRef<ReasoningPipelineHandle | null>(null)
  const stepTreeScrollRef = useRef<HTMLDivElement | null>(null)
  const skippedInitialDefaultSelectionRef = useRef<string | null>(null)

  const [selection, setSelection] = useState<Selection | null>(null)
  const [allExecutionLogs, setAllExecutionLogs] = useState<ExecutionLogEntry[]>([])
  const [accessibilitySummary, setAccessibilitySummary] = useState<AccessibilitySummary | null>(null)

  // THE CHIP CLIENT LIVES HERE, NOT IN THE HEADER (404-07, D-20 / 400 D-13). The navbar is
  // presentational: it takes a view and paints it. A header that fetched for itself would open one
  // client per mount of a component that remounts, and would be a second answer to "what does this
  // page know about this chain". The raw READ is what is held — the projection is pure and total,
  // so re-deriving it on render costs nothing and keeps exactly one copy of the mapping.
  const [postProcessingRead, setPostProcessingRead] = useState<PostProcessingRead | undefined>(undefined)

  // THE KNOWLEDGE TAB'S OWN READ (407-02 · LERN-01, D-05). The page owns the client and the tab is
  // presentational, on the chip read's footing above: a tab that fetched for itself would open one
  // client per remount of a component the tab strip remounts. Held RAW because
  // `projectKnowledgeView` is pure and total — re-deriving it costs nothing and keeps exactly one
  // copy of the mapping. `undefined` is "the first read has not landed", which is the tab's
  // `loading` state and is deliberately not a member of the projection's own union.
  const [knowledgeRead, setKnowledgeRead] = useState<KnowledgeRead | undefined>(undefined)

  // THE FAILURE VIEW'S OWN READ (406-01 · DETL-04, D-03/D-04). Held raw, like the chip read above,
  // because `projectAnalysisView` is pure and total — re-deriving it on render costs nothing and
  // keeps exactly one copy of the join.
  const [analysis, setAnalysis] = useState<AnalysisGetOutput | undefined>(undefined)

  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [artifactDrawerOpen, setArtifactDrawerOpen] = useState(false)
  const [artifactDrawerTab, setArtifactDrawerTab] = useState<ArtifactDrawerTab>("attributes")
  // WHICH cited artifact the drawer was opened with (406-08 · D-02). `null` for every other way in
  // — the `i` / `c` / `m` shortcuts and the navbar action all open the drawer with nothing in hand,
  // and the screenshot tab is not offered at all in that state.
  const [artifactDrawerSha, setArtifactDrawerSha] = useState<string | null>(null)
  const [artifactResponse, setArtifactResponse] = useState<RunArtifactResponse | null>(null)
  const [artifactLoading, setArtifactLoading] = useState(false)
  const [artifactError, setArtifactError] = useState<string | null>(null)
  const artifactLoadedRunIdRef = useRef<string | null>(null)
  const artifactRequestRef = useRef(0)

  const [activeTab, setActiveTab] = useState<string>(() => {
    const param = searchParams.get('tab')
    if (param === 'screenshot') return 'overview'
    return param ?? 'overview'
  })

  useEffect(() => {
    if (!run?.status) return
    recordRunDetailStatus?.(run.status)
  }, [recordRunDetailStatus, run?.status])

  // One read now, a 3 s poll while the chain is still moving, and the dedicated stream's frames as
  // triggers to read again — all of it inside `watchPostProcessing`. The page's whole part is to
  // subscribe for the id it was asked for, forget the previous run's answer when that id changes,
  // and hand back the disposer so nothing outlives the screen it was for.
  useEffect(() => {
    if (!id) return
    setPostProcessingRead(undefined)
    return watchPostProcessing(id, { onRead: setPostProcessingRead })
  }, [id])

  // THE CHIP WORD, AND NOTHING ELSE OFF THE FRAME (D-03, 404 D-17 applied a second time). A pushed
  // `watchPostProcessing` frame is a TRIGGER: it says the durable answer may have moved. Nothing a
  // frame carries is ever painted into a member's block — only `fetchRunAnalysis`'s result is.
  const analysisChip = postProcessingRead?.kind === 'read'
    ? postProcessingRead.status.chips.analysis
    : undefined

  // RE-READ ON EVERY TRANSITION OF THAT WORD, AND ON NO OTHER FRAME. The dependency list IS the
  // D-03 rule: `pending → running → done | failed` each move the value and re-run this effect,
  // while a repeated frame carrying the same word does not. No new socket, no new timer.
  //
  // A REJECTED READ LEAVES THE PREVIOUS ANSWER IN PLACE. Clearing on failure would blank a
  // sentence the reader is looking at because one poll hiccuped; the honest state of a failed
  // re-read is the last answer the op actually gave.
  //
  // ...BUT ONLY FOR THE RUN IT WAS AN ANSWER ABOUT (CR-02, measured 2026-08-29). The route is
  // `/runs/:id`, so a move from run A to run B changes the param WITHOUT remounting this page,
  // and `projectAnalysisView` joins on `perTest` / `testIndex` — an integer both runs have. So a
  // held answer does not go stale visibly; it JOINS, painting run A's sentence, provenance,
  // confidence, cited steps and cited artifact shas under run B's members. And the rejection rule
  // above made it permanent for the ordinary case, because the read answers 404 for a run with no
  // handoff: navigating from a run WITH an analysis to one WITHOUT left A's sentences on B's page
  // indefinitely, including this door's RESTORED secret values attributed to the wrong test.
  //
  // The sibling read above forgets the previous run on an id change for exactly this reason; the
  // same rule applies here.
  useEffect(() => { setAnalysis(undefined) }, [id])

  useEffect(() => {
    if (!id) return
    let cancelled = false
    void fetchRunAnalysis(id).then(
      // THE ANSWER MUST BE ABOUT THE RUN ON SCREEN. The reset above closes the in-flight window;
      // this closes the one an in-flight answer for the previous run would otherwise slip
      // through. Two guards, each documenting a different way the join goes silently wrong.
      (result) => { if (!cancelled && result.runId === id) setAnalysis(result) },
      () => { /* the previous answer FOR THIS RUN stands — a rejected fetch is not a paint input */ },
    )
    return () => { cancelled = true }
  }, [id, analysisChip])

  useEffect(() => {
    if (!id) return

    skippedInitialDefaultSelectionRef.current = null

    let cancelled = false
    let retryCount = 0
    // The bounded row catch-up below, so the effect's own teardown can disarm it. A page that
    // unmounted mid-catch-up and still woke up to fetch would be a request for a screen nobody
    // is looking at.
    let catchUpAttempts = 0
    let catchUpTimer: ReturnType<typeof setTimeout> | undefined

    async function loadRun() {
      try {
        const data = await fetchRun(id!)
        if (cancelled) return

        // THE BOUNCE, RE-KEYED (2026-08-26, Phase 404 · D-07, T-404-15).
        //
        // WHAT THIS REPLACED. Until 404 the loader began by reading `/api/execution/active` and
        // bounced to `/live` for any run in that set. D-07 retires that reading: an execution
        // stays "active" until its POST-RUN TAIL finishes, and the tail runs after the verdict —
        // so a viewer whom the live page had just moved here on the verdict (D-13) was thrown
        // straight back to `/live`, which navigated them here again. A ping-pong nobody can click
        // their way out of, for as long as curation takes.
        //
        // THE PREDICATE IS NOW THE ROW'S OWN STATUS, which the dashboard subscriber writes at the
        // `verdict` envelope. One producer, one fact.
        const rowIsLive = shouldRouteRunToLive(data.run.status)
        if (rowIsLive && arrivedOnVerdict === undefined) {
          navigate(routes.runLive(id!), { replace: true })
          return
        }

        setRun(data.run)

        // AND THE RACE THE PREDICATE CANNOT SEE. `updateRun` at `verdict` and this `fetchRun`
        // race by design — D-13 navigates on the ENVELOPE, the earliest honest moment, and the
        // durable row follows within milliseconds. An arrival carrying `arrivedOnVerdict` never
        // bounces on any attempt; it renders the row it got and re-asks on a bounded cadence
        // until the row reads terminal, so the header badge follows the row rather than freezing
        // on a stale `running`.
        if (rowIsLive && catchUpAttempts < VERDICT_ROW_CATCH_UP_MAX) {
          catchUpAttempts += 1
          catchUpTimer = setTimeout(() => { if (!cancelled) void loadRun() }, VERDICT_ROW_CATCH_UP_MS)
        }

        // ONE DURABLE READ, AND ONLY ONE (D-03/D-16). What stood here until 405-08 was a walk:
        // read the parent, then read every child run in a loop for its steps, then read the last
        // attempt again for ITS steps — N+2 requests to draw one page, each of them able to fail
        // on its own and silently drop a member (the `catch { // skip }` that used to sit in that
        // loop). `runs.detail` answers the whole run in one unpaged projection, so a member that
        // did not run arrives as a row rather than as an absence nobody noticed.
        //
        // A FAILED READ IS ITS OWN STATE, not a bounce and not an empty tree. The run row already
        // rendered above, so the header, the verdict and the failure banner stay; only the tree
        // says it could not be loaded.
        try {
          const projection = await fetchRunDetail(id!)
          if (cancelled) return
          setDetail(projection)
          const groups = filterGroups(
            groupRunDetail(projection),
            parseMemberFilter(searchParams.get("member")),
          )
          setSelection(getSelectionFromUrlOrFirst(displayStepsForGroups(groups), searchParams))
        } catch {
          if (cancelled) return
          setDetail(null)
          setSelection(null)
        }
      } catch (err) {
        if (cancelled) return
        if (err instanceof Error && err.message.includes("404")) {
          if (retryCount < 5) {
            retryCount++
            setTimeout(() => { if (!cancelled) loadRun() }, 1000)
            return
          }
          setNotFound(true)
        } else {
          toast.error("Failed to load run")
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    loadRun()
    return () => {
      cancelled = true
      if (catchUpTimer !== undefined) clearTimeout(catchUpTimer)
    }
  }, [id, navigate, arrivedOnVerdict])

  useEffect(() => {
    if (!id || isLoading) return
    let cancelled = false
    fetchExecutionLogs(id)
      .then(({ logs }) => {
        if (!cancelled) setAllExecutionLogs(logs)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [id, isLoading])

  // ONE READ FOR THE WHOLE KNOWLEDGE TAB (407-02 · D-03/D-05). Not a poll and not a subscription:
  // a run's served brief is a durable fact about a run that already happened, so it is read once
  // per id and never again. The Learned half moves with curation, which the chip read already
  // watches; 407-09 spends that trigger rather than adding a second timer here.
  //
  // A REJECTED READ IS A STATE, NOT A SWALLOWED ERROR. `runs.knowledge` answers its own absences
  // as RESULTS — a pruned handoff and a project with no store both arrive on the `read` arm — so
  // the only thing reaching the catch is a door that refused or fell over, and the tab says so
  // (D-06). Clearing to `undefined` would show a skeleton forever for a read that already failed.
  useEffect(() => {
    if (!id) return
    let cancelled = false
    setKnowledgeRead(undefined)
    fetchRunKnowledge(id)
      .then(projection => {
        if (!cancelled) setKnowledgeRead({ kind: 'read', projection })
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setKnowledgeRead({ kind: 'unavailable', error: err instanceof Error ? err.message : String(err) })
        }
      })
    return () => { cancelled = true }
  }, [id])

  const knowledgeView = useMemo(
    () => (knowledgeRead === undefined ? undefined : projectKnowledgeView(knowledgeRead)),
    [knowledgeRead],
  )

  useEffect(() => {
    artifactLoadedRunIdRef.current = null
    artifactRequestRef.current += 1
    setArtifactResponse(null)
    setArtifactError(null)
    setArtifactLoading(false)
  }, [run?.id])

  const loadArtifact = useCallback(async () => {
    if (!run?.id) return
    const requestId = artifactRequestRef.current + 1
    artifactRequestRef.current = requestId
    setArtifactLoading(true)
    setArtifactError(null)

    try {
      const response = await fetchRunArtifact(run.id)
      if (artifactRequestRef.current !== requestId) return
      artifactLoadedRunIdRef.current = run.id
      setArtifactResponse(response)
    } catch (err) {
      if (artifactRequestRef.current !== requestId) return
      setArtifactError(err instanceof Error ? err.message : "Failed to load artifact data")
    } finally {
      if (artifactRequestRef.current === requestId) {
        setArtifactLoading(false)
      }
    }
  }, [run?.id])

  useEffect(() => {
    if (!artifactDrawerOpen || !run?.id) return
    if (artifactLoading || artifactError) return
    if (artifactLoadedRunIdRef.current === run.id && artifactResponse) return
    void loadArtifact()
  }, [artifactDrawerOpen, artifactError, artifactLoading, artifactResponse, loadArtifact, run?.id])

  const openArtifactDrawer = useCallback((tab: ArtifactDrawerTab, sha?: string) => {
    setArtifactDrawerTab(tab)
    setArtifactDrawerSha(sha ?? null)
    setArtifactDrawerOpen(true)
  }, [])

  /**
   * Open a cited artifact where the reader already looks (406-08 · D-02, second half).
   *
   * THE PAGE OWNS THE DRAWER AND THE BLOCK OWNS NOTHING. `VerdictBlock` hands up a sha; this turns
   * it into the drawer's screenshot tab, and the drawer mints the URL through the one route minter.
   * No route, no window and no second URL spelling is created anywhere along that path.
   */
  const onCitedArtifact = useCallback((sha: string) => {
    openArtifactDrawer("screenshot", sha)
  }, [openArtifactDrawer])

  const memberFilter = parseMemberFilter(searchParams.get("member"))
  const groups = useMemo(
    () => (detail ? groupRunDetail(detail) : []),
    [detail],
  )
  const visibleGroups = useMemo(() => filterGroups(groups, memberFilter), [groups, memberFilter])
  // The op's bytes and the chip word, joined to member handles. The page composes no sentence.
  const analysisView = useMemo(
    () => projectAnalysisView(analysis, analysisChip),
    [analysis, analysisChip],
  )
  // CHROME KEYS ON THE RUN, NOT ON THE FILTER (D-16). A viewer who narrowed a five-member suite to
  // one member is still looking at a suite, and hiding the header and the picker would strand them
  // there with no way back.
  const hasMemberChrome = detail ? showMemberChrome(detail) : false
  const displaySteps = useMemo(() => displayStepsForGroups(visibleGroups), [visibleGroups])

  const selectedStep = useMemo(() => {
    if (!hasStepId(selection)) return null
    return displaySteps.find(s => s.id === selection.stepId) ?? null
  }, [selection, displaySteps])

  const accessibilityRunId = selectedStep?.rawRunId ?? run?.id ?? null

  useEffect(() => {
    if (!accessibilityRunId) {
      setAccessibilitySummary(null)
      return
    }
    setAccessibilitySummary(null)
    let cancelled = false
    fetchAccessibilitySummary(accessibilityRunId)
      .then((summary) => {
        if (!cancelled) setAccessibilitySummary(summary)
      })
      .catch(() => {
        if (!cancelled) setAccessibilitySummary(null)
      })
    return () => { cancelled = true }
  }, [accessibilityRunId])

  // THE SELECTED SUB-ACTION IS THE DURABLE ONE (405-11 · D-16).
  //
  // The tree selects by ordinal within the step, and the step now carries the projection's own
  // `subActions` in the producer's order, so the panel below reads the SAME row the tree
  // highlighted. Before this plan the panel read a v1 shape whose producer was already deleted, so
  // it resolved to nothing on every selection and the overview rendered its no-selection state for
  // runs that had recorded plenty.
  //
  // An ordinal that names no recorded sub-action resolves to `null` rather than throwing: `?sub=`
  // is hand-editable, and the failure mode of a wrong answer here is the step's own view, never a
  // crash.
  const selectedSubAction = useMemo<RunDetailSubAction | null>(() => {
    if (!isSubactionSelection(selection) || !selectedStep) return null
    return selectedStep.subActions?.[selection.subIndex] ?? null
  }, [selection, selectedStep])

  type NavItem =
    | { type: 'hook'; logId: string }
    | { type: 'step'; stepId: string }
    | { type: 'sub'; stepId: string; subIndex: number }
    | { type: 'exec'; stepId: string; logId: string }

  const expandedStepId = hasStepId(selection) ? selection.stepId : null

  const setupHooks = useMemo(() =>
    allExecutionLogs.filter(l => l.stepId === null && l.phase === 'setup'),
    [allExecutionLogs]
  )
  const teardownHooks = useMemo(() =>
    allExecutionLogs.filter(l => l.stepId === null && l.phase === 'teardown'),
    [allExecutionLogs]
  )
  const stepExecutionLogs = useMemo(() =>
    allExecutionLogs.filter(l => l.stepId !== null),
    [allExecutionLogs]
  )
  const selectedStepLogs = useMemo(() => {
    if (!selectedStep) return []
    return stepExecutionLogs.filter((log) => {
      if (log.stepId === selectedStep.id) return true
      if (!log.stepId) return false
      if (selectedStep.rawRunId && log.runId && selectedStep.rawRunId !== log.runId) return false
      return Number.parseInt(log.stepId, 10) === selectedStep.rawStepOrder
    })
  }, [stepExecutionLogs, selectedStep])
  const selectedHookLog = useMemo(() =>
    selection?.type === 'hook'
      ? allExecutionLogs.find(l => l.id === selection.hookId) ?? null
      : null,
    [selection, allExecutionLogs]
  )
  const selectedExecutionLog = useMemo(() =>
    selection?.type === 'execution'
      ? allExecutionLogs.find(l => l.id === selection.logId) ?? null
      : null,
    [selection, allExecutionLogs]
  )

  const navItems = useMemo(() => {
    const items: NavItem[] = []

    // Run-level setup hooks
    for (const hook of setupHooks) {
      items.push({ type: 'hook', logId: hook.id })
    }

    // ONE FLAT ORDER, AND IT IS ALREADY THE TREE'S (405-08). `displaySteps` comes out of the
    // member-grouped projection in handle-then-ordinal order, so keyboard navigation walks the
    // tree exactly as drawn without a second grouping pass to keep in step with the first.
    for (const step of displaySteps) {
      items.push({ type: 'step', stepId: step.id })
      if (step.id === expandedStepId) {
        for (const log of stepExecutionLogs) {
          if (log.stepId === step.id) items.push({ type: 'exec', stepId: step.id, logId: log.id })
        }
        for (const sub of step.subActions ?? []) {
          items.push({ type: 'sub', stepId: step.id, subIndex: sub.subActionIndex })
        }
      }
    }

    // Run-level teardown hooks
    for (const hook of teardownHooks) {
      items.push({ type: 'hook', logId: hook.id })
    }
    return items
  }, [displaySteps, expandedStepId, stepExecutionLogs, setupHooks, teardownHooks])

  const currentNavIdx = useMemo(() => {
    if (!selection) return -1
    return navItems.findIndex(item => {
      if (selection.type === 'hook' && item.type === 'hook') return item.logId === selection.hookId
      if (selection.type === 'step' && item.type === 'step') return item.stepId === selection.stepId
      if (selection.type === 'subaction' && item.type === 'sub')
        return item.stepId === selection.stepId && item.subIndex === selection.subIndex
      if (selection.type === 'execution' && item.type === 'exec')
        return item.logId === selection.logId
      return false
    })
  }, [navItems, selection])

  function navItemToSelection(item: NavItem): Selection {
    if (item.type === 'hook') return { type: 'hook', hookId: item.logId }
    if (item.type === 'step') return { type: 'step', stepId: item.stepId }
    if (item.type === 'exec') return { type: 'execution', stepId: item.stepId, logId: item.logId }
    return { type: 'subaction', stepId: item.stepId, subIndex: item.subIndex }
  }

  const TAB_NAMES = ['overview', 'env', 'network', 'console', 'aria', 'a11y', 'knowledge'] as const

  const shortcuts = useMemo(() => {
    const map: Record<string, (e: KeyboardEvent) => void> = {
      arrowdown: () => {
        if (navItems.length === 0) return
        if (currentNavIdx === -1) {
          setSelection(navItemToSelection(navItems[0]))
        } else {
          const next = Math.min(currentNavIdx + 1, navItems.length - 1)
          setSelection(navItemToSelection(navItems[next]))
        }
      },
      arrowup: () => {
        if (navItems.length === 0) return
        if (currentNavIdx === -1) {
          setSelection(navItemToSelection(navItems[navItems.length - 1]))
        } else {
          const prev = Math.max(currentNavIdx - 1, 0)
          setSelection(navItemToSelection(navItems[prev]))
        }
      },
      j: () => { map.arrowdown({} as KeyboardEvent) },
      k: () => { map.arrowup({} as KeyboardEvent) },
      'shift+arrowdown': () => {
        if (navItems.length === 0) return
        const nextStepIdx = navItems.findIndex((item, i) => i > currentNavIdx && item.type === 'step')
        if (nextStepIdx !== -1) setSelection(navItemToSelection(navItems[nextStepIdx]))
      },
      'shift+arrowup': () => {
        if (navItems.length === 0) return
        let prevStepIdx = -1
        for (let i = currentNavIdx - 1; i >= 0; i--) {
          if (navItems[i].type === 'step') { prevStepIdx = i; break }
        }
        if (prevStepIdx !== -1) setSelection(navItemToSelection(navItems[prevStepIdx]))
      },
      '1': () => setActiveTab(TAB_NAMES[0]),
      '2': () => setActiveTab(TAB_NAMES[1]),
      '3': () => setActiveTab(TAB_NAMES[2]),
      '4': () => setActiveTab(TAB_NAMES[3]),
      '5': () => setActiveTab(TAB_NAMES[4]),
      '6': () => setActiveTab(TAB_NAMES[5]),
      '7': () => setActiveTab(TAB_NAMES[6]),
      i: () => openArtifactDrawer("attributes"),
      c: () => openArtifactDrawer("config"),
      // `M` RE-POINTED, NOT RETIRED (407 D-02). The v1 memory drawer tab this key opened is dead
      // debris that 407-05 deletes grep-clean; re-pointing it here rather than there means the
      // shortcut is never dead for the length of a plan, and the muscle memory lands on the
      // surface that actually holds this run's memory story.
      m: () => setActiveTab('knowledge'),
      r: () => {
        if (!run) return
        const wasLocal = run.attributes["agent-qa.runner"] === "local"
        triggerRun({ file: run.filePath ?? run.name, local: wasLocal })
          .then((result) => {
            toast.success("Re-run started")
            navigate(routes.runLive(result.runId))
          })
          .catch(() => toast.error("Failed to start re-run"))
      },
      escape: () => {
        if (artifactDrawerOpen) setArtifactDrawerOpen(false)
        else setSelection(null)
      },
      'shift+?': () => setShortcutsOpen(prev => !prev),
      'shift+!': () => pipelineRef.current?.togglePhase(0),
      'shift+@': () => pipelineRef.current?.togglePhase(1),
      'shift+#': () => pipelineRef.current?.togglePhase(2),
      'shift+$': () => pipelineRef.current?.togglePhase(3),
    }
    return map
  }, [navItems, currentNavIdx, selection, run, navigate, artifactDrawerOpen, pipelineRef, openArtifactDrawer])

  useKeyboardShortcuts(shortcuts)

  // Sync selection + tab to URL
  //
  // THE STEP PARAM IS THE SELECTION KEY ITSELF (405-08 · D-16) — `<testIndex>:<stepIndex>`, the
  // same string the tree highlights by, so the round-trip is an identity rather than a
  // translation. `?run=` is DELETED rather than left dormant: it named a child run id, and after
  // 405-07 there are no child runs to name; a stale one in a bookmarked link must not survive into
  // the rewritten query.
  useEffect(() => {
    const step = hasStepId(selection)
      ? displaySteps.find(s => s.id === selection.stepId)
      : null

    const next = new URLSearchParams(searchParams)
    if (step) {
      next.set('step', step.id)
    } else {
      next.delete('step')
    }
    next.delete('run')
    if (isSubactionSelection(selection)) {
      next.set('sub', String(selection.subIndex))
    } else {
      next.delete('sub')
    }
    if (activeTab !== 'overview') {
      next.set('tab', activeTab)
    } else {
      next.delete('tab')
    }

    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true })
    }
  }, [selection, activeTab, displaySteps, searchParams, setSearchParams])

  // Scroll selected item into view
  useEffect(() => {
    if (!hasStepId(selection)) return
    const container = stepTreeScrollRef.current
    if (!container) return

    const isDefaultInitialStepSelection =
      selection.type === 'step' &&
      !searchParams.has('step') &&
      !searchParams.has('sub') &&
      displaySteps[0]?.id === selection.stepId

    if (isDefaultInitialStepSelection) {
      skippedInitialDefaultSelectionRef.current = selection.stepId
      return
    }

    skippedInitialDefaultSelectionRef.current = null

    const selector = selection.type === 'step'
      ? `[data-step-id="${selection.stepId}"]`
      : selection.type === 'execution'
      ? `[data-execution-id="${selection.logId}"]`
      : isSubactionSelection(selection)
      ? `[data-sub-action-id="${selection.stepId}-${selection.subIndex}"]`
      : null

    if (!selector) return

    const animationFrameId = requestAnimationFrame(() => {
      const el = container.querySelector<HTMLElement>(selector)
      if (el) {
        scrollElementIntoContainerView(container, el)
      }
    })

    return () => cancelAnimationFrame(animationFrameId)
  }, [selection, displaySteps, searchParams])

  /**
   * Narrow the tree to one member, or widen it back (D-16).
   *
   * THE FILTER IS URL STATE AND NOTHING ELSE. There is no second copy in React state to fall out
   * of step with the address bar, and no fetch: the projection for the whole run is already in
   * hand, so narrowing is a `filter` over it. That is the difference from what stood here — the
   * suite picker re-fetched a child run and its logs on every change, so a link into one member
   * showed a different page than clicking to it.
   */
  const handleMemberFilterChange = useCallback((value: string) => {
    const next = new URLSearchParams(searchParams)
    if (value === MEMBER_FILTER_ALL) next.delete('member')
    else next.set('member', value)
    // The selected step may belong to a member this filter just hid; the tree re-derives the
    // selection from the URL below, and an unrenderable key falls back to the first visible step.
    setSearchParams(next, { replace: false })
  }, [searchParams, setSearchParams])

  /**
   * Jump to a step the verdict cited (406-06 · D-02, first half).
   *
   * IT MINTS NO ID AND NO SCROLLER. The step key is `runDetailStepKey`'s — the one spelling the
   * tree renders as `data-step-id`, the panels resolve by, and the `?step=` deep link round-trips
   * through — so this is a `setSelection` and nothing more; the page's existing scroll-into-view
   * effect finds the row inside `stepTreeScrollRef`. A second flattening or a second id spelling
   * here would be the exact drift `displayStepsForGroups` exists to prevent.
   *
   * A CITED INDEX WITH NO STEP IS A NO-OP (T-406-18). The ordinals come off the producer's own
   * evidence, and a verdict citing a step this run never recorded must not select a row that is not
   * there, nor throw. The existence check is against ALL groups rather than the visible ones, which
   * is what distinguishes "the filter is hiding it" from "it does not exist".
   *
   * AND WHEN THE FILTER IS HIDING IT, THE FILTER WIDENS FIRST. Selecting a step outside the visible
   * tree would be undone one effect later by the guard below, which pulls the selection back to the
   * first visible row — so the reader would click a cited step and land somewhere else entirely.
   */
  const onCitedStep = useCallback((testIndex: number, stepIndex: number) => {
    const stepId = runDetailStepKey(testIndex, stepIndex)
    const exists = groups.some(
      (entry) =>
        entry.member.testIndex === testIndex
        && entry.steps.some(({ step }) => step.stepIndex === stepIndex),
    )
    if (!exists) return

    if (!displaySteps.some((step) => step.id === stepId)) {
      const next = new URLSearchParams(searchParams)
      next.delete('member')
      setSearchParams(next, { replace: false })
    }
    setSelection({ type: 'step', stepId })
  }, [groups, displaySteps, searchParams, setSearchParams])

  /**
   * Narrow the tree to a cluster sibling's own group (406-06 · D-08).
   *
   * THE FILTER'S OWN SPELLING, NOT A SECOND ONE. `?member=<testIndex>` is what the picker writes
   * and what `parseMemberFilter` reads, so a sibling link and the picker are the same control
   * reached two ways — and the link is shareable for free.
   */
  const onSelectMember = useCallback((testIndex: number) => {
    const next = new URLSearchParams(searchParams)
    next.set('member', String(testIndex))
    setSearchParams(next, { replace: false })
  }, [searchParams, setSearchParams])

  // Keep the selection inside the visible tree. A member filter (or a deep link into a member that
  // is filtered out) can leave `selection` pointing at a step nobody can see, and a highlighted row
  // with no row is a panel showing details for something off-screen.
  useEffect(() => {
    if (isLoading) return
    if (!hasStepId(selection)) return
    if (displaySteps.some((step) => step.id === selection.stepId)) return
    setSelection(displaySteps.length > 0 ? { type: 'step', stepId: displaySteps[0].id } : null)
  }, [displaySteps, selection, isLoading])

  if (isLoading) return <DetailSkeleton />

  if (notFound || !run) {
    return (
      <EmptyState
        icon={FileSearch}
        title="Run not found"
        description="This test run doesn't exist or has been deleted"
        actionLabel="View All Runs"
        onAction={() => navigate(routes.runs)}
      />
    )
  }

  return (
    <TooltipProvider>
      <div className="flex h-full min-h-0 flex-col overflow-hidden">
        <RunNavbar
          run={run}
          tokens={detail?.tokens}
          shortcutsOpen={shortcutsOpen}
          onToggleShortcuts={() => setShortcutsOpen(prev => !prev)}
          onOpenArtifacts={openArtifactDrawer}
          onCurationClick={() => setActiveTab('knowledge')}
          hasPostProcessing
          postProcessing={
            postProcessingRead === undefined ? undefined : projectPostProcessingView(postProcessingRead)
          }
        />

        <ResizablePanelGroup
          orientation="horizontal"
          className="min-h-0 flex-1 overflow-hidden"
        >
          <ResizablePanel defaultSize={35} minSize={20}>
            <div ref={stepTreeScrollRef} className="flex h-full min-h-0 min-w-0 flex-col overflow-y-auto">
              {/*
                THE MEMBER FILTER (D-16). What stood here was a picker over CHILD RUNS that
                re-fetched one on every change, and beside it an attempts tab strip that re-fetched
                a whole earlier attempt. D-17 retires the attempts picker outright — the projection
                keeps the FINAL attempt's steps per handle plus a count, and the attempt-by-attempt
                story stays in the run's own event log. So one control remains, it fetches nothing,
                and it is absent entirely on a single-member run.
              */}
              {hasMemberChrome ? (
                <div className="border-b px-3 py-2 shrink-0">
                  <Select
                    value={memberFilter === MEMBER_FILTER_ALL ? MEMBER_FILTER_ALL : String(memberFilter)}
                    onValueChange={handleMemberFilterChange}
                  >
                    <SelectTrigger className="w-full h-8 text-xs" data-member-filter>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={MEMBER_FILTER_ALL}>
                        All tests ({groups.length})
                      </SelectItem>
                      {groups.map(({ member }) => (
                        <SelectItem key={member.testIndex} value={String(member.testIndex)}>
                          {memberDisplayName(member)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}

              {run.status === 'failed' && run.failureSummary && (
                <FailureBanner summary={run.failureSummary} />
              )}

              {run.status === 'failed' && run.errorLog && (
                <Collapsible className="mx-2 mt-1">
                  <CollapsibleTrigger className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors group w-full">
                    <ChevronRight className="h-3 w-3 transition-transform group-data-[state=open]:rotate-90" />
                    <span>Error Details</span>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <pre className="mt-1 text-xs font-mono bg-muted/30 border border-border/50 rounded-[2px] px-3 py-2 overflow-x-auto whitespace-pre-wrap max-h-60 overflow-y-auto text-foreground/70 select-text">
                      {run.errorLog}
                    </pre>
                  </CollapsibleContent>
                </Collapsible>
              )}

              {run.memoryLog && (() => {
                const mem = JSON.parse(run.memoryLog) as {
                  added: number; confirmed: number; deprecated: number
                  errors: string[]; curatorDuration: number
                  tokenUsage?: { promptTokens: number; completionTokens: number; totalTokens: number }
                }
                return (
                  <Collapsible className="mx-2 mt-1">
                    <CollapsibleTrigger className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors group w-full">
                      <ChevronRight className="h-3 w-3 transition-transform group-data-[state=open]:rotate-90" />
                      <span>Memory</span>
                      <span className="ml-1 text-[10px] opacity-60">
                        {mem.added}A {mem.confirmed}C {mem.deprecated}D
                      </span>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="mt-1 grid grid-cols-2 gap-x-6 gap-y-1 text-xs px-3 py-2 bg-muted/30 border border-border/50 rounded-[2px]">
                        <div className="flex justify-between"><span className="text-muted-foreground">Added</span><span className="font-mono">{mem.added}</span></div>
                        <div className="flex justify-between"><span className="text-muted-foreground">Confirmed</span><span className="font-mono">{mem.confirmed}</span></div>
                        <div className="flex justify-between"><span className="text-muted-foreground">Deprecated</span><span className="font-mono">{mem.deprecated}</span></div>
                        <div className="flex justify-between"><span className="text-muted-foreground">Errors</span><span className="font-mono">{mem.errors.length}</span></div>
                        <div className="flex justify-between"><span className="text-muted-foreground">Curator Duration</span><span className="font-mono">{(mem.curatorDuration / 1000).toFixed(1)}s</span></div>
                        <div className="flex justify-between"><span className="text-muted-foreground">Tokens</span><span className="font-mono">{mem.tokenUsage ? `${formatTokens(mem.tokenUsage.promptTokens)} / ${formatTokens(mem.tokenUsage.completionTokens)}` : '\u2014'}</span></div>
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                )
              })()}

              {detail === null ? (
                <div
                  data-run-detail-error
                  className="flex-1 flex items-center justify-center px-4 text-center text-sm text-muted-foreground"
                >
                  {RUN_DETAIL_UNAVAILABLE_LABEL}
                </div>
              ) : (
                <StepTree
                  groups={visibleGroups}
                  showMemberChrome={hasMemberChrome}
                  analysisView={analysisView}
                  onCitedStep={onCitedStep}
                  onSelectMember={onSelectMember}
                  onCitedArtifact={onCitedArtifact}
                  selection={selection}
                  onSelect={setSelection}
                  setupHooks={setupHooks}
                  teardownHooks={teardownHooks}
                  inlineLogs={stepExecutionLogs}
                />
              )}
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle />

          <ResizablePanel defaultSize={65} minSize={30} data-tour-id="tour-run-detail-reasoning">
            <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
              {selection?.type === 'hook' && selectedHookLog ? (
                <HookDetailPanel log={selectedHookLog} />
              ) : selection?.type === 'execution' && selectedExecutionLog ? (
                <HookDetailPanel log={selectedExecutionLog} />
              ) : (
                <TabPanels
                  activeTab={activeTab}
                  onTabChange={setActiveTab}
                  step={selectedStep}
                  subAction={selectedSubAction}
                  runId={selectedStep?.rawRunId ?? run.id}
                  allSteps={displaySteps}
                  executionLogs={selectedStepLogs}
                  accessibilitySummary={accessibilitySummary}
                  platform={run.platform}
                  pipelineRef={pipelineRef}
                  knowledge={knowledgeView}
                />
              )}
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>

        {artifactDrawerOpen ? (
          <ArtifactDrawer
            run={run}
            open={artifactDrawerOpen}
            tab={artifactDrawerTab}
            screenshotSha={artifactDrawerSha}
            response={artifactResponse}
            loading={artifactLoading}
            error={artifactError}
            onOpenChange={setArtifactDrawerOpen}
            onTabChange={setArtifactDrawerTab}
            onRetry={loadArtifact}
          />
        ) : null}

      </div>
    </TooltipProvider>
  )
}
