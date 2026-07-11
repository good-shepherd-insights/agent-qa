/**
 * ROOT-03 corpus membership entries (D-02/D-03) — the corpus/ unit of the
 * D-09 pure label factory.
 *
 * Store law (D-02): one file per entry — append-only corpus by
 * construction. Adding a case never rewrites another entry, git diffs show
 * exactly which cases joined, and parallel seeding runs cannot conflict on
 * a shared manifest.
 *
 * Provenance law (ROOT-03): every entry carries provenance sufficient for
 * M3's "no run that bred a candidate may gate it" exclusion — the source
 * run identity, its build ordinal, its handoff location, and the receipt
 * digest binding the entry to the exact captured decision.
 */
import { sha256hex } from '@vostride/agent-qa-schema'
import type { ScopeKey } from '@vostride/agent-qa-schema'
import { canonicalJson } from '../canonical-json'
import type { LeafCassette } from '../cassette/cassette'
import { deriveRunSlug } from '../extract/ids'

/** Single version gate for the corpus-entry document (D-02). */
export const CORPUS_ENTRY_SCHEMA_VERSION = 1

/**
 * The only v50 split value. Adversarial/held-out splits are M3 curator
 * territory and deliberately NOT in the union yet — adding them later is an
 * additive union widening.
 */
export type CorpusSplit = 'natural'

/** Links back to the source run for ROOT-03's exclusion enforcement. */
export interface CorpusRunLinks {
  /** Source run identity as a plain wire string. */
  runId: string
  /** Traversal-safe slug derived from the run id. */
  runSlug: string
  /**
   * Caller-supplied location of the source run handoff. Eval core cannot
   * import runner-local path constants — the seeding helper and the CLI
   * compose this value and pass it in as data.
   */
  handoffPath: string
}

/** One corpus membership unit — the exact bytes committed per case (D-02). */
export interface CorpusEntry {
  /** Version gate (D-02). */
  schemaVersion: 1
  /** Deterministic cassette identity this entry admits (D-02). */
  cassetteId: string
  /** Resolved product-partition name (D-03). */
  product: string
  /** Corpus split; 'natural' is the only v50 value. */
  split: CorpusSplit
  /**
   * Requirement-verbatim key from ROOT-03 (captured_at_ordinal); kept
   * verbatim so the committed JSON greps against the requirement text —
   * CONTEXT explicitly frees the key choice. Equals receipt.buildOrdinal.
   */
  captured_at_ordinal: number
  /**
   * Requirement-verbatim key from ROOT-03 (run_links); kept verbatim so the
   * committed JSON greps against the requirement text.
   */
  run_links: CorpusRunLinks
  /** Digest of the canonical-serialized cassette receipt. */
  receiptDigest: string
}

export interface ProjectCorpusEntryInput {
  cassette: LeafCassette
  product: string
  runId: string
  handoffPath: string
}

/** Project one admitted cassette into its committed corpus entry (D-02/ROOT-03). */
export function projectCorpusEntry({
  cassette,
  product,
  runId,
  handoffPath,
}: ProjectCorpusEntryInput): CorpusEntry {
  return {
    schemaVersion: CORPUS_ENTRY_SCHEMA_VERSION,
    cassetteId: cassette.id,
    product,
    split: 'natural',
    captured_at_ordinal: cassette.receipt.buildOrdinal,
    run_links: {
      runId,
      runSlug: deriveRunSlug(runId),
      handoffPath,
    },
    receiptDigest: sha256hex(canonicalJson(cassette.receipt)),
  }
}

/**
 * Resolve the D-03 product-partition key from a run scope. A 'product' tier
 * with a real name passes through; an unnamed or 'unknown' product and any
 * non-product tier map to the typed 'default' partition (Research A1).
 */
export function resolveProductPartition(scope: ScopeKey): string {
  if (scope.tier === 'product' && scope.key !== '' && scope.key !== 'unknown') {
    return scope.key
  }
  return 'default'
}
