// The entity resolver, tier (a) (Phase 387, ENTY-01 / D-01 / D-07 / D-09).
//
// Three tiers are designed; ONE ships here, and the shape is what lets the other two land
// without an architectural change:
//
//   (a) EXACT — an anchored address parse plus a ledger hit, or an exact machine-id
//       sighting. Deterministic, no ranking, no model, score 1.0. THIS FILE.
//   (b) strong hit over the hybrid entity index — 387-03.
//   (c) top-3 disambiguation card — 387-03.
//
// The never-guess contract is enforced structurally rather than by a threshold: with tier
// (b) absent, anything tier (a) cannot answer EXACTLY returns the typed `none` arm. That is
// deliberately a worse experience than guessing and a much better one than being wrong —
// ENTY-01 names mis-linking a failing run to the wrong entity as the QA hazard this whole
// mechanism exists to prevent, and a resolver that answered "probably that one" would have
// shipped exactly that hazard behind a confident-looking card.
//
// Nothing in this file consults a model, a clock-dependent ordering, or any nondeterministic
// tie-break. Two calls with the same ledger and the same sighting sources answer identically.
//
// D-01's lazy mint lives here: an entity gets its permanent address the first time something
// SIGHTS it, which is this function. No creation path anywhere calls the ledger.

import {
  ENTITY_EXACT_MATCH_SCORE,
  canonicalShortId,
  formatEntityUri,
  parseEntityUri,
  parseShortId,
} from '@vostride/agent-qa-schema'
import type { EntityDescriptor, EntityKind, EntityResolution } from '@vostride/agent-qa-schema'

import type { AddressingLedger } from '../addressing/ledger.js'

/**
 * One store's answer to "do you own an entity with exactly this machine id?".
 *
 * A port rather than a switch over kinds, because each kind's machine ids live behind a
 * different store and the tracer wires only one of them. 387-03 adds sources for the
 * remaining kinds and neither this function nor its callers change.
 */
export interface EntitySightingSource {
  readonly kind: EntityKind
  /** The entity with this exact machine id, or `undefined`. Never a fuzzy match. */
  sight(machineId: string): EntitySighting | undefined
  /** The entity a minted address maps back to, for rendering a ledger hit. */
  hydrate(machineId: string): EntitySighting | undefined
}

/** What a store reports about one of its entities. Facts only — no card, no address. */
export interface EntitySighting {
  readonly machineId: string
  readonly title: string
  /**
   * The status as the OWNING store reports it. Validated against the kind's closed union at
   * the card boundary (D-12), not here: this layer reports, the producer renders, and the
   * schema refuses. Three responsibilities, three places.
   */
  readonly statusSource: string
}

export interface ResolveEntityRefDeps {
  readonly ledger: AddressingLedger
  readonly sources: readonly EntitySightingSource[]
}

function describe(
  kind: EntityKind,
  shortId: string,
  sighting: EntitySighting,
): EntityDescriptor {
  return {
    kind,
    shortId,
    uri: formatEntityUri(kind, shortId),
    machineId: sighting.machineId,
    title: sighting.title,
    statusSource: sighting.statusSource,
  }
}

function sourceFor(
  sources: readonly EntitySightingSource[],
  kind: EntityKind,
): EntitySightingSource | undefined {
  return sources.find((source) => source.kind === kind)
}

/**
 * Resolve one already-minted address, or say why it does not resolve.
 *
 * Shared by the short-ID arm and the URI arm so the two spellings of one address cannot
 * diverge — the URI leg canonicalises to a short-ID and then joins this path, rather than
 * running a second, parallel lookup that could drift.
 */
function resolveMintedAddress(
  shortId: string,
  kind: EntityKind,
  deps: ResolveEntityRefDeps,
): EntityResolution {
  // Reserved before unknown: `BUG-7` is a well-formed address in a family this build cannot
  // mint (D-03), and reporting it as merely unknown would send a caller looking for a bug the
  // ledger simply has not seen yet.
  if (kind === 'BUG') return { kind: 'none', reason: 'reserved-kind' }

  const address = deps.ledger.lookupByShortId(shortId)
  if (address === undefined) return { kind: 'none', reason: 'unknown-address' }

  const source = sourceFor(deps.sources, kind)
  const sighting = source?.hydrate(address.machineId)
  if (sighting === undefined) {
    // D-04's honest-status half is 387-07's: a permanent address whose entity is gone must
    // still resolve, to a card whose status says what happened. Until that landing this build
    // says it cannot describe the entity rather than inventing a status for it. It never
    // reports the address as unknown — the address IS known, and saying otherwise would be
    // the dead link D-04 forbids.
    return { kind: 'none', reason: 'unknown-address', closestSuggestion: address.shortId }
  }

  return {
    kind: 'resolved',
    descriptor: describe(kind, address.shortId, sighting),
    score: ENTITY_EXACT_MATCH_SCORE,
  }
}

/**
 * Tier (a): resolve a reference, minting on first sighting (D-01).
 *
 * Order matters and is fixed: URI, then short-ID, then exact machine id. Addresses are tried
 * before machine ids because an address is unambiguous by construction, and a machine id that
 * happened to LOOK like a short-ID would otherwise be able to shadow a published address.
 */
export function resolveEntityRef(ref: string, deps: ResolveEntityRefDeps): EntityResolution {
  const trimmed = ref.trim()
  if (trimmed === '') return { kind: 'none', reason: 'no-match' }

  const uri = parseEntityUri(trimmed)
  if (uri !== undefined) return resolveMintedAddress(uri.shortId, uri.kind, deps)

  const shortId = parseShortId(trimmed)
  if (shortId !== undefined) {
    const canonical = canonicalShortId(trimmed)
    if (canonical !== undefined) return resolveMintedAddress(canonical, shortId.kind, deps)
  }

  // The sighting leg. EXACT machine-id equality only — this is not a search, and the sources
  // are consulted in their registered order so the answer does not depend on iteration
  // accidents.
  for (const source of deps.sources) {
    const sighting = source.sight(trimmed)
    if (sighting === undefined) continue
    if (source.kind === 'BUG') return { kind: 'none', reason: 'reserved-kind' }

    // First sighting mints (D-01). Idempotent in the ledger, so a re-sighting returns the
    // address that is already published rather than a second one.
    const address = deps.ledger.mint(source.kind, sighting.machineId)
    return {
      kind: 'resolved',
      descriptor: describe(source.kind, address.shortId, sighting),
      score: ENTITY_EXACT_MATCH_SCORE,
    }
  }

  // Tier (b) is 387-03's. Until it lands, free text that matched no address and no machine id
  // is a miss and says so.
  return { kind: 'none', reason: 'no-match' }
}

/**
 * `entities.get`'s read path: the descriptor for an EXACT address, or `undefined`.
 *
 * Deliberately narrower than `resolveEntityRef` — it neither mints nor consults the sighting
 * leg. `get` means "I already have the address", and a `get` that could mint would make every
 * card render a potential write.
 */
export function getEntityDescriptor(
  ref: string,
  deps: ResolveEntityRefDeps,
): EntityDescriptor | undefined {
  const trimmed = ref.trim()
  const uri = parseEntityUri(trimmed)
  const shortId = uri?.shortId ?? canonicalShortId(trimmed)
  const kind = uri?.kind ?? parseShortId(trimmed)?.kind
  if (shortId === undefined || kind === undefined) return undefined

  // Reaches `resolveMintedAddress`, never the sighting leg, so no `get` can mint.
  const outcome = resolveMintedAddress(shortId, kind, deps)
  return outcome.kind === 'resolved' ? outcome.descriptor : undefined
}
