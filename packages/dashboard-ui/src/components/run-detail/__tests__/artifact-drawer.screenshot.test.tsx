// @vitest-environment jsdom
//
// THE DRAWER'S SCREENSHOT TAB (406-08 · DETL-04, D-02 second half; 405 D-12 / D-15).
//
// A CITED SCREENSHOT OPENS WHERE THE READER ALREADY LOOKS. The failure view's cited-artifact link
// does not mint a window, an inline pane or a route of its own — it opens the artifact drawer a
// person already reaches with `i` / `c` / `m`, on a fourth tab keyed by the sha it was clicked
// with. These cells pin the three things that makes true: the tab exists when there is a sha, its
// image `src` is the ONE minter's (`routes.runArtifact`) and nothing else's, and the three v1 tabs
// are still exactly where they were.
//
// THE CLICK-TIME 404 IS STILL HONEST (405 D-15). A blob can vanish between the durable read that
// said `present` and the request this tab makes; the viewer says so through `onUnavailable` and the
// tab paints the SAME `EvidenceIncomplete` the read-time absence paints. One state, one component,
// two roads to it — which is D-18 restated at the third ref site.
//
// A FAITHFUL VIEWER DOUBLE, NOT A BLANK. The mock renders the `img` the real viewer renders and
// fires `onUnavailable` from its `onError`, so these cells measure the seam rather than the mock.

import { act, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ArtifactDrawer } from "@/components/run-detail/artifact-drawer"
import { routes } from "@/lib/routes"
import { EVIDENCE_INCOMPLETE_LABEL } from "@/lib/run-detail-view"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock("@/components/screenshot-viewer", () => ({
  ScreenshotViewer: ({ src, onUnavailable }: { src: string; onUnavailable?: () => void }) => (
    <img data-testid="screenshot-viewer" src={src} onError={() => onUnavailable?.()} />
  ),
}))

// The sheet is a portal in production; rendered inline here so the cells can read the subtree they
// mounted rather than hunting `document.body`. The TABS are the real ones on purpose — "only the
// active tab's content is mounted" is a property these cells depend on.
vi.mock("@/components/ui/sheet", () => ({
  Sheet: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SheetContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SheetHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SheetTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  SheetDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
}))

vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

const RUN_ID = "run-406-08"
const SHA = "c".repeat(64)

const RUN = {
  id: RUN_ID,
  name: "Checkout suite",
  filePath: "tests/checkout.yaml",
  status: "failed",
  duration: 10000,
  attributes: {},
  environment: null,
  metadata: null,
  startedAt: "2026-08-28T00:00:00.000Z",
  endedAt: "2026-08-28T00:00:10.000Z",
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
  createdAt: "2026-08-28T00:00:00.000Z",
}

let container: HTMLDivElement
let root: Root

function mountDrawer(over: {
  tab?: "attributes" | "config" | "memory" | "screenshot"
  screenshotSha?: string | null
} = {}) {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root.render(
      <ArtifactDrawer
        run={RUN as never}
        open
        tab={over.tab ?? "screenshot"}
        screenshotSha={over.screenshotSha === undefined ? SHA : over.screenshotSha}
        response={null}
        loading={false}
        error={null}
        onOpenChange={() => {}}
        onTabChange={() => {}}
        onRetry={() => {}}
      />,
    )
  })
  return container
}

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
})

describe("the screenshot tab opens what the verdict cited (D-02)", () => {
  it("mints its image src through the ONE route minter and nothing else", () => {
    const drawer = mountDrawer()

    const img = drawer.querySelector('[data-testid="screenshot-viewer"]')
    expect(img?.getAttribute("src")).toBe(routes.runArtifact(RUN_ID, SHA))
    expect(drawer.querySelector('[data-artifact-state="available"]')).not.toBeNull()
  })

  it("offers the tab only when a sha was clicked — the three v1 tabs are otherwise unchanged", () => {
    const withSha = mountDrawer({ tab: "attributes" })
    expect(withSha.querySelector('[data-artifact-drawer-tab="screenshot"]')).not.toBeNull()

    act(() => {
      root.unmount()
    })
    container.remove()

    const withoutSha = mountDrawer({ tab: "attributes", screenshotSha: null })
    expect(
      withoutSha.querySelector('[data-artifact-drawer-tab="screenshot"]'),
      "a reader who pressed `i` sees the same three tabs they always saw",
    ).toBeNull()
    expect(withoutSha.textContent).toContain("Attributes")
    expect(withoutSha.textContent).toContain("Config")
    expect(withoutSha.textContent).toContain("Memory")
  })

  it("paints the ONE absence component when there is no sha to open", () => {
    const drawer = mountDrawer({ screenshotSha: null })

    expect(drawer.querySelector('[data-artifact-state="unavailable"]')).not.toBeNull()
    expect(drawer.querySelector('[data-evidence-state="incomplete"]')).not.toBeNull()
    expect(drawer.textContent).toContain(EVIDENCE_INCOMPLETE_LABEL)
    expect(drawer.querySelector('[data-testid="screenshot-viewer"]')).toBeNull()
  })

  it("says so when the blob vanished BETWEEN the read and the click (405 D-15)", () => {
    const drawer = mountDrawer()
    expect(drawer.querySelector('[data-evidence-state="incomplete"]')).toBeNull()

    const img = drawer.querySelector('[data-testid="screenshot-viewer"]') as HTMLImageElement
    act(() => {
      img.dispatchEvent(new Event("error"))
    })

    expect(drawer.querySelector('[data-artifact-state="unavailable"]')).not.toBeNull()
    expect(
      drawer.querySelector('[data-evidence-state="incomplete"]'),
      "a click-time 404 is the same visible state as a read-time absence (D-18)",
    ).not.toBeNull()
    expect(drawer.querySelector('[data-testid="screenshot-viewer"]')).toBeNull()
  })
})
