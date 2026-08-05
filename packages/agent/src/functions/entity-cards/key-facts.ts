// The per-kind `keyFacts[]` projections (Phase 387, ENTY-02 / D-04 / D-12 / D-19).
//
// D-12: a key fact is COMPUTED DETERMINISTICALLY FROM STORE DATA and is never LLM-authored.
// This module is where that promise is kept, and it is kept structurally rather than by
// discipline: every function here is a pure function of values it is handed, it imports
// nothing but the schema vocabulary, and it has no parameter through which a model, a clock,
// a filesystem or a network could be reached. A companion source scan asserts the absence of
// a model import with a planted-violation control, because "no LLM wrote this" is exactly the
// kind of claim that is easy to state and easy to stop being true.
//
// WHAT A KIND MAY SAY IS A TABLE, not a switch — `KEY_FACT_PROJECTIONS` is written
// `satisfies Record<EntityKind, …>`, so a seventh kind is a type error here rather than a
// card that silently renders the generic facts. That table is also the SEAM the phase's
// stubs land on: today an `EntityDescriptor` carries the identity a store reported, the title,
// the status and (for a renamed target) the successor, and nothing else, because only the
// `MEM` sighting source is registered in any composition (387-01, unchanged by 387-03). A run's
// verdict ordinal and a bundle's record count are facts the store does not yet HAND anybody,
// and inventing labels for values nothing produces would be exactly the LLM-authored-content
// failure this module exists to exclude, wearing a deterministic costume. Each kind's richer
// facts land in its row below on the day its sighting source reports them.
//
// The one place richer content exists TODAY is the forget receipt (D-19), which is designed
// to be both the apply verb's return value and the content a forgotten entity's permanent
// address resolves to afterwards (D-04). `forgetReceiptKeyFacts` is that second use.

import { formatEntityUri } from '@vostride/agent-qa-schema'
import type {
  EntityDescriptor,
  EntityKind,
  ForgetReceiptV1,
  KeyFact,
  QuarantineEntryState,
} from '@vostride/agent-qa-schema'

/**
 * What each kind CALLS the machine id its address maps FROM.
 *
 * One fact every kind carries, under the kind's own noun. The label is the whole per-kind
 * content of this fact and it is not cosmetic: `bundle id` and `run id` send a reader to
 * different places to correlate, and a card that said `machine id` for both would make the
 * reader guess which store to look in. A table rather than six literals so a kind cannot be
 * added without answering the question.
 */
export const ENTITY_IDENTITY_FACT_LABELS = {
  TST: 'test id',
  RUN: 'run id',
  BUG: 'reserved address',
  MEM: 'bundle id',
  POL: 'policy id',
  TGT: 'target name',
} as const satisfies Record<EntityKind, string>

/** The label the D-03 rename fact renders under, named once so a test can pin it. */
export const ENTITY_RENAMED_TO_FACT_LABEL = 'renamed to'

/**
 * The labels a quarantined `TST` card projects under, in the order they render (390 D-12/D-17).
 *
 * Three facts, and the third is the only interesting choice. D-17 puts the OCCURRENCE COUNT
 * ("3rd occurrence in 5 builds") in the rendered sentence, where a live provider join can compute
 * it; this producer is pure by construction and takes no ports, so it carries the occurrence
 * context the LEDGER ITSELF records — which class of failure recurred, and since when. Reaching
 * for the count here would mean giving the card producer a store handle, which is the one thing
 * ENTY-02's determinism claim rests on it not having.
 */
export const QUARANTINE_FACT_LABELS = {
  owner: 'quarantine owner',
  expires: 'quarantine expires',
  occurrence: 'quarantine occurrence',
} as const

/** The labels a forget receipt projects under, in the order they render (D-19). */
export const FORGET_RECEIPT_FACT_LABELS = {
  records: 'records forgotten',
  recordIds: 'record ids',
  projections: 'projections scrubbed',
  forgottenAt: 'forgotten at',
} as const

function identityFact(descriptor: EntityDescriptor): KeyFact {
  return {
    label: ENTITY_IDENTITY_FACT_LABELS[descriptor.kind],
    value: descriptor.machineId,
  }
}

/**
 * D-03's "with its rename visible", made literal.
 *
 * The old address keeps resolving to the old name — anything else would make an existing CI
 * log's reference quietly mean a different target — and the card is where a reader learns
 * what it became.
 *
 * It is reachable only from the `TGT` row of the table below, and the successor URI is built
 * for `TGT` unconditionally, which is why there is no `kind === 'TGT'` guard in here. There
 * WAS one, and a mutation probe measured it inert: with it removed every case still passed,
 * because the only thing that decides which kinds show a rename is the table. A second guard
 * that agrees with the table today is a second place the rule could stop being true with
 * nothing comparing them (387-01 D-1, same finding). The table is the one mechanism, and the
 * probe that pins it adds this projection to a kind that must not have it.
 */
function renameFact(descriptor: EntityDescriptor): KeyFact[] {
  if (descriptor.successorMachineId === undefined) return []
  return [{
    label: ENTITY_RENAMED_TO_FACT_LABEL,
    value: descriptor.successorMachineId,
    ref: formatEntityUri('TGT', `TGT-${descriptor.successorMachineId}`),
  }]
}

/**
 * An open quarantine window rendered as facts (390 D-12).
 *
 * Reached only from the `TST` row of the table below, and only for an entry the join already
 * decided is suppressing — an expired or released window contributes NOTHING here, because the
 * card's status says `active` for both and a fact announcing a quarantine beside it would be the
 * card contradicting itself.
 */
function quarantineFacts(entry: QuarantineEntryState | undefined): KeyFact[] {
  if (entry === undefined) return []
  return [
    { label: QUARANTINE_FACT_LABELS.owner, value: entry.owner },
    { label: QUARANTINE_FACT_LABELS.expires, value: entry.expiresAt },
    {
      label: QUARANTINE_FACT_LABELS.occurrence,
      value: `${entry.verdictClass} failures recurring; quarantined since ${entry.enteredAt}`,
    },
  ]
}

/**
 * A forget receipt rendered as facts (D-19 + D-04).
 *
 * The record ids are rendered as ONE fact carrying the whole list rather than as one fact per
 * record, and that is the reconciliation of two rules that would otherwise fight: D-19 says
 * forgetting a bundle lists every member record and nothing is silently partial, while the
 * card contract bounds the number of facts. A per-record fact would have had to be truncated,
 * which is precisely the silent partiality D-19 forbids; a single fact carrying the full list
 * keeps the enumeration complete and the card scannable.
 *
 * Ids are SORTED. A receipt's own array order is whatever the forget verb walked, and a card
 * whose facts reorder between two renders of unchanged state is not deterministic (ENTY-02's
 * ordering edge). Sorting is what makes the projection a function of the receipt's CONTENT
 * rather than of the order it happened to arrive in.
 */
export function forgetReceiptKeyFacts(receipt: ForgetReceiptV1): KeyFact[] {
  const recordIds = [...receipt.tombstonedRecords]
    .map((record) => record.recordId)
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
  const projections = [...receipt.projectionsScrubbed].sort(
    (left, right) => (left < right ? -1 : left > right ? 1 : 0),
  )

  return [
    {
      label: FORGET_RECEIPT_FACT_LABELS.records,
      value: String(recordIds.length),
    },
    ...(recordIds.length === 0 ? [] : [{
      label: FORGET_RECEIPT_FACT_LABELS.recordIds,
      value: recordIds.join(', '),
    }]),
    ...(projections.length === 0 ? [] : [{
      label: FORGET_RECEIPT_FACT_LABELS.projections,
      value: projections.join(', '),
    }]),
    {
      label: FORGET_RECEIPT_FACT_LABELS.forgottenAt,
      value: new Date(receipt.forgottenAt).toISOString(),
    },
  ]
}

/** What a projection is handed: the store's descriptor, plus the receipt when one survives. */
export interface KeyFactInput {
  readonly descriptor: EntityDescriptor
  /** The forget receipt for a forgotten `MEM` bundle (D-04/D-19), when the caller holds one. */
  readonly forgetReceipt?: ForgetReceiptV1
  /**
   * The SUPPRESSING quarantine window for a `TST` entity (390), already joined by the producer.
   *
   * Handed in as a value for the same reason the receipt is: this module is pure over what it is
   * given, and a member through which a ledger could be read would be a port in disguise. The
   * join itself is spelled once, beside the status it also decides.
   */
  readonly quarantineEntry?: QuarantineEntryState
}

type KeyFactProjection = (input: KeyFactInput) => KeyFact[]

/**
 * THE per-kind projection table.
 *
 * `satisfies Record<EntityKind, …>` is the completeness guarantee: adding a seventh kind and
 * forgetting to say what its card shows is a type error, not a card that renders whatever the
 * fallback happened to be. There is deliberately no fallback.
 */
export const KEY_FACT_PROJECTIONS = {
  TST: ({ descriptor, quarantineEntry }) => [
    identityFact(descriptor),
    ...quarantineFacts(quarantineEntry),
  ],
  RUN: ({ descriptor }) => [identityFact(descriptor)],
  // A reserved family (D-03) has no entity behind the address, so the address itself under its
  // own label is the whole honest content.
  BUG: ({ descriptor }) => [identityFact(descriptor)],
  MEM: ({ descriptor, forgetReceipt }) => [
    identityFact(descriptor),
    ...(forgetReceipt === undefined ? [] : forgetReceiptKeyFacts(forgetReceipt)),
  ],
  POL: ({ descriptor }) => [identityFact(descriptor)],
  TGT: ({ descriptor }) => [identityFact(descriptor), ...renameFact(descriptor)],
} as const satisfies Record<EntityKind, KeyFactProjection>

/**
 * Project one entity's key facts (D-12).
 *
 * BOUNDED BY CONSTRUCTION, not by truncation, and the difference is the whole reason the
 * receipt renders as it does. Every row above emits a fixed, small number of facts whatever
 * its input contains — the receipt's record ids are ONE fact carrying the whole list rather
 * than one fact per record — so no store state can push a card past
 * `ENTITY_CARD_MAX_KEY_FACTS` and the schema's `.max()` can never fire.
 *
 * An earlier revision truncated here with a `.slice()`. A mutation probe measured it
 * unreachable: removing it left every case green, because the largest projection any input
 * can produce is five facts. It was a second bound that agreed with the first, and it would
 * have been the WRONG repair anyway — silently dropping the tail of a forget receipt is
 * exactly the silent partiality D-19 forbids. What replaced it is a test that exhausts the
 * projection table and a probe that makes the enumeration per-record, which is the mutation
 * the bound actually protects against.
 */
export function projectKeyFacts(input: KeyFactInput): KeyFact[] {
  return KEY_FACT_PROJECTIONS[input.descriptor.kind](input)
}
