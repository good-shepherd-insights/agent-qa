// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { MemoryRouter, Route, Routes } from "react-router"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import TestsPage from "@/pages/tests"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))
vi.mock("@/hooks/use-page-title", () => ({ usePageTitle: () => {} }))
vi.mock("@/hooks/use-run-config", () => ({
  useRunConfig: () => ({ defaultRunMode: "local", hasFarm: false, isLoading: false }),
}))

interface Member {
  testId: string | null
  filePath: string | null
  suiteId: string | null
  name: string
  outcome: string | null
}

function run(id: string, status: string, createdAt: string, members: Member[]) {
  return {
    id,
    name: members.map((member) => member.name).join(" · "),
    filePath: null,
    status,
    duration: 1000,
    attributes: {},
    environment: null,
    metadata: null,
    startedAt: createdAt,
    endedAt: status === "running" ? null : createdAt,
    failureSummary: null,
    errorLog: null,
    memoryLog: null,
    testId: null,
    suiteId: null,
    platform: "web",
    testFileContent: null,
    modelName: null,
    llmProvider: null,
    parentRunId: null,
    attemptNumber: 1,
    retryCount: 0,
    maxRetries: 0,
    createdAt,
    members: members.map((member, testIndex) => ({ testIndex, ...member })),
  }
}

interface TestDef {
  name: string
  path: string
  testId: string
}

function testFile(test: TestDef) {
  return { path: test.path, name: test.name, testId: test.testId, targetName: null, platform: "web", modified: "2026-10-17T09:00:00.000Z" }
}

function member(test: TestDef, outcome: string | null, suiteId: string | null = null): Member {
  return { testId: test.testId, filePath: test.path, suiteId, name: test.name, outcome }
}

const SLOW = { name: "Slow checkout", path: "tests/slow-checkout.yaml", testId: "t_slow" }
const QUICK = { name: "Quick login", path: "tests/quick-login.yaml", testId: "t_quick" }
const BROKEN = { name: "Broken search", path: "tests/broken-search.yaml", testId: "t_broken" }
const MENDED = { name: "Mended profile", path: "tests/mended-profile.yaml", testId: "t_mended" }

let served: { tests: unknown[]; runs: Array<ReturnType<typeof run>> } = { tests: [], runs: [] }

function json(body: unknown) {
  return Promise.resolve({ ok: true, status: 200, statusText: "OK", json: () => Promise.resolve(body) })
}

function fakeServer(input: string) {
  const url = new URL(input, "http://dashboard.test")
  if (url.pathname === "/api/tests") return json({ files: served.tests, targets: [] })
  if (url.pathname === "/api/runs") {
    const statuses = url.searchParams.getAll("status")
    const runs = statuses.length > 0 ? served.runs.filter((row) => statuses.includes(row.status)) : served.runs
    return json({ runs, total: runs.length, targets: [] })
  }
  return json({})
}

let container: HTMLDivElement | null = null
let root: Root | null = null

async function renderPage(path: string) {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root!.render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/tests" element={<TestsPage />} />
        </Routes>
      </MemoryRouter>,
    )
  })
  await act(async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve()
  })
}

function rowNamed(name: string): Element | undefined {
  return Array.from(container?.querySelectorAll("tbody tr") ?? []).find((candidate) =>
    candidate.textContent?.includes(name),
  )
}

function listedTests(): string[] {
  return [SLOW, QUICK, BROKEN, MENDED].map((test) => test.name).filter((name) => rowNamed(name) !== undefined)
}

function lastRunBadge(name: string) {
  const row = rowNamed(name)
  expect(row, `a row for ${name}`).toBeTruthy()
  const badge = row!.querySelector('a[href^="/runs/"] [data-slot="badge"]')
  expect(badge, `a last-run badge for ${name}`).toBeTruthy()
  return { variant: badge!.getAttribute("data-variant"), text: badge!.textContent }
}

beforeEach(() => {
  served = { tests: [], runs: [] }
  vi.stubGlobal("fetch", vi.fn((input: string) => fakeServer(input)))
})

afterEach(() => {
  if (root) act(() => root!.unmount())
  root = null
  container?.remove()
  container = null
  vi.unstubAllGlobals()
})

describe("C444-TIMEOUT-BADGE", () => {
  it("the Tests page shows a timed-out last run as a destructive Timed out badge", async () => {
    served.tests = [SLOW, QUICK].map(testFile)
    served.runs = [
      run("r_slow", "timeout", "2026-10-17T11:00:00.000Z", [member(SLOW, "timeout")]),
      run("r_quick", "passed", "2026-10-17T10:00:00.000Z", [member(QUICK, "passed")]),
    ]
    await renderPage("/tests")

    expect(lastRunBadge(QUICK.name)).toEqual({ variant: "default", text: "Passed" })
    expect(lastRunBadge(SLOW.name)).toEqual({ variant: "destructive", text: "Timed out" })
  })

  it("the Tests page's Failed filter lists a test whose last run timed out", async () => {
    served.tests = [SLOW, QUICK, BROKEN].map(testFile)
    served.runs = [
      run("r_slow", "timeout", "2026-10-17T11:00:00.000Z", [member(SLOW, "timeout")]),
      run("r_quick", "passed", "2026-10-17T10:30:00.000Z", [member(QUICK, "passed")]),
      run("r_broken", "failed", "2026-10-17T10:00:00.000Z", [member(BROKEN, "failed")]),
    ]
    await renderPage("/tests?status=failed")

    expect(listedTests()).toEqual([SLOW.name, BROKEN.name])
  })

  it("the Tests page's Passed filter lists a test whose last run healed", async () => {
    served.tests = [SLOW, QUICK, MENDED].map(testFile)
    served.runs = [
      run("r_slow", "timeout", "2026-10-17T11:00:00.000Z", [member(SLOW, "timeout")]),
      run("r_quick", "passed", "2026-10-17T10:30:00.000Z", [member(QUICK, "passed")]),
      run("r_mended", "healed", "2026-10-17T10:00:00.000Z", [member(MENDED, "healed")]),
    ]
    await renderPage("/tests?status=passed")

    expect(listedTests()).toEqual([QUICK.name, MENDED.name])
  })
})
