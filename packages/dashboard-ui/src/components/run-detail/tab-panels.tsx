import { useRef, useEffect } from "react"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { ScrollArea } from "@/components/ui/scroll-area"
import { TabOverview } from "./tab-overview"
import type { ScreenshotEmptyState } from "./tab-overview"
import { TabEnv } from "./tab-env"
import { TabNetwork } from "./tab-network"
import { TabConsole } from "./tab-console"
import { TabAriaTree } from "./tab-aria-tree"
import { TabA11y } from "./tab-a11y"
import { TabKnowledge } from "./tab-knowledge"
import type { AccessibilitySummary, ExecutionLogEntry } from "@/lib/api"
import type { KnowledgeView } from "@/lib/knowledge-view"
import type { DisplayStep } from "@/lib/display-step"
import type { ReasoningPipelineHandle } from "@/components/reasoning-pipeline"
import type { RunDetailSubAction } from "@vostride/agent-qa-schema"

interface TabPanelsProps {
  activeTab: string
  onTabChange: (tab: string) => void
  step: DisplayStep | null
  subAction: RunDetailSubAction | null
  runId: string | null
  allSteps: DisplayStep[]
  executionLogs?: ExecutionLogEntry[]
  accessibilitySummary?: AccessibilitySummary | null
  platform?: string
  screenshotEmptyState?: ScreenshotEmptyState
  pipelineRef?: React.RefObject<ReasoningPipelineHandle | null>
  /**
   * The Knowledge tab's whole input (407-02 · D-01). `undefined` is the read that has not landed
   * — the page owns the one `runs.knowledge` client, and this component paints what it is handed.
   */
  knowledge?: KnowledgeView | undefined
}

export function TabPanels({
  activeTab,
  onTabChange,
  step,
  subAction,
  runId,
  allSteps,
  executionLogs = [],
  accessibilitySummary,
  platform,
  screenshotEmptyState = "absent",
  pipelineRef,
  knowledge,
}: TabPanelsProps) {
  const hasExecutionLogs = executionLogs.length > 0
  const consoleScrollRef = useRef<HTMLDivElement>(null)
  const networkScrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (activeTab !== 'console' && activeTab !== 'network') return
    const ref = activeTab === 'console' ? consoleScrollRef : networkScrollRef
    requestAnimationFrame(() => {
      const viewport = ref.current?.querySelector('[data-slot="scroll-area-viewport"]')
      if (viewport) viewport.scrollTop = viewport.scrollHeight
    })
  }, [activeTab, step?.id])

  if (!step) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        Select a step to view details
      </div>
    )
  }

  return (
    <Tabs
      value={activeTab}
      onValueChange={onTabChange}
      className="flex h-full min-h-0 flex-col overflow-hidden gap-0"
    >
      <TabsList variant="line" className="w-full justify-start border-b px-3 h-9 shrink-0 rounded-none">
        <TabsTrigger value="overview" className="text-xs rounded-none flex-initial">Overview</TabsTrigger>
        <TabsTrigger value="env" className="text-xs rounded-none flex-initial">Variables</TabsTrigger>
        <TabsTrigger value="network" className="text-xs rounded-none flex-initial">Network</TabsTrigger>
        <TabsTrigger value="console" className="text-xs rounded-none flex-initial">
          {hasExecutionLogs ? 'stdout' : 'Console'}
        </TabsTrigger>
        <TabsTrigger value="aria" className="text-xs rounded-none flex-initial">ARIA Tree</TabsTrigger>
        <TabsTrigger value="a11y" className="text-xs rounded-none flex-initial">A11y</TabsTrigger>
        {/*
          THE TRIGGER IS STATIC TAB METADATA (UI-SPEC, Knowledge tab trigger). It renders with its
          six siblings whatever the `runs.knowledge` read is doing: the loading state and the error
          state both live INSIDE the content, so the tab is always selectable and never lies about
          whether there is something behind it.
        */}
        <TabsTrigger value="knowledge" className="text-xs rounded-none flex-initial">Knowledge</TabsTrigger>
      </TabsList>

      <TabsContent value="overview" className="flex-1 min-h-0">
        <ScrollArea className="h-full">
          <TabOverview
            step={step}
            subAction={subAction}
            runId={runId}
            screenshotEmptyState={screenshotEmptyState}
            pipelineRef={pipelineRef}
          />
        </ScrollArea>
      </TabsContent>

      <TabsContent value="env" className="flex-1 min-h-0">
        <ScrollArea className="h-full">
          <TabEnv step={step} executionLogs={executionLogs} />
        </ScrollArea>
      </TabsContent>

      <TabsContent value="network" className="flex-1 min-h-0">
        <div ref={networkScrollRef} className="h-full">
          <ScrollArea className="h-full">
            <TabNetwork step={step} allSteps={allSteps} platform={platform} />
          </ScrollArea>
        </div>
      </TabsContent>

      <TabsContent value="console" className="flex-1 min-h-0">
        <div ref={consoleScrollRef} className="h-full">
          <ScrollArea className="h-full">
            <TabConsole step={step} allSteps={allSteps} executionLogs={executionLogs} isHookStep={hasExecutionLogs} />
          </ScrollArea>
        </div>
      </TabsContent>

      <TabsContent value="aria" className="flex flex-1 min-h-0 overflow-hidden">
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <TabAriaTree step={step} />
        </div>
      </TabsContent>

      <TabsContent value="a11y" className="flex-1 min-h-0">
        <ScrollArea className="h-full">
          <TabA11y step={step} summary={accessibilitySummary} />
        </ScrollArea>
      </TabsContent>

      <TabsContent value="knowledge" className="flex-1 min-h-0">
        <ScrollArea className="h-full">
          <TabKnowledge view={knowledge} />
        </ScrollArea>
      </TabsContent>
    </Tabs>
  )
}
