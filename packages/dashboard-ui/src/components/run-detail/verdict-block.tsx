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
// AND AN ARTIFACT WHOSE BYTES ARE GONE IS STILL THERE, AS A CHIP (406-08 · D-19). The absent ref
// keeps its place in the row wearing `EvidenceIncomplete inline` — never dropped (a reader would
// count the links and conclude the verdict cited fewer things than it did) and never a button (an
// affordance that opens nothing is the worse lie the one component's own header names). Its
// siblings that ARE present stay clickable, and a count line under the row says how many of how
// many are gone, so a reader scanning collapsed groups can see evidence is missing without opening
// one. The sentence, the provenance, the marker and the member's outcome badge are all untouched:
// ONE MISSING SCREENSHOT IS NOT AN UNTRUSTWORTHY VERDICT, and the whole-verdict badge that would
// say otherwise was rejected. Bundle-level `evidence-incomplete` semantics belong to bundles.
//
// AND THE CIRCULARITY EVIDENCE IS TWO ROWS, NEVER ONE (422 · D-17 / D-19 / D-20). The causal
// records — the ones whose cross-check FLIPPED — and the records merely ON the served path are
// different claims, so they are different attribute names, different rows and a different chip
// look. One row carrying both would attribute a member's failure to a record whose check HELD,
// which is precisely the misreading the ledger exists to prevent.
//
// THE WHOLE SECTION IS ABSENT FOR A VERDICT THAT MADE NO CLAIM. Not an empty element and not a
// "not recorded" line under every historical failure: `view.misdirectionEvidence` is undefined
// whenever `analysis.get` carried no member, and this file renders nothing at all for it. A run
// whose arbiter never ran paints exactly the block it painted before 422.
//
// NO PRODUCER STRING JOINS THE SEAM HERE. Every word below is an exported constant, an exported
// formatter or a closed vocabulary word the DTO validated (`held`, `flipped`, `cap-exceeded`,
// `posture-unavailable`, a record id). The `reason` text a root read failure produces never
// reaches this DTO — see `AnalysisMisdirectionRecord` — so there is nothing here to mask, and
// wrapping these would claim a redaction nobody made.
//
// `data-*` DESCRIBES WHAT IS RENDERED, not what was passed (the banner's `showingFull` lesson).

import { useEffect, useRef, useState } from 'react'
import { MarkCorrectionFields, type MarkCorrection } from './mark-correction-fields'
import { MARKS, type Mark } from '@vostride/agent-qa-schema'
import { DenialBlock } from '@/chat/chat-transcript'
import { COPY_REVIEW_COMMAND_LABEL, proposalReviewCommand } from '@/lib/knowledge-view'
import { ReviewCommandButton } from '@/components/id-badge'
import { MARK_LABELS, markChipText, markTriageText, type OnMark, type MarkDenial } from '@/lib/analysis-view'
import { EvidenceIncomplete } from "@/components/run-detail/evidence-incomplete"
import { MaskedText } from "@/components/run-detail/masked-text"
import {
  CITED_ARTIFACT_LABEL,
  citedStepLabel,
  MISDIRECTION_CAUSAL_RECORDS_LABEL,
  MISDIRECTION_ON_PATH_RECORDS_LABEL,
  MISDIRECTION_RESULTS_LABEL,
  MISDIRECTION_RESULT_TEXT,
  misdirectionUnbackedLine,
  type MemberVerdictView,
} from "@/lib/analysis-view"
import { memberHandleLabel } from "@/lib/run-detail-view"

interface VerdictBlockProps {
  onMark?: OnMark
  markDenial?: MarkDenial
  markPending?: boolean
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

/** An EXPOSED record: a quiet chip, the same weight as every other read-only fact in the block. */
const ON_PATH_CHIP_CLASS =
  "inline-block max-w-full break-all rounded-[2px] border border-border/60 bg-background/60 px-1.5 py-0.5 font-mono text-xs " +
  "text-muted-foreground"

/** A CAUSAL record: the amber the lifecycle marker already owns, so the page mints no new colour. */
const CAUSAL_CHIP_CLASS =
  "inline-block max-w-full break-all rounded-[2px] border border-amber-500/60 bg-amber-500/10 px-1.5 py-0.5 font-mono text-xs " +
  "text-amber-800 dark:text-amber-300"

const MARK_ACTION_CLASS = 'inline-flex min-h-8 min-w-8 items-center justify-center rounded-[2px] border px-2 py-1 font-mono text-xs transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-60'

/** Bound member feedback exists independently of failure-analysis prose. */
export function MemberMarkControls({ view, onMark, markDenial, markPending = false }: {
  view: Pick<MemberVerdictView, 'testIndex' | 'marks'>
  onMark?: OnMark
  markDenial?: MarkDenial
  markPending?: boolean
}) {
  const [kind, setKind] = useState<Mark>()
  const [note, setNote] = useState('')
  const [correction, setCorrection] = useState<MarkCorrection>()
  const [correctionValid, setCorrectionValid] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [status, setStatus] = useState('')
  const [resultVisible, setResultVisible] = useState(true)
  const [lastDenial, setLastDenial] = useState<MarkDenial>()
  const submission = useRef<object | undefined>(undefined)
  useEffect(() => () => { submission.current = undefined }, [])
  useEffect(() => { if (markDenial) setLastDenial(markDenial) }, [markDenial])
  const edit = () => { setStatus(''); setResultVisible(false) }
  const clearDraft = () => { setKind(undefined); setNote(''); setCorrection(undefined); setCorrectionValid(true) }
  const submit = async () => {
    if (!onMark || kind === undefined || markPending || submission.current || !correctionValid) return
    const request = {}
    submission.current = request
    setSubmitting(true)
    setResultVisible(false)
    setStatus('Mark submission pending.')
    try {
      const result = correction
        ? await onMark(view.testIndex, undefined, kind, note || undefined, correction)
        : await onMark(view.testIndex, undefined, kind, note || undefined)
      if (submission.current !== request) return
      if (result === 'refreshed') {
        clearDraft()
        setStatus('Mark saved. Receipt refreshed.')
      } else if (result !== 'stale') {
        setResultVisible(true)
        setStatus('Draft retained. Check the result below before retrying.')
      } else setStatus('')
    } catch {
      if (submission.current !== request) return
      setResultVisible(true)
      setStatus('Draft retained. Check the result below before retrying.')
    } finally {
      if (submission.current === request) { submission.current = undefined; setSubmitting(false) }
    }
  }
  const denial = markDenial ?? lastDenial
  const disabled = markPending || submitting
  const mark = view.marks?.find(entry => entry.stepIndex === undefined)
  // 419-11 M4 pins this availability expression in the shared member control.
  return view.marks !== undefined && onMark ? (
        <div data-member-mark aria-busy={submitting} className="mt-1.5 flex flex-wrap items-center gap-1 text-xs">
          {MARKS.map(choice => (
            <button key={choice} type="button" data-mark-kind={choice} aria-pressed={kind === choice}
              className={`${MARK_ACTION_CLASS} ${kind === choice ? 'border-primary bg-primary/15 text-foreground' : 'border-border bg-background text-muted-foreground'}`}
              disabled={disabled} onClick={() => { edit(); setKind(choice) }}>
              {MARK_LABELS[choice]}
            </button>
          ))}
          {kind === undefined ? null : (
            <div className="flex w-full flex-wrap items-center gap-1">
              <p className="w-full">Selected: {kind}</p>
              <textarea data-mark-note aria-label="Optional mark note" maxLength={2000}
                className="w-full rounded-[2px] border border-border bg-background p-1 text-xs"
                value={note} onChange={event => { edit(); setNote(event.target.value) }} disabled={disabled} />
              <MarkCorrectionFields disabled={disabled} onChange={(value, valid) => { edit(); setCorrection(value); setCorrectionValid(valid) }} />
              <button type="button" data-mark-submit className={`${MARK_ACTION_CLASS} border-border bg-background`} disabled={disabled || !correctionValid}
                onClick={() => { void submit() }}>Record {kind} mark</button>
              <button type="button" data-mark-cancel className={`${MARK_ACTION_CLASS} border-border bg-background`} disabled={disabled}
                onClick={() => { edit(); clearDraft() }}>Cancel</button>
            </div>
          )}
          {mark === undefined ? null : (
            <>
              <span data-mark-chip>{markChipText(mark)}</span>
              <span data-mark-triage><MaskedText text={markTriageText(mark)} /></span>
              {mark.disposition.kind === 'drafted' ? (
                <ReviewCommandButton data-mark-review command={proposalReviewCommand(mark.disposition.proposalId)} label={COPY_REVIEW_COMMAND_LABEL} className={`${MARK_ACTION_CLASS} border-border bg-background`} />
              ) : null}
            </>
          )}
          <p data-mark-status role="status" aria-live="polite" aria-atomic="true" className="w-full">{status}</p>
          {!resultVisible || denial === undefined ? null : (
            <div data-mark-denied role="alert" className="w-full"><DenialBlock neutralReason={denial.reason} remedies={denial.remedies} /></div>
          )}
        </div>
      ) : null
}

export function VerdictBlock({
  view,
  onCitedStep,
  onSelectMember,
  onCitedArtifact,
  onMark,
  markDenial,
  markPending = false,
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

      <MemberMarkControls view={view} onMark={onMark} markDenial={markDenial} markPending={markPending} />

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
          {view.citedArtifacts.map((ref) =>
            // `ref.incomplete ?` IS SPELLED HERE, ONCE, AND NOT HOISTED — 406-11's mutation legs
            // match this expression literally. One leg drops the absent ref from the row, the other
            // renders it as an ordinary link; both edit this ternary and both must red a cell.
            ref.incomplete ? (
              <span
                key={ref.id}
                data-cited-artifact-state="incomplete"
                data-cited-artifact-sha={ref.sha}
                className="inline-flex items-center"
              >
                <EvidenceIncomplete variant="inline" />
              </span>
            ) : (
              <button
                key={ref.id}
                type="button"
                data-cited-artifact={ref.sha}
                onClick={() => { onCitedArtifact(ref.sha) }}
                className={AFFORDANCE_CLASS}
              >
                {CITED_ARTIFACT_LABEL}
              </button>
            ),
          )}
        </div>
      )}

      {view.missingEvidence === undefined ? null : (
        <div
          data-evidence-missing={`${String(view.missingEvidence.missing)}/${String(view.missingEvidence.total)}`}
          className="mt-1.5 text-[10px] text-muted-foreground"
        >
          {view.missingEvidenceText}
        </div>
      )}

      {view.misdirectionEvidence === undefined ? null : (
        <>
          <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span
              data-misdirection={view.misdirectionEvidence.state}
              className={
                view.misdirectionEvidence.state === 'flipped'
                  ? "min-w-0 text-amber-800 dark:text-amber-300"
                  : "min-w-0"
              }
            >
              {view.misdirectionEvidence.text}
            </span>
            {view.misdirectionEvidence.unbackedReason === undefined ? null : (
              <span
                data-misdirection-unbacked={view.misdirectionEvidence.unbackedReason}
                className="min-w-0"
              >
                {view.misdirectionEvidence.unbackedText}
              </span>
            )}
            <span data-misdirection-on-path className="min-w-0">
              {view.misdirectionEvidence.onPathText}
            </span>
          </div>

          {view.misdirectionEvidence.causalRecords.length === 0
            && (view.misdirectionEvidence.onPath === undefined
              || view.misdirectionEvidence.onPath.length === 0) ? null : (
          <dl className="mt-2 space-y-2 text-xs text-muted-foreground">
            {view.misdirectionEvidence.causalRecords.length === 0 ? null : (
            <div
              data-misdirection-causal={String(view.misdirectionEvidence.causalRecords.length)}
            >
              <dt className="mb-1">{MISDIRECTION_CAUSAL_RECORDS_LABEL}</dt>
              <dd>
                <ul className="flex flex-wrap items-start gap-1">
                  {view.misdirectionEvidence.causalRecords.map((recordId) => (
                    <li key={recordId} className="min-w-0 max-w-full">
                      <span data-misdirection-causal-record={recordId} className={CAUSAL_CHIP_CLASS}>
                        {recordId}
                      </span>
                    </li>
                  ))}
                </ul>
              </dd>
            </div>
            )}

            {view.misdirectionEvidence.onPath === undefined
              || view.misdirectionEvidence.onPath.length === 0 ? null : (
            <div
              data-misdirection-exposed={String(view.misdirectionEvidence.onPath.length)}
            >
              <dt className="mb-1">{MISDIRECTION_ON_PATH_RECORDS_LABEL}</dt>
              <dd>
                <ul className="flex flex-wrap items-start gap-1">
                  {view.misdirectionEvidence.onPath.map((entry) => (
                    <li key={entry.recordId} className="min-w-0 max-w-full">
                      <span
                        data-misdirection-on-path-record={entry.recordId}
                        data-misdirection-trust={entry.trust}
                        className={ON_PATH_CHIP_CLASS}
                      >
                        {entry.recordId}
                      </span>
                    </li>
                  ))}
                </ul>
              </dd>
            </div>
            )}
          </dl>
          )}

          {view.misdirectionEvidence.results === undefined
            || view.misdirectionEvidence.results.length === 0 ? null : (
            <details className="mt-2 text-xs text-muted-foreground">
              <summary className="cursor-pointer rounded-[2px] py-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                {MISDIRECTION_RESULTS_LABEL}
              </summary>
              <ul className="mt-2 space-y-2">
                {view.misdirectionEvidence.results.map((result) => (
                  <li key={result.recordId} data-misdirection-result={result.recordId}>
                    <div className="break-all font-mono text-foreground">{result.recordId}</div>
                    <div>{MISDIRECTION_RESULT_TEXT[result.crossCheck]}</div>
                    {result.reason === undefined ? null : (
                      <div data-misdirection-result-reason={result.reason}>
                        {misdirectionUnbackedLine(result.reason)}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
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
