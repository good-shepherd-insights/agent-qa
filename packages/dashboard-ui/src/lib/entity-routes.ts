// Entity routes: hrefs are minted from ENTITY_KIND_ROUTES over an entity's own address, never
// copied from a url an op result carried. A kind this dashboard does not route gets no route.

import {
  ENTITY_DASHBOARD_ROUTES,
  parseEntityUri,
  type EntityKind,
} from '@vostride/agent-qa-schema'

import { routes } from '@/lib/routes'

// `machineId` is optional: a bare agentqa:// reference carries a short-ID and nothing else.
export interface EntityRouteAddress {
  readonly kind: EntityKind
  readonly shortId: string
  readonly machineId?: string
}

export type EntityRouteResolver = (address: EntityRouteAddress) => string | undefined

// TST and RUN pages are keyed by machine id, so a short-ID alone resolves to no route.
export const ENTITY_KIND_ROUTES = {
  TST: ({ machineId }) => (machineId === undefined ? undefined : routes.testView(machineId)),
  RUN: ({ machineId }) => (machineId === undefined ? undefined : routes.runDetail(machineId)),
  MEM: null,
  POL: null,
  TGT: () => routes.config,
} as const satisfies Record<EntityKind, EntityRouteResolver | null>

// The routed/unrouted partition must match the schema contract, checked by tsc.
type RoutePartitionOfContract = {
  [K in EntityKind]: (typeof ENTITY_DASHBOARD_ROUTES)[K]['route'] extends null
    ? null
    : EntityRouteResolver
}
const ROUTE_PARTITION_MATCHES_CONTRACT: RoutePartitionOfContract = ENTITY_KIND_ROUTES
void ROUTE_PARTITION_MATCHES_CONTRACT

export function entityRouteFor(address: EntityRouteAddress): string | undefined {
  const resolver = ENTITY_KIND_ROUTES[address.kind]
  return resolver === null ? undefined : resolver(address)
}

export function entityRefRoute(ref: string): string | undefined {
  const parsed = parseEntityUri(ref)
  return parsed === undefined
    ? undefined
    : entityRouteFor({ kind: parsed.kind, shortId: parsed.shortId })
}
