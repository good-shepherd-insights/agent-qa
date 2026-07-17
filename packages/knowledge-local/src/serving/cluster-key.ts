import {
  canonicalJson,
  normalizeAnchor,
  type Anchor,
} from '@vostride/agent-qa-schema'

/**
 * PROVISIONAL Pin 2 cluster identity. M3 may retune the grouping from field evidence, but every
 * serving channel must share this precise-first definition until then.
 */
export function clusterKey(anchors: readonly Anchor[]): string {
  const element = anchors.find((anchor) => anchor.t === 'el')
  if (element !== undefined) {
    const { ordinal: _ordinal, ...identity } = normalizeAnchor(element) as Extract<
      Anchor,
      { t: 'el' }
    >
    return canonicalJson(identity)
  }

  const flow = anchors.find((anchor) => anchor.t === 'flow')
  if (flow !== undefined) return canonicalJson(normalizeAnchor(flow))

  const page = anchors.find((anchor) => anchor.t === 'page')
  if (page !== undefined) {
    return (normalizeAnchor(page) as Extract<Anchor, { t: 'page' }>).route
  }

  // Records without any Pin 2 identity anchor share one deliberately conservative cluster.
  return canonicalJson([])
}
