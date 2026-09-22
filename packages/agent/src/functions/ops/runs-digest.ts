// `runs.digest` — ONE run, one digest, composed live (Phase 391, D-16 / D-17 / D-18).
//
// PROP-04's complaint is a product complaint: an approval UX that fires forty times per nightly
// run is worse than one that fires once. The answer is not a throttle, a debounce or a batching
// window — every one of those is a timing knob with a wrong setting (386 D-15). The answer is a
// PROJECTION KEYED BY `runId`. A projection keyed by a run cannot fire per event, so "exactly
// one digest per run" is a property of the shape and not a rule anybody enforces.
//
// NOTHING IS PERSISTED HERE. The digest composes from four already-shipped read paths — the
// analysis op (389 D-11), the chain-state op (388 D-14), the proposals inbox (391 plan 03) and
// the quarantine ledger (390 D-13) — every time somebody asks. So there is nothing to drift,
// nothing to migrate, no second copy of a run's truth to reconcile, and the frozen counts-only
// notification row is left exactly as it was (D-16, T-391-18).
//
// THE TWO SIBLING OPS ARE INVOKED, NOT REIMPLEMENTED. `analysisGetSpec.invoke` and
// `runsPostProcessingSpec.invoke` are called with THIS call's deps, so the verdict sentences in
// a digest are the same bytes `analysis.get` serves and the chips are the same five words
// `runs.postprocessing` serves. That is 389 D-05/D-10 and 388 D-14 honoured by CALLING them
// rather than by a comment promising not to diverge. The specs are module-internal — nothing
// outside this package can reach them — so this is composition inside the layer, not a
// dispatch path around `invokeFunction`'s gate (T-384-01): every EXTERNAL caller still arrives
// through the pipeline, and this op declares its own read-only descriptor and read scopes.
//
// REFS AND COUNTS ONLY (D-18, T-391-17). No delta content, no forget-receipt tombstones, no
// rationale prose, no masked bytes. A proposal is a short id, a summary built from its own refs
// and delta COUNT, and the decision it awaits; full receipts stay behind `proposals.show`.

import {
  RunDigestSchema,
  RunsDigestInputSchema,
} from '@vostride/agent-qa-schema'
import type {
  KnowledgeProposalV1,
  KnowledgeTargetRef,
  PostProcessingStatus,
  ProposalEnvelope,
  ProposalInboxEntryDto,
  ProposalKind,
  QuarantineEntryState,
  RunDigest,
  RunDigestProposalRow,
  RunsDigestInput,
} from '@vostride/agent-qa-schema'

import { renderAnalysisClusterBlock } from '../../analysis/render-cluster-block.js'
import { FunctionNotBoundError } from '../spec.js'
import type { ClauseVerdict, FunctionDeps, FunctionSpec } from '../spec.js'
import { analysisGetSpec } from './analysis-get.js'
import { RunNotFoundError } from './runs-get.js'
import {
  projectPostProcessingChips,
  projectPostProcessingExclusion,
  runsPostProcessingSpec,
} from './runs-post-processing.js'

/**
 * Lowercase dot taxonomy (384 D-15): the `runs` domain, one noun.
 *
 * `runs.` rather than a new `digest.` domain, because what this returns is a fact ABOUT A RUN —
 * the same reason `runs.postprocessing` is not `postprocessing.get`. The exported constant is
 * what the CLI's `digest` verb, the tail's fetch pointer, 392's chat and M5 all name; the
 * literal appears here once, and the parity suite picks the id up from the registry.
 */
export const RUNS_DIGEST_FUNCTION_ID = 'runs.digest'

/** The line separator 388 pinned for the exit summary, reused so one story reads as one. */
const DIGEST_SEPARATOR = ' · '

/**
 * How much of a proposal id a rendered line carries.
 *
 * Twelve characters of a `prop_`-prefixed id — the prefix plus seven of the body — which is
 * enough to tell apart the handful of proposals one run mints while staying scannable in a
 * list. DISPLAY ONLY: {@link RunDigestProposalRow.id} carries the full id every decision verb
 * takes, so nothing addresses anything by this value and a collision costs a reader a glance
 * rather than a wrong decision.
 */
const SHORT_ID_LENGTH = 12

/**
 * What a human owes each kind of proposal, as a TOTAL record over the closed kind vocabulary.
 *
 * A `Record` rather than a default string: 393-396 add test-draft, config and MCP kinds, and a
 * fall-through would have shipped them into the digest wearing the knowledge kind's decision.
 * A new member fails to compile here until somebody says what deciding it means.
 */
const REQUIRED_DECISION: Record<ProposalKind, string> = {
  knowledge: 'accept or reject',
  // 394 D-05: accepting WRITES the draft into the suite and commits it, so the decision is about
  // the repository rather than about the knowledge store — and the line says so, because "accept
  // or reject" would read identically for two decisions with very different consequences.
  'test-draft': 'add this test to the suite, or reject it',
  // 395 CFGM-03: accepting COMMITS the change to the repository, so the line says commit rather
  // than "accept or reject" — the same distinction the test-draft row above draws, and for the same
  // reason: two decisions with very different consequences would otherwise read identically.
  config: 'apply this configuration change as a commit, or reject it',
}

/** A target ref as a REF — the id or short-ID it addresses, never the record's content. */
function targetRefText(target: KnowledgeTargetRef): string {
  return target.grain === 'record' ? target.recordId : target.shortId
}

/**
 * One line about a proposal, built from refs and counts and from nothing else (D-18).
 *
 * The verb and the target ref say what it is about; the delta count says how much it would
 * change; a forget's tombstone COUNT says how much it would remove. What is deliberately
 * absent: the deltas themselves, the tombstoned record ids, the projections to scrub, and the
 * reason text — all of which are on the payload, all of which are one `proposals.show` away,
 * and none of which belongs in a value three surfaces render directly.
 */
function knowledgeSummaryLine(payload: KnowledgeProposalV1): string {
  const deltas = `${payload.deltas.length} delta${payload.deltas.length === 1 ? '' : 's'}`
  const tombstoned = payload.receiptPreview?.tombstonedRecords.length
  return [
    `${payload.verb} ${targetRefText(payload.targetRef)}`,
    deltas,
    ...(tombstoned === undefined ? [] : [`${tombstoned} to tombstone`]),
  ].join(', ')
}

/**
 * One line per proposal, per kind — a THIRD exhaustive site over the kind vocabulary (394-06).
 *
 * It became one when the envelope's payload was correlated with its kind. Before that the digest
 * read `payload.verb` off a type that had exactly one arm; a kind added without a line here is now
 * a compile error at the `satisfies never` below, which is the same mechanism the two `Record`s
 * use and for the same reason: a fall-through would render a test draft wearing a knowledge
 * proposal's summary.
 *
 * Every arm is REFS AND COUNTS (D-18). The draft's steps and the run's evidence all stay one
 * `proposals.show` away.
 */
function summaryLineFor(envelope: ProposalEnvelope): string {
  switch (envelope.kind) {
    case 'knowledge':
      return knowledgeSummaryLine(envelope.payload)
    case 'test-draft':
      // BOTH figures, because one of them alone is the defect WTST-08 exists to prevent: the
      // actual with nothing to compare it against is unfalsifiable, and the preview alone reports
      // what was promised rather than what was spent (394-08, D-03).
      return `test draft ${envelope.payload.draftRef.testName}, `
        + `${envelope.payload.disposition}, ${envelope.payload.runsConsumed} run(s) `
        + `of up to ${envelope.payload.runsPreviewed} previewed`
    case 'config':
      // THE ONE-LINER AND THE FILE COUNT, AND NOTHING FROM INSIDE THE PAYLOAD. This arm is the one
      // that could most easily leak: the config payload carries the rendered diff's bytes and the
      // new file content, and a digest line that reached for either would print a person's
      // configuration into a report three surfaces render. `summaryLine` is what the construction
      // wrote for exactly this slot (391 D-18's refs-and-counts law), and the count is a count.
      //
      // 395-02's `blocked` arm narrows HERE, which is the whole reason `payloadKind` is a
      // discriminant: the blocked record is a REPORT and has no files to count, and a digest line
      // that reached for the scan findings would print a fingerprint of the very value the block
      // exists to keep off every surface. It says what was refused and why, in two words.
      return envelope.payload.payloadKind === 'blocked'
        ? `config ${envelope.payload.summaryLine}, blocked (${envelope.payload.blockedReason}), `
          + `${envelope.payload.paths.length} file(s)`
        : `config ${envelope.payload.summaryLine}, `
          + `${envelope.payload.files.length} file(s)`
          + `${envelope.payload.crossBoundary ? ', cross-boundary' : ''}`
    default:
      return envelope satisfies never
  }
}

function proposalRow(envelope: ProposalEnvelope): RunDigestProposalRow {
  return {
    id: envelope.id,
    shortId: envelope.id.slice(0, SHORT_ID_LENGTH),
    summaryLine: summaryLineFor(envelope),
    // WR-05: only a PENDING proposal is owed a decision. An applied, rejected or expired one is
    // listed because it is part of what this run produced, and asking a person to accept or
    // reject something already decided is an instruction they cannot carry out — so the slot
    // carries what BECAME of it instead. Every lifecycle member is a legal value here because
    // `RunDigestProposalRowSchema.requiredDecision` is a non-empty string rather than an enum.
    requiredDecision: envelope.status === 'pending'
      ? REQUIRED_DECISION[envelope.kind]
      : envelope.status,
  }
}

/** The durable identity legs, joined — never `testId`, which is per-run (390 D-13). */
function quarantineRef(entry: QuarantineEntryState): string {
  return `${entry.product}/${entry.filePath}::${entry.testName}`
}

/**
 * The rendered bytes every surface prints, composed ONCE here.
 *
 * A surface that laid these out for itself would be composing a second story about one run, and
 * the failure mode is not cosmetic: the tail's block, the CLI verb's output and 392's chat
 * would each be free to omit the section that happened to be empty on the day they were
 * written. Sections that have nothing to say still print their zero, because "no proposals were
 * minted" is a fact a person needs and an absent line is indistinguishable from a bug.
 */
function renderDigestLines(digest: Omit<RunDigest, 'lines'>): string[] {
  const lines: string[] = [`digest — ${digest.runId}`]

  // The analysis section, through the ONE block renderer. Empty for a run with no failures,
  // which prints nothing at all rather than a header saying there is nothing.
  const clusterBlock = renderAnalysisClusterBlock({
    runId: digest.runId,
    verdicts: [],
    sentences: [],
    clusters: digest.verdictClusters,
  })
  if (clusterBlock !== '') lines.push(clusterBlock)

  // 425 D-08: an excluded run has no chain to report on, so the two chip words would read
  // `pending` forever. The fact replaces them — in the same words the CLI exit line prints and
  // the dashboard paints — while the outcome clause keeps its own behaviour, because a row that
  // somehow carries both is still entitled to say what became of it.
  const excluded = digest.chain.exclusion
  lines.push(`chain — ${[
    ...(excluded === undefined
      ? [`analysis: ${digest.chain.analysis}`, `curation: ${digest.chain.curation}`]
      : [`analysis: excluded (${excluded.reason})`, `curation: excluded (${excluded.reason})`]),
    ...(digest.chain.outcome === undefined ? [] : [`chain ${digest.chain.outcome}`]),
  ].join(DIGEST_SEPARATOR)}`)

  const minted = digest.proposalsMintedThisRun
  const pending = `${digest.pendingProposalCount} pending overall`
  if (minted.length === 0) {
    // An empty list has TWO causes and they are not the same statement. "None minted this run"
    // is a measurement, and it is only available when something in the store carries a run to
    // range over; otherwise the digest would be asserting a negative about a key nothing
    // populated, one separator away from a pending count that contradicts it (T-391-21).
    lines.push(digest.runAttributionAvailable
      ? `proposals — none minted this run${DIGEST_SEPARATOR}${pending}`
      : `proposals — run attribution unavailable${DIGEST_SEPARATOR}${pending}`)
  } else {
    lines.push(
      `proposals — ${minted.length} minted this run${DIGEST_SEPARATOR}${pending}:`,
    )
    for (const row of minted) {
      lines.push(`  ${row.shortId}  ${row.summaryLine} — ${row.requiredDecision}`)
    }
  }

  lines.push(`candidates — ${digest.candidates.curated} curated${DIGEST_SEPARATOR}${
    digest.candidates.deprecated} deprecated`)

  lines.push(`quarantine — ${digest.quarantine.quarantined} quarantined${DIGEST_SEPARATOR}${
    digest.quarantine.expired} expired${
    digest.quarantine.refs.length === 0 ? '' : `: ${digest.quarantine.refs.join(', ')}`}`)

  return lines
}

export const runsDigestSpec: FunctionSpec<RunsDigestInput, RunDigest> = {
  id: RUNS_DIGEST_FUNCTION_ID,
  summary: "Compose one run's digest: verdicts, chain, proposals awaiting a decision, counts.",
  requiredScopes: ['read'],
  resultKind: 'unary',
  /**
   * Bound where a composition supplies the PROPOSALS store, and that choice is the digest's
   * subject rather than the largest of its inputs. A host that cannot open the proposals
   * directory would render a digest whose decision section reads "none minted this run" about
   * a store it has never been able to see — the one wrong answer that makes a person stop
   * checking (the inbox's own D-09 reasoning). The other three sections degrade honestly
   * instead: an unbound analysis reader means a run with no sentences yet, an unbound queue
   * means a chain nothing has been enqueued for, an unbound ledger means no quarantine.
   */
  boundThrough: 'proposalsInbox',
  input: RunsDigestInputSchema,
  output: RunDigestSchema,
  risk: { name: `fn:${RUNS_DIGEST_FUNCTION_ID}`, recognized: true, readOnly: true },
  /**
   * REFS AND COUNTS, which is this op's own law rather than a house style (399.1 D-01 · 391 D-18).
   *
   * The digest's `lines` are its rendered territory and they travel on `results[]`, which D-04
   * prints in full. A receipt line reaching into them would put a run's story inside the map — the
   * exact thing D-18 pinned this op's whole shape around.
   */
  classify(output): ClauseVerdict {
    return {
      status: 'executed',
      outcome: `digest for ${output.runId} — `
        + `${output.proposalsMintedThisRun.length} proposal(s) minted, `
        + `${output.pendingProposalCount} pending`,
    }
  },
  async invoke(input, deps: FunctionDeps) {
    const inbox = deps.proposalsInbox
    if (inbox === undefined) {
      throw new FunctionNotBoundError(RUNS_DIGEST_FUNCTION_ID)
    }

    const runId = String(input.runId)
    // A digest NAMES a run, so a run this host has never recorded is a refusal rather than a
    // page of zeros — and the check is here, against the REQUIRED runs port, so the refusal is
    // the same on a host with no analysis reader as on one that has it. Delegating it to the
    // analysis composition below would have made a correctness property depend on an optional
    // dep's presence.
    const document = await deps.runs.get(input.runId)
    if (document === undefined) {
      throw new RunNotFoundError(runId)
    }

    // Each section is composed only where its dep is present. Explicit presence checks rather
    // than a try/catch around the invocations: swallowing would also swallow a real failure
    // inside a bound path, and "the analysis reader threw" is not the same fact as "this host
    // has no analysis reader".
    const analysis = deps.analysis === undefined
      ? undefined
      : await analysisGetSpec.invoke({ runId: input.runId }, deps)
    const status: PostProcessingStatus | undefined = deps.postProcessing === undefined
      ? undefined
      : await runsPostProcessingSpec.invoke({ runId: input.runId }, deps)
    const quarantine: readonly QuarantineEntryState[] = deps.quarantine === undefined
      ? []
      : await deps.quarantine.list()

    // EVERY row, then two projections over rows already in hand — never two queries. The
    // filter preserves the store's order (minted-at, then id), which is where that law lives
    // and where it is pinned; a sort here would be a second declaration of it, free to agree
    // today and disagree after the first tie-break change (`proposals.list`'s own rule).
    const entries: readonly ProposalInboxEntryDto[] = await inbox.list()
    const mintedThisRun = entries.filter((entry) => entry.envelope.origin?.runId === runId)
    const pendingProposalCount = entries
      .filter((entry) => entry.envelope.status === 'pending').length

    const curation = status?.notification?.stages.curation
    // ONE FOLD, ONE PRODUCER (law 6). On the bound path the fact is minted once, by the fold
    // inside `runs.postprocessing`, and the digest publishes what that read carried rather than
    // deriving it again — an ordinary run's status carries no exclusion key, so a `??` fallback
    // here would re-derive on every ordinary run. The unbound arm is the one composition where no
    // fold ran: there the digest answers from the handoff it already loaded for its own refusal,
    // never from an empty chain, which is also what an in-flight run's chain looks like.
    const exclusion = status === undefined
      ? projectPostProcessingExclusion(document)
      : status.exclusion

    const sections: Omit<RunDigest, 'lines'> = {
      runId,
      // VERBATIM — the same cluster views, carrying the same already-composed representative
      // sentences the one renderer produced inside `analysis.get` (389 D-05/D-15).
      verdictClusters: analysis?.clusters ?? [],
      chain: {
        // `undefined` answers exactly as an empty chain does: nothing was enqueued for this
        // run, which is what a host with no queue database can honestly say (388's own note).
        ...projectPostProcessingChips(undefined),
        ...(status === undefined ? {} : status.chips),
        ...(status?.notification === undefined
          ? {}
          : { outcome: status.notification.outcome }),
        ...(exclusion === undefined ? {} : { exclusion }),
      },
      proposalsMintedThisRun: mintedThisRun.map((entry) => proposalRow(entry.envelope)),
      pendingProposalCount,
      // Computed over the SAME `entries` the filter above ranged over, not re-queried: the two
      // answers are about one read of one store, so a digest cannot report an empty batch and an
      // availability verdict taken a moment apart.
      runAttributionAvailable: entries.length === 0
        || entries.some((entry) => entry.envelope.origin?.runId !== undefined),
      candidates: {
        // Absent counts read as zero HERE and only here: the row omits them when curation never
        // committed a bundle (388 D-11), and a digest section is a place a person reads a
        // number rather than a place a distinction between "none" and "not yet" survives — the
        // chain chips one line up already carry that distinction.
        curated: curation?.curated ?? 0,
        deprecated: curation?.deprecated ?? 0,
      },
      quarantine: {
        quarantined: quarantine.filter((entry) => entry.state === 'quarantined').length,
        expired: quarantine.filter((entry) => entry.state === 'expired').length,
        // `released` entries are deliberately absent from both the counts and the refs: a
        // released test is one somebody already dealt with, and listing it every run would be
        // the graveyard 390 legislated against, one surface later.
        refs: quarantine
          .filter((entry) => entry.state === 'quarantined')
          .map(quarantineRef),
      },
    }

    return { ...sections, lines: renderDigestLines(sections) }
  },
}
