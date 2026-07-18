import {
  canonicalJson,
  parseProcedureBody,
  type Delta,
} from '@vostride/agent-qa-schema'
import {
  parseAuthoredCheckpoint,
  type CurationJobView,
} from '@vostride/agent-qa-knowledge-local'
import { createModel } from '@vostride/agent-qa-model'
import type { ModelProfile, ResolvedModelAuth } from '@vostride/agent-qa-model'
import { describe, expect, it } from 'vitest'

import { buildCuratorAuthor } from '../curator-author.js'
import type { ProcedureTrajectorySeed } from '../emit-candidates.js'

type CuratorModel = ReturnType<typeof createModel>
type GenerateResult = Awaited<ReturnType<CuratorModel['doGenerate']>>

const noAuth: ResolvedModelAuth = { kind: 'none' }

function profile(): ModelProfile {
  return {
    provider: 'openai-compatible',
    model: 'curator-scripted-model',
    baseURL: 'http://localhost:11434/v1',
    auth: { mode: 'none' },
    capabilities: {
      text: true,
      vision: false,
      visionToolMessages: false,
      toolCalling: true,
      structuredOutput: false,
      streaming: false,
      contextWindow: 16_384,
      maxOutput: 1_024,
    },
  }
}

function generateResult(text: string): GenerateResult {
  return {
    content: [{ type: 'text', text }],
    finishReason: { unified: 'stop', raw: 'stop' },
    usage: {
      inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 0, text: 0, reasoning: 0 },
    },
    warnings: [],
  }
}

function scriptedModel(outputs: string[]): CuratorModel {
  let index = 0
  return {
    specificationVersion: 'v3',
    provider: 'scripted',
    modelId: 'scripted',
    supportedUrls: {},
    async doGenerate() {
      const output = outputs[index++]
      if (output === undefined) throw new Error('scripted model exhausted')
      return generateResult(output)
    },
    async doStream() {
      return { stream: new ReadableStream() }
    },
  }
}

function trajectorySeed(): ProcedureTrajectorySeed {
  return {
    version: 1,
    flowName: 'auth::sign-in-then-checkout',
    steps: [
      {
        ordinal: 0,
        instruction: 'Open the sign-in page',
        action: {
          type: 'click',
          targets: {
            ref: { ref: 'open', role: 'button', nameNormalized: 'sign in', ordinal: 0 },
          },
          values: {},
        },
        pageRoute: '/login',
      },
      {
        ordinal: 1,
        instruction: 'Enter the account email',
        action: {
          type: 'fill',
          targets: {
            ref: { ref: 'email', role: 'textbox', nameNormalized: 'email', ordinal: 0 },
          },
          values: {
            text: { observed: 'user@example.com', source: 'literal', targetRef: 'email' },
            clearMode: { observed: 'replace', source: 'literal', targetRef: 'email' },
          },
        },
        pageRoute: '/login',
      },
      {
        ordinal: 2,
        instruction: 'Enter the account password',
        action: {
          type: 'fill',
          targets: {
            ref: {
              ref: 'password',
              role: 'textbox',
              nameNormalized: 'password',
              ordinal: 0,
            },
          },
          values: {
            text: { observed: '<SECRET_0>', source: 'masked-secret', targetRef: 'password' },
            clearMode: { observed: 'replace', source: 'literal', targetRef: 'password' },
          },
        },
        pageRoute: '/login',
      },
      {
        ordinal: 3,
        instruction: 'Submit and open checkout',
        action: {
          type: 'click',
          targets: {
            ref: { ref: 'submit', role: 'button', nameNormalized: 'submit', ordinal: 0 },
          },
          values: {},
        },
        pageRoute: '/checkout',
      },
    ],
  }
}

function procedureJob(overrides: Partial<CurationJobView> = {}): CurationJobView {
  return {
    candidateId: 'a'.repeat(64),
    kind: 'procedure',
    anchors: [
      { t: 'flow', name: 'auth::sign-in-then-checkout' },
      { t: 'page', route: '/login' },
    ],
    summarySeed: 'Procedure auth::sign-in-then-checkout',
    bodySeed: canonicalJson(trajectorySeed()),
    distilledObservations: [],
    scope: { tier: 'product', key: 'shop' },
    buildOrdinal: 42,
    attributingObservationId: 'run-1:test-0:step-0',
    executionContext: 'local-interactive',
    secretFlagged: true,
    injectionFlagged: false,
    captureReceipt: {
      regions: [
        {
          stepIndex: 2,
          elementRef: 'password',
          role: 'textbox',
          normalizedName: 'password',
          inputType: 'password',
          reason: 'password-input',
        },
      ],
      interactions: [
        { stepIndex: 0, elementRef: 'open' },
        { stepIndex: 1, elementRef: 'email' },
        { stepIndex: 2, elementRef: 'password' },
        { stepIndex: 3, elementRef: 'submit' },
      ],
      omissions: [],
      redactions: [],
    },
    ...overrides,
  }
}

function factJob(): CurationJobView {
  return procedureJob({
    kind: 'fact',
    subtype: 'selector',
    anchors: [
      { t: 'page', route: '/checkout' },
      { t: 'el', role: 'button', name: 'Place order', ordinal: 0 },
    ],
    summarySeed: 'The checkout button submits the order',
    bodySeed: 'Use the resolved checkout button after the cart is complete.',
    secretFlagged: false,
    captureReceipt: { regions: [], interactions: [], omissions: [], redactions: [] },
  })
}

const wholeFlowPlusSubFlow = JSON.stringify({
  candidates: [
    {
      flowName: 'auth::sign-in-then-checkout',
      stepSpan: [0, 3],
      parameters: [
        {
          name: 'accountEmail',
          type: 'string',
          required: true,
          appliesTo: [{ stepOrdinal: 1, field: 'text' }],
        },
      ],
      successAssertion: 'The checkout page is shown',
    },
    {
      flowName: 'auth::sign-in',
      stepSpan: [0, 2],
      parameters: [
        {
          name: 'accountEmail',
          type: 'string',
          required: true,
          appliesTo: [{ stepOrdinal: 1, field: 'text' }],
        },
      ],
      successAssertion: 'The account is signed in',
    },
  ],
})

function author(outputs: string[]) {
  return buildCuratorAuthor({
    profile: profile(),
    auth: noAuth,
    createModelImpl: () => scriptedModel(outputs),
  })
}

function addBundles(deltas: Delta[]) {
  return deltas.map((delta) => {
    if (delta.kind !== 'Add') throw new Error(`expected Add delta, got ${delta.kind}`)
    return delta.bundle
  })
}

describe('procedure-extraction author path (PROC-01 D-02/D-03)', () => {
  it('yields whole-flow and sub-flow Add deltas whose bodies round-trip the codec', async () => {
    const outcome = await author([wholeFlowPlusSubFlow])(procedureJob(), [])

    expect(outcome.kind).toBe('authored')
    if (outcome.kind !== 'authored') throw new Error('expected authored outcome')
    expect(outcome.deltas).toHaveLength(2)
    const bundles = addBundles(outcome.deltas)
    expect(bundles.every((bundle) => bundle.kind === 'procedure')).toBe(true)
    expect(bundles.map((bundle) => bundle.anchors[0])).toEqual([
      { t: 'flow', name: 'auth::sign-in-then-checkout' },
      { t: 'flow', name: 'auth::sign-in' },
    ])
    const payloads = bundles.map((bundle) => parseProcedureBody(bundle.body))
    expect(payloads[0]?.steps).toHaveLength(4)
    expect(payloads[1]?.steps).toHaveLength(3)
    expect(payloads[0]?.steps.map((step) => step.instruction)).toEqual([
      'Open the sign-in page',
      'Enter the account email',
      'Enter the account password',
      'Submit and open checkout',
    ])
    expect(payloads[1]?.successAssertion).toBe('The account is signed in')
  })

  it('derives guard descriptors from job evidence — a bogus proposal descriptor cannot alter them', async () => {
    const bogus = JSON.stringify({
      candidates: [
        {
          flowName: 'auth::sign-in',
          stepSpan: [0, 2],
          parameters: [],
          successAssertion: 'Signed in',
          steps: [
            {
              guard: {
                target: { role: 'link', nameNormalized: 'hacked', ordinal: 9 },
                pageAnchor: { t: 'page', route: '/evil' },
              },
            },
          ],
          guards: [{ role: 'link', nameNormalized: 'hacked', ordinal: 9 }],
        },
      ],
    })

    const outcome = await author([bogus])(procedureJob(), [])
    if (outcome.kind !== 'authored') throw new Error('expected authored outcome')
    const [bundle] = addBundles(outcome.deltas)
    const payload = parseProcedureBody(bundle!.body)

    expect(payload?.steps.map((step) => step.guard)).toEqual([
      {
        target: { role: 'button', nameNormalized: 'sign in', ordinal: 0 },
        pageAnchor: { t: 'page', route: '/login' },
      },
      {
        target: { role: 'textbox', nameNormalized: 'email', ordinal: 0 },
        pageAnchor: { t: 'page', route: '/login' },
      },
      {
        target: { role: 'textbox', nameNormalized: 'password', ordinal: 0 },
        pageAnchor: { t: 'page', route: '/login' },
      },
    ])
    expect(bundle!.body).not.toContain('hacked')
    expect(bundle!.body).not.toContain('/evil')
  })

  it('force-parameterizes a masked-secret value the proposal missed (D-03)', async () => {
    const outcome = await author([wholeFlowPlusSubFlow])(procedureJob(), [])
    if (outcome.kind !== 'authored') throw new Error('expected authored outcome')
    const [wholeFlow] = addBundles(outcome.deltas)
    const payload = parseProcedureBody(wholeFlow!.body)
    if (payload === undefined) throw new Error('expected parseable procedure body')

    const passwordStep = payload.steps[2]!
    const slot = passwordStep.action.values['text']
    expect(typeof slot).toBe('object')
    if (typeof slot !== 'object') throw new Error('expected param ref slot')
    const forced = payload.parameters.find((parameter) => parameter.name === slot.param)
    expect(forced).toMatchObject({ type: 'secret', required: true })
    expect(wholeFlow!.body).not.toContain('<SECRET_0>')

    const emailSlot = payload.steps[1]!.action.values['text']
    expect(emailSlot).toEqual({ param: 'accountEmail' })
    expect(wholeFlow!.body).not.toContain('user@example.com')
  })

  it('widened multi-delta checkpoint round-trips and single-delta fact authoring still works', async () => {
    const factOutcome = await author([
      JSON.stringify({
        kind: 'Add',
        citedAliases: [],
        bundle: {
          kind: 'fact',
          subtype: 'selector',
          anchors: [{ t: 'page', route: '/checkout' }],
          summary: 'Model-authored atomic summary',
          body: 'Model-authored standalone body',
        },
      }),
    ])(factJob(), [])

    expect(factOutcome.kind).toBe('authored')
    if (factOutcome.kind !== 'authored') throw new Error('expected authored fact outcome')
    expect(factOutcome.deltas).toHaveLength(1)
    expect(factOutcome.deltas[0]?.kind).toBe('Add')

    const procedureOutcome = await author([wholeFlowPlusSubFlow])(procedureJob(), [])
    if (procedureOutcome.kind !== 'authored') throw new Error('expected authored outcome')
    const checkpoint = parseAuthoredCheckpoint({
      schemaVersion: 1,
      deltas: procedureOutcome.deltas,
      neighborIds: [],
      preconditions: [],
      authorship: procedureOutcome.authorship,
    })
    expect(checkpoint.deltas).toHaveLength(2)
  })
})
