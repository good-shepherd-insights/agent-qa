import type {
  Anchor,
  DistilledObservation,
  GraphEdgeType,
  GraphNodeType,
} from '@vostride/agent-qa-schema'
import { graphNodeId } from '@vostride/agent-qa-schema'
import { describe, expect, it } from 'vitest'

import {
  deriveEquivalentToBridges,
  deriveLocatesViaEdges,
  deriveObservationEdges,
} from '../graph-derive.js'
import type {
  DerivedGraphEdge,
  DerivedGraphNode,
  GraphDerivationContext,
} from '../graph-derive.js'

const context: GraphDerivationContext = {
  bundleId: 'r_graph_fixture',
  recordRowid: 17,
  product: 'checkout-app',
  createdAtOrdinal: 41,
}

function observation(
  overrides: Partial<DistilledObservation> = {},
): DistilledObservation {
  return {
    schemaVersion: 1,
    step: { naturalKey: 'submit checkout', ordinal: 3 },
    platform: 'web',
    test: { id: 'checkout-happy-path' },
    procedure: { id: 'complete-checkout' },
    flow: { name: 'checkout', precedes: 'confirmation' },
    surface: { kind: 'page', naturalKey: '/checkout' },
    element: { naturalKey: 'button:submit order' },
    locator: { selector: '[data-testid="submit-order"]' },
    error: { naturalKey: 'submit remained disabled' },
    observedAtOrdinal: 44,
    ...overrides,
  }
}

function edgeKey(edge: DerivedGraphEdge): string {
  return `${edge.srcNodeId}\u0000${edge.edgeType}\u0000${edge.dstNodeId}`
}

function expectEdge(
  edges: readonly DerivedGraphEdge[],
  source: [GraphNodeType, Parameters<typeof graphNodeId>[1]],
  edgeType: GraphEdgeType,
  target: [GraphNodeType, Parameters<typeof graphNodeId>[1]],
): void {
  expect(edges).toContainEqual(expect.objectContaining({
    srcNodeId: graphNodeId(...source),
    edgeType,
    dstNodeId: graphNodeId(...target),
    recordRowid: context.recordRowid,
    bundleId: context.bundleId,
    product: context.product,
    recencyOrdinal: 44,
  }))
}

describe('deterministic graph derivation (377 D-09/D-10)', () => {
  it('derives every observation-backed edge class with observation recency', () => {
    const { edges } = deriveObservationEdges([observation()], context)
    const stepKey = { naturalKey: 'submit checkout', ordinal: 3 }

    expectEdge(edges, ['test', 'checkout-happy-path'], 'contains', ['step', stepKey])
    expectEdge(
      edges,
      ['procedure', 'complete-checkout'],
      'composed-of',
      ['step', stepKey],
    )
    expectEdge(
      edges,
      ['step', stepKey],
      'uses',
      ['web-element', 'button:submit order'],
    )
    expectEdge(edges, ['step', stepKey], 'on', ['web-page', '/checkout'])
    expectEdge(edges, ['step', stepKey], 'part-of', ['flow', 'checkout'])
    expectEdge(edges, ['flow', 'checkout'], 'precedes', ['flow', 'confirmation'])
    expectEdge(
      edges,
      ['error', 'submit remained disabled'],
      'caused-by',
      ['web-element', 'button:submit order'],
    )
    expect(edges).toHaveLength(7)
  })

  it('derives selector locator edges only when the bundle platform is resolved', () => {
    const anchors: Anchor[] = [
      { t: 'el', role: 'button', name: 'Submit order' },
      { t: 'selector', literal: '[data-testid="submit-order"]' },
    ]

    const resolved = deriveLocatesViaEdges(anchors, 'web', context)
    expect(resolved.edges).toEqual([
      expect.objectContaining({
        srcNodeId: graphNodeId('web-element', { role: 'button', name: 'submit order' }),
        edgeType: 'locates-via',
        dstNodeId: graphNodeId('web-locator', '[data-testid="submit-order"]'),
        recencyOrdinal: context.createdAtOrdinal,
      }),
    ])
    expect(deriveLocatesViaEdges(anchors, undefined, context).edges).toEqual([])
  })

  it.each([
    ['web only', ['web-element'], 0],
    ['mobile only', ['mobile-element'], 0],
    ['web and mobile', ['web-element', 'mobile-element'], 1],
    ['unresolved and web', ['element', 'web-element'], 0],
  ] as const)(
    'applies the platform-strict equivalent-to matrix: %s',
    (_label, elementTypes, expectedBridges) => {
      const stepNodeId = graphNodeId('step', { naturalKey: 'submit checkout', ordinal: 3 })
      const nodes: DerivedGraphNode[] = [
        {
          nodeId: stepNodeId,
          type: 'step',
          naturalKey: { naturalKey: 'submit checkout', ordinal: 3 },
          product: context.product,
        },
        ...elementTypes.map((type, index): DerivedGraphNode => ({
          nodeId: graphNodeId(type, `${type}-${index}`),
          type,
          naturalKey: `${type}-${index}`,
          product: context.product,
        })),
      ]
      const edges: DerivedGraphEdge[] = nodes.slice(1).map((node, index) => ({
        srcNodeId: stepNodeId,
        edgeType: 'uses',
        dstNodeId: node.nodeId,
        recordRowid: context.recordRowid + index,
        bundleId: `${context.bundleId}-${index}`,
        product: context.product,
        recencyOrdinal: 44 + index,
      }))

      const bridges = deriveEquivalentToBridges(nodes, edges)

      expect(bridges).toHaveLength(expectedBridges)
      for (const bridge of bridges) {
        expect(bridge.edgeType).toBe('equivalent-to')
        expect(nodes.find((node) => node.nodeId === bridge.srcNodeId)?.type)
          .toBe('web-element')
        expect(nodes.find((node) => node.nodeId === bridge.dstNodeId)?.type)
          .toBe('mobile-element')
      }
    },
  )

  it('emits every deterministic web-to-mobile pair in node-id order', () => {
    const observations = [
      observation({
        platform: 'mobile',
        surface: { kind: 'screen', naturalKey: 'CheckoutActivity' },
        element: { naturalKey: 'mobile-submit-b' },
        observedAtOrdinal: 48,
      }),
      observation({ element: { naturalKey: 'web-submit-b' }, observedAtOrdinal: 47 }),
      observation({
        platform: 'mobile',
        surface: { kind: 'screen', naturalKey: 'CheckoutActivity' },
        element: { naturalKey: 'mobile-submit-a' },
        observedAtOrdinal: 46,
      }),
      observation({ element: { naturalKey: 'web-submit-a' }, observedAtOrdinal: 45 }),
    ]
    const projection = deriveObservationEdges(observations, context)
    const bridges = deriveEquivalentToBridges(projection.nodes, projection.edges)

    expect(bridges).toHaveLength(4)
    expect(bridges.map(edgeKey)).toEqual([...bridges].sort((a, b) =>
      edgeKey(a).localeCompare(edgeKey(b))).map(edgeKey))
  })

  it('sorts edge output independently of observation enumeration order', () => {
    const observations = [
      observation(),
      observation({
        step: { naturalKey: 'confirm checkout', ordinal: 4 },
        element: { naturalKey: 'button:confirm order' },
        observedAtOrdinal: 45,
      }),
    ]

    const forward = deriveObservationEdges(observations, context).edges
    const reversed = deriveObservationEdges([...observations].reverse(), context).edges

    expect(forward).toEqual(reversed)
    expect(forward.map(edgeKey)).toEqual([...forward].sort((a, b) =>
      edgeKey(a).localeCompare(edgeKey(b))).map(edgeKey))
  })
})
