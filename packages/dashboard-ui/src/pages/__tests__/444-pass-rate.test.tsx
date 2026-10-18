// @vitest-environment jsdom

import { act, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { MemoryRouter, Route, Routes } from "react-router"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { InsightsBreakdownTable } from "@/components/insights/insights-breakdown-table"
import type { InsightsBreakdownRow } from "@/lib/api"
import SuiteViewerPage from "@/pages/suite-viewer"
import TestViewerPage from "@/pages/test-viewer"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { chartData } = vi.hoisted(() => ({ chartData: [] as unknown[] }))

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))
vi.mock("@/hooks/use-page-title", () => ({ usePageTitle: () => {} }))
vi.mock("@/hooks/use-run-config", () => ({
  useRunConfig: () => ({ defaultRunMode: "local", hasFarm: false, isLoading: false }),
}))
vi.mock("@/components/monaco-editor", () => ({ MonacoEditor: () => <div /> }))
vi.mock("@/components/visual-builder", () => ({ VisualBuilder: () => <div /> }))
vi.mock("@/components/suite-visual-builder", () => ({ SuiteVisualBuilder: () => <div /> }))
vi.mock("@/components/test-navbar", () => ({ TestNavbar: () => <div /> }))
vi.mock("@/components/suite-navbar", () => ({ SuiteNavbar: () => <div /> }))
vi.mock("@/components/pass-rate-chart", () => ({
  PassRateChart: ({ data }: { data: unknown }) => {
    chartData.push(data)
    return <div data-testid="pass-rate-chart" />
  },
}))
vi.mock("@/components/duration-chart", () => ({ DurationChart: () => <div /> }))

const EM_DASH = "—"

const VIEWED_TEST = {
  path: "tests/checkout.yaml",
  testId: "t_checkout",
  content: "name: Checkout flow\ntest-id: t_checkout\nsteps:\n  - open the cart\n",
}

const VIEWED_SUITE = {
  path: "suites/nightly.yaml",
  suiteId: "s_nightly",
  content: "suite-id: s_nightly\nname: Nightly suite\ntarget: web\ntests:\n  - test: tests/checkout.yaml\n",
}

type Daily = { date: string; passed: number; failed: number; total: number; avgDuration: number }

let trends: { passRate: number | null; totalRuns: number; avgDuration: number; daily: Daily[] }
let suiteAnalyticsFails = false

function analytics() {
  return {
    runs: [],
    total: trends.totalRuns,
    trends,
    isFlaky: false,
    flakyScore: 0,
    scope: { configured: false, predicates: [], scopedCount: 0, totalCount: trends.totalRuns },
  }
}

function json(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status < 400,
    status,
    statusText: status < 400 ? "OK" : "Internal Server Error",
    json: () => Promise.resolve(body),
  })
}

function fakeServer(input: string) {
  const url = new URL(input, "http://dashboard.test")
  if (url.pathname === `/api/tests/${VIEWED_TEST.testId}`) return json(VIEWED_TEST)
  if (url.pathname === `/api/suites/${VIEWED_SUITE.suiteId}`) return json(VIEWED_SUITE)
  if (url.pathname.startsWith("/api/analytics/tests/")) return json({ name: "Checkout flow", ...analytics() })
  if (url.pathname === `/api/analytics/suites/${VIEWED_SUITE.suiteId}`) {
    return suiteAnalyticsFails
      ? json({ error: "unavailable" }, 500)
      : json({ suiteId: VIEWED_SUITE.suiteId, ...analytics() })
  }
  return json({})
}

let container: HTMLDivElement | null = null
let root: Root | null = null

async function settle() {
  await act(async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve()
  })
}

async function renderPage(path: string) {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root!.render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/test/:t_id" element={<TestViewerPage />} />
          <Route path="/suite/:suite-id" element={<SuiteViewerPage />} />
        </Routes>
      </MemoryRouter>,
    )
  })
  await settle()
}

async function renderTable(node: ReactNode) {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root!.render(node)
  })
}

function unmount() {
  if (root) act(() => root!.unmount())
  root = null
  container?.remove()
  container = null
}

// The value printed beside each "Pass Rate" label; the chart's own "Pass Rate" heading is not one.
function ratesBesideLabel(): string[] {
  return Array.from(container?.querySelectorAll("*") ?? [])
    .filter((element) => element.children.length === 0 && element.textContent?.trim() === "Pass Rate")
    .map((label) => label.nextElementSibling)
    .filter((next): next is Element => next !== null && next.querySelector('[data-testid="pass-rate-chart"]') === null)
    .map((next) => next.textContent?.trim() ?? "")
}

function passRateCells(dimension: "test" | "platform"): string[] {
  const column = dimension === "platform" ? 4 : 2
  return Array.from(container?.querySelectorAll("tbody tr") ?? [])
    .map((row) => row.querySelectorAll("td")[column]?.textContent?.trim() ?? "")
}

function everyCell(): string[] {
  return Array.from(container?.querySelectorAll("tbody td") ?? []).map((cell) => cell.textContent?.trim() ?? "")
}

beforeEach(() => {
  trends = { passRate: null, totalRuns: 2, avgDuration: 1000, daily: [] }
  suiteAnalyticsFails = false
  chartData.length = 0
  vi.stubGlobal("fetch", vi.fn((input: string) => fakeServer(input)))
})

afterEach(() => {
  unmount()
  vi.unstubAllGlobals()
})

describe('C444-PASS-RATE', () => {
  it("the test viewer shows an em dash for a test with no rate", async () => {
    for (const tab of ["overview", "insights"]) {
      trends = { passRate: null, totalRuns: 2, avgDuration: 1000, daily: [] }
      await renderPage(`/test/${VIEWED_TEST.testId}?tab=${tab}`)
      expect(ratesBesideLabel(), `the ${tab} layout with no rate`).toEqual([EM_DASH])
      unmount()

      trends = { passRate: 0.5, totalRuns: 2, avgDuration: 1000, daily: [] }
      await renderPage(`/test/${VIEWED_TEST.testId}?tab=${tab}`)
      expect(ratesBesideLabel(), `the ${tab} layout at one half`).toEqual(["50%"])
      unmount()
    }
  })

  it("the suite viewer shows an em dash for a suite with no rate", async () => {
    for (const tab of ["overview", "insights"]) {
      trends = { passRate: null, totalRuns: 2, avgDuration: 1000, daily: [] }
      await renderPage(`/suite/${VIEWED_SUITE.suiteId}?tab=${tab}`)
      expect(ratesBesideLabel(), `the ${tab} layout with no rate`).toEqual([EM_DASH])
      unmount()

      suiteAnalyticsFails = true
      await renderPage(`/suite/${VIEWED_SUITE.suiteId}?tab=${tab}`)
      expect(ratesBesideLabel(), `the ${tab} layout over the empty-analytics default`).toEqual([EM_DASH])
      unmount()
      suiteAnalyticsFails = false

      trends = { passRate: 0.5, totalRuns: 2, avgDuration: 1000, daily: [] }
      await renderPage(`/suite/${VIEWED_SUITE.suiteId}?tab=${tab}`)
      expect(ratesBesideLabel(), `the ${tab} layout at one half`).toEqual(["50%"])
      unmount()
    }
  })

  it("the insights breakdown shows an em dash for a group with no rate", async () => {
    const rows: InsightsBreakdownRow[] = [
      { key: "Unrated", label: "Unrated", runs: 3, passRate: null, flakeRate: 0.25, avgDuration: 1000, passed: 0, failed: 0 },
      { key: "Rated", label: "Rated", runs: 2, passRate: 0.5, flakeRate: 0.25, avgDuration: 1000, passed: 1, failed: 1 },
    ]
    await renderTable(<InsightsBreakdownTable dimension="test" rows={rows} />)
    expect(passRateCells("test")).toEqual([EM_DASH, "50%"])
    expect(everyCell()).not.toContain("0%")
    unmount()

    const platforms: InsightsBreakdownRow[] = [
      { key: "ios", label: "ios", runs: 3, passRate: null, flakeRate: 0.25, avgDuration: 1000, passed: 0, failed: 0 },
      { key: "web", label: "web", runs: 2, passRate: 0.5, flakeRate: 0.25, avgDuration: 1000, passed: 1, failed: 1 },
    ]
    await renderTable(<InsightsBreakdownTable dimension="platform" rows={platforms} />)
    expect(passRateCells("platform")).toEqual([EM_DASH, "50%"])
    expect(everyCell()).not.toContain("0%")
  })

  it("the viewers' chart rates a day by its passes and failures only", async () => {
    const daily: Daily[] = [
      { date: "2026-10-01", passed: 1, failed: 0, total: 3, avgDuration: 1000 },
      { date: "2026-10-02", passed: 0, failed: 0, total: 2, avgDuration: 1000 },
    ]
    for (const path of [`/test/${VIEWED_TEST.testId}?tab=insights`, `/suite/${VIEWED_SUITE.suiteId}?tab=insights`]) {
      trends = { passRate: 1, totalRuns: 5, avgDuration: 1000, daily }
      chartData.length = 0
      await renderPage(path)
      expect(chartData.length, `${path} renders its pass-rate chart`).toBeGreaterThan(0)
      expect(chartData[chartData.length - 1], path).toEqual([{ date: "2026-10-01", passRate: 100 }])
      unmount()
    }
  })
})
