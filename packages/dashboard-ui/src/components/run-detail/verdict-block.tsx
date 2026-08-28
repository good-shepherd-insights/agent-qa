// ONE MEMBER'S VERDICT, AS A PERSON READS IT (406-01 · DETL-04, D-05 / D-10 / D-12;
// grown in 406-06 · D-02 / D-08 / D-09 / D-11).
//
// PRESENTATIONAL, AND DELIBERATELY SO. This component takes a view the page already projected out
// of `analysis.get` and paints it. It fetches nothing, holds no run id, derives no fact and
// composes no prose: the sentence is the op's own bytes, copied through, and every other string it
// shows — the provenance chip, the lifecycle marker, the sibling line, the cited-step label — comes
// out of `lib/analysis-view.ts`, which is pure and separately pinned. THE ONLY BRANCHES HERE ARE
// PRESENCE BRANCHES: is there a marker, are there cited steps, are there siblings. Anything that
// had to be decided was decided in the projection.
//
// THE SENTENCE IS A PRODUCER STRING AND GOES THROUGH THE SEAM (D-12, 405 D-10). It quotes the
// failing step's recorded error verbatim — Playwright's own text — inside
// `observed (step N): "…"`, so it carries `<SECRET_n>` at rest and a typed marker after the
// display seam, exactly as `failureSummary` does one component away. Rendered raw, the marker's
// delimiter reaches a text node a person reads. `MaskedText` is the same seam the overview, the
// sub-action row and the failure banner have painted every producer string through since 405-11.
//
// AND IT IS THE ONLY STRING ON THAT SEAM, which is the same decision restated four times now. The
// provenance ("LLM verdict · 0.86"), the marker, the sibling line and the step labels are this
// PRODUCT's words about the verdict's own fields; wrapping them would claim a redaction nobody ever
// made. Every one of them is a constant or a formatter, never a producer's sentence.
//
// NO COPY AFFORDANCE AND NO TITLE WRITE (T-406-05). WINDOWS #302/#303 name the clipboard and the
// document title as unenumerated egress sinks for RESTORED cleartext: the local door restores
// declared secrets into this sentence for the person reading the page, and a copy button would
// move that value into a bug report, while a title write would move it into a bfcache entry and
// every window-title log. Neither is here; the sentence stays where the reader can see it.
//
// TEXT NODES AND ELEMENTS, NEVER MARKUP (T-406-02). Nothing in this file or in `MaskedText` below
// it hands React raw HTML — the acceptance gate greps this file for the escape hatch's name and
// requires zero occurrences, which is why the name is not written anywhere in it. A jsdom cell
// feeds this component markup and asserts no element was constructed.
//
// A CITED STEP IS A BUTTON AND A SIBLING IS A BUTTON, because both DO something (D-02, D-08): the
// first selects that step in this member's tree through the page's existing `Selection`, the second
// narrows the member filter to that sibling's group. Neither mints a route, an id spelling or a
// scroller of its own — the page owns all three and this component hands it two handles.
//
// A CITED STEP THE VIEW DOES NOT NAME IS NOT RENDERED AS A DEAD CHIP (T-406-18). An index the
// projection did not carry never becomes a button, and a button whose step the page cannot resolve
// is a no-op there rather than a throw here.
//
// A CITED ARTIFACT OPENS IN THE DRAWER, AND ONLY THE PAGE KNOWS WHERE THAT IS (406-08 · D-02,
// second half). The block hands up a sha and nothing else: no run id, no URL, no window. The page
// turns that sha into the drawer's screenshot tab, whose `src` the one route minter mints. Rendering
// the picture here instead was rejected — it duplicates the overview's rendering and grows the page
// once per red member on a 40-red run.
//
// `data-*` DESCRIBES WHAT IS RENDERED, not what was passed (the banner's `showingFull` lesson).

import { MaskedText } from "@/components/run-detail/masked-text"
import { CITED_ARTIFACT_LABEL, citedStepLabel, type MemberVerdictView } from "@/lib/analysis-view"
import { memberHandleLabel } from "@/lib/run-detail-view"

interface VerdictBlockProps {
  view: MemberVerdictView
  /** Select the cited step in this member's tree — `(memberHandle, stepOrdinal)` (D-02). */
  onCitedStep: (testIndex: number, stepIndex: number) => void
  /** Narrow the member filter to a cluster sibling's own group (D-08). */
  onSelectMember: (testIndex: number) => void
  /** Open the cited artifact — the sha is the whole handle the page needs (D-02). */
  onCitedArtifact: (sha: string) => void
}

/** The one look every affordance in this block wears — a quiet inline chip, never a coloured link. */
const AFFORDANCE_CLASS =
  "rounded-[2px] border border-border/60 bg-background/60 px-1.5 py-0.5 font-mono text-[10px] " +
  "text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"

export function VerdictBlock({
  view,
  onCitedStep,
  onSelectMember,
  onCitedArtifact,
}: VerdictBlockProps) {
  return (
    <div
      data-verdict-block
      data-verdict-producer={view.producer}
      data-verdict-confidence={String(view.confidence)}
      className="mx-2 mt-1 mb-1.5 rounded-[2px] border border-border/60 bg-muted/10 px-3 py-2 text-xs"
    >
      <span data-verdict-sentence className="select-text text-foreground/80">
        <MaskedText text={view.sentence} />
      </span>

      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-muted-foreground">
        {view.marker === undefined ? null : (
          <span data-verdict-marker={view.marker} className="whitespace-nowrap text-amber-500">
            {view.markerText}
          </span>
        )}
        <span data-verdict-provenance className="whitespace-nowrap">
          {view.provenance}
        </span>
      </div>

      {view.citedSteps.length === 0 ? null : (
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          {view.citedSteps.map((stepIndex) => (
            <button
              key={stepIndex}
              type="button"
              data-cited-step={String(stepIndex)}
              onClick={() => { onCitedStep(view.testIndex, stepIndex) }}
              className={AFFORDANCE_CLASS}
            >
              {citedStepLabel(stepIndex)}
            </button>
          ))}
        </div>
      )}

      {view.citedArtifacts.length === 0 ? null : (
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          {view.citedArtifacts
            .filter((ref) => !ref.incomplete)
            .map((ref) => (
              <button
                key={ref.id}
                type="button"
                data-cited-artifact={ref.sha}
                onClick={() => { onCitedArtifact(ref.sha) }}
                className={AFFORDANCE_CLASS}
              >
                {CITED_ARTIFACT_LABEL}
              </button>
            ))}
        </div>
      )}

      {view.siblings.length === 0 ? null : (
        <div
          data-cluster-siblings={String(view.siblings.length)}
          className="mt-1.5 flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground"
        >
          <span className="whitespace-nowrap">{view.siblingText}</span>
          {view.siblings.map((sibling) => (
            <button
              key={sibling.testIndex}
              type="button"
              data-cluster-sibling={String(sibling.testIndex)}
              onClick={() => { onSelectMember(sibling.testIndex) }}
              className={AFFORDANCE_CLASS}
            >
              {memberHandleLabel(sibling.testIndex)}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
