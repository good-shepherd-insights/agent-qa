// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it } from "vitest"

import { EditorStepDetail } from "@/components/editor/editor-step-detail"
import type { LiveSubAction } from "@/hooks/use-live-editor"
import type { DisplayStep } from "@/lib/display-step"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const STEP: DisplayStep = {
  id: "s1",
  name: "turn Wi-Fi on",
  status: "passed",
  duration: 10,
  stepOrder: 0,
  rawStepOrder: 0,
  displayStepOrder: 1,
  displayStepTotal: null,
}

function liveSubAction(result: LiveSubAction["result"], error?: string): LiveSubAction {
  return {
    index: 0,
    observation: "Wi-Fi switch",
    reasoning: "turn Wi-Fi on",
    plannedAction: { type: "tap", ref: "e3" },
    result,
    ...(error === undefined ? {} : { error }),
  }
}

let root: Root | null = null
let container: HTMLDivElement | null = null

function renderDetail(subAction: LiveSubAction): HTMLElement {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root!.render(<EditorStepDetail step={STEP} subAction={subAction} />))
  return container
}

function outcomeOf(view: HTMLElement) {
  const words = ["success", "failure", "no input sent"]
  return [...view.querySelectorAll("span.text-xs.font-medium")].find((span) =>
    words.includes(span.textContent ?? ""),
  )
}

afterEach(() => {
  if (root) act(() => root!.unmount())
  container?.remove()
  root = null
  container = null
})

describe("C437-NO-INPUT-LABEL", () => {
  it("the live editor detail names a skipped tap no input sent in the muted colour", () => {
    const view = renderDetail(liveSubAction("no-input"))
    const outcome = outcomeOf(view)
    expect(outcome?.textContent).toBe("no input sent")
    expect(outcome?.className).toContain("text-muted-foreground")
    expect(view.innerHTML).not.toContain("failure")
    expect(view.innerHTML).not.toContain("text-red-500")
    act(() => root!.unmount())
    container?.remove()

    const passed = outcomeOf(renderDetail(liveSubAction("success")))
    expect(passed?.textContent).toBe("success")
    expect(passed?.className).toContain("text-emerald-500")
    act(() => root!.unmount())
    container?.remove()

    const failed = outcomeOf(renderDetail(liveSubAction("failure", "element not found")))
    expect(failed?.textContent).toBe("failure")
    expect(failed?.className).toContain("text-red-500")
  })
})
