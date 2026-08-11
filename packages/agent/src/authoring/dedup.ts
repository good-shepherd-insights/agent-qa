// Stage 2 — dedup-before-author, the deterministic suite-wide text lane (Phase 394, D-04/D-16).
//
// WHAT THIS LANE DOES, in order:
//
//   1. Score the caller's INTENT against every test in the authored suite, through the shipped
//      `textOverlap` and no other recipe.
//   2. Keep the highest-scoring member, breaking a tie on the lexicographically smallest
//      workspace-relative identity path.
//   3. Refuse when that score is at or above the pinned threshold, naming the member, the score,
//      the shared-token count that produced it, and the two continuations an author can take.
//   4. Otherwise admit, still reporting the closest member so a caller can see what it was
//      nearly.
//
// WHY IT IS DETERMINISTIC, and why that is the point rather than a limitation. An intent has no
// execution fingerprint — nothing has been run, and nothing has even been authored — so 393's
// anchor-sequence recipe cannot fire here at all, and it is the reason this screen is worth doing
// before a model call rather than after one. No model judges duplication either: a
// non-deterministic filter cannot be proven against a frozen corpus, and a filter nobody can prove
// is a filter whose false-refusal rate is a matter of opinion. What this lane trades away is
// recall on a crafted paraphrase, and that is bounded rather than unowned — gate 3 remains the
// anchor-level backstop for near-duplicates that slip the text screen (T-394-15).
//
// WHY THE FAILURE DIRECTION IS TOWARD REFUSE. Not re-argued here: `adds-value.ts`'s own comment on
// `TEXT_FALLBACK_SIMILARITY_THRESHOLD` states the asymmetry for the same comparison on the same
// normalizer, and one statement of a rule is the whole point of reusing the mechanics.
//
// WHAT IT COSTS TO BE WRONG, per direction, is what the threshold comment below measures.

import { AUTHORING_DEDUP_CONTINUATIONS } from '@vostride/agent-qa-schema'
import type { AuthoringDedupContinuation } from '@vostride/agent-qa-schema'

import { textOverlap } from './adds-value.js'
import type { SuiteTestIdentity, SuiteTextCorpusEntryLike } from './ports.js'

/**
 * Similarity at or above which an intent is refused as a near-duplicate of an existing test.
 *
 * A PINNED CONSTANT, never config (386 D-15).
 *
 * IT SITS BELOW GATE 3's, DELIBERATELY. `TEXT_FALLBACK_SIMILARITY_THRESHOLD` is 0.5; this is 0.45.
 * The two answer different questions on the same scale — gate 3 asks whether a draft that has
 * already been authored and run adds value, and this asks whether an intent already exists — and
 * the costs of being wrong are not symmetric between them. An over-flagging pre-run screen costs
 * ONE refused invocation the user can re-issue deliberately after reading which test it matched.
 * An under-flagging one costs a duplicate test in the suite, which is paid on every run forever
 * and which nothing downstream will remove.
 *
 * RETUNE, AND IT IS A MEASUREMENT RATHER THAN A PREFERENCE. Before moving this number, re-run the
 * frozen corpus at `__tests__/fixtures/dedup-corpus/expectations.json` and report three things:
 *   (a) WHICH ROWS MOVE. The corpus carries a boundary triple — 0.4482758621, 0.4500000000 and
 *       0.4516129032 — so the immediate neighbourhood is already instrumented. The value is
 *       0.45 rather than a rounder number because 0.45 is the value the corpus can sit EXACTLY
 *       on: the at-threshold document's nine tokens are all `uat-381-ladder` tokens, so its
 *       Jaccard is 9/20, which is the same IEEE-754 double as the literal here. A pin no row can
 *       land on to the digit makes the `>=` direction a coin flip with a constant next to it.
 *   (b) THE FALSE-REFUSAL RATE ON THE ACCEPT CONTROLS. The corpus's accept control tops out at
 *       0.4166666667 against the suite, so there is 0.0333 of headroom below and it is the
 *       narrowest margin in the table. Note that this number MOVES with the comparison universe:
 *       393 measured the same text at 0.4074 by scoring it against one file, and reading the whole
 *       suite raised it. A threshold inherited from a narrower universe is measured on a different
 *       instrument.
 *   (c) THE WALL-CLOCK COST PER REFUSED INVOCATION. A refusal here is strictly cheaper than the
 *       alternative — one token-set intersection per suite member against one model call plus N
 *       gate-runs at roughly 22s each — which is why over-flagging is affordable at all. Report it
 *       rather than assuming it, because it is the number that stops being true first if the lane
 *       ever grows a per-comparison cost.
 *
 * A retune that only argues from intuition is the failure this comment exists to prevent.
 */
export const DEDUP_REFUSE_SIMILARITY_THRESHOLD = 0.45

/**
 * What a refusal NAMES. Every field is evidence a reader can act on, not a summary of a verdict.
 *
 * `matchedRef` is the reference a caller hands to `entities.resolve`, spelled
 * `<filePath>::<testName>` — the same spelling `adds-value.ts`'s gate reason already prints, so
 * the two surfaces that name a suite test name it the same way.
 *
 * IT IS NOT A `TST-###` SHORT-ID, and that is measured rather than an omission. `ENTITY_KINDS`
 * reserves `TST`, but a short-ID exists only once something SIGHTS the entity, and sighting is
 * what mints the permanent address — `resolver/resolve.ts` states that no creation path anywhere
 * calls the ledger, so a refusal could not mint one without becoming a write on a read path.
 * Measured further: `composeLocalAgent()` wires exactly one sighting source, the memory one, so
 * NO suite test has a `TST-###` on any host in this build. Printing one would publish an address
 * that resolves to nothing, which is precisely ENTY-01's never-guess failure. The durable identity
 * is what this build can name truthfully, so it is what the refusal names; when a `TST` sighting
 * source lands, this field is the one place that has to change.
 *
 * `threshold` rides along because a refusal that reports 0.52 without reporting what it was
 * compared to tells an author nothing about whether their draft was borderline.
 */
export interface DedupEvidence {
  readonly score: number
  readonly matched: SuiteTestIdentity
  readonly matchedRef: string
  readonly sharedTokens: number
  readonly threshold: number
}

/** The closest suite member, reported on BOTH arms so an admit can say what it was nearly. */
export interface DedupClosest {
  readonly filePath: string
  readonly testName: string
  readonly similarity: number
}

/**
 * How stage 2 read the suite, and the arm it took.
 *
 * `comparedTests` is on both arms and is the universe claim in one number: the comparison
 * population is EVERY test in the suite, not the fingerprint-covered subset gate 3's primary lane
 * speaks for. A draft duplicating a test the derived index has no rows for is still refused, and a
 * lane that filtered its input would report a smaller count before it reported a wrong match.
 *
 * `closest` is present whenever the corpus was non-empty. On the `duplicate` arm it is the same
 * member `evidence` names — two readings of one comparison, kept so a consumer that only wants
 * "what was it nearest" reads one field on both arms.
 */
export type DedupScreening =
  | {
    readonly kind: 'no-duplicate'
    readonly comparedTests: number
    readonly closest?: DedupClosest
  }
  | {
    readonly kind: 'duplicate'
    readonly comparedTests: number
    readonly closest: DedupClosest
    readonly evidence: DedupEvidence
    readonly continuations: readonly AuthoringDedupContinuation[]
  }

/** The `entities.resolve` reference for a suite test — the house spelling, in one place. */
export function dedupMatchRef(identity: SuiteTestIdentity): string {
  return `${identity.filePath}::${identity.testName}`
}

/**
 * Stage 2 — screen the intent against the authored suite, BEFORE anything is authored.
 *
 * The intent stands in for the draft's text because at this point there IS no draft, which is what
 * makes the screen worth doing at all. It is scored through `textOverlap`, the shipped comparison
 * gate 3's degraded lane already screens with (393 D-16), rather than through a second recipe: two
 * notions of "how alike are these two tests" would let the pre-authoring screen and the post-run
 * gate disagree about the same pair.
 *
 * THE TIE-BREAK IS PART OF THE CONTRACT, not an implementation detail. Two suite tests can score
 * identically — most easily when a suite carries the same test at two paths — and a lane that took
 * whichever the host happened to yield first would report a different duplicate on a re-run over
 * the same suite, which makes the refusal's link unreliable at exactly the moment a user is
 * deciding whether to trust it. The smallest workspace-relative identity path wins, so two
 * invocations against one suite name one test.
 */
export function dedupBeforeAuthor(
  intent: string,
  corpus: readonly SuiteTextCorpusEntryLike[],
): DedupScreening {
  let best: { readonly entry: SuiteTextCorpusEntryLike; readonly overlap: { score: number; sharedTokens: number } } | undefined

  for (const entry of corpus) {
    const overlap = textOverlap({ testName: intent, steps: [] }, entry)
    if (
      best === undefined
      || overlap.score > best.overlap.score
      // Strictly smaller, so the running best is only displaced by a genuinely earlier path. A
      // `<=` here would make the LAST of a tied group win and re-introduce iteration order.
      || (overlap.score === best.overlap.score && entry.filePath < best.entry.filePath)
    ) {
      best = { entry, overlap }
    }
  }

  if (best === undefined) return { kind: 'no-duplicate', comparedTests: corpus.length }

  const closest: DedupClosest = {
    filePath: best.entry.filePath,
    testName: best.entry.testName,
    similarity: best.overlap.score,
  }

  // `>=`, so a score sitting exactly on the pin reads as duplicate and the intent is refused.
  // Over-flagging toward refuse is the safe failure here for the reason the threshold's own
  // comment measures, and it is what makes a pin the corpus can land on exactly usable at all.
  if (best.overlap.score < DEDUP_REFUSE_SIMILARITY_THRESHOLD) {
    return { kind: 'no-duplicate', comparedTests: corpus.length, closest }
  }

  const matched: SuiteTestIdentity = {
    filePath: best.entry.filePath,
    testName: best.entry.testName,
  }
  return {
    kind: 'duplicate',
    comparedTests: corpus.length,
    closest,
    evidence: {
      score: best.overlap.score,
      matched,
      matchedRef: dedupMatchRef(matched),
      sharedTokens: best.overlap.sharedTokens,
      threshold: DEDUP_REFUSE_SIMILARITY_THRESHOLD,
    },
    continuations: AUTHORING_DEDUP_CONTINUATIONS,
  }
}
