// The MCP App resource, driven end to end against a REAL registry (Phase 408 plan 01 · MCPA-01).
//
// WHAT IS PRODUCTION HERE AND WHAT IS SCRIPTED. Production: `registerAppResources`, the read
// handler, `renderAppWrapperPage`, `createFunctionRegistry`, `invokeFunction`, the `runs.liveurl`
// op, `mintLiveUrlToken` and `validateLiveUrlToken`. Scripted: the recording registrar (the same
// narrow slice `resources.test.ts` drives), the run event log this fixture serves, and the
// `LiveViewPort` a composition would otherwise build — its signer is a real HMAC over a key this
// file owns, so a token that validates below went past the SHIPPED validator and not past a stub.
//
// WHY THE SIGNER IS REAL AND NOT A `sig:${data}` FAKE. D-03's invariant is that a token minted
// inside the App-rendering path validates against the frame proxy that will serve it — one signer,
// two call sites. A fake signer would make the mint/validate cell pass for a wrapper containing
// any string at all, which is exactly the claim the cell exists to refuse.
//
// THE MUTATION LEGS THIS FILE IS THE BAR FOR (to be re-measured when Plan 04's scan cell lands):
//   A1  the read handler mints ONCE and reuses the token for every handle    -> the per-handle cell
//   A2  the mint moved out of the read handler into registration (mint-once) -> the freshness cell
//   A3  the visibility gate dropped from `registerAppResources`              -> the scope cell
//   A4  an unknown run rethrown instead of rendered                          -> the not-live cell
//   A5  the URI echo emitted unmasked on the refusal path                    -> the masking cell

import { createHmac, timingSafeEqual } from 'node:crypto'

import {
  createFunctionRegistry,
  validateLiveUrlToken,
  type CreateFunctionRegistryOptions,
  type FunctionDeps,
  type FunctionRegistry,
  type LiveViewPort,
} from '@vostride/agent-qa-agent'
import type {
  FunctionCaller,
  FunctionScope,
  LiveUrlSigner,
  RunEventEnvelope,
} from '@vostride/agent-qa-schema'
import { describe, expect, it } from 'vitest'

import {
  APP_NEGOTIATION_CLIENT_CAPABILITIES_KEY,
  APP_RESOURCE_MIME_TYPE,
  APP_RESOURCE_URI_TEMPLATE,
  AppResourceUriError,
  MCP_APPS_EXTENSION_ID,
  parseAppUri,
  registerAppResources,
} from '../app-resource.js'
import { APP_WRAPPER_STATES } from '../app-wrapper.js'

// ---- The fixture composition -------------------------------------------------------------------

const FIXTURE_RUN_ID = 'run-408-01-tracer'
const FIXTURE_ORIGIN = 'http://127.0.0.1:7777'
const SIGNING_KEY = 'zz-408-01-app-resource-signing-key'

/** The `cli/src/composition/live-url-signer.ts` shape, keyed here so no key is ever shared. */
const signer: LiveUrlSigner = {
  sign: (data) => createHmac('sha256', SIGNING_KEY).update(data).digest('base64url'),
  equals: (a, b) => {
    const left = Buffer.from(a)
    const right = Buffer.from(b)
    return left.length === right.length && timingSafeEqual(left, right)
  },
}

/**
 * A clock that ADVANCES, because the freshness claim is about token BYTES.
 *
 * `iat`/`exp` are ms-epoch and they are inside the signed body, so two mints in the same
 * millisecond are byte-identical by construction — a real host separated by network time would
 * differ, and a cell that depended on that would be flaky rather than wrong. Advancing one
 * millisecond per read makes "a second read mints again" observable without inventing a fact.
 */
function advancingClock(start = 1_800_000_000_000): { now: () => number; at: () => number } {
  let current = start
  return { now: () => (current += 1), at: () => current }
}

const runStartedEnvelope = (handles?: readonly number[]): RunEventEnvelope => ({
  seq: 1,
  ts: 1_800_000_000_000,
  runId: FIXTURE_RUN_ID,
  type: 'runStarted',
  payload: {
    busSchemaVersion: 1,
    scope: { tier: 'test', key: 'TST-408-01' },
    executionContext: 'local-headless',
    buildOrdinal: 1,
    configDigests: { suiteConfigDigest: 'suite-d', testConfigDigest: 'test-d' },
    memberTestCount: handles === undefined ? 1 : handles.length,
    ...(handles === undefined ? {} : { handles: [...handles] }),
  },
})

interface FixtureOptions {
  /** The roster the run announces on its own `runStarted`. */
  readonly handles?: readonly number[]
  /** Which run ids this host holds a live session for. Empty = the D-07 not-live path. */
  readonly liveRunIds?: readonly string[]
}

function fixtureRegistry(options: FixtureOptions = {}): {
  readonly registry: FunctionRegistry
  readonly clock: { now: () => number; at: () => number }
} {
  const handles = options.handles ?? [0, 1]
  const liveRunIds = options.liveRunIds ?? [FIXTURE_RUN_ID]
  const clock = advancingClock()

  const liveView: LiveViewPort = {
    signer,
    origin: () => FIXTURE_ORIGIN,
    now: clock.now,
    capabilityOf: (runId, handle) =>
      liveRunIds.includes(runId) && handles.includes(handle)
        ? { kind: 'cdp-screencast' }
        : undefined,
  }

  const runs = {
    readEvents: async (runId: string, fromSeq: number) =>
      runId === FIXTURE_RUN_ID && fromSeq <= 1 ? [runStartedEnvelope(options.handles ?? [0, 1])] : [],
  }

  const auditSink = {
    appendExecutionAudit() {},
    appendGuardrailAudit() {},
  } as unknown as CreateFunctionRegistryOptions['auditSink']

  return {
    registry: createFunctionRegistry({
      deps: { runs, liveView } as unknown as FunctionDeps,
      auditSink,
    }),
    clock,
  }
}

function caller(grantedScopes: readonly FunctionScope[] = ['read']): FunctionCaller {
  return { surface: 'mcp', origin: 'agent', grantedScopes, safeMode: false }
}

const identity = (text: string): string => text

// ---- The recording registrar (the `resources.test.ts` slice) -----------------------------------

interface RecordedAppRegistration {
  readonly name: string
  readonly uriTemplate: string
  readonly mimeType: string | undefined
  readonly listCallback: unknown
  readonly read: (
    uri: URL,
    variables: Record<string, string>,
    ctx: unknown,
  ) => Promise<{
    contents: readonly { uri: string; mimeType?: string; text?: string; _meta?: unknown }[]
  }>
}

function recordingServer(): {
  readonly calls: RecordedAppRegistration[]
  registerResource: (
    name: string,
    template: { uriTemplate: { toString: () => string }; listCallback?: unknown },
    config: Record<string, unknown>,
    read: RecordedAppRegistration['read'],
  ) => void
} {
  const calls: RecordedAppRegistration[] = []
  return {
    calls,
    registerResource(name, template, config, read) {
      calls.push({
        name,
        uriTemplate: template.uriTemplate.toString(),
        mimeType: config['mimeType'] as string | undefined,
        listCallback: (template as { listCallback?: unknown }).listCallback,
        read,
      })
    },
  }
}

/**
 * The read context a host that DECLARED the Apps extension produces (408 plan 02).
 *
 * Not an invention: this is the exact envelope shape measured off a real
 * `@modelcontextprotocol/client@2.0.0` over the shipped node handler in
 * `app-negotiation.test.ts`, which is where the claim that this is what the wire looks like is
 * proven. Here it is restated so these direct-drive cells can keep asking their own questions —
 * minting, freshness, masking, roster — without every one of them standing up a socket.
 */
const negotiatedContext = {
  mcpReq: {
    envelope: {
      [APP_NEGOTIATION_CLIENT_CAPABILITIES_KEY]: {
        extensions: { [MCP_APPS_EXTENSION_ID]: {} },
      },
    },
  },
}

/** The captured read, driven the way a negotiated host drives it. */
type NegotiatedRead = (uri: URL) => ReturnType<RecordedAppRegistration['read']>

const asNegotiated =
  (read: RecordedAppRegistration['read']): NegotiatedRead =>
  (uri: URL) =>
    read(uri, {}, negotiatedContext)

/** Register against the fixture and hand back the ONE read the registration captured. */
function registerAndCapture(options: FixtureOptions = {}, scopes?: readonly FunctionScope[]): {
  readonly registered: readonly string[]
  readonly read: NegotiatedRead
  readonly clock: { now: () => number; at: () => number }
} {
  const { registry, clock } = fixtureRegistry(options)
  const server = recordingServer()
  const registered = registerAppResources(server as never, {
    registry,
    caller: caller(scopes),
    maskText: identity,
  })
  expect(server.calls.length, 'exactly one app template is registered').toBe(1)
  return { registered, read: asNegotiated(server.calls[0]!.read), clock }
}

function htmlOf(result: { contents: readonly { text?: string }[] }): string {
  const text = result.contents[0]?.text
  expect(typeof text, 'the app resource serves TEXT, not a blob').toBe('string')
  return text as string
}

/**
 * Every `liveUrl` the served HTML carries, read the way a host would: the embed path for THIS run,
 * with the token in the fragment.
 *
 * Deliberately a scan over the whole document rather than a lookup into a structure — the claim is
 * that the tokens are IN the bytes the host renders, and reading them back out of the input the
 * renderer was handed would assert nothing about the output.
 */
function liveUrlsIn(html: string): readonly string[] {
  const pattern = new RegExp(
    `${FIXTURE_ORIGIN.replace('.', '\\.')}/live/${FIXTURE_RUN_ID}#([A-Za-z0-9._-]+)`,
    'g',
  )
  return [...html.matchAll(pattern)].map((match) => match[0])
}

const tokenOf = (liveUrl: string): string => liveUrl.slice(liveUrl.indexOf('#') + 1)

// ---- The codec ---------------------------------------------------------------------------------

describe('parseAppUri — the ONE codec for ui:// app addresses (T-396-08)', () => {
  it('reads the run id out of a canonical app address', () => {
    expect(parseAppUri(`ui://agent-qa/live-run/${FIXTURE_RUN_ID}`)).toEqual({
      runId: FIXTURE_RUN_ID,
    })
  })

  it('refuses a near-miss authority, a near-miss segment and a trailing path', () => {
    expect(parseAppUri(`ui://agent-qb/live-run/${FIXTURE_RUN_ID}`)).toBeUndefined()
    expect(parseAppUri(`ui://agent-qa/live-runs/${FIXTURE_RUN_ID}`)).toBeUndefined()
    expect(parseAppUri(`ui://agent-qa/live-run/${FIXTURE_RUN_ID}/frames`)).toBeUndefined()
    expect(parseAppUri(`https://agent-qa/live-run/${FIXTURE_RUN_ID}`)).toBeUndefined()
    expect(parseAppUri('ui://agent-qa/live-run/')).toBeUndefined()
  })

  it('refuses a run id the run-directory codec would have to rewrite', () => {
    expect(parseAppUri('ui://agent-qa/live-run/..')).toBeUndefined()
    expect(parseAppUri('ui://agent-qa/live-run/%2E%2E%2Fetc')).toBeUndefined()
  })
})

// ---- Registration ------------------------------------------------------------------------------

describe('registerAppResources — the D-02/D-03 gate', () => {
  it('registers exactly one UNLISTED template, at the published address', () => {
    const { registry } = fixtureRegistry()
    const server = recordingServer()
    const registered = registerAppResources(server as never, {
      registry,
      caller: caller(),
      maskText: identity,
    })

    expect(registered).toEqual([APP_RESOURCE_URI_TEMPLATE])
    expect(server.calls[0]!.uriTemplate).toBe(APP_RESOURCE_URI_TEMPLATE)
    expect(server.calls[0]!.mimeType).toBe(APP_RESOURCE_MIME_TYPE)
    // Pitfall 2's mitigation, asserted rather than described: the template never appears in a
    // listing, so no model-driven enumeration can walk to a minted token.
    expect(server.calls[0]!.listCallback).toBeUndefined()
  })

  it('registers NOTHING for a caller granted no read scope (D-02)', () => {
    const { registry } = fixtureRegistry()
    const server = recordingServer()
    const registered = registerAppResources(server as never, {
      registry,
      caller: caller([]),
      maskText: identity,
    })
    expect(registered).toEqual([])
    expect(server.calls).toEqual([])
  })

  it('registers NOTHING on a registry that declares no mint op (D-03 floor)', () => {
    const server = recordingServer()
    const registered = registerAppResources(server as never, {
      registry: { list: () => [] },
      caller: caller(),
      maskText: identity,
    })
    expect(registered).toEqual([])
    expect(server.calls).toEqual([])
  })

  it('advertises the official Apps extension id, spelled once', () => {
    expect(MCP_APPS_EXTENSION_ID).toBe('io.modelcontextprotocol/ui')
    expect(APP_RESOURCE_MIME_TYPE).toBe('text/html;profile=mcp-app')
  })
})

// ---- The read: mint by reference, per handle, fresh ---------------------------------------------

describe('resources/read mints through the ONE wall and serves the wrapper (D-01/D-06/D-10)', () => {
  it('serves one liveUrl per announced handle, each validating against the SAME signer', async () => {
    const { read, clock } = registerAndCapture({ handles: [0, 1] })
    const result = await read(new URL(`ui://agent-qa/live-run/${FIXTURE_RUN_ID}`))
    const html = htmlOf(result)

    const liveUrls = liveUrlsIn(html)
    expect(liveUrls.length, 'one mint per handle on the roster').toBe(2)
    expect(new Set(liveUrls).size, 'two handles, two distinct links').toBe(2)

    const handles = liveUrls.map((liveUrl) => {
      const verdict = validateLiveUrlToken(signer, tokenOf(liveUrl), {
        runId: FIXTURE_RUN_ID,
        now: clock.at(),
      })
      expect(verdict.kind, `the shipped validator accepts ${liveUrl}`).toBe('ok')
      return verdict.kind === 'ok' ? verdict.claims.handle : -1
    })
    expect([...handles].sort()).toEqual([0, 1])
  })

  it('names the minted origin as the ONLY allowed frame domain (Pitfall 1, T-408-05)', async () => {
    const { read } = registerAndCapture()
    const result = await read(new URL(`ui://agent-qa/live-run/${FIXTURE_RUN_ID}`))
    expect(result.contents[0]!.mimeType).toBe(APP_RESOURCE_MIME_TYPE)
    expect(result.contents[0]!._meta).toEqual({ ui: { csp: { frameDomains: [FIXTURE_ORIGIN] } } })
  })

  it('mints AGAIN on a second read — fresh-on-render, never a cached token (D-10)', async () => {
    const { read } = registerAndCapture({ handles: [0] })
    const uri = new URL(`ui://agent-qa/live-run/${FIXTURE_RUN_ID}`)
    const first = liveUrlsIn(htmlOf(await read(uri)))
    const second = liveUrlsIn(htmlOf(await read(uri)))

    expect(first.length).toBe(1)
    expect(second.length).toBe(1)
    expect(second[0], 'a second read carries different token bytes').not.toBe(first[0])
  })

  it('reads the roster off the run\'s OWN runStarted, not off a guess', async () => {
    const { read } = registerAndCapture({ handles: [0, 1, 2] })
    const html = htmlOf(await read(new URL(`ui://agent-qa/live-run/${FIXTURE_RUN_ID}`)))
    expect(liveUrlsIn(html).length).toBe(3)
  })
})

// ---- Honest absence ----------------------------------------------------------------------------

describe('absence is named, never an error surface (D-07/D-11)', () => {
  it('renders the not-live wrapper for a run this host holds no live session for', async () => {
    const { read } = registerAndCapture({ liveRunIds: [] })
    const result = await read(new URL(`ui://agent-qa/live-run/${FIXTURE_RUN_ID}`))
    const html = htmlOf(result)

    expect(html).toContain('data-app-state="run-ended"')
    expect(liveUrlsIn(html), 'nothing was minted for a run that is not live').toEqual([])
    // No inner frame exists, so there is no origin to allow — the csp block is ABSENT rather than
    // present-and-empty (T-408-05: never a broader allow than the document needs).
    expect(result.contents[0]!._meta).toBeUndefined()
  })

  it('refuses a malformed app address by name, echoing only MASKED caller text (T-408-02)', async () => {
    const seen: string[] = []
    const { registry } = fixtureRegistry()
    const server = recordingServer()
    registerAppResources(server as never, {
      registry,
      caller: caller(),
      maskText: (text) => {
        seen.push(text)
        return '<masked>'
      },
    })

    await expect(
      asNegotiated(server.calls[0]!.read)(new URL('ui://agent-qa/live-run/../../secrets')),
    ).rejects.toThrow(AppResourceUriError)
    expect(seen.some((text) => text.includes('secrets')), 'the echo went through the masker').toBe(
      true,
    )

    let message = ''
    try {
      await asNegotiated(server.calls[0]!.read)(new URL('ui://agent-qa/live-run/../../secrets'))
    } catch (err) {
      message = err instanceof Error ? err.message : String(err)
    }
    expect(message).toContain('<masked>')
    expect(message).not.toContain('secrets')
  })
})

// ---- The wrapper's own vocabulary --------------------------------------------------------------

describe('the wrapper page vocabulary (D-11)', () => {
  it('closes the state set at the five D-11 states', () => {
    expect([...APP_WRAPPER_STATES]).toEqual([
      'connecting',
      'live',
      'expired',
      'unreachable-origin',
      'run-ended',
    ])
  })

  it('renders no run state of its own — no step list, no status line', async () => {
    const { read } = registerAndCapture()
    const html = htmlOf(await read(new URL(`ui://agent-qa/live-run/${FIXTURE_RUN_ID}`)))
    expect(html).toContain('data-app-live-frame')
    expect(html).toContain('data-app-handle-picker')
    expect(html).not.toContain('data-app-step')
    expect(html).not.toContain('data-app-status')
  })
})
