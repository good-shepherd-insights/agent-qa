import { useCallback, useEffect, useState, type ComponentType } from "react"
import { useNavigate, useParams, useSearchParams } from "react-router"

import { Button } from "@/components/ui/button"
import { Tabs, TabsContent } from "@/components/ui/tabs"
import { FormSkeleton } from "@/components/page-skeleton"
import { fetchAppMetadata, fetchConfig } from "@/lib/api"
import { usePageTitle } from "@/hooks/use-page-title"
import {
  CONFIG_SECTIONS,
  CONFIG_TABS,
  configTabPath,
  resolveConfigTab,
  resolveLegacyConfigLink,
  type ConfigSectionId,
  type ConfigTab,
} from "@/lib/config-tabs"
import {
  CONFIG_LOAD_FAILED_TITLE,
  CONFIG_PAGE_TITLE,
  CONFIG_SECTION_LABELS,
  LEGACY_LINK_NOT_FOUND_TEXT,
  RELOAD_CONFIG_LABEL,
  configLoadFailedBody,
} from "@/lib/config-copy"
import { ConfigLineNotice } from "@/components/config-manager/config-section-shell"
import { ConfigTabBar } from "@/components/config-manager/config-tabs"
import { LlmSection } from "@/components/config-manager/llm-section"
import { TimeoutSection } from "@/components/config-manager/timeout-section"
import { CacheSection } from "@/components/config-manager/cache-section"
import { AuthStatesSection } from "@/components/config-manager/auth-states-section"
import { LoggingSection } from "@/components/config-manager/logging-section"
import { BrowserSection } from "@/components/config-manager/browser-section"
import { RecordingSection } from "@/components/config-manager/recording-section"
import { AccessibilitySection } from "@/components/config-manager/accessibility-section"
import { PlannerSection } from "@/components/config-manager/planner-section"
import { DashboardSection } from "@/components/config-manager/dashboard-section"
import { TestMatchSection } from "@/components/config-manager/test-match-section"
import { FilesSection } from "@/components/config-manager/files-section"
import { LogCaptureSection } from "@/components/config-manager/log-capture-section"
import { ExecutionDefaultsSection } from "@/components/config-manager/execution-defaults-section"
import { MobileSection } from "@/components/config-manager/mobile-section"
import { KnowledgeSection } from "@/components/config-manager/knowledge-section"
import { VisionSection } from "@/components/config-manager/vision-section"
import { TargetsSection } from "@/components/config-manager/targets-section"
import { DevicesSection } from "@/components/config-manager/devices-section"
import { ProvidersSection } from "@/components/config-manager/providers-section"
import { AnalyticsSection } from "@/components/config-manager/analytics-section"

interface SectionProps {
  config: Record<string, unknown>
  onConfigChange: () => void
}

const SECTION_COMPONENTS: Partial<Record<ConfigSectionId, readonly ComponentType<SectionProps>[]>> = {
  models: [LlmSection, ExecutionDefaultsSection],
  "screenshot-size": [VisionSection],
  "planner-limits": [PlannerSection],
  targets: [TargetsSection],
  devices: [DevicesSection],
  "device-farms": [ProvidersSection],
  "login-states": [AuthStatesSection],
  "mobile-app-state": [MobileSection],
  browser: [BrowserSection],
  timeouts: [TimeoutSection],
  cache: [CacheSection],
  recording: [RecordingSection],
  accessibility: [AccessibilitySection],
  "log-capture": [LogCaptureSection],
  "test-discovery": [TestMatchSection],
  files: [FilesSection],
  knowledge: [KnowledgeSection],
  dashboard: [DashboardSection],
  logging: [LoggingSection],
  "pass-rate-scope": [AnalyticsSection],
}

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; reason: string }
  | { kind: "ready"; config: Record<string, unknown> }

function configSectionHeadingId(section: ConfigSectionId): string {
  return `config-section-${section}-heading`
}

function sectionBelongsTo(tab: ConfigTab, section: string): section is ConfigSectionId {
  return (CONFIG_SECTIONS[tab] as readonly string[]).includes(section)
}

function loadFailureReason(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  return text.trim().replace(/[.\s]+$/, "")
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false
}

export default function ConfigPage() {
  usePageTitle(CONFIG_PAGE_TITLE)
  const navigate = useNavigate()
  const { tab: tabParam } = useParams()
  const [searchParams] = useSearchParams()
  const [state, setState] = useState<LoadState>({ kind: "loading" })
  const [appVersion, setAppVersion] = useState<string | null>(null)
  const [showLegacyNotice, setShowLegacyNotice] = useState(false)

  const resolvedTab = resolveConfigTab(tabParam)
  const tab: ConfigTab = resolvedTab ?? "models"
  const sectionParam = searchParams.get("section")
  const versionText = appVersion ? `agent-qa v${appVersion}` : "agent-qa version unavailable"

  useEffect(() => {
    const legacy = resolveLegacyConfigLink(searchParams)
    if (legacy.kind === "mapped") {
      navigate(configTabPath(legacy.tab, legacy.section), { replace: true })
      return
    }
    const unknownLink =
      legacy.kind === "unknown" ||
      (tabParam !== undefined && resolvedTab === undefined) ||
      (resolvedTab !== undefined && sectionParam !== null && !sectionBelongsTo(resolvedTab, sectionParam))
    if (unknownLink) {
      setShowLegacyNotice(true)
      navigate(configTabPath("models"), { replace: true })
      return
    }
    if (tabParam === undefined) {
      navigate(configTabPath("models"), { replace: true })
    }
  }, [navigate, resolvedTab, searchParams, sectionParam, tabParam])

  const loadConfig = useCallback(async () => {
    try {
      const res = await fetchConfig()
      setState({ kind: "ready", config: res.config })
    } catch (error) {
      setState({ kind: "error", reason: loadFailureReason(error) })
    }
  }, [])

  useEffect(() => {
    void loadConfig()
  }, [loadConfig])

  useEffect(() => {
    let active = true

    async function loadAppMetadata() {
      try {
        const metadata = await fetchAppMetadata()
        const version = metadata.version.trim()
        if (active) setAppVersion(version || null)
      } catch {
        if (active) setAppVersion(null)
      }
    }

    loadAppMetadata()

    return () => {
      active = false
    }
  }, [])

  const ready = state.kind === "ready"

  useEffect(() => {
    if (!ready || resolvedTab === undefined || sectionParam === null) return
    if (!sectionBelongsTo(resolvedTab, sectionParam)) return
    const heading = document.getElementById(configSectionHeadingId(sectionParam))
    if (heading) {
      heading.scrollIntoView?.({ block: "start", behavior: prefersReducedMotion() ? "auto" : "smooth" })
      heading.focus({ preventScroll: true })
    }
    navigate(configTabPath(resolvedTab), { replace: true })
  }, [navigate, ready, resolvedTab, sectionParam])

  function handleTabChange(value: string) {
    const next = resolveConfigTab(value)
    if (next === undefined || next === tab) return
    setShowLegacyNotice(false)
    navigate(configTabPath(next))
  }

  function reloadConfig() {
    setState({ kind: "loading" })
    void loadConfig()
  }

  if (state.kind === "loading") {
    return (
      <div data-config-page data-config-state="loading">
        <FormSkeleton />
      </div>
    )
  }

  return (
    <div data-config-page data-config-state={state.kind} className="max-w-4xl">
      <h1 className="text-2xl font-semibold tracking-tight">{CONFIG_PAGE_TITLE}</h1>

      {showLegacyNotice ? (
        <ConfigLineNotice data-config-invalid-notice className="mt-6">
          {LEGACY_LINK_NOT_FOUND_TEXT}
        </ConfigLineNotice>
      ) : null}

      {state.kind === "error" ? (
        <ConfigLineNotice data-config-load-error className="mt-6 space-y-2">
          <p className="text-sm font-medium text-foreground">{CONFIG_LOAD_FAILED_TITLE}</p>
          <p className="text-xs">{configLoadFailedBody(state.reason)}</p>
          <Button type="button" variant="outline" size="sm" onClick={reloadConfig}>
            {RELOAD_CONFIG_LABEL}
          </Button>
        </ConfigLineNotice>
      ) : (
        <Tabs value={tab} onValueChange={handleTabChange} className="mt-6">
          <ConfigTabBar tab={tab} />
          {CONFIG_TABS.map((id) => (
            <TabsContent
              key={id}
              value={id}
              data-config-panel={id}
              data-tour-id="tour-config-section"
              className="space-y-8 pt-6"
            >
              {CONFIG_SECTIONS[id].map((section) => {
                const components = SECTION_COMPONENTS[section]
                if (!components) return null
                const headingId = configSectionHeadingId(section)
                return (
                  <section
                    key={section}
                    data-config-section={section}
                    aria-labelledby={headingId}
                    className="space-y-4"
                  >
                    <h2
                      id={headingId}
                      tabIndex={-1}
                      className="rounded-sm text-base font-medium leading-snug outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    >
                      {CONFIG_SECTION_LABELS[section]}
                    </h2>
                    {components.map((Component, index) => (
                      <Component key={index} config={state.config} onConfigChange={loadConfig} />
                    ))}
                  </section>
                )
              })}
            </TabsContent>
          ))}
        </Tabs>
      )}

      <p
        data-config-app-version
        className="mt-6 border-t border-border pt-3 text-[11px] font-mono text-muted-foreground/70"
      >
        {versionText}
      </p>
    </div>
  )
}
