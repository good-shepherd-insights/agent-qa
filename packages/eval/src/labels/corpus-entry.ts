/**
 * ROOT-03 corpus membership entries (D-02/D-03) — the corpus/ unit of the
 * D-09 pure label factory, widened to schema version 2 by phase 414.
 *
 * Store law (D-02): one file per entry — append-only corpus by
 * construction. Adding a case never rewrites another entry, git diffs show
 * exactly which cases joined, and parallel seeding runs cannot conflict on
 * a shared manifest.
 *
 * Provenance law (ROOT-03): every entry carries provenance sufficient for
 * M3's "no run that bred a candidate may gate it" exclusion — the source
 * run identity, its build ordinal, and the receipt digest binding the entry
 * to the exact captured decision.
 *
 * 414 D-13: `run_links.handoffPath` is GONE. The handoff location was
 * always a convention of the slug (`.agent-qa/runs/<runSlug>/handoff.json`),
 * so a strict v2 schema cannot carry a path at all — absolute or relative.
 * That is ROOT-08's "the committed entry schema forbids absolute paths" in
 * its strongest, structural form rather than as a regex.
 *
 * 414 D-03/D-21: the entry is now a discriminated union on `split`. A
 * held-out arm carries `heldOutVisibility`, the adversarial arm carries
 * `generator`, and each is present ONLY on its own arm — D-21's presence
 * rule holds in both directions by construction, not by a runtime check.
 *
 * 414 D-04: `captured_at` and `targetEnvironment` are OPTIONAL and never
 * fabricated. They arrive as DATA (module discipline bans clock APIs in
 * eval core, so no caller can synthesize them here); the seeder
 * and the migration derive them where they resolve and omit them otherwise.
 *
 * 414 D-22 (the v54 deletion bar): every closed set below is projected into
 * a `satisfies`-pinned literal list declared directly beneath its type. The
 * `satisfies` clause makes an entry naming no member a compile error; the
 * reverse direction (a member no entry names) is pinned by the runtime
 * cells in `__tests__/corpus-splits.test.ts` and the never-bars in
 * `__tests__/corpus-entry.test-d.ts`. Widening or narrowing any of the
 * three sets therefore REDs a test that names what joined or left.
 */
import { sha256hex } from '@vostride/agent-qa-schema'
import type { Benefit, ScopeKey } from '@vostride/agent-qa-schema'
import { canonicalJson } from '../canonical-json'
import type { LeafCassette } from '../cassette/cassette'
import { deriveRunSlug } from '../extract/ids'

/** Single version gate for the corpus-entry document (D-02, bumped by 414 D-03). */
export const CORPUS_ENTRY_SCHEMA_VERSION = 2

/**
 * The three corpus splits (414 D-03). `natural` is the optimise set,
 * `held-out` the gated set the proposer may not train on, `adversarial` the
 * generated set 422 will populate.
 */
export type CorpusSplit = 'natural' | 'held-out' | 'adversarial'

/** Declaration-order projection of `CorpusSplit` (D-22). */
export const CORPUS_SPLITS = [
  'natural',
  'held-out',
  'adversarial',
] as const satisfies readonly CorpusSplit[]

/**
 * Visibility of a held-out entry (414 D-18/D-19). `shared` is a validation
 * set the proposer may read; `private` is the unseen test set that is
 * unlistable, unloadable and uncountable through the `/reader` port.
 */
export type HeldOutVisibility = 'shared' | 'private'

/** Declaration-order projection of `HeldOutVisibility` (D-22). */
export const HELD_OUT_VISIBILITIES = [
  'shared',
  'private',
] as const satisfies readonly HeldOutVisibility[]

/**
 * How an adversarial entry was generated (414 D-21). The vocabulary takes
 * its full shape now — zero values persist until 422 — so that 422 adds a
 * member through the bar rather than creating the bar.
 */
export type GeneratorKind =
  | 'fuzz-selector'
  | 'fuzz-label'
  | 'fuzz-error'
  | 'injection-name'
  | 'optimized-trigger'
  | 'judge-targeted'

/** Declaration-order projection of `GeneratorKind` (D-22). */
export const GENERATOR_KINDS = [
  'fuzz-selector',
  'fuzz-label',
  'fuzz-error',
  'injection-name',
  'optimized-trigger',
  'judge-targeted',
] as const satisfies readonly GeneratorKind[]

/**
 * 2026-09-11, 422 D-09/D-11/D-12: the two `GeneratorKind` members an LLM AUTHORS.
 *
 * DERIVED by `Extract` rather than declared a second time. A separate declaration would let
 * the two lists drift — a probe kind renamed in `GeneratorKind` would leave this one naming a
 * member that no longer exists — while the projection below keeps the `satisfies` bar pointing
 * at the same six-member union every census and gate-set already reads. The union is NOT
 * widened by 422 (D-05): the probe kinds have been declared since 414 and only now acquire a
 * producer.
 */
export type ProbeGeneratorKind = Extract<GeneratorKind, 'judge-targeted' | 'optimized-trigger'>

/** Declaration-order projection of `ProbeGeneratorKind` (D-22). */
export const PROBE_GENERATOR_KINDS = [
  'judge-targeted',
  'optimized-trigger',
] as const satisfies readonly ProbeGeneratorKind[]

/** Is this generator kind authored by a model rather than drawn from a frozen table? */
export function isProbeGeneratorKind(kind: GeneratorKind): kind is ProbeGeneratorKind {
  return (PROBE_GENERATOR_KINDS as readonly GeneratorKind[]).includes(kind)
}

/**
 * Which environment the source run executed against (414 D-04). Optional
 * and never fabricated; 418 reads it for validity down-weighting.
 */
export type TargetEnvironment = 'shared' | 'local'

/**
 * 2026-09-11, 422 D-05: the mutation FAMILY a derived entry came from.
 *
 * `GeneratorKind` names the FIELD that was perturbed and stays at six
 * members; the family that supplied the perturbation rides beside it as its
 * own closed set, so a new family is an additive field value rather than a
 * widening of the six-member union every census and gate-set already reads.
 * The eleven members are the frozen table families of
 * `../adversarial/tables`; `tables.ts` imports this union rather than
 * declaring a second one, so the table map and the persisted vocabulary are
 * one definition under the D-22 bar.
 */
export type AdversarialMutator =
  | 'confusable'
  | 'invisible'
  | 'tag-block'
  | 'injection-template'
  | 'benign-case'
  | 'benign-whitespace'
  | 'benign-punctuation'
  | 'benign-digit'
  | 'benign-truncate'
  | 'benign-plural'
  | 'benign-synonym'

/** Declaration-order projection of `AdversarialMutator` (D-22). */
export const ADVERSARIAL_MUTATORS = [
  'confusable',
  'invisible',
  'tag-block',
  'injection-template',
  'benign-case',
  'benign-whitespace',
  'benign-punctuation',
  'benign-digit',
  'benign-truncate',
  'benign-plural',
  'benign-synonym',
] as const satisfies readonly AdversarialMutator[]

/**
 * 2026-09-11, 422 D-11: the model that AUTHORED an LLM-derived probe.
 *
 * Both fields are DISCLOSURE, not authority: `id` is the configured model identity the host
 * resolved and `family` its resolved provider family. D-12 permits the configured judge to
 * author probes aimed at itself precisely BECAUSE the entry names its author — a judge that
 * fools itself is a result the number can attribute rather than a contamination it cannot see.
 * Planner-family exclusion is the CLI preflight's job (D-09) and is deliberately not a
 * property of these bytes.
 */
export interface AuthoringModel {
  /** Configured model identity, exactly as the host resolved it. */
  id: string
  /** Resolved provider family, as the judge-family resolver spells it. */
  family: string
}

/** Adversarial provenance: which generator minted this entry, from what seed (D-21). */
export interface CorpusGenerator {
  /** Closed-set generator family (D-21/D-22). */
  kind: GeneratorKind
  /** The natural cassette the generator perturbed. */
  seedCassetteId: string
  /** Version of that generator's recipe; a change is a named migration. */
  generatorVersion: number
  /**
   * 2026-09-11, 422 D-05: the mutation family. ADDITIVE-OPTIONAL — zero
   * committed entries carry it before 422, so no
   * CORPUS_ENTRY_SCHEMA_VERSION bump is owed and a pre-422 entry still
   * parses through the same guard arm.
   */
  mutator?: AdversarialMutator
  /**
   * 2026-09-11, 422 D-08: the frozen table GENERATION this variant was
   * derived under. A bump mints new derived ids, so the previous
   * generation's committed entries keep gating until a reviewed rotation
   * retires them.
   */
  tableVersion?: number
  /** 2026-09-11, 422 D-08: pinned hash of that generation's frozen tables. */
  tableHash?: string
  /**
   * 2026-09-11, 422 D-11/D-12: the model that authored this probe's text.
   * ADDITIVE-OPTIONAL and present only on the two probe kinds.
   */
  authoringModel?: AuthoringModel
  /**
   * 2026-09-11, 422 D-11: the frozen prompt VERSION the probe was authored under. Present
   * only on the two probe kinds; a prompt re-wording bumps it and mints new probe ids.
   */
  promptVersion?: number
}

/**
 * 2026-09-11, 422 D-05/D-11: what provenance a generator stamp actually carries.
 *
 * Two derivation paths now mint adversarial entries and they stamp DIFFERENT provenance. A
 * table-drawn variant names `mutator` + `tableVersion` + `tableHash`; an LLM-authored probe has
 * no mutation family at all and names `authoringModel` + `promptVersion` instead. A
 * generation-only stamp is the legacy shape that predates 422 and stays readable forever.
 *
 * Everything else is `malformed` — and that deliberately includes a stamp that is complete but
 * belongs to the OTHER path. A `judge-targeted` entry naming a `mutator` would claim a frozen
 * table drew text no table contains, and a `confusable` entry naming an `authoringModel` would
 * credit a model for a substitution made by a pure function. Both are provenance that cannot
 * be true, which is exactly what a refusal is for.
 */
export type GeneratorProvenance = 'absent' | 'table' | 'probe' | 'malformed'

/** Declaration-order projection of `GeneratorProvenance` (D-22). */
export const GENERATOR_PROVENANCES = [
  'absent',
  'table',
  'probe',
  'malformed',
] as const satisfies readonly GeneratorProvenance[]

/**
 * The ONE completeness rule. The corpus guard, the label factory and the strict label reader
 * all ask this function rather than each re-spelling the field arithmetic — three spellings of
 * "is this provenance complete" is three places for them to disagree.
 */
export function generatorProvenance(generator: CorpusGenerator): GeneratorProvenance {
  const table = [generator.mutator, generator.tableVersion, generator.tableHash].filter(
    field => field !== undefined,
  ).length
  const probe = [generator.authoringModel, generator.promptVersion].filter(
    field => field !== undefined,
  ).length
  const probeKind = isProbeGeneratorKind(generator.kind)
  if (table === 0 && probe === 0) return 'absent'
  if (table === 3 && probe === 0) return probeKind ? 'malformed' : 'table'
  if (probe === 2 && table === 0) return probeKind ? 'probe' : 'malformed'
  return 'malformed'
}

/**
 * Links back to the source run for ROOT-03's exclusion enforcement.
 *
 * 414 D-13: exactly two fields. No path of any kind may appear here.
 */
export interface CorpusRunLinks {
  /** Source run identity as a plain wire string. */
  runId: string
  /** Traversal-safe slug derived from the run id. */
  runSlug: string
}

/** Fields every split arm carries (414 D-03). */
export interface CorpusEntryBase {
  // 2026-09-08, 418 D-24: optional feedback DATA on v2, absent on ordinary entries.
  source?: 'canary-feedback'
  attributedObservationId?: string
  benefit?: Benefit
  /** Version gate (D-02, 414 D-03). */
  schemaVersion: 2
  /** Deterministic cassette identity this entry admits (D-02). */
  cassetteId: string
  /** Resolved product-partition name (D-03). */
  product: string
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
  /** ISO wall-clock capture time (414 D-04). Omitted when it does not resolve. */
  captured_at?: string
  /** Environment the source run executed against (414 D-04). Omitted when unknown. */
  targetEnvironment?: TargetEnvironment
}

/** The optimise set: the proposer may read and train on these (D-19). */
export interface NaturalCorpusEntry extends CorpusEntryBase {
  split: 'natural'
}

/** A visible validation entry: readable by the proposer, still gated on (D-19). */
export interface SharedHeldOutCorpusEntry extends CorpusEntryBase {
  split: 'held-out'
  heldOutVisibility: 'shared'
}

/** The unseen test set: gates, but is unreachable through `/reader` (D-18/D-19). */
export interface PrivateHeldOutCorpusEntry extends CorpusEntryBase {
  split: 'held-out'
  heldOutVisibility: 'private'
}

/** A generated entry (D-21); 422 mints these, 414 only types them. */
export interface AdversarialCorpusEntry extends CorpusEntryBase {
  split: 'adversarial'
  generator: CorpusGenerator
}

/** One corpus membership unit — the exact bytes committed per case (D-02/D-03). */
export type CorpusEntry =
  | NaturalCorpusEntry
  | SharedHeldOutCorpusEntry
  | PrivateHeldOutCorpusEntry
  | AdversarialCorpusEntry

/**
 * What the proposer's read port may return (414 D-18/D-19). DERIVED from
 * `CorpusEntry` by exclusion, never declared a second time — that is what
 * keeps the `/reader` never-bar non-vacuous when a new arm joins.
 */
export type ProposerVisibleCorpusEntry = Exclude<CorpusEntry, PrivateHeldOutCorpusEntry>

/** Narrow an entry to the proposer-visible set: private held-out is the only exclusion. */
export function isProposerVisibleEntry(entry: CorpusEntry): entry is ProposerVisibleCorpusEntry {
  return !(entry.split === 'held-out' && entry.heldOutVisibility === 'private')
}

/**
 * The split-carrying half of an entry, supplied to `projectCorpusEntry` as
 * an INPUT (414 D-07/T-414-03). The split is decided BEFORE the entry is
 * projected, so no post-hoc relabel path exists anywhere.
 */
export type SplitAssignment =
  | { split: 'natural' }
  | { split: 'held-out'; heldOutVisibility: HeldOutVisibility }
  | { split: 'adversarial'; generator: CorpusGenerator }

export interface ProjectCorpusEntryInput {
  feedback?: { attributedObservationId: string; benefit: Benefit }
  cassette: LeafCassette
  product: string
  runId: string
  /** Decided by `assignSplit` (or by the migration) before projection. */
  assignment: SplitAssignment
  /** D-04 ISO capture time as DATA; omitted when the caller cannot derive it. */
  capturedAt?: string
  /** D-04 target environment as DATA; omitted when the caller cannot derive it. */
  targetEnvironment?: TargetEnvironment
}

/** Project one admitted cassette into its committed corpus entry (D-02/ROOT-03). */
export function projectCorpusEntry({
  cassette,
  product,
  runId,
  assignment,
  capturedAt,
  targetEnvironment,
  feedback,
}: ProjectCorpusEntryInput): CorpusEntry {
  const base: CorpusEntryBase = {
    schemaVersion: CORPUS_ENTRY_SCHEMA_VERSION,
    cassetteId: cassette.id,
    product,
    // 2026-09-08, ROOT-03: feedback retains the actual receipt ordinal and breeding run.
    captured_at_ordinal: cassette.receipt.buildOrdinal,
    run_links: {
      runId,
      runSlug: deriveRunSlug(runId),
    },
    receiptDigest: sha256hex(canonicalJson(cassette.receipt)),
    // Optional-spread, never an undefined key: committedFileText is
    // canonical and a committed document must not carry a key it has no
    // value for (D-04).
    ...(capturedAt === undefined ? {} : { captured_at: capturedAt }),
    ...(targetEnvironment === undefined ? {} : { targetEnvironment }),
    ...(feedback === undefined ? {} : { source: 'canary-feedback' as const, ...feedback }),
  }
  return { ...base, ...assignment }
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
