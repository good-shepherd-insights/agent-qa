// @vitest-environment jsdom

import { act, type ReactElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { MemoryRouter } from "react-router"
import { afterEach, describe, expect, it, vi } from "vitest"

import { RunNavbar } from "@/components/run-detail/run-navbar"
import { triggerRun } from "@/lib/api"
import { TOKENS_NOT_MEASURED_LABEL } from "@/lib/run-detail-view"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock("@/lib/api", () => ({
  triggerRun: vi.fn(),
}))

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock("@/components/id-badge", () => ({
  IdBadge: () => <div data-testid="id-badge">id-badge</div>,
}))

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactElement }) => children,
  TooltipTrigger: ({ children }: { children: ReactElement }) => children,
  TooltipContent: ({ children }: { children: ReactElement }) => <>{children}</>,
}))

vi.mock("@/components/ui/popover", async () => {
  const React = await vi.importActual<typeof import("react")>("react")
  let latestOpen = false
  let latestOnOpenChange: ((open: boolean) => void) | undefined

  return {
    Popover: ({
      children,
      open,
      onOpenChange,
    }: {
      children: ReactElement
      open?: boolean
      onOpenChange?: (open: boolean) => void
    }) => {
      latestOpen = Boolean(open)
      latestOnOpenChange = onOpenChange
      return <>{children}</>
    },
    PopoverTrigger: ({ children }: { children: ReactElement }) => {
      if (!React.isValidElement(children)) return children
      const existingOnClick = (children.props as { onClick?: (event: unknown) => void }).onClick
      return React.cloneElement(children, {
        onClick: (event: unknown) => {
          existingOnClick?.(event)
          latestOnOpenChange?.(!latestOpen)
        },
      } as Record<string, unknown>)
    },
    PopoverContent: ({ children }: { children: ReactElement }) => <div>{children}</div>,
  }
})

let container: HTMLDivElement
let root: Root

function mount(el: ReactElement) {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root.render(<MemoryRouter>{el}</MemoryRouter>)
  })
}

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
  vi.clearAllMocks()
})

const baseRun = {
  id: "r_run-id",
  name: "Login run",
  filePath: "tests/login.yaml",
  status: "passed",
  duration: 1200,
  attributes: {
    "agent-qa.trigger": "cli",
    "agent-qa.runner": "local",
  },
  environment: null,
  metadata: null,
  startedAt: "2026-04-18T00:00:00.000Z",
  endedAt: "2026-04-18T00:00:01.200Z",
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
  createdAt: "2026-04-18T00:00:00.000Z",
}

describe("RunNavbar", () => {
  it("links test runs to the canonical test page in a new tab without showing ids", () => {
    mount(
      <RunNavbar
        run={{ ...baseRun, testId: "t_login", name: "Test run" }}
        shortcutsOpen={false}
        onToggleShortcuts={() => {}}
      />,
    )

    const link = container.querySelector('a[aria-label="Open test"]') as HTMLAnchorElement | null
    expect(link).not.toBeNull()
    expect(link?.getAttribute("href")).toBe("/test/t_login")
    expect(link?.getAttribute("target")).toBe("_blank")
    expect(link?.getAttribute("rel")).toBe("noopener noreferrer")
    expect(container.querySelector('[data-testid="id-badge"]')).toBeNull()
    expect(container.textContent).not.toContain("t_login")
  })

  it("links suite runs to the canonical suite page in a new tab", () => {
    mount(
      <RunNavbar
        run={{ ...baseRun, suiteId: "s_smoke", name: "Suite run" }}
        shortcutsOpen={false}
        onToggleShortcuts={() => {}}
      />,
    )

    const link = container.querySelector('a[aria-label="Open suite"]') as HTMLAnchorElement | null
    expect(link).not.toBeNull()
    expect(link?.getAttribute("href")).toBe("/suite/s_smoke")
    expect(link?.getAttribute("target")).toBe("_blank")
    expect(link?.getAttribute("rel")).toBe("noopener noreferrer")
    expect(container.textContent).not.toContain("s_smoke")
  })

  it("omits the source arrow when no test or suite id is available", () => {
    mount(
      <RunNavbar
        run={{ ...baseRun, name: "Detached run" }}
        shortcutsOpen={false}
        onToggleShortcuts={() => {}}
      />,
    )

    expect(container.querySelector('a[aria-label="Open test"]')).toBeNull()
    expect(container.querySelector('a[aria-label="Open suite"]')).toBeNull()
  })

  // THE LEGEND DOCUMENTS THE KEYS THAT EXIST, AND ONLY THOSE (405-11 - D-14).
  //
  // It used to advertise a Before/After screenshot pair. The bus records ONE decision screenshot
  // per turn - the screen the planner looked at when it decided - so there is no second side to
  // select and the two keys were removed with the segmented control they drove. A legend row for a
  // key that does nothing is worse than no row: it sends a reader hunting for a feature.
  it("documents the keys that exist, and advertises no side-selection the page cannot honour", () => {
    mount(
      <RunNavbar
        run={{ ...baseRun, name: "Screenshot run" }}
        shortcutsOpen={true}
        onToggleShortcuts={() => {}}
      />,
    )

    expect(container.textContent).toContain("Details: Attributes")
    expect(container.textContent).toContain("Artifacts: Config")
    // 407-02 D-02: `M` no longer opens the dead v1 memory drawer tab — it opens the Knowledge
    // tab, and the legend says so. The old row is asserted GONE for the same reason the two
    // screenshot rows below are: a row for a key that does something else is a row that misleads.
    expect(container.textContent).toContain("Knowledge tab")
    expect(container.textContent).not.toContain("Artifacts: Memory")
    expect(container.textContent).toContain("Shift+?")
    expect(container.textContent).not.toContain("Before screenshot")
    expect(container.textContent).not.toContain("After screenshot")
  })

  // THE RECORDING ACTION IS GONE, AND THAT IS THE ASSERTION (405-11 - D-14).
  //
  // This cell used to pin the href the header built for a run recording out of a stored path. Refs
  // are the only artifact addressing now and no producer writes a recording ref, so the header has
  // no video surface at all - an honest absence, not a surviving path. If a recording producer
  // lands later, this cell is what has to change, and it will change to assert a MINTED href.
  it("offers no recording action while no producer records one by ref", () => {
    mount(
      <RunNavbar
        run={baseRun}
        shortcutsOpen
        onToggleShortcuts={() => {}}
      />,
    )

    expect(container.querySelector('a[aria-label="Open recording"]')).toBeNull()
    expect(container.querySelectorAll('a[href^="/api/videos/"]')).toHaveLength(0)
    expect(container.textContent).not.toContain("Video")
  })

  // D-06 CARRIED INTO THE HEADER. The old span summed three per-step counters and was guarded on a
  // positive total, so a run nobody measured and a run that spent nothing rendered identically -
  // as nothing. The projection's own sum answers both questions separately, and the header says
  // which one it is.
  it("says tokens were not measured rather than rendering nothing for an unmeasured run", () => {
    mount(
      <RunNavbar
        run={baseRun}
        tokens={{ measuredSteps: 0, unmeasuredSteps: 3 }}
        shortcutsOpen={false}
        onToggleShortcuts={() => {}}
      />,
    )

    const line = container.querySelector('[data-run-token-summary]')
    expect(line?.textContent).toContain(TOKENS_NOT_MEASURED_LABEL)
  })

  it("reports the measured sum and how much of the run it covers", () => {
    mount(
      <RunNavbar
        run={baseRun}
        tokens={{
          measuredSteps: 2,
          unmeasuredSteps: 1,
          promptTokens: 900,
          completionTokens: 100,
          totalTokens: 1000,
        }}
        shortcutsOpen={false}
        onToggleShortcuts={() => {}}
      />,
    )

    const line = container.querySelector('[data-run-token-summary]')
    expect(line?.textContent).toContain("2 of 3 steps")
    expect(line?.textContent).not.toContain(TOKENS_NOT_MEASURED_LABEL)
  })

  it("renders no token line at all while the durable read has not landed", () => {
    mount(
      <RunNavbar run={baseRun} shortcutsOpen={false} onToggleShortcuts={() => {}} />,
    )

    expect(container.querySelector('[data-run-token-summary]')).toBeNull()
  })

  it("opens run details on the Test tab from the navbar action", () => {
    const onOpenArtifacts = vi.fn()
    mount(
      <RunNavbar
        run={{ ...baseRun, name: "Artifact run" }}
        shortcutsOpen={false}
        onToggleShortcuts={() => {}}
        onOpenArtifacts={onOpenArtifacts}
      />,
    )

    const trigger = container.querySelector('button[aria-label="Open run artifacts"]') as HTMLButtonElement | null
    expect(trigger).not.toBeNull()
    expect(trigger?.getAttribute("title")).toBe("Run details (I/C/M)")

    act(() => {
      trigger!.click()
    })

    expect(onOpenArtifacts).toHaveBeenCalledTimes(1)
    expect(onOpenArtifacts).toHaveBeenCalledWith("test")
  })

  it("toggles the shortcut popover once when closing from the trigger", () => {
    const onToggleShortcuts = vi.fn()
    mount(
      <RunNavbar
        run={{ ...baseRun, name: "Screenshot run" }}
        shortcutsOpen={true}
        onToggleShortcuts={onToggleShortcuts}
      />,
    )

    const trigger = container.querySelector('button[aria-label="Keyboard shortcuts"]') as HTMLButtonElement | null
    expect(trigger).not.toBeNull()

    act(() => {
      trigger!.click()
    })

    expect(onToggleShortcuts).toHaveBeenCalledTimes(1)
  })

  it("reruns suite parents with the stored suite file path", async () => {
    const triggerRunMock = vi.mocked(triggerRun)
    triggerRunMock.mockResolvedValue({ runId: "run_rerun", status: "queued" })

    mount(
      <RunNavbar
        run={{
          ...baseRun,
          name: "Sample Basic suite",
          filePath: "suites/sample-basic.suite.yaml",
          suiteId: "s_sample_basic",
          parentRunId: null,
        }}
        shortcutsOpen={false}
        onToggleShortcuts={() => {}}
      />,
    )

    const trigger = container.querySelector('button[aria-label="Re-run"]') as HTMLButtonElement | null
    expect(trigger).not.toBeNull()

    await act(async () => {
      trigger!.click()
      await Promise.resolve()
    })

    expect(triggerRunMock).toHaveBeenCalledWith({
      file: "suites/sample-basic.suite.yaml",
      local: true,
    })
  })
})
