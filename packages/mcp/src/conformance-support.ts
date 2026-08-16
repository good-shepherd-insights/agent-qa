// The ONE lens two schema-comparison suites look through (2026-08-16, Phase 397 D-06 · MCPS-02).
//
// WHAT THIS FILE IS. Three normalisations that make an advertised JSON-Schema document and the
// function layer's own inert projection comparable, and NOTHING ELSE. It converts nothing, builds
// nothing, reaches nothing: the functions below are pure, take plain objects, return plain objects,
// and name no package. That is why the file adds no entry to this package's dependency census —
// there is no specifier in it to add.
//
// WHY IT MOVED HERE OUT OF A TEST. It was authored inside `projection-fidelity.test.ts`, where it
// had exactly one consumer. Phase 397's conformance suite lives in `packages/cli` and needs the
// same lens for its structural-schema-equality leg, and no package may reach another package's
// `__tests__` directory. The two ways out were to publish the lens or to re-derive it, and D-06
// rules out the second by name: a second conversion recipe for one comparison is the
// redundant-mechanism trap, and the way it fails is silent — the copy that drifts looser is the
// one that passes over real drift, and nothing compares the two copies to each other.
//
// SO THE TWO CONSUMERS SHARE ONE OBJECT: this package's own fidelity suite, and 397's parity suite
// over in the cli package. A third would be a third consumer of the same object, not a third lens.
//
// WHY THE THREE NORMALISATIONS EXIST AT ALL (MCPS-07's citation, and the honest one). Both stamps
// they remove are artifacts of the SDK's own conversion under SEP-2106's full JSON Schema 2020-12
// posture for tool input/output schemas, produced by the converter SEP-1613 pins on the SDK side:
// the `$schema` dialect marker it writes, and the `type: "object"` it adds to a composition root it
// can prove is object-shaped. The function layer's projection speaks the same vocabulary and writes
// neither. Nothing here normalises a difference the PRODUCT introduced — only two the transport's
// converter did.
//
// READ THE DOCSTRINGS BEFORE WIDENING ANYTHING. Each normalisation is gated as narrowly as it is
// for a MEASURED reason, recorded in its own comment. A strip that dropped content rather than a
// dialect marker or an SDK stamp would be the way to make a drift cell pass over a contract that
// genuinely moved — which is the one failure the suites consuming this file exist to catch.

/** A JSON-Schema document as it travels: an ordinary object, with nothing runnable on it. */
export type JsonDocument = Record<string, unknown>

/**
 * Drop `$schema`, which the SDK's conversion stamps and the registry's projection does not.
 *
 * A DIALECT MARKER, not content: it says which JSON Schema draft the document speaks and describes
 * nothing about the contract. Removing it is the one normalisation this file performs, and it is
 * called out rather than buried because a normalisation that removed content would be the way to
 * make a drift cell pass over real drift.
 */
export function withoutDialect(document: unknown): JsonDocument {
  const { $schema: _dialect, ...rest } = (document ?? {}) as JsonDocument
  return stripRedundantObjectStamp(rest)
}

/**
 * Drop the `type: "object"` the SDK stamps onto a COMPOSITION root.
 *
 * The second and last normalisation, and it is as narrow as the first. `standardSchemaToJsonSchema`
 * stamps `type: "object"` on a typeless root it can prove is object-shaped — a `oneOf` whose every
 * member is `type: "object"`, which is exactly what a zod discriminated union emits. The SDK's own
 * comment calls the stamp "redundant-but-valid", and a document is not changed by adding a
 * constraint every one of its branches already imposes.
 *
 * IT IS GATED ON THE COMPOSITION KEYWORD, so a genuine `type` disagreement still reds: the only
 * case dropped is a root that carries `oneOf`/`anyOf` AND the stamp, which is the one case the SDK
 * manufactures. An ungated `delete document.type` would have made the whole drift cell blind to a
 * contract whose root type actually moved.
 */
export function stripRedundantObjectStamp(document: JsonDocument): JsonDocument {
  const composed = document.oneOf !== undefined || document.anyOf !== undefined
  if (!composed || document.type !== 'object') return document
  const { type: _stamp, ...rest } = document
  return rest
}

/**
 * One advertised union arm, with the fold's discriminant taken back out.
 *
 * `required: []` is DROPPED rather than kept, and the case is real rather than defensive:
 * `config.undo.propose` takes an all-optional input, so its own projection carries no `required`
 * key at all while the extended arm carries `['action']` — and removing the discriminant from that
 * leaves an empty array where the other side has nothing. JSON Schema reads an absent `required`
 * and an empty one identically, so the two documents agree; keeping the empty array would have
 * failed the cell on a difference that describes no difference.
 */
export function armWithoutDiscriminant(arm: JsonDocument, discriminant: string): JsonDocument {
  const properties = { ...((arm.properties ?? {}) as JsonDocument) }
  delete properties[discriminant]
  const required = ((arm.required ?? []) as readonly string[]).filter((key) => key !== discriminant)
  const rebuilt: JsonDocument = { ...arm, properties, required }
  if (required.length === 0) delete rebuilt.required
  return rebuilt
}
