// @vitest-environment jsdom

// THE ARIA TAB'S CELLS, AFTER ITS PRODUCER WENT (405-11 · D-14 / DETL-06).
//
// WHAT THESE USED TO PIN. A before/after toggle over two accessibility snapshots, fetched by the
// tab itself over a per-step reasoning trace, inside a contained scroll frame. That trace table and
// its route are gone with the v1 projection, and the bus collapses a screen state to a sha256
// before it reaches the wire — so no durable row carries this text and the toggle has nothing to
// toggle between.
//
// WHAT THEY PIN NOW. The tab renders its not-captured state, says so in a machine-readable posture,
// and — the cell that actually has teeth — asks for NOTHING. A tab that still opened a request for
// a route nobody serves would spend a round-trip per selection to arrive at the same empty screen.

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import { NO_ARIA_TREE_LABEL, TabAriaTree } from "@/components/run-detail/tab-aria-tree"
import { fromRunDetailStep } from "@/lib/display-step"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const fetchSpy = vi.fn()

vi.stubGlobal("fetch", fetchSpy)

let container: HTMLDivElement | null = null
let root: Root | null = null

const STEP = fromRunDetailStep(
  {
    testIndex: 0,
    stepIndex: 0,
    stepText: "Open login",
    cacheStatus: "miss",
    verifierVerdict: { pass: true, reasoning: "the login form is up" },
    selfHealOccurred: false,
    briefDigest: "d00",
    status: "passed",
    durationMs: 1000,
  },
  [],
)

async function renderTree() {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)

  await act(async () => {
    root!.render(<TabAriaTree step={STEP} />)
  })

  return container
}

afterEach(() => {
  if (root) act(() => root!.unmount())
  root = null
  container?.remove()
  container = null
  vi.clearAllMocks()
})

describe("TabAriaTree", () => {
  it("says no snapshot was captured, in its own words and in a readable posture", async () => {
    const view = await renderTree()

    expect(view.textContent).toContain(NO_ARIA_TREE_LABEL)
    expect(view.querySelector('[data-aria-tree-state="not-captured"]')).not.toBeNull()
  })

  it("offers no before/after toggle over snapshots nothing recorded", async () => {
    const view = await renderTree()

    expect(view.querySelector("pre")).toBeNull()
    expect(Array.from(view.querySelectorAll("button")).map((b) => b.textContent)).toEqual([])
  })

  // The teeth: an absence rendered after a request is a different (and worse) thing than an
  // absence that costs nothing to state.
  it("asks nobody for a snapshot that has no producer", async () => {
    await renderTree()

    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
