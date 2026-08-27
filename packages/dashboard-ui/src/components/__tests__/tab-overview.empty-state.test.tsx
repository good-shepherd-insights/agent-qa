// @vitest-environment jsdom

// THE OVERVIEW'S SCREENSHOT STATES (405-11 · D-14 / D-15).
//
// FOUR STATES, AND NONE OF THEM MAY LOOK LIKE ANOTHER. "Still expected" and "never captured" were
// already distinct here and stay word-for-word unchanged. This plan adds the two D-15 states the
// ref shape makes possible: a blob that IS addressable renders an image minted through the one
// route minter, and a blob the producer already flagged as gone renders a visible refusal instead
// of a broken image element.
//
// The `src` is asserted against `routes.runArtifact` BY CALLING IT, not by writing the URL out. A
// literal here would pass while the page minted a different path, which is exactly the drift the
// one-minter law exists to prevent.

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  NO_SCREENSHOT_LABEL,
  PENDING_SCREENSHOT_LABEL,
  TabOverview,
  type ScreenshotEmptyState,
} from "@/components/run-detail/tab-overview"
import { fromRunDetailStep } from "@/lib/display-step"
import { routes } from "@/lib/routes"
import { SCREENSHOT_UNAVAILABLE_LABEL } from "@/lib/run-detail-view"
import type { ArtifactRef, RunDetailSubAction } from "@vostride/agent-qa-schema"
import { asRef } from "@vostride/agent-qa-schema"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// The viewer is a faithful double, not a blank: it renders the `img` the real one renders and wires
// the same failure callback, so the two D-15 cells below measure the seam rather than the mock.
vi.mock("@/components/screenshot-viewer", () => ({
  ScreenshotViewer: ({ src, onUnavailable }: { src: string; onUnavailable?: () => void }) => (
    <img data-testid="screenshot-viewer" src={src} onError={() => onUnavailable?.()} />
  ),
}))

vi.mock("@/components/reasoning-pipeline", () => ({
  ReasoningPipeline: () => <div data-testid="reasoning-pipeline" />,
}))

const SHA = "a1b2c3d4".repeat(8)

const STEP = fromRunDetailStep(
  {
    testIndex: 0,
    stepIndex: 0,
    stepText: "Open dashboard",
    cacheStatus: "miss",
    verifierVerdict: { pass: true, reasoning: "the dashboard is up" },
    selfHealOccurred: false,
    briefDigest: "d00",
    status: "passed",
    durationMs: 1000,
  },
  [],
)

function makeSubAction(artifactRefs?: readonly ArtifactRef[]): RunDetailSubAction {
  return {
    testIndex: 0,
    stepIndex: 0,
    subActionIndex: 0,
    plan: "Open the dashboard",
    plannedAction: { type: "click", ref: asRef("dashboard") },
    result: { success: true },
    screenStateHash: "f".repeat(64),
    ...(artifactRefs === undefined ? {} : { artifactRefs }),
  }
}

let container: HTMLDivElement | null = null
let root: Root | null = null

async function renderOverview(
  subAction: RunDetailSubAction | null,
  screenshotEmptyState: ScreenshotEmptyState = "absent",
) {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)

  await act(async () => {
    root!.render(
      <TabOverview
        step={STEP}
        subAction={subAction}
        runId="run-1"
        screenshotEmptyState={screenshotEmptyState}
      />,
    )
  })

  return container
}

afterEach(() => {
  if (root) act(() => root!.unmount())
  root = null
  container?.remove()
  container = null
})

describe("TabOverview screenshot states", () => {
  it("shows pending copy while a screenshot is still expected", async () => {
    const view = await renderOverview(null, "pending")

    expect(view.textContent).toContain(PENDING_SCREENSHOT_LABEL)
    expect(view.textContent).not.toContain(NO_SCREENSHOT_LABEL)
    expect(view.querySelector("img")).toBeNull()
  })

  it("shows absent copy when this turn recorded no decision screenshot", async () => {
    const view = await renderOverview(makeSubAction([]), "absent")

    expect(view.textContent).toContain(NO_SCREENSHOT_LABEL)
    expect(view.textContent).not.toContain(PENDING_SCREENSHOT_LABEL)
    expect(view.textContent).not.toContain(SCREENSHOT_UNAVAILABLE_LABEL)
    expect(view.querySelector("img")).toBeNull()
  })

  it("mints the image src from the ref through the one route minter", async () => {
    const view = await renderOverview(
      makeSubAction([{ id: `decision-screenshot:${SHA}`, sha: SHA }]),
    )

    expect(view.querySelector('[data-artifact-state="available"]')).not.toBeNull()
    expect(view.querySelector("img")?.getAttribute("src")).toBe(routes.runArtifact("run-1", SHA))
  })

  // The producer already told us the bytes are not there. Asking anyway would turn a known fact
  // into a round-trip whose 404 we would then have to interpret.
  it("refuses without requesting when the ref says the evidence is incomplete", async () => {
    const view = await renderOverview(
      makeSubAction([{ id: `decision-screenshot:${SHA}`, sha: SHA, evidenceIncomplete: true }]),
    )

    expect(view.querySelector('[data-artifact-state="unavailable"]')).not.toBeNull()
    expect(view.textContent).toContain(SCREENSHOT_UNAVAILABLE_LABEL)
    expect(view.querySelector("img")).toBeNull()
  })

  it("flips to the same refusal when the request for the blob fails", async () => {
    const view = await renderOverview(
      makeSubAction([{ id: `decision-screenshot:${SHA}`, sha: SHA }]),
    )

    const image = view.querySelector("img")
    expect(image).not.toBeNull()

    await act(async () => {
      image!.dispatchEvent(new Event("error"))
    })

    expect(view.querySelector("img")).toBeNull()
    expect(view.querySelector('[data-artifact-state="unavailable"]')).not.toBeNull()
    expect(view.textContent).toContain(SCREENSHOT_UNAVAILABLE_LABEL)
  })

  // An `artifactRefs` list is open — the producer may attach other evidence to the same turn — so
  // the pane selects the decision screenshot by its id rather than taking whatever came first.
  // Taking the first entry would put an arbitrary blob into the image the moment a second channel
  // starts recording, which is a WRONG picture rather than a missing one.
  it("selects the decision screenshot by id rather than taking the first ref", async () => {
    const other = "b".repeat(64)
    const view = await renderOverview(
      makeSubAction([
        { id: `dom-snapshot:${other}`, sha: other },
        { id: `decision-screenshot:${SHA}`, sha: SHA },
      ]),
    )

    expect(view.querySelector("img")?.getAttribute("src")).toBe(routes.runArtifact("run-1", SHA))
  })
})
