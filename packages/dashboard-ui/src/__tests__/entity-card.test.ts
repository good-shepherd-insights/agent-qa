// @vitest-environment jsdom

// The entity card in the DOM medium (Phase 400 plan 08, DASH-03).
//
// WHAT THESE CELLS HOLD. 387 shipped ONE card shape and ONE producer; this plan ships the
// dashboard's render of it. So the claims here are about the render and nothing else:
//
//   1. The pinned fields reach the DOM — title, the per-kind status word, every key fact.
//   2. A link exists EXACTLY for the kinds this dashboard routes (TST, RUN, TGT), and its href is
//      minted from `ENTITY_KIND_ROUTES` over the card's own address — never from the card's `url`
//      string, which is an address for a DIFFERENT surface and, being op-result content, is exactly
//      the value a hostile card would put a payload in (T-400-27).
//   3. An unrouted kind (MEM, POL) renders NO link element. Not a disabled one, not a `#`
//      href, not a span styled like a link — nothing. That is D-10's own law: a card never shows a
//      link to a page nothing serves, and MEM is the case where the temptation is real, because
//      400-01's D-16 overlay means a MEM card in dashboard chat DOES carry a `url`.
//   4. An action goes through the CHAT DOOR and nowhere else. The button hands `sendTurn` a
//      `/fn <op> <json>` utterance — the same door a person types into, gated by the same gate
//      (T-400-26 / P4). The component holds no fetch of its own and the source assertion below is
//      what keeps that true after the next edit.
//
// THE FIXTURES ARE THE PRODUCER'S OUTPUT (`fixtures/entity-cards.ts`), not shapes typed here. A
// render cell fed a literal can pass on an input no producer can emit, which is 390-03's law and
// the reason that file says where every byte came from.
//
// THE VISUAL HALF IS NOT HERE. These render into jsdom and assert accessible text, elements and
// data attributes; the real-browser DOM differential against the BUILT UI is plan 400-09's, on
// 399.1's precedent that a payload assertion cannot carry a visual claim.

import { readFileSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'

import { act, createElement, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ENTITY_DASHBOARD_ROUTES,
  ENTITY_IDENTITY_FACT_LABELS,
  ENTITY_KINDS,
  isRoutedEntityKind,
  type EntityCard as EntityCardValue,
  type EntityKind,
} from '@vostride/agent-qa-schema'

import {
  ENTITY_KIND_ROUTES,
  EntityCard,
  entityCardActionUtterance,
  entityCardMachineId,
  entityCardRoute,
  entityCardsIn,
  entityRouteFor,
} from '@/chat/entity-card'
import { ChatTranscriptView, type ChatTranscriptViewProps } from '@/chat/chat-transcript'
import {
  createChatTranscriptState,
  reduceChatTranscript,
  type ChatTranscriptEvent,
  type ChatTranscriptState,
} from '@/chat/use-chat-turn'
import {
  MEM_CARD,
  POL_CARD,
  PRODUCED_ENTITY_CARDS,
  RUN_CARD,
  TGT_CARD,
  TGT_RENAMED_CARD,
  TST_CARD,
  TST_NO_URL_CARD,
  TST_QUARANTINED_CARD,
} from '@/__tests__/fixtures/entity-cards'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | undefined
let container: HTMLDivElement | undefined

afterEach(() => {
  if (root !== undefined) act(() => { root?.unmount() })
  container?.remove()
  root = undefined
  container = undefined
})

/** Mount through the app's own entry call, into the document a person's browser would paint. */
function mount(element: ReactElement): HTMLElement {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => { root?.render(createElement(MemoryRouter, null, element)) })
  return container
}

function mountCard(
  card: EntityCardValue,
  onSend: (utterance: string) => void = () => {},
): HTMLElement {
  return mount(createElement(EntityCard, { card, onSend }))
}

/** Every anchor the render produced — the thing an unrouted kind must have none of. */
function anchors(host: HTMLElement): HTMLAnchorElement[] {
  return [...host.querySelectorAll('a')]
}

const ENTITY_CARD_SOURCE_TEXT = readFileSync(
  resolvePath(import.meta.dirname, '../chat/entity-card.tsx'),
  'utf8',
)

/**
 * The module's EXECUTABLE source — comments removed.
 *
 * The prohibition cell below is a scan for a network call, and a scan that ranged the whole file
 * would fire on the header paragraph that EXPLAINS why there is no `fetch` and no `EventSource` in
 * it. That is the same defect in the same family as 400-06's blind mutation landing on a doc
 * comment: an assertion that reads prose measures the prose. The planted-violation control below
 * is what keeps this stripper from quietly removing the thing it was supposed to leave.
 */
function executableSource(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .replace(/^[ \t]*\/\/.*$/gmu, '')
}

const ENTITY_CARD_SOURCE = executableSource(ENTITY_CARD_SOURCE_TEXT)

// ---- 1. The pinned shape reaches the DOM -------------------------------------------------------

describe('the card renders the ONE 387 shape', () => {
  it('renders the title, the per-kind status word and EVERY key fact the producer projected', () => {
    // The quarantined variant on purpose: it is the richest card the shipped producer can emit
    // (four facts), so a render that dropped a tail is visible here and invisible on the one-fact
    // cards every other cell drives.
    const host = mountCard(TST_QUARANTINED_CARD)

    expect(host.querySelector('[data-entity-card]')?.getAttribute('data-entity-kind')).toBe('TST')
    expect(host.textContent).toContain('checkout rejects an expired card')
    expect(host.querySelector('[data-entity-status]')?.textContent).toBe('quarantined')

    const facts = [...host.querySelectorAll('[data-key-fact]')].map((node) => ({
      label: node.querySelector('[data-key-fact-label]')?.textContent,
      value: node.querySelector('[data-key-fact-value]')?.textContent,
    }))
    expect(facts).toEqual(
      TST_QUARANTINED_CARD.keyFacts.map((fact) => ({ label: fact.label, value: fact.value })),
    )
    expect(facts).toHaveLength(4)
  })

  it('renders the address a person can paste — the short-ID and the agentqa:// URI', () => {
    const host = mountCard(MEM_CARD)
    expect(host.querySelector('[data-entity-id]')?.textContent).toBe('MEM-001')
    expect(host.querySelector('[data-entity-uri]')?.textContent).toBe('agentqa://memory/MEM-001')
  })
})

// ---- 2. Route resolution, minted from the map and never from the card's own url ----------------

describe('routed kinds link into this dashboard', () => {
  it('links a TST card to the test-viewer route for the machine id its identity fact carries', () => {
    const host = mountCard(TST_CARD)
    const [link, ...rest] = anchors(host)
    expect(rest).toEqual([])
    expect(link?.getAttribute('href')).toBe('/test/t-irish-vise-s')
  })

  it('links a RUN card to run-detail and a TGT card to config', () => {
    const runHost = mountCard(RUN_CARD)
    expect(anchors(runHost).map((link) => link.getAttribute('href'))).toEqual(['/runs/run-alpha'])
    act(() => { root?.unmount() })
    container?.remove()

    const tgtHost = mountCard(TGT_CARD)
    expect(anchors(tgtHost).map((link) => link.getAttribute('href'))).toEqual(['/config'])
  })

  it('mints the href from the ROUTE MAP, never from the card url an op result carried', () => {
    // T-400-27. `url` is content: it arrives on an op result and, on a hostile store, is whatever
    // that store wrote. Every fixture's `url` points at `http://127.0.0.1:3470/t/demo/...` — the
    // 387 D-10 route shape, which this dashboard does not serve — so an href equal to it would be
    // both a dead link and a raw op-result string used as a destination.
    const host = mountCard(TST_CARD)
    const href = anchors(host)[0]?.getAttribute('href')
    expect(href).not.toBe(TST_CARD.url)
    expect(href?.startsWith('/')).toBe(true)
  })

  it('links a routed card whose op result carried NO url at all', () => {
    // The in-app route is served by THIS dashboard whether or not a base URL is configured, so
    // conditioning it on `url` would suppress a working link on the v52 default posture — and
    // `services.dashboard.workspace` is unset in the shipped dashboard composition, which makes
    // that posture the ordinary one rather than an edge.
    const host = mountCard(TST_NO_URL_CARD)
    expect(anchors(host).map((link) => link.getAttribute('href'))).toEqual(['/test/t-irish-vise-s'])
  })
})

// ---- 3. url-absent honesty, over the COMPLETE unrouted set (flagged assumption E3) -------------

describe('unrouted kinds render honestly — no link, no placeholder pretending to be one', () => {
  it('renders a MEM card with no link element even though its result carried a url', () => {
    const host = mountCard(MEM_CARD)
    expect(MEM_CARD.url).toBeDefined()
    expect(anchors(host)).toEqual([])
    expect(host.querySelectorAll('[href]')).toHaveLength(0)
    // Nor a costume: nothing claiming to be a route affordance.
    expect(host.querySelector('[data-entity-card-link]')).toBeNull()
  })

  it('shows the unroutable url as TEXT, so the address is readable without being a destination', () => {
    const host = mountCard(MEM_CARD)
    expect(host.querySelector('[data-entity-url-text]')?.textContent).toBe(MEM_CARD.url)
  })

  it('holds for EVERY unrouted kind and only for those — the complete five-kind set', () => {
    const linkCountByKind: Record<string, number> = {}
    for (const kind of ENTITY_KINDS) {
      const card = FIXTURE_BY_KIND[kind]
      const host = mountCard(card)
      linkCountByKind[kind] = anchors(host).length
      act(() => { root?.unmount() })
      container?.remove()
      root = undefined
      container = undefined
    }
    expect(linkCountByKind).toEqual({ TST: 1, RUN: 1, TGT: 1, MEM: 0, POL: 0 })
  })
})

/** One produced card per kind — the complete set the honesty cell above walks. */
const FIXTURE_BY_KIND = {
  TST: TST_CARD,
  RUN: RUN_CARD,
  MEM: MEM_CARD,
  POL: POL_CARD,
  TGT: TGT_CARD,
} as const satisfies Record<EntityKind, EntityCardValue>

// ---- 4. Actions go through the chat door and nowhere else --------------------------------------

describe('card actions are gated invokes through the chat door', () => {
  it('hands the turn hook a /fn utterance carrying the action functionId and its inputSeed', () => {
    const sent: string[] = []
    const host = mountCard(MEM_CARD, (utterance) => sent.push(utterance))

    const buttons = [...host.querySelectorAll<HTMLButtonElement>('[data-entity-action]')]
    expect(buttons.map((button) => button.getAttribute('data-entity-action'))).toEqual(
      MEM_CARD.actions.map((action) => action.functionId),
    )

    act(() => { buttons[1]?.click() })
    expect(sent).toEqual([
      '/fn knowledge.record.show {"recordId":"bundle-checkout-flow"}',
    ])
  })

  it('renders the action LABEL the registry op ref carried, not a label invented here', () => {
    const host = mountCard(MEM_CARD)
    expect(
      [...host.querySelectorAll('[data-entity-action]')].map((node) => node.textContent),
    ).toEqual(MEM_CARD.actions.map((action) => action.label))
  })

  it('renders no action row at all when a card carries no actions', () => {
    // A render-only shape built HERE, not a produced fixture: the fixture file's
    // produced-not-literal law is about fixtures, and the claim under test is the render's.
    const host = mountCard({ ...MEM_CARD, actions: [] })
    expect(host.querySelectorAll('[data-entity-action]')).toHaveLength(0)
  })

  it('carries no network path of its own (source assertion, P4 / T-400-26)', () => {
    // The prohibition is structural: an action that could reach the function layer any other way
    // would be an invoke the gate never saw. The only way out of this component is the callback.
    expect(ENTITY_CARD_SOURCE).not.toMatch(/\bfetch\s*\(/u)
    expect(ENTITY_CARD_SOURCE).not.toMatch(/\bXMLHttpRequest\b/u)
    expect(ENTITY_CARD_SOURCE).not.toMatch(/\bEventSource\b/u)
    expect(ENTITY_CARD_SOURCE).not.toMatch(/from ["']axios["']/u)
    expect(ENTITY_CARD_SOURCE).not.toMatch(/from ["']@\/lib\/api["']/u)
  })

  it('would SEE a network call if one were added (planted-violation control)', () => {
    // A source scan that has never been observed to fire certifies its own regex. Two controls:
    // the scan reds on a planted call, and the comment stripper does not swallow one that sits
    // beside prose about it.
    const planted = executableSource(`${ENTITY_CARD_SOURCE_TEXT}\nawait fetch("/api/entities")\n`)
    expect(planted).toMatch(/\bfetch\s*\(/u)
    expect(executableSource('// we never call fetch(\nconst x = 1')).not.toMatch(/\bfetch\s*\(/u)
    expect(executableSource('/* no fetch( here */\nfetch("/x")')).toMatch(/\bfetch\s*\(/u)
  })

  it('serialises the seed as the door\'s own /fn grammar', () => {
    expect(entityCardActionUtterance({
      functionId: 'runs.start',
      label: 'Run this test',
      inputSeed: { patterns: ['t-irish-vise-s'] },
    })).toBe('/fn runs.start {"patterns":["t-irish-vise-s"]}')
  })
})

// ---- 5. The route map is TOTAL over the card schema's kind union -------------------------------

describe('the kind -> route map is total', () => {
  it('answers for every member of ENTITY_KINDS and for nothing else', () => {
    expect(Object.keys(ENTITY_KIND_ROUTES).sort()).toEqual([...ENTITY_KINDS].sort())
  })

  it('names the routed kinds as resolvers and the unrouted ones as an explicit null', () => {
    // `null` rather than an absent key, so "this kind has no dashboard route" is a DECISION
    // somebody wrote down rather than a lookup that happened to miss.
    const shape = Object.fromEntries(
      ENTITY_KINDS.map((kind) => [kind, ENTITY_KIND_ROUTES[kind] === null ? 'unrouted' : 'routed']),
    )
    expect(shape).toEqual({
      TST: 'routed', RUN: 'routed', TGT: 'routed',
      MEM: 'unrouted', POL: 'unrouted',
    })
  })

  it('refuses to mint a route for a routed kind whose address names no machine id', () => {
    // An `agentqa://` reference carries an ADDRESS and no machine id, and `/test/:t_id` is keyed by
    // machine id. Guessing the short-ID into that slot would be a dead link minted with confidence,
    // which is the exact failure D-10 forbids.
    expect(entityRouteFor({ kind: 'TST', shortId: 'TST-001' })).toBeUndefined()
    expect(entityRouteFor({ kind: 'TST', shortId: 'TST-001', machineId: 't-x' })).toBe('/test/t-x')
    // A slug-addressed target's route takes no parameter, so it resolves from the address alone.
    expect(entityRouteFor({ kind: 'TGT', shortId: 'TGT-checkout' })).toBe('/config')
  })

  it('reads the machine id off the identity fact the CONTRACT names', () => {
    for (const kind of ENTITY_KINDS) {
      const card = FIXTURE_BY_KIND[kind]
      const identity = card.keyFacts.find(
        (fact) => fact.label === ENTITY_IDENTITY_FACT_LABELS[kind],
      )
      expect(entityCardMachineId(card)).toBe(identity?.value)
    }
  })
})

// ---- 6. agentqa:// references on key facts ----------------------------------------------------

describe('agentqa:// references resolve through the same map', () => {
  it('links a rename fact whose ref addresses a routed kind', () => {
    const host = mountCard(TGT_RENAMED_CARD)
    const refLink = host.querySelector<HTMLAnchorElement>('[data-key-fact-ref]')
    expect(refLink?.getAttribute('href')).toBe('/config')
    expect(refLink?.textContent).toBe('agentqa://target/TGT-checkout-v2')
  })

  it('renders a reference this dashboard cannot route as plain text', () => {
    // Fabricated at the REFERENCE level, not the card level: a key fact may point at any kind, and
    // an unrouted target must read as an address rather than as somewhere to click.
    expect(entityRouteFor({ kind: 'MEM', shortId: 'MEM-001', machineId: 'b-1' })).toBeUndefined()
  })
})

// ---- 7. Detection is the schema's own parse, never a shape check written here ------------------

describe('a card is recognised by the schema that defines one', () => {
  it('finds the card in an entities.get result (the card IS the result)', () => {
    expect(entityCardsIn(TST_CARD)).toEqual([TST_CARD])
  })

  it('finds the card in an entities.resolve resolved arm and every ambiguous candidate', () => {
    expect(entityCardsIn({ kind: 'resolved', card: MEM_CARD, score: 1 })).toEqual([MEM_CARD])
    expect(entityCardsIn({
      kind: 'ambiguous',
      candidates: [{ card: MEM_CARD, score: 0.6 }, { card: POL_CARD, score: 0.4 }],
    })).toEqual([MEM_CARD, POL_CARD])
  })

  it('finds nothing in a none arm, and nothing in an ordinary op payload', () => {
    expect(entityCardsIn({ kind: 'none', reason: 'no-match' })).toEqual([])
    expect(entityCardsIn({ runId: 'run-alpha', status: 'failed' })).toEqual([])
    expect(entityCardsIn(undefined)).toEqual([])
  })

  it('REFUSES a look-alike the card schema refuses — the anti-duck-typing bar', () => {
    // Every field a shape check would look at is present and well-typed. What is wrong is the
    // cross-field integrity `EntityCardSchema` superRefines: `kind`, `id` and `uri` are three
    // spellings of ONE address and these three disagree. A hand-rolled `'kind' in payload` guard
    // passes this and renders a card that resolves differently depending on which field is read.
    expect(entityCardsIn({
      kind: 'TST',
      id: 'MEM-001',
      uri: 'agentqa://memory/MEM-001',
      title: 'a card whose three spellings disagree',
      status: 'active',
      keyFacts: [],
      actions: [],
    })).toEqual([])
  })

  it('reads the card shape from the schema package (source assertion)', () => {
    expect(ENTITY_CARD_SOURCE).toMatch(/EntityCardSchema/u)
    expect(ENTITY_CARD_SOURCE).toMatch(/EntityCardResolutionSchema/u)
  })
})

// ---- 8. The transcript renders cards WITHOUT suppressing the payload (399.1 D-04 / D-14) -------

describe('the transcript renders an entity-card result as a card', () => {
  function fold(events: readonly ChatTranscriptEvent[]): ChatTranscriptState {
    return events.reduce(
      (carried, event) => reduceChatTranscript(carried, event),
      createChatTranscriptState(),
    )
  }

  const NOOP = {
    onSend: () => {},
    onAnswerConfirm: () => {},
    status: 'idle',
    starters: [],
  } satisfies Omit<ChatTranscriptViewProps, 'state'>

  it('renders the card ABOVE the complete payload, never instead of it', () => {
    const state = fold([
      { channel: 'session', event: { kind: 'user_message', turnId: 't1', at: 'a', text: 'show me MEM-001' } },
      { channel: 'session', event: { kind: 'clause_result', turnId: 't1', at: 'a', functionId: 'entities.get', payload: MEM_CARD } },
      { channel: 'session', event: { kind: 'clause_receipt', turnId: 't1', at: 'a', clause: 'one', functionId: 'entities.get', origin: 'human', status: 'executed', outcome: 'found MEM MEM-001' } },
    ])
    const host = mount(createElement(ChatTranscriptView, { ...NOOP, state }))

    const card = host.querySelector('[data-entity-card]')
    expect(card).not.toBeNull()
    expect(card?.getAttribute('data-entity-kind')).toBe('MEM')

    // LAW 3 is untouched: the complete masked payload is still there, still expanded.
    const payload = host.querySelector('[data-payload-block]')
    expect(payload?.getAttribute('data-expanded')).toBe('true')
    expect(payload?.textContent).toContain('bundle-checkout-flow')
  })

  it('sends a card action through the transcript\'s own onSend — the one chat door', () => {
    const sent: string[] = []
    const state = fold([
      { channel: 'session', event: { kind: 'clause_result', turnId: 't1', at: 'a', functionId: 'entities.get', payload: TST_CARD } },
      { channel: 'session', event: { kind: 'clause_receipt', turnId: 't1', at: 'a', clause: 'one', functionId: 'entities.get', origin: 'human', status: 'executed', outcome: 'found TST TST-001' } },
    ])
    const host = mount(createElement(ChatTranscriptView, {
      ...NOOP,
      state,
      onSend: (utterance: string) => sent.push(utterance),
    }))

    const runAction = host.querySelector<HTMLButtonElement>('[data-entity-action="runs.start"]')
    act(() => { runAction?.click() })
    expect(sent).toEqual(['/fn runs.start {"patterns":["t-irish-vise-s"]}'])
  })
})

// ---- The fixture set is the complete one ------------------------------------------------------

it('the produced-fixture set covers every kind the card schema can carry', () => {
  expect(new Set(Object.values(PRODUCED_ENTITY_CARDS).map((card) => card.kind))).toEqual(
    new Set(ENTITY_KINDS),
  )
})

// ---- The dashboard half of the ONE scenario-table denominator (400-08 task 2) ------------------

// THE ROUTE EXPECTATIONS ARE NOT WRITTEN HERE. `ENTITY_DASHBOARD_ROUTES` is a SHIPPED contract in
// the schema package (`entity/dashboard-route.ts`), and the conformance scenario table's
// `ENTITY_CARD_RENDER_CASES` — carried on the two entity ops through their `entityCardExpect`
// column — is SPREAD from that same declaration, with `conformance/entity-card-parity.test.ts`
// asserting the spread held and driving the MCP half of the same rows. So both doors are measured
// against one declaration, which is DASH-03's parity clause and 399.1 D-09's one-denominator rule.
//
// WHY THIS FILE READS THE CONTRACT AND NOT THE TABLE DIRECTLY: every package's `tsconfig.json` pins
// `rootDir` to its own `src`, so a cross-package relative import is a `tsc --noEmit` error
// (TS6059). The schema package is the ONE package both surfaces depend on, and it is where
// `ENTITY_URL_ROUTE` already lives for exactly this reason — "the M5 route table imports this
// constant, so the dashboard's routes and the cards' links agree is ONE declaration rather than
// two that were written from the same sentence."

describe('the dashboard render answers the shipped card-route contract', () => {
  it('routes exactly the kinds the contract says are routed, and none of the ones it does not', () => {
    const fromMap = Object.fromEntries(
      ENTITY_KINDS.map((kind) => [kind, ENTITY_KIND_ROUTES[kind] === null ? null : 'routed']),
    )
    const fromContract = Object.fromEntries(
      ENTITY_KINDS.map((kind) => [kind, isRoutedEntityKind(kind) ? 'routed' : null]),
    )
    expect(fromMap).toEqual(fromContract)
  })

  it('mints an href that fills the contract\'s own template, for every routed kind', () => {
    // The map could route the right kinds and still point them at a path the contract does not
    // name — which is the drift a shared declaration exists to make impossible, and which a
    // "routed / unrouted" comparison alone cannot see.
    for (const kind of ENTITY_KINDS) {
      const template = ENTITY_DASHBOARD_ROUTES[kind].route
      if (template === null) continue
      const card = FIXTURE_BY_KIND[kind]
      const href = entityCardRoute(card)
      if (ENTITY_DASHBOARD_ROUTES[kind].keyedBy === 'no-parameter') {
        expect(href).toBe(template)
      } else {
        const prefix = template.slice(0, template.indexOf(':'))
        expect(href?.startsWith(prefix), `${kind}: ${String(href)} vs ${template}`).toBe(true)
        expect(href?.slice(prefix.length)).toBe(entityCardMachineId(card))
      }
    }
  })

  for (const kind of ENTITY_KINDS) {
    it(`entities.get / ${kind} on dashboard: the row's render form, in the DOM`, () => {
      const contract = ENTITY_DASHBOARD_ROUTES[kind]
      const card = FIXTURE_BY_KIND[kind]
      const host = mountCard(card)

      // (a) the identifying fields the row names reach a reader. The markers are FIELD NAMES on the
      // card contract, so the claim on THIS door is that each one's VALUE is on the page — a
      // browser renders values, not JSON keys, and asserting the key would be asserting that the
      // DOM contains a string the card never displays.
      const text = host.textContent ?? ''
      for (const marker of CARD_RENDER_MARKERS) {
        const value = String((card as unknown as Record<string, unknown>)[marker])
        expect(text, `${kind}: the row names ${marker} and the render withholds it`).toContain(value)
      }

      // (b) a route link EXACTLY when the contract says the kind is routed, and (c) url-absence —
      // zero link affordance — when it says it is not.
      const links = anchors(host).filter((link) => link.hasAttribute('data-entity-card-link'))
      if (contract.route === null) {
        expect(links, `${kind} is unrouted and this render offered a link`).toEqual([])
      } else {
        expect(links).toHaveLength(1)
        expect(links[0]?.getAttribute('href')).toBe(entityCardRoute(card))
        // And never the card's own url, whatever the contract says (T-400-27).
        expect(links[0]?.getAttribute('href')).not.toBe(card.url)
      }
    })
  }
})

/**
 * The card fields a reader must be able to read — the SAME set `scenario-table.ts` carries as each
 * case's `markers`, and the same rule: the card contract's always-present fields, sorted.
 *
 * `keyFacts` and `actions` are deliberately absent, on the table's own stated reasoning: they are
 * arrays the contract lets a kind answer with empty, so requiring them per kind would demand of
 * one kind a thing the contract says it need not have.
 */
const CARD_RENDER_MARKERS = ['id', 'kind', 'status', 'title', 'uri'] as const
