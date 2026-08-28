// @vitest-environment jsdom
//
// ONE MEMBER'S VERDICT BLOCK (406-06 · DETL-04, D-08 / D-09 / D-10 / D-11).
//
// THE BLOCK DERIVES NOTHING, so every cell here hands it a view and reads the DOM back. What is
// pinned is the mapping from view to markup: which element exists, which attribute carries which
// raw word, and which callback a click reaches. The projection that BUILDS the view is pinned
// separately in `lib/__tests__/analysis-view.test.ts`, and neither file re-derives the other's job.
//
// THE COPY IS ASSERTED BY CONSTANT (405-06's law). `ANALYSIS_PROVISIONAL_TEXT`,
// `ANALYSIS_FAILED_FALLBACK_TEXT`, `siblingLine` and `citedStepLabel` come from
// `lib/analysis-view.ts`, so a sentence moves in one place and these cells move with it. A string
// re-typed here would stay green while the page said something else.
//
// THE `data-*` ATTRIBUTES ARE THE CELL CONTRACT, never the visible text — 406-11's shipped-binary
// cells address the built bundle by these same selectors, and a cell reading rendered prose would
// be asserting on presentation.

import { act, type ReactElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import { MASKED_MARKER_DELIMITER, maskedMarker } from "@vostride/agent-qa-schema"

import { VerdictBlock } from "@/components/run-detail/verdict-block"
import {
  ANALYSIS_FAILED_FALLBACK_TEXT,
  ANALYSIS_PROVISIONAL_TEXT,
  CITED_ARTIFACT_LABEL,
  citedStepLabel,
  missingEvidenceLine,
  provenanceLabel,
  siblingLine,
  type MemberVerdictView,
} from "@/lib/analysis-view"
import { EVIDENCE_INCOMPLETE_LABEL } from "@/lib/run-detail-view"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

function mount(element: ReactElement) {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root.render(element)
  })
  return container
}

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
})

/** The floor verdict, terminal and unremarkable — every cell narrows from here. */
function view(over: Partial<MemberVerdictView> = {}): MemberVerdictView {
  return {
    testIndex: 0,
    sentence: 'observed (step 0): "Submit never became enabled"',
    producer: "deterministic-classifier",
    confidence: 0,
    provenance: provenanceLabel("deterministic-classifier", 0),
    citedSteps: [],
    citedArtifacts: [],
    siblings: [],
    ...over,
  }
}

function render(over: Partial<MemberVerdictView> = {}, handlers: {
  onCitedStep?: (testIndex: number, stepIndex: number) => void
  onSelectMember?: (testIndex: number) => void
  onCitedArtifact?: (sha: string) => void
} = {}) {
  return mount(
    <VerdictBlock
      view={view(over)}
      onCitedStep={handlers.onCitedStep ?? (() => {})}
      onSelectMember={handlers.onSelectMember ?? (() => {})}
      onCitedArtifact={handlers.onCitedArtifact ?? (() => {})}
    />,
  )
}

/** Two content addresses, distinct and 64-hex, so a cell can tell one ref from the other. */
const SHA_PRESENT = "a".repeat(64)
const SHA_GONE = "b".repeat(64)

describe("the sentence's lifecycle is a marker, and the marker is the view's (D-09/D-11)", () => {
  it("paints the provisional marker with its exported sentence while the chain may still upgrade", () => {
    const block = render({ marker: "provisional", markerText: ANALYSIS_PROVISIONAL_TEXT })

    const marker = block.querySelector("[data-verdict-marker]")
    expect(marker?.getAttribute("data-verdict-marker"), "the raw word, not the copy").toBe("provisional")
    expect(marker?.textContent).toBe(ANALYSIS_PROVISIONAL_TEXT)
  })

  it("paints the failed marker when the chain fell back permanently", () => {
    const block = render({ marker: "failed", markerText: ANALYSIS_FAILED_FALLBACK_TEXT })

    const marker = block.querySelector("[data-verdict-marker]")
    expect(marker?.getAttribute("data-verdict-marker")).toBe("failed")
    expect(marker?.textContent).toBe(ANALYSIS_FAILED_FALLBACK_TEXT)
  })

  it("renders NO marker element at all on a terminal chain — not an empty one", () => {
    // AN EMPTY MARKER ELEMENT WOULD STILL MATCH `[data-verdict-marker]`, and 406-11's shipped-binary
    // cells assert on exactly that selector. A block that always rendered the element and left it
    // blank would read as "there is a marker here" to every reader of the DOM.
    const block = render()

    expect(block.querySelector("[data-verdict-marker]")).toBeNull()
    expect(block.textContent).not.toContain(ANALYSIS_PROVISIONAL_TEXT)
    expect(block.textContent).not.toContain(ANALYSIS_FAILED_FALLBACK_TEXT)
  })
})

describe("the provenance and the sentence keep their 406-01 contract (D-10, T-406-02)", () => {
  it("keeps every attribute the tracer put on the block, and reads provenance off the view", () => {
    const block = render({
      producer: "analyze-run",
      confidence: 0.86,
      provenance: provenanceLabel("analyze-run", 0.86),
    })

    const root_ = block.querySelector("[data-verdict-block]")
    expect(root_?.getAttribute("data-verdict-producer")).toBe("analyze-run")
    expect(root_?.getAttribute("data-verdict-confidence")).toBe("0.86")
    expect(block.querySelector("[data-verdict-provenance]")?.textContent)
      .toBe(provenanceLabel("analyze-run", 0.86))
    expect(block.querySelector("[data-verdict-sentence]")?.textContent)
      .toBe('observed (step 0): "Submit never became enabled"')
  })

  it("renders a markup-bearing sentence as TEXT and paints its masked marker as a chip", () => {
    // THE SENTENCE IS THE ONE STRING ON THE SEAM. It is a producer string carrying the failing
    // step's own error, so it arrives with a typed marker after the display unmask; the block
    // renders it through `MaskedText` and nothing else in this component goes near the seam.
    const hostile = `<img src=x onerror=alert(1)> observed with ${maskedMarker("secret")}`
    const block = render({ sentence: hostile })

    const sentence = block.querySelector("[data-verdict-sentence]")
    expect(sentence?.querySelectorAll("img").length, "no element was ever constructed").toBe(0)
    expect(block.querySelectorAll("img").length).toBe(0)
    expect(sentence?.textContent).toContain("<img src=x onerror=alert(1)>")
    expect(block.textContent, "the marker's delimiter never reaches a text node")
      .not.toContain(MASKED_MARKER_DELIMITER)
  })
})

describe("a cited step is one click from its row (D-02, first half)", () => {
  it("renders one button per cited step and hands the click back with both handles", () => {
    const onCitedStep = vi.fn()
    const block = render({ testIndex: 4, citedSteps: [2, 3] }, { onCitedStep })

    const buttons = [...block.querySelectorAll("[data-cited-step]")]
    expect(buttons.map((el) => el.getAttribute("data-cited-step"))).toEqual(["2", "3"])
    expect(buttons.every((el) => el.tagName === "BUTTON"), "an affordance, not a label").toBe(true)
    expect(buttons[0]?.textContent).toBe(citedStepLabel(2))

    act(() => {
      ;(buttons[0] as HTMLButtonElement).click()
    })
    expect(onCitedStep, "the member handle travels with the step ordinal").toHaveBeenCalledWith(4, 2)
  })

  it("renders no cited-step affordance when the verdict cited no step", () => {
    const block = render({ citedSteps: [] })
    expect(block.querySelector("[data-cited-step]")).toBeNull()
  })
})

describe("a cluster is a sibling LINE under the sentence, never a panel (D-08)", () => {
  it("counts the siblings on the line and links each one back to its own group", () => {
    const onSelectMember = vi.fn()
    const block = render(
      {
        siblings: [
          { testIndex: 0, testId: "t_0" },
          { testIndex: 7, testId: "t_7" },
        ],
        siblingText: siblingLine(2),
      },
      { onSelectMember },
    )

    const line = block.querySelector("[data-cluster-siblings]")
    expect(line?.getAttribute("data-cluster-siblings")).toBe("2")
    expect(line?.textContent).toContain(siblingLine(2))

    const links = [...block.querySelectorAll("[data-cluster-sibling]")]
    expect(links.map((el) => el.getAttribute("data-cluster-sibling"))).toEqual(["0", "7"])

    act(() => {
      ;(links[1] as HTMLButtonElement).click()
    })
    expect(onSelectMember).toHaveBeenCalledWith(7)
  })

  it("renders no sibling line for a lone failure", () => {
    const block = render({ siblings: [] })
    expect(block.querySelector("[data-cluster-siblings]")).toBeNull()
    expect(block.querySelector("[data-cluster-sibling]")).toBeNull()
  })
})

describe("a cited artifact is one click from the drawer (D-02, second half)", () => {
  it("renders one button per present cited artifact and hands the click back its sha", () => {
    const onCitedArtifact = vi.fn()
    const block = render(
      { citedArtifacts: [{ id: "art_0", sha: SHA_PRESENT, incomplete: false }] },
      { onCitedArtifact },
    )

    const link = block.querySelector("[data-cited-artifact]")
    expect(link?.getAttribute("data-cited-artifact"), "the sha VERBATIM — the content address itself")
      .toBe(SHA_PRESENT)
    expect(link?.tagName, "an affordance, not a label").toBe("BUTTON")
    expect(link?.textContent).toBe(CITED_ARTIFACT_LABEL)

    act(() => {
      ;(link as HTMLButtonElement).click()
    })
    expect(onCitedArtifact, "the sha is the only handle the page needs").toHaveBeenCalledWith(SHA_PRESENT)
  })

  it("renders no cited-artifact affordance when the verdict cited no artifact", () => {
    const block = render({ citedArtifacts: [] })
    expect(block.querySelector("[data-cited-artifact]")).toBeNull()
  })
})

describe("evidence that is GONE is a chip where the link was, and a count beside it (D-19)", () => {
  /** One present ref and one whose bytes are gone — the shape D-19 is written about. */
  const ONE_OF_TWO: Partial<MemberVerdictView> = {
    citedArtifacts: [
      { id: "art_0", sha: SHA_PRESENT, incomplete: false },
      { id: "art_1", sha: SHA_GONE, incomplete: true },
    ],
    missingEvidence: { missing: 1, total: 2 },
    missingEvidenceText: missingEvidenceLine({ missing: 1, total: 2 }),
  }

  it("keeps the absent ref IN the row as a chip, and keeps its present sibling clickable", () => {
    const onCitedArtifact = vi.fn()
    const block = render(ONE_OF_TWO, { onCitedArtifact })

    expect(
      block.querySelector(`[data-cited-artifact="${SHA_GONE}"]`),
      "an affordance that opens nothing is a worse lie than the missing picture",
    ).toBeNull()
    expect(block.querySelector(`[data-cited-artifact="${SHA_PRESENT}"]`), "its sibling still opens")
      .not.toBeNull()

    const chip = block.querySelector('[data-cited-artifact-state="incomplete"]')
    expect(chip?.getAttribute("data-cited-artifact-sha"), "the ref is named, not silently dropped")
      .toBe(SHA_GONE)
    expect(chip?.tagName, "not a button").not.toBe("BUTTON")
    expect(chip?.querySelector("button"), "and nothing inside it is one either").toBeNull()

    expect(
      chip?.querySelector('[data-evidence-state="incomplete"]'),
      "rendered through the ONE component, so the overview and this row cannot drift (D-18)",
    ).not.toBeNull()
    expect(chip?.textContent).toContain(EVIDENCE_INCOMPLETE_LABEL)

    act(() => {
      ;(chip as HTMLElement).click()
    })
    expect(onCitedArtifact, "clicking the chip asks for nothing").not.toHaveBeenCalled()
  })

  it("says how many of how many are gone, in the exported line", () => {
    const block = render(ONE_OF_TWO)

    // ADDRESSED THE WAY 406-10 ADDRESSES IT — by the attribute's VALUE, not by reading it back off
    // a node found some other way. The count is the selector, so a wrong count is a missing node.
    const count = block.querySelector('[data-evidence-missing="1/2"]')
    expect(count, "one of two, and the attribute says which").not.toBeNull()
    expect(count?.textContent).toBe(missingEvidenceLine({ missing: 1, total: 2 }))
  })

  it("renders NO count line when every cited artifact is there", () => {
    const block = render({ citedArtifacts: [{ id: "art_0", sha: SHA_PRESENT, incomplete: false }] })
    expect(block.querySelector("[data-evidence-missing]")).toBeNull()
    expect(block.querySelector('[data-cited-artifact-state="incomplete"]')).toBeNull()
  })

  it("does NOT re-grade the verdict because a screenshot is gone", () => {
    // ONE MISSING SCREENSHOT IS NOT AN UNTRUSTWORTHY VERDICT (D-19). The whole-verdict badge was
    // rejected precisely because it conflates the two; these three readings are what a reader —
    // and 406-10's shipped-binary cells — use to tell a re-graded verdict from an intact one.
    const intact = render({ citedArtifacts: [{ id: "art_0", sha: SHA_PRESENT, incomplete: false }] })
    const producer = intact.querySelector("[data-verdict-block]")?.getAttribute("data-verdict-producer")
    const confidence = intact.querySelector("[data-verdict-block]")?.getAttribute("data-verdict-confidence")
    const sentence = intact.querySelector("[data-verdict-sentence]")?.textContent

    act(() => {
      root.unmount()
    })
    container.remove()

    const partial = render(ONE_OF_TWO)
    expect(partial.querySelector("[data-verdict-block]")?.getAttribute("data-verdict-producer")).toBe(producer)
    expect(partial.querySelector("[data-verdict-block]")?.getAttribute("data-verdict-confidence")).toBe(confidence)
    expect(partial.querySelector("[data-verdict-sentence]")?.textContent).toBe(sentence)
  })

  it("renders exactly ONE cited-artifact node when the only cited artifact is gone", () => {
    // THE TWO MUTATIONS 406-11 LEGS, SHAPED AS ONE CELL. Dropping the absent ref would make this
    // zero; rendering it as an ordinary link would make it a BUTTON. Either edit reds here.
    const block = render({
      citedArtifacts: [{ id: "art_0", sha: SHA_GONE, incomplete: true }],
      missingEvidence: { missing: 1, total: 1 },
      missingEvidenceText: missingEvidenceLine({ missing: 1, total: 1 }),
    })

    const nodes = block.querySelectorAll("[data-cited-artifact], [data-cited-artifact-state]")
    expect(nodes.length, "never zero — the reader would count fewer citations than the verdict made")
      .toBe(1)
    expect(nodes[0]?.tagName, "never a button — that is the plain-pass mutation").not.toBe("BUTTON")
    expect(nodes[0]?.getAttribute("data-cited-artifact-state")).toBe("incomplete")
    expect(block.querySelector("[data-evidence-missing]")?.getAttribute("data-evidence-missing"))
      .toBe("1/1")
    expect(block.querySelector("[data-evidence-missing]")?.textContent)
      .toBe(missingEvidenceLine({ missing: 1, total: 1 }))
  })
})
