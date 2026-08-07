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
import type { FunctionDeps, FunctionSpec } from '../spec.js'
import { analysisGetSpec } from './analysis-get.js'
import { RunNotFoundError } from './runs-get.js'
import { projectPostProcessingChips, runsPostProcessingSpec } from './runs-post-processing.js'

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
function summaryLineFor(payload: KnowledgeProposalV1): string {
  const deltas = `${payload.deltas.length} delta${payload.deltas.length === 1 ? '' : 's'}`
  const tombstoned = payload.receiptPreview?.tombstonedRecords.length
  return [
    `${payload.verb} ${targetRefText(payload.targetRef)}`,
    deltas,
    ...(tombstoned === undefined ? [] : [`${tombstoned} to tombstone`]),
  ].join(', ')
}

function proposalRow(envelope: ProposalEnvelope): RunDigestProposalRow {
  return {
    id: envelope.id,
    shortId: envelope.id.slice(0, SHORT_ID_LENGTH),
    summaryLine: summaryLineFor(envelope.payload),
    requiredDecision: REQUIRED_DECISION[envelope.kind],
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

  lines.push(`chain — ${[
    `analysis: ${digest.chain.analysis}`,
    `curation: ${digest.chain.curation}`,
    `issues: ${digest.chain.issues}`,
    ...(digest.chain.outcome === undefined ? [] : [`chain ${digest.chain.outcome}`]),
  ].join(DIGEST_SEPARATOR)}`)

  const minted = digest.proposalsMintedThisRun
  const pending = `${digest.pendingProposalCount} pending overall`
  if (minted.length === 0) {
    lines.push(`proposals — none minted this run${DIGEST_SEPARATOR}${pending}`)
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
      },
      proposalsMintedThisRun: mintedThisRun.map((entry) => proposalRow(entry.envelope)),
      pendingProposalCount,
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
