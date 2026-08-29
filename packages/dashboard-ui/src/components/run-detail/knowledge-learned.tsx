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
// ROWS WIN OVER SENTENCES, and that ordering lives in `learnedView`, not here. This file paints
// whatever the view carries: the projection never hands it both a populated list and a sentence,
// because a sentence beside rows would be a second, quieter account of the same records (CR-04).
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

import { Badge } from "@/components/ui/badge"
import {
  LEARNED_HEADING,
  REVIEW_PROPOSALS_CTA,
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
            THE CTA WORDS ARE IMPORTED, like every other sentence in this tab (403-05 D-5).
            `ProposalsView.ctaText` carries the same constant for anything reading the projection
            rather than the DOM; the cells assert the two agree, so there is one spelling and it
            lives in `lib/knowledge-view.ts`.
          */}
          <Link
            data-review-proposals
            to={proposals.href}
            className="text-primary underline-offset-4 hover:underline"
          >
            {REVIEW_PROPOSALS_CTA}
          </Link>
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
 */
function RecordRow({ row }: { row: LearnedRowView }) {
  return (
    <li
      data-record-change={row.kind}
      data-record-id={row.recordId}
      className="flex flex-wrap items-baseline gap-2 text-sm"
    >
      <Badge {...KIND_LOOK[row.kind]}>{row.kind}</Badge>
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
      <span data-record-id-text className="font-mono text-xs text-muted-foreground">
        {row.recordId}
      </span>
    </li>
  )
}
