// MASKING AT THE SEND SEAM (Phase 398 plan 06 task 2, D-17 / D-19 · ANLY-01 · T-398-06).
//
// WHERE THE ASSERTIONS SIT, AND WHY IT MATTERS THAT THEY SIT THERE. Every violation cell in this
// file reads the GUNZIPPED BODY A REAL HTTP SERVER RECEIVED — not the object handed to
// `maskEventForSend`, not the argument `client.capture` saw. Masking is a claim about what leaves
// the process, and this repo has a filed precedent (395) for a corpus that asserted on a value's
// `.message` while the channel a person actually saw was its serialization. The only honest place
// to read "the secret did not leave" is where it would have arrived.
//
// THE ESCAPE-BLIND LESSON (396), made measurable rather than asserted. The planted secret carries a
// double quote and a newline, so JSON serialization rewrites it: `sk-…"tok<LF>en"…` on the wire is
// `sk-…\"tok\nen\"…`. An implementation that masks AFTER serialization by searching for the raw
// value finds nothing and reports success. The control cell below sends the same payload with NO
// masking context and asserts the ESCAPED form is what actually appears — so the violation cell's
// "escaped form absent" is a discriminating assertion rather than a lucky one.

import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { composeAnalytics } from '../compose.js'
import { AgentQaAnalyticsEventSchema } from '../events.js'
import { createAnalyticsMaskingContext, maskEventForSend } from '../masking-seam.js'
import { createPosthogTransport } from '../transports.js'
import { packageSourceFiles, relativeToSrc, withoutComments } from './source-scan.js'
import { startWireSink, type WireSink } from './wire-sink.js'
import type { AgentQaAnalyticsEvent } from '../events.js'
import type { AnalyticsCapturePayload } from '../port.js'

const PROJECT_KEY = 'phc_masking_seam'

// A quote and a newline are the whole point: both are rewritten by JSON serialization, so a
// post-serialization scan for these exact bytes finds nothing.
const PLANTED_SECRET = 'sk-live-"tok\nen"-9f3a-DEADBEEF'
const ESCAPED_SECRET = JSON.stringify(PLANTED_SECRET).slice(1, -1)
const MASK_TOKEN = '<SECRET_0>'

function seededContext(): ReturnType<typeof createAnalyticsMaskingContext> {
  // Seeded through `seedMaskingContext`'s own sources contract — the SAME function the run masking
  // context uses, handed a secret store, not a bespoke list of strings assembled here.
  return createAnalyticsMaskingContext({
    secretStore: {
      forEachSecret: (callback) => callback('PLANTED_API_KEY', PLANTED_SECRET),
    },
  })
}

function realEvent(): AgentQaAnalyticsEvent {
  return AgentQaAnalyticsEventSchema.parse({
    name: 'agent-qa.init.completed',
    properties: {
      surface: 'cli',
      runtime_context: 'user',
      init_mode: 'agent',
      outcome: 'created',
      created_file_count: 3,
    },
  })
}

/** Drive the SHIPPED composition → port → transport → socket, and return the wire body. */
async function sendThroughShippedPath(
  sink: WireSink,
  options: { distinctId: string; maskingContext?: { mask(text: string): string } },
): Promise<string> {
  const composed = composeAnalytics<AgentQaAnalyticsEvent>({
    env: {},
    projectKey: PROJECT_KEY,
    projectHost: sink.origin,
    identity: () => ({ distinctId: options.distinctId }),
    ...(options.maskingContext ? { maskingContext: options.maskingContext } : {}),
  })
  composed.port.capture(realEvent())
  await composed.port.flush()
  return sink.requests.at(-1)?.text ?? ''
}

/**
 * Drive the SHIPPED transport directly with a hand-built payload.
 *
 * The union's fields are enum-constrained by design, so the only way to exercise the seam's
 * STRUCTURE (nested objects, arrays, deep string leaves) is at the transport's own interface —
 * which is written against `AnalyticsEventEnvelope`, not the union. That is not a weaker surface:
 * it is the exact shape the seam must be safe for, including for members a later phase adds.
 */
async function sendPayloadThroughTransport(
  sink: WireSink,
  payload: AnalyticsCapturePayload,
  maskingContext?: { mask(text: string): string },
): Promise<string> {
  const transport = createPosthogTransport({
    projectKey: PROJECT_KEY,
    host: sink.origin,
    ...(maskingContext ? { maskingContext } : {}),
  })
  transport.capture(payload)
  await transport.flush()
  return sink.requests.at(-1)?.text ?? ''
}

/** The three fields posthog stamps per send. Normalised so two bodies are comparable. */
function normalizeVolatile(body: string): string {
  return body
    .replace(/"uuid":"[^"]*"/gu, '"uuid":"<UUID>"')
    .replace(/"timestamp":"[^"]*"/gu, '"timestamp":"<TS>"')
    .replace(/"sent_at":"[^"]*"/gu, '"sent_at":"<TS>"')
}

describe('masking at the send seam (D-19, T-398-06)', () => {
  let sink: WireSink

  beforeEach(async () => {
    sink = await startWireSink()
  })

  afterEach(async () => {
    await sink.close()
  })

  // -------------------------------------------------------------------------------------------
  // The control: what the wire looks like with NO masking context
  // -------------------------------------------------------------------------------------------

  it('control — without a masking context the secret arrives, in its JSON-ESCAPED form', async () => {
    const body = await sendThroughShippedPath(sink, { distinctId: PLANTED_SECRET })

    // The raw bytes are NOT what is on the wire — this is the escape-blind trap in one assertion.
    expect(body).not.toContain(PLANTED_SECRET)
    expect(body).toContain(ESCAPED_SECRET)
    expect(body).not.toContain(MASK_TOKEN)
  })

  // -------------------------------------------------------------------------------------------
  // The violation cells: the secret must not reach the wire in any form
  // -------------------------------------------------------------------------------------------

  it('a seeded secret planted as the distinct id is masked on the wire', async () => {
    const body = await sendThroughShippedPath(sink, {
      distinctId: PLANTED_SECRET,
      maskingContext: seededContext(),
    })

    expect(body).not.toContain(PLANTED_SECRET)
    // The discriminating half: a post-serialization masker would leave THIS behind.
    expect(body).not.toContain(ESCAPED_SECRET)
    expect(body).toContain(MASK_TOKEN)
    // The event still arrived — masking is not "send nothing".
    expect(body).toContain('agent-qa.init.completed')
  })

  it('a seeded secret nested in objects and arrays is masked on the wire', async () => {
    const payload: AnalyticsCapturePayload = {
      distinctId: 'u_clean-anchor-value-here-ok',
      event: {
        name: 'agent-qa.init.completed',
        properties: {
          init_mode: 'agent',
          nested: { detail: PLANTED_SECRET, depth: 2 },
        },
      },
    } as AnalyticsCapturePayload

    const body = await sendPayloadThroughTransport(sink, payload, seededContext())

    expect(body).not.toContain(PLANTED_SECRET)
    expect(body).not.toContain(ESCAPED_SECRET)
    expect(body).toContain(MASK_TOKEN)
  })

  it('masking runs BEFORE serialization — the mask token sits where the value was, not around it', async () => {
    const context = seededContext()
    const masked = maskEventForSend(
      {
        distinctId: PLANTED_SECRET,
        event: { name: 'agent-qa.init.completed', properties: { init_mode: 'agent' } },
      } as AnalyticsCapturePayload,
      context,
    )

    // Structure-aware means the STRING LEAF was replaced, so the serialized form contains no
    // fragment of the original — not even the parts an escape would have split it around.
    expect(masked.distinctId).toBe(MASK_TOKEN)
    expect(JSON.stringify(masked)).not.toContain('sk-live-')
    expect(JSON.stringify(masked)).not.toContain('DEADBEEF')
  })

  // -------------------------------------------------------------------------------------------
  // The clean side: masking must not touch a payload with nothing to mask
  // -------------------------------------------------------------------------------------------

  it('a collision-free payload arrives unchanged — masked and unmasked bodies match', async () => {
    const distinctId = 'u_quiet-lake-amber-pine-otter-fern-slate-ember-loft-nine'

    const withMasking = await sendThroughShippedPath(sink, {
      distinctId,
      maskingContext: seededContext(),
    })
    const withoutMasking = await sendThroughShippedPath(sink, { distinctId })

    // Byte-identical after normalising the three fields posthog stamps per send (uuid, timestamp,
    // sent_at). Those differ between any two sends and say nothing about masking.
    expect(normalizeVolatile(withMasking)).toBe(normalizeVolatile(withoutMasking))
    expect(withMasking).toContain(distinctId)
    expect(withMasking).not.toContain(MASK_TOKEN)
  })

  it('the event NAME is never rewritten, even when a registered secret collides with it', async () => {
    // A name is drawn from a closed literal set, so it cannot carry a user's data — and rewriting
    // it could only corrupt attribution. This pins the decision rather than leaving it to chance.
    const context = createAnalyticsMaskingContext({
      secretStore: { forEachSecret: (cb) => cb('COLLIDING', 'agent-qa.init.completed') },
    })
    const masked = maskEventForSend(
      {
        distinctId: 'u_anchor-value-goes-right-here',
        event: { name: 'agent-qa.init.completed', properties: {} },
      } as AnalyticsCapturePayload,
      context,
    )

    expect(masked.event.name).toBe('agent-qa.init.completed')
  })

  // -------------------------------------------------------------------------------------------
  // The structural claims: ONE choke point, and no second masking mechanism
  // -------------------------------------------------------------------------------------------

  it('maskEventForSend has exactly ONE call site in shipped source, and it is the transport', () => {
    const callSites: string[] = []

    for (const file of packageSourceFiles()) {
      const code = withoutComments(readFileSync(file, 'utf8'))
      const pattern = /(\w*\s*)maskEventForSend\s*\(/gu
      for (const match of code.matchAll(pattern)) {
        // The declaration reads `function maskEventForSend(`; every other occurrence is a call.
        if ((match[1] ?? '').trim() === 'function') continue
        callSites.push(relativeToSrc(file))
      }
    }

    expect(callSites).toEqual(['transports.ts'])
  })

  it('the seam imports the safety masking context — it does not mint a second deny-list', () => {
    const seamSource = packageSourceFiles().find((file) => relativeToSrc(file) === 'masking-seam.ts')
    expect(seamSource).toBeDefined()
    const code = withoutComments(readFileSync(seamSource as string, 'utf8'))

    expect(code).toContain('@vostride/agent-qa-safety')
    expect(code).toContain('seedMaskingContext')
    expect(code).toContain('createMaskingContext')
    // A regex literal or a constructed RegExp here would be the second deny-list this cell exists
    // to forbid: the masking vocabulary is the seeded context's, not a pattern written beside it.
    expect(code).not.toContain('new RegExp')
    expect(code).not.toMatch(/=\s*\/[^/\s]/u)
  })

  it('the seeded context draws from seedMaskingContext sources, not from a hand-built list', () => {
    const context = createAnalyticsMaskingContext({
      secretStore: { forEachSecret: (cb) => cb('STORE_SECRET', 'store-secret-value-0001') },
      env: { SOME_TOKEN: 'env-secret-value-0002' },
      authState: { knownSensitiveStrings: ['auth-secret-value-0003'] },
    })

    // All three channels the sources contract defines, masked by the one context.
    expect(context.mask('store-secret-value-0001')).not.toContain('store-secret-value-0001')
    expect(context.mask('env-secret-value-0002')).not.toContain('env-secret-value-0002')
    expect(context.mask('auth-secret-value-0003')).not.toContain('auth-secret-value-0003')
  })
})
