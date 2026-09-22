// THE LEARNED HALF OF THE KNOWLEDGE TAB (407-09 · LERN-02, D-09..D-12, T-407-21/T-407-22).
//
// IT IS PRESENTATIONAL AND KNOWS NO RUN. It takes a view and paints it. It reads nothing, fetches
// nothing and mints no route — the page owns the one `runs.knowledge` client (D-05's "one read,
// one shape"), `lib/knowledge-view.ts` owns every sentence and every state word, and this file
// owns only where they land in the DOM.
//
// FIVE STATES, AND FOUR OF THEM ARE ABSENCES — none of which renders blank (D-12). A half that
// showed an empty list under a `failed` chip would tell a reader "curation ran and changed
// nothing", which is a different run from the one in front of them. So every arm below carries
// either rows or a sentence, and the projection is total so this component needs no fallback.
//
// THE SIXTH RENDERING is a settled state word carrying a sentence that names an UNREADABLE STORE
// (407-14/407-15): `data-learned-read="incomplete"` on the root, the counts still beside the
// heading, and no rows. It is not a sixth STATE — the chain really did settle — which is why the
// fact rides its own attribute instead of a state word the curation chip could not mirror.
//
// AND A SEVENTH: rows, or an unsettled-chain sentence, with the READ NOTE beneath, when the store
// was only partly readable (407-18 · REVIEW CR-01/WR-05). The op degrades its two Learned
// enrichments independently, so a served record and a partial read arrive together — the note is
// the person-visible half of `data-learned-read`, which is the cell-visible half. Neither half
// ever replaces the rows: a view handed records paints them and says the read was partial beside
// them.
//
// AND AN EIGHTH: rows with the CHAIN NOTE beneath them, when curation settled `failed` AFTER it
// had already committed change records (407-26 · REVIEW CR-01 · owner ruling 2026-08-31). A chain
// that fell over cannot un-commit what it wrote, so the records are painted and the chain's fate
// is stated beside them in `[data-learned-chain-note]`. The no-rows `failed` arm did not move: it
// still prints `Curation failed — nothing was learned from this run.` in the sentence slot, which
// is the one arm where nothing on screen falsifies it.
//
// ROWS WIN OVER SENTENCES, and that ordering lives in `learnedView`, not here. This file paints
// whatever the view carries: the projection never hands it both a populated list and a sentence,
// because a sentence beside rows would be a second, quieter account of the same records (CR-04).
// THAT RULE IS WHY THE EIGHTH RENDERING NEEDED A NEW SLOT rather than a reworded sentence — a
// failed chain's fate travels in `chainNote`, beneath the rows, precisely so that the sentence
// contract above stays intact instead of being bent to carry a second account of the same list.
//
// NO SKELETON AND NO SPINNER, EVER. `pending` here is not "bytes are on their way"; it is a chain
// a daemon may not have picked up for hours (404's posture text exists for exactly that reason).
// A shimmer would promise an arrival nobody has scheduled.
//
// `data-learned-state`, `data-learned-count-line`, `data-record-change`, `data-record-id` and
// `data-pending-proposals` ARE THE CELL CONTRACT, never the visible text. The jsdom cells here and
// 407-11's Playwright cells on the built bundle both address attributes, so a copy change moves
// `lib/knowledge-view.ts` and nothing else.
//
// EVERY HREF COMES FROM A BUILDER, NEVER FROM A PROJECTION STRING (T-407-21). The row's `href` is
// whatever `entityRefRoute` resolved in the projection — a route this build owns or nothing at all
// — and the reference STRING is only ever rendered as text. A row whose reference is hostile
// therefore paints the hostile text and links nowhere, which is the cell directly below the
// `data-record-ref` span.
//
// ALL TEXT GOES THROUGH REACT TEXT NODES. No raw-HTML injection escape hatch appears anywhere in
// this file — a grep for React's one is an acceptance criterion. Record ids are producer strings
// crossing the display seam, and a hostile-id cell asserts an `<img onerror=…>` creates no element.

import { Link } from "react-router"

import { ReviewCommandButton } from "@/components/id-badge"
import { Badge } from "@/components/ui/badge"
import {
  LEARNED_HEADING,
  promotionPathLabel,
  type LearnedChangeKind,
  type LearnedRowView,
  type LearnedView,
  type ProposalsView,
} from "@/lib/knowledge-view"

/** A half heading: 16px/500 — explicitly `font-medium`, because the global `h4` rule is 600. */
const HEADING_CLASS = "text-base font-medium leading-snug"

/**
 * The kind badge's look, as a closed table over the five Learned kinds.
 *
 * `promoted` borrows the verdict badge's emerald because a promotion is the one change in the set
 * that made the store MORE trusted; `deprecated` is the same destructive as a failed run because
 * it is the one that retired something. `confirmed` and `superseded` are bare outlines: they moved
 * a record without changing what a reader should do about it.
 *
 * `added` TAKES THE SAME EMERALD, and the borrowing is deliberate rather than lazy. A new record
 * made the store LARGER, not more trusted, so the two are not the same event — but the UI-SPEC
 * adds no colour in this phase and `added` is the only other positive kind in the table, so it
 * wears the one success tint the SPEC already reserves. The `data-record-change` attribute, not
 * the tint, is what tells the two apart for a cell or a reader looking closely.
 *
 * A `Record<LearnedChangeKind, …>` rather than a switch with a default, so a sixth kind is a
 * compile error here rather than a row that silently paints whichever arm the lookup missed —
 * which is precisely what happened when `added` was admitted to the vocabulary at the view.
 */
const KIND_LOOK: Record<LearnedChangeKind, Parameters<typeof Badge>[0]> = {
  added: { className: "bg-emerald-500/15 text-emerald-500 border-emerald-500/20" },
  confirmed: { variant: "outline" },
  superseded: { variant: "outline" },
  deprecated: { variant: "destructive" },
  promoted: { className: "bg-emerald-500/15 text-emerald-500 border-emerald-500/20" },
}

/**
 * The Learned half — heading, count line, then either the rows or the state's sentence.
 *
 * THE COUNT LINE AND THE SENTENCE ARE DIFFERENT CLAIMS and both can be present. `curated 3 facts,
 * deprecated 1` says what the frozen row recorded; `Change records for this run are not available
 * yet.` says none of it reached this run's change log. Dropping either would leave a reader unable
 * to tell an unattributed change from a run that changed nothing.
 *
 * `proposals` IS A SIBLING, NOT A MEMBER (D-11). A pending proposal outlives the curation that
 * produced it, so its line renders under every state — including `pending` and `failed`, where the
 * half above it has nothing to list but the inbox still has something waiting.
 */
export function KnowledgeLearned({
  view,
  proposals,
}: {
  view: LearnedView
  proposals?: ProposalsView | undefined
}) {
  return (
    <section
      data-learned-state={view.state}
      {...(view.scanIncomplete === true ? { "data-learned-read": "incomplete" } : {})}
      data-learned-snapshot={view.curationSnapshot === undefined ? "absent" : "recorded"}
      {...(view.curationSnapshot?.sinceThenCount === undefined
        ? {}
        : { "data-learned-since-then": String(view.curationSnapshot.sinceThenCount) })}
      className="space-y-2"
    >
      <div className="flex flex-wrap items-baseline gap-2">
        <h4 className={HEADING_CLASS}>{LEARNED_HEADING}</h4>
        {view.countLine === undefined ? null : (
          <span data-learned-count-line className="text-xs text-muted-foreground tabular-nums">
            {view.countLine}
          </span>
        )}
      </div>

      {/*
        WHAT THE COUNT LINE COULD NOT RECORD, LABELLED (425-06 · D-18). A pre-423 pair is a
        coarser measurement, not a breakdown with three buckets missing, and a withheld snapshot
        is a refusal rather than a zero — so the absence gets its own paragraph beneath the
        heading row. It is a SECOND ELEMENT and not a second clause on the count line, so a reader
        scanning counts reads counts, and a cell can assert the absence rather than a substring.
      */}
      {view.countNote === undefined ? null : (
        <p data-learned-count-note className="text-xs text-muted-foreground">
          {view.countNote}
        </p>
      )}

      {/*
        THE GAP, AND THEN ITS CAUSE (425-06 · D-19). Two paragraphs rather than one sentence: the
        first is arithmetic a reader can check against the rows below it, the second is an account
        of that arithmetic the read had to justify. The block sits directly under the counts it
        reconciles — a mismatch explained at the bottom of a long list is a mismatch a reader
        scrolls past — and it is ABSENT, never blank, on every run whose numbers agree.
      */}
      {view.curationSnapshot?.reconciliation === undefined ? null : (
        <div data-learned-reconciliation className="space-y-1">
          <p
            data-learned-reconciliation-count
            className="text-xs text-muted-foreground tabular-nums"
          >
            {view.curationSnapshot.reconciliation.count}
          </p>
          <p
            data-learned-reconciliation-cause
            className="text-xs text-muted-foreground tabular-nums"
          >
            {view.curationSnapshot.reconciliation.cause}
          </p>
        </div>
      )}

      {view.sentence === undefined ? null : (
        <p data-learned-sentence className="text-sm text-muted-foreground">
          {view.sentence}
        </p>
      )}

      {view.rows.length === 0 ? null : (
        <ul className="space-y-2">
          {view.rows.map(row => (
            <RecordRow key={row.key} row={row} />
          ))}
        </ul>
      )}

      {/*
        THE CHAIN'S FATE, BENEATH THE RECORDS AND NEVER INSTEAD OF THEM (407-26 · REVIEW CR-01 /
        G-407-12 · owner ruling 2026-08-31). The rows above are what a failed chain committed
        before it stopped; this paragraph says what happened to the chain that wrote them. It rides
        under the list, so a reader is never shown a sentence standing where the records should be.

        IT REPORTS THE CHAIN; THE PARAGRAPH BELOW REPORTS THE READ. That is why they are two
        elements and not one: the op degrades those two enrichments independently, so a view
        carrying both facts prints both, each addressable on its own attribute.

        CHAIN FIRST, THEN READ, because this note is about the list a reader is already looking at
        and the one below is about how much of the store anyone could see at all.
      */}
      {view.chainNote === undefined ? null : (
        <p data-learned-chain-note className="text-xs text-muted-foreground">
          {view.chainNote}
        </p>
      )}

      {/*
        BENEATH the answer, never instead of it. `readNote` is present exactly where the view was
        degraded AND is not already printing the unreadable-store sentence, so this paragraph and
        `[data-learned-sentence]` never both name the store (407-18).
      */}
      {view.readNote === undefined ? null : (
        <p data-learned-read-note className="text-xs text-muted-foreground">
          {view.readNote}
        </p>
      )}

      {proposals === undefined ? null : (
        <p
          data-pending-proposals={String(proposals.count)}
          className="flex flex-wrap items-baseline gap-2 text-sm text-muted-foreground"
        >
          <span className="tabular-nums">{proposals.line}</span>
          {/*
            THE CTA IS A RUNNABLE COMMAND, NOT A ROUTE (423 D-19 · SC5). No dashboard inbox exists,
            so the control shows and copies `ProposalsView.command`; `ctaText` names it for
            assistive technology. Both come from `lib/knowledge-view.ts`.
          */}
          <ReviewCommandButton
            data-review-proposals
            command={proposals.command}
            label={proposals.ctaText}
            className="font-mono text-xs text-primary underline-offset-4 hover:underline"
          />
        </p>
      )}
    </section>
  )
}

/**
 * One changed record: what happened to it, the address it happened to, and its id.
 *
 * THE ID IS ALWAYS RENDERED and the reference is not. A change record's id is a content-derived
 * bundle id far more often than it is an entity short-ID, so most rows carry no canonical
 * reference at all — and a row that showed only a reference would render blank for those. The id
 * is the one thing every row has, so it is the one thing every row prints.
 *
 * THREE RENDERINGS OF THE REFERENCE, and the middle one is the point. Routed → an anchor. Present
 * but unrouted → the URI as text, because this build can say WHAT the row points at without being
 * able to say where to click (`ENTITY_KIND_ROUTES.MEM` is `null` under the DASH-03 contract).
 * Absent → nothing, because inventing an address for an unaddressable record is the guessed link
 * D-10 forbids.
 *
 * AND THAT SAME FACT IS WHY THE ID NEEDS AN INTRINSIC BREAK (407-23 · G-407-2): a content-derived
 * bundle id is one unbroken token, so `wrap-anywhere` (`overflow-wrap: anywhere`) is what lets this
 * baseline row shrink it — `break-word` permits a break only after the box has already been sized,
 * which is not soon enough for an item sized from its own content. The reference beside it solves
 * the same problem the other way, with `truncate max-w-[32rem]`, and is left exactly as it is.
 */
function RecordRow({ row }: { row: LearnedRowView }) {
  return (
    <li
      data-record-change={row.kind}
      data-record-id={row.recordId}
      {...(row.section === undefined ? {} : { "data-learned-section": row.section })}
      className="flex flex-wrap items-baseline gap-2 text-sm"
    >
      <Badge {...KIND_LOOK[row.kind]}>{row.kind}</Badge>
      {row.promotionPath === undefined ? null : (
        <span
          data-promotion-path={row.promotionPath}
          data-promotion-receipt={row.promotionReceiptDigest ?? ''}
          className="text-xs text-muted-foreground wrap-anywhere"
        >
          promoted via {promotionPathLabel(row.promotionPath)}
          {row.promotionReceiptDigest ? ` · ${row.promotionReceiptDigest.slice(0, 12)}` : ''}
        </span>
      )}
      {row.ref === undefined ? null : row.href === undefined ? (
        <span data-record-ref className="truncate max-w-[32rem] text-muted-foreground">
          {row.ref}
        </span>
      ) : (
        <Link
          data-record-ref
          to={row.href}
          title={row.ref}
          className="truncate max-w-[32rem] text-primary underline-offset-4 hover:underline"
        >
          {row.ref}
        </Link>
      )}
      <span data-record-id-text className="font-mono text-xs text-muted-foreground wrap-anywhere">
        {row.recordId}
      </span>
    </li>
  )
}
