// @vitest-environment jsdom

import { act, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { AccessibilityViolation } from "@/lib/api"
import type { DisplayStep } from "@/lib/display-step"
import { generateRunId } from '@vostride/agent-qa-ids'
import { EVIDENCE_COPY } from '@/lib/evidence-state-view'

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children, className }: { children: ReactNode; className?: string }) => (
    <span data-testid="impact-badge" className={className}>{children}</span>
  ),
}))

vi.mock("@/lib/utils", () => ({
  cn: (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(" "),
}))

import { TabA11y } from "@/components/run-detail/tab-a11y"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const runId = generateRunId()

let container: HTMLDivElement | null = null
let root: Root | null = null

async function renderA11y(
  accessibilityViolations: AccessibilityViolation[] | null,
  reason: 'not-captured' | 'unavailable' = 'unavailable',
) {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)

  const sha = 'a'.repeat(64)
  const step: DisplayStep = {
    id: '0:0', name: 'step', status: 'passed', duration: 0, stepOrder: 0,
    rawStepOrder: 0, displayStepOrder: 1, displayStepTotal: 1, testIndex: 0, stepIndex: 0,
    evidence: {
      a11y: accessibilityViolations === null
        ? { kind: 'a11y', state: 'absent', reason }
        : { kind: 'a11y', state: 'present', ref: { id: `a11y-evidence:${sha}`, sha }, counts: { critical: 0, serious: 0, moderate: 0, minor: 0 } },
      console: { kind: 'console', state: 'absent', reason: 'not-captured' },
      network: { kind: 'network', state: 'absent', reason: 'not-captured' },
      variables: { kind: 'variables', state: 'absent', reason: 'not-captured' },
    },
  }
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({
    outcome: 'ready', document: { kind: 'a11y', records: accessibilityViolations },
  }) }))
  await act(async () => {
    root!.render(<TabA11y step={step} runId={runId} />)
  })

  return container
}

afterEach(() => {
  if (root) {
    act(() => root!.unmount())
  }
  root = null
  if (container) container.remove()
  container = null
  vi.unstubAllGlobals()
})

describe("TabA11y", () => {
  it("reports unrecorded checks separately from clean scans", async () => {
    const view = await renderA11y(null, 'not-captured')

    expect(view.textContent).toContain(EVIDENCE_COPY.a11y['not-captured'].title)
    expect(view.querySelector('[data-evidence-state="empty"]')).toBeNull()
  })

  it("reports missing per-step scan data separately from clean scans", async () => {
    const view = await renderA11y(null)

    expect(view.textContent).toContain(EVIDENCE_COPY.a11y.unavailable.title)
    expect(view.querySelector('[data-evidence-state="empty"]')).toBeNull()
  })

  it("reports a clean scan when the step has an empty violation list", async () => {
    const view = await renderA11y([])

    expect(view.textContent).toContain(EVIDENCE_COPY.a11y.empty.title)
  })

  it("renders recorded violations with impact, node html, and help link", async () => {
    const view = await renderA11y([
      {
        ruleId: "image-alt",
        impact: "critical",
        description: "Images must have alternate text",
        help: "Image elements must have alternate text",
        helpUrl: "https://dequeuniversity.com/rules/axe/4.10/image-alt",
        nodes: [{ html: '<img src="hero.png">', target: ["img"] }],
      },
    ])

    expect(view.textContent).toContain("critical")
    expect(view.textContent).toContain("image-alt")
    expect(view.textContent).toContain("Image elements must have alternate text")
    expect(view.textContent).toContain('<img src="hero.png">')
    expect(view.querySelector("a")?.getAttribute("href")).toBe("https://dequeuniversity.com/rules/axe/4.10/image-alt")
  })
})
