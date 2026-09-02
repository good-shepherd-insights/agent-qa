// The entity card, rendered (Phase 400 plan 08, DASH-03 · 387 ENTY-02 / D-10 / D-11).
//
// THIS FILE RENDERS A CARD. IT DOES NOT BUILD ONE, and that is the whole of 387's one-producer law
// expressed as a file boundary: `packages/agent/src/functions/entity-cards/produce-card.ts` is the
// only code in this repo that constructs an `EntityCard`, the card arrives here as an OP RESULT
// (`entities.get` / `entities.resolve`), and everything below is a projection of that value. A
// component that assembled a card out of store reads would be a second producer — free to agree
// with the first until one of them is edited — and the chat card, the MCP `structuredContent` and
// this render would stop being three projections of one thing.
//
// THE HREF IS MINTED HERE AND NEVER COPIED OFF THE CARD (T-400-27). A card's `url` is
// CONFIG-DERIVED content on an op result: 387 D-10 composes it from `services.dashboard.baseUrl`,
// and 400-01's D-16 fills that key with the origin a dashboard bound. Two facts make it the wrong
// value for an `href` in this component:
//
//   1. IT ADDRESSES A DIFFERENT ROUTE TABLE. `formatEntityUrl` renders the pinned
//      `/t/:workspace/:kind/:shortId/:slug` shape — the M5 route table, which this build does not
//      serve. Rendering it as a link would be a dead link shown with confidence, the one thing
//      D-10 exists to prevent.
//   2. IT IS UNTRUSTED CONTENT. It reaches the browser as a string on a payload. A component that
//      turned a payload string into a destination has handed navigation to whatever wrote the
//      store.
//
// So links come from `ENTITY_KIND_ROUTES` — kind + the entity's own machine id — and a card's raw
// `url`, when this dashboard cannot route its kind, renders as TEXT. A reader can still read and
// copy the address; the browser is never told it is somewhere to go.
//
// WHAT `url`-ABSENT HONESTY IS HERE, AND WHAT IT IS NOT. The honest arm is keyed on whether THIS
// DASHBOARD ROUTES THE KIND, not on whether the card carried a `url`. An in-app path is served by
// this same app whether or not any base URL is configured; conditioning the link on `url` would
// suppress a working link on the ordinary posture, because the shipped dashboard composition
// overlays `services.dashboard.baseUrl` and leaves `services.dashboard.workspace` unset, which
// makes `url` ABSENT on most real cards. So: MEM and POL render zero link affordance — not a
// disabled anchor, not a `#`, not a span dressed as one — and TST, RUN and TGT link into the routes
// `app.tsx` actually registers.
//
// ACTIONS LEAVE THROUGH THE CHAT DOOR AND NOWHERE ELSE (P4 / T-400-26). A card's `actions[]` are
// registry op refs (D-11), and the button below turns one into the `/fn <op> <json>` utterance a
// person could have typed, handed to the same `sendTurn` the composer uses. The gate is the access
// control, and an invoke that reached the function layer by any other path would be one the gate
// never saw. This module therefore holds no fetch, no EventSource and no api import — a source
// assertion in `entity-card.test.ts` keeps that true after the next edit, because a prohibition
// nothing measures is a comment.

import { Link } from "react-router"

import {
  ENTITY_DASHBOARD_ROUTES,
  ENTITY_IDENTITY_FACT_LABELS,
  EntityCardResolutionSchema,
  EntityCardSchema,
  parseEntityUri,
  type ActionRef,
  type EntityCard as EntityCardValue,
  type EntityKind,
  type KeyFact,
} from "@vostride/agent-qa-schema"

import { routes } from "@/lib/routes"

/**
 * One entity, as much of it as this dashboard can address.
 *
 * `machineId` is OPTIONAL because the two things that name an entity carry different amounts: a
 * card carries its identity key fact, while a bare `agentqa://` reference carries an address and
 * nothing else. A resolver that took only a short-ID would have to invent the machine id for the
 * routes that are keyed by one, which is the guessed link D-10 forbids.
 */
export interface EntityRouteAddress {
  readonly kind: EntityKind
  readonly shortId: string
  readonly machineId?: string
}

/** A kind's dashboard route, or `undefined` when this address cannot produce an honest one. */
export type EntityRouteResolver = (address: EntityRouteAddress) => string | undefined

/**
 * THE kind → dashboard-route map, TOTAL over the card schema's kind union.
 *
 * `as const satisfies Record<EntityKind, …>` is the completeness guarantee, and it is the same move
 * `ENTITY_STATUSES`, `KEY_FACT_PROJECTIONS` and `ENTITY_ACTION_TABLES` make on the producer side: a
 * sixth kind is a compile error here rather than a card that silently renders whichever arm the
 * lookup happened to miss. There is deliberately no fallback and no default.
 *
 * `null` — not an absent key — is how a kind says it has no page here. An absent key would make an
 * intentional unrouted arm read exactly like a kind nobody has looked at yet, and those are the two
 * answers a reviewer needs to be able to tell apart.
 *
 * THE PATHS ARE `lib/routes.ts`'s builders, not strings retyped off the router. `routes.testView` and
 * `routes.runDetail` are the same builders every other page navigates with, so a route rename moves
 * the card's links with it instead of leaving them pointing at a path nothing serves.
 *
 * WHY `TST` AND `RUN` REFUSE WITHOUT A MACHINE ID. `/test/:t_id` and `/runs/:id` are keyed by the
 * machine id — `tests.tsx` navigates with `row.testId`, `run-detail` loads by run id — while an
 * entity's `id` is its PUBLISHED short-ID (`TST-001`), a different address in a different
 * namespace. Putting the short-ID in that slot would render a link that 404s, minted with
 * confidence. `TGT` takes no parameter at all: a target's page is the config surface.
 */
export const ENTITY_KIND_ROUTES = {
  TST: ({ machineId }) => (machineId === undefined ? undefined : routes.testView(machineId)),
  RUN: ({ machineId }) => (machineId === undefined ? undefined : routes.runDetail(machineId)),
  MEM: null,
  POL: null,
  TGT: () => routes.config,
} as const satisfies Record<EntityKind, EntityRouteResolver | null>

/**
 * The routed/unrouted partition above is the SHIPPED CONTRACT's, checked at compile time.
 *
 * `ENTITY_DASHBOARD_ROUTES` (schema, `entity/dashboard-route.ts`) is the one declaration the
 * conformance scenario table's card cases are also spread from. Without this line the map above and
 * that contract would be two tables agreeing today, and a kind could acquire or lose a page in one
 * of them silently — which is the exact drift a shared declaration exists to prevent. The mapped
 * type below makes a `null` here required wherever the contract says `route: null`, and a resolver
 * required wherever it names a path, so a disagreement is a `tsc` error rather than a card that
 * links somewhere nothing serves.
 *
 * The PATHS themselves are still built with `lib/routes.ts`'s builders (the ones every other page
 * navigates with) and are joined against the contract's templates by `entity-card.test.ts` — a
 * compile-time check can hold the partition, and only a rendered href can hold the shape.
 */
type RoutePartitionOfContract = {
  [K in EntityKind]: (typeof ENTITY_DASHBOARD_ROUTES)[K]["route"] extends null
    ? null
    : EntityRouteResolver
}
const ROUTE_PARTITION_MATCHES_CONTRACT: RoutePartitionOfContract = ENTITY_KIND_ROUTES
void ROUTE_PARTITION_MATCHES_CONTRACT

/** The route this address resolves to in THIS dashboard, or `undefined` — never a guess. */
export function entityRouteFor(address: EntityRouteAddress): string | undefined {
  const resolver = ENTITY_KIND_ROUTES[address.kind]
  return resolver === null ? undefined : resolver(address)
}

/**
 * The machine id a card publishes, read off the key fact THE CONTRACT names.
 *
 * `ENTITY_IDENTITY_FACT_LABELS` is the schema's own table (moved beside the card contract in
 * 400-08), so this is a contract read rather than a label guess. The two alternatives were both
 * wrong in the way this codebase has been bitten before: a literal `'test id'` here would be a
 * second copy of a per-kind noun, free to drift the day one is retuned; digging the id out of an
 * `actions[]` `inputSeed` would be addressing by coincidence, which `actions.ts`'s own header names
 * as the thing a seed must never be relied on for.
 */
export function entityCardMachineId(card: EntityCardValue): string | undefined {
  const label = ENTITY_IDENTITY_FACT_LABELS[card.kind]
  return card.keyFacts.find((fact) => fact.label === label)?.value
}

/** A card's own dashboard route, or `undefined` — the url-absent arm. */
export function entityCardRoute(card: EntityCardValue): string | undefined {
  const machineId = entityCardMachineId(card)
  return entityRouteFor({
    kind: card.kind,
    shortId: card.id,
    ...(machineId === undefined ? {} : { machineId }),
  })
}

/**
 * The `agentqa://` reference a key fact carries, resolved to a dashboard route.
 *
 * A reference has no machine id — it is an address and only an address — so the kinds whose routes
 * need one resolve to `undefined` here and the fact renders its URI as text. That is the honest
 * answer: this build can say WHAT the fact points at without being able to say where to click.
 */
export function entityRefRoute(ref: string): string | undefined {
  const parsed = parseEntityUri(ref)
  return parsed === undefined
    ? undefined
    : entityRouteFor({ kind: parsed.kind, shortId: parsed.shortId })
}

/**
 * The utterance one action becomes — the door's own `/fn <op> <json>` grammar (D-10).
 *
 * Assembled here and PARSED ON THE SERVER, exactly as a typed utterance is. The browser does not
 * parse directives (`use-chat-turn.ts`'s standing rule) and it does not invoke functions; it hands
 * the door a line, and the resolver table, the planner and the gate do the rest.
 */
export function entityCardActionUtterance(action: ActionRef): string {
  return `/fn ${action.functionId} ${JSON.stringify(action.inputSeed)}`
}

/**
 * Every entity card inside one op result, found by THE SCHEMA THAT DEFINES A CARD.
 *
 * `EntityCardSchema.safeParse` and `EntityCardResolutionSchema.safeParse`, never a `'kind' in
 * payload` shape check. The difference is not stylistic: the card schema superRefines cross-field
 * integrity — `kind`, `id` and `uri` are three spellings of ONE address — and a hand-rolled guard
 * accepts a payload whose three spellings disagree, then renders a card that resolves differently
 * depending on which field a reader's eye lands on. A second, weaker parser beside the one the op
 * validated with is the same defect class as a regex beside a URL parser.
 *
 * Both entity ops are covered because they answer with different shapes: `entities.get` returns the
 * card itself, `entities.resolve` returns the resolution union whose `resolved` arm carries one
 * card and whose `ambiguous` arm carries up to three.
 */
export function entityCardsIn(payload: unknown): readonly EntityCardValue[] {
  const direct = EntityCardSchema.safeParse(payload)
  if (direct.success) return [direct.data as EntityCardValue]

  const resolution = EntityCardResolutionSchema.safeParse(payload)
  if (!resolution.success) return []
  if (resolution.data.kind === "resolved") return [resolution.data.card as EntityCardValue]
  if (resolution.data.kind === "ambiguous") {
    return resolution.data.candidates.map((candidate) => candidate.card as EntityCardValue)
  }
  return []
}

export interface EntityCardProps {
  readonly card: EntityCardValue
  /** The chat door. The ONLY way out of this component. */
  readonly onSend: (utterance: string) => void
}

/**
 * One entity card.
 *
 * The fields are the pinned ones and the order is the card's own: who it is, what state it is in,
 * the deterministic facts the producer computed, then the next moves it advertises. Nothing is
 * added, and nothing that arrived is dropped — `keyFacts` renders complete, bounded by the schema's
 * `.max()` rather than by a slice here, because a truncating render is a drop path with a rule
 * attached and 387's producer already guarantees the bound.
 */
export function EntityCard({ card, onSend }: EntityCardProps) {
  const route = entityCardRoute(card)
  return (
    <div
      data-entity-card
      data-entity-kind={card.kind}
      className="flex flex-col gap-1.5 rounded-md border border-border bg-muted/20 px-3 py-2"
    >
      <div className="flex flex-wrap items-baseline gap-2">
        <span data-entity-id className="font-mono text-[11px] text-muted-foreground">
          {card.id}
        </span>
        {route === undefined ? (
          <span className="text-sm font-medium text-foreground">{card.title}</span>
        ) : (
          <Link
            data-entity-card-link
            to={route}
            className="text-sm font-medium text-foreground underline underline-offset-2 hover:text-primary"
          >
            {card.title}
          </Link>
        )}
        <span
          data-entity-status
          className="rounded-full border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground"
        >
          {card.status}
        </span>
      </div>

      <span data-entity-uri className="font-mono text-[10px] text-muted-foreground">
        {card.uri}
      </span>

      {/* T-400-27: an address this build cannot route is READABLE, never clickable. */}
      {card.url === undefined || route !== undefined ? null : (
        <span data-entity-url-text className="font-mono text-[10px] break-all text-muted-foreground">
          {card.url}
        </span>
      )}

      {card.keyFacts.length === 0 ? null : (
        <dl data-entity-key-facts className="flex flex-col gap-0.5">
          {card.keyFacts.map((fact) => (
            <KeyFactRow key={`${fact.label}:${fact.value}`} fact={fact} />
          ))}
        </dl>
      )}

      {card.actions.length === 0 ? null : (
        <div data-entity-actions className="flex flex-wrap gap-1 pt-0.5">
          {card.actions.map((action) => (
            <button
              key={action.functionId}
              type="button"
              data-entity-action={action.functionId}
              onClick={() => { onSend(entityCardActionUtterance(action)) }}
              className="rounded border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-accent"
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * One deterministic fact, with its `agentqa://` reference resolved when this build can route it.
 *
 * The URI is rendered as the fact's own text either way. A reference is an ADDRESS a person can
 * paste into chat, and it stays readable whether or not there is a page behind it here — which is
 * what makes the linked and unlinked arms the same claim rendered two ways rather than two
 * different amounts of information.
 */
function KeyFactRow({ fact }: { fact: KeyFact }) {
  const refRoute = fact.ref === undefined ? undefined : entityRefRoute(fact.ref)
  return (
    <div data-key-fact className="flex flex-wrap items-baseline gap-1.5 text-xs">
      <dt data-key-fact-label className="text-muted-foreground">{fact.label}</dt>
      <dd data-key-fact-value className="font-mono text-foreground">{fact.value}</dd>
      {fact.ref === undefined ? null : refRoute === undefined ? (
        <span data-key-fact-ref-text className="font-mono text-[10px] text-muted-foreground">
          {fact.ref}
        </span>
      ) : (
        <Link
          data-key-fact-ref
          to={refRoute}
          className="font-mono text-[10px] text-muted-foreground underline underline-offset-2 hover:text-primary"
        >
          {fact.ref}
        </Link>
      )}
    </div>
  )
}
