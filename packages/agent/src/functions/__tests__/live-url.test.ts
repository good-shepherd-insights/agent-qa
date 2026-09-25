// The `liveUrl` token pair + the `runs.liveurl` op (403 D-01..D-04, LIVE-02).
//
// EVERY REFUSAL IS ASSERTED BY NAME, not as a falsy verdict. A validator that answers `false` for
// four different reasons is a validator whose surface can only ever render "something went wrong" —
// and D-02's whole point is that a viewer of an expired link is TOLD the link expired.

import { FunctionScopeSchema, LIVE_URL_SCOPE, RunsLiveUrlResultSchema } from '@vostride/agent-qa-schema'
import type {
  FunctionCaller,
  LiveStreamDeclaration,
  LiveUrlClaims,
  LiveUrlSigner,
} from '@vostride/agent-qa-schema'
import type { AuditSink } from '@vostride/agent-qa-safety'
import { describe, expect, it } from 'vitest'

import {
  LIVE_EMBED_PATH_PREFIX,
  LIVE_URL_TTL_MS,
  decodeBase64Url,
  encodeBase64Url,
  liveUrlOf,
  mintLiveUrlToken,
  validateLiveUrlToken,
} from '../live-url.js'
import { FunctionNotBoundError, invokeFunction } from '../invoke.js'
import {
  LiveViewUnavailableError,
  RUNS_LIVE_URL_FUNCTION_ID,
  UnknownRunError,
  runsLiveUrlSpec,
} from '../ops/runs-live-url.js'
import { createRegistryFromSpecs } from '../registry.js'
import type { FunctionDeps, FunctionSpec, LiveViewPort } from '../spec.js'

/**
 * A FAKE signer whose signature is a visible function of its input, so a cell can flip one byte and
 * know exactly what it flipped. `equals` is strict — the real signer's constant-time compare is a
 * property of the CLI composition and is measured there, not here.
 */
const fakeSigner: LiveUrlSigner = {
  sign: (data: string) => `sig:${data}`,
  equals: (a: string, b: string) => a === b,
}

const NOW = 1_700_000_000_000

function claims(overrides: Partial<LiveUrlClaims> = {}): LiveUrlClaims {
  return { runId: 'run-alpha', handle: 0, scope: LIVE_URL_SCOPE, iat: NOW, exp: NOW + 60_000, ...overrides }
}

const CALLER: FunctionCaller = {
  surface: 'test',
  grantedScopes: [...FunctionScopeSchema.options],
  safeMode: false,
  origin: 'human',
}

const auditSink: AuditSink = { appendExecutionAudit() {}, appendGuardrailAudit() {} }

interface RecordingLiveView {
  readonly port: LiveViewPort
  readonly minted: string[]
}

function recordingLiveView(input: {
  origin?: string | undefined
  capability?: LiveStreamDeclaration | undefined
} = {}): RecordingLiveView {
  const minted: string[] = []
  return {
    minted,
    port: {
      signer: fakeSigner,
      origin: () => ('origin' in input ? input.origin : 'http://localhost:4321'),
      now: () => NOW,
      capabilityOf: () => ('capability' in input ? input.capability : { kind: 'cdp-screencast' }),
      onMinted: (token) => { minted.push(token) },
    },
  }
}

function registryWith(liveView: LiveViewPort | undefined): ReturnType<typeof createRegistryFromSpecs> {
  const deps = {
    runs: {} as FunctionDeps['runs'],
    knowledge: {} as FunctionDeps['knowledge'],
    config: {} as FunctionDeps['config'],
    entities: {} as FunctionDeps['entities'],
    ...(liveView === undefined ? {} : { liveView }),
  } as FunctionDeps
  return createRegistryFromSpecs([runsLiveUrlSpec as FunctionSpec], {
    deps,
    resolveExecutionContext: () => 'local-interactive',
    auditSink,
  })
}

describe('base64url helpers are a round trip over the claims body', () => {
  it('round-trips every ASCII length class the claims body can take', () => {
    for (const text of ['', 'a', 'ab', 'abc', 'abcd', '{"runId":"run-alpha","handle":0}']) {
      expect(decodeBase64Url(encodeBase64Url(text))).toBe(text)
    }
  })

  it('refuses a body that is not base64url at all', () => {
    expect(decodeBase64Url('not base64url!')).toBeUndefined()
  })
})

describe('mintLiveUrlToken / validateLiveUrlToken (403 D-01/D-02)', () => {
  it('round-trips a freshly minted token to ok with the claims intact', () => {
    const token = mintLiveUrlToken(fakeSigner, claims())
    const verdict = validateLiveUrlToken(fakeSigner, token, { runId: 'run-alpha', now: NOW })
    expect(verdict.kind).toBe('ok')
    if (verdict.kind !== 'ok') return
    expect(verdict.claims).toEqual(claims())
  })

  it('refuses a flipped signature byte as bad_signature', () => {
    const token = mintLiveUrlToken(fakeSigner, claims())
    const tampered = `${token.slice(0, -1)}${token.endsWith('X') ? 'Y' : 'X'}`
    expect(validateLiveUrlToken(fakeSigner, tampered, { runId: 'run-alpha', now: NOW }))
      .toEqual({ kind: 'refused', reason: 'bad_signature' })
  })

  it('refuses a two-part token, a non-v1 prefix and an empty part as malformed', () => {
    const token = mintLiveUrlToken(fakeSigner, claims())
    const [, body, signature] = token.split('.') as [string, string, string]
    for (const bad of [`${body}.${signature}`, `v2.${body}.${signature}`, `v1..${signature}`, `v1.${body}.`]) {
      expect(validateLiveUrlToken(fakeSigner, bad, { runId: 'run-alpha', now: NOW }).kind)
        .toBe('refused')
      expect(
        (validateLiveUrlToken(fakeSigner, bad, { runId: 'run-alpha', now: NOW }) as { reason: string }).reason,
        bad,
      ).toBe('malformed')
    }
  })

  it('refuses a well-signed non-JSON body as malformed', () => {
    const body = encodeBase64Url('not json at all')
    const token = `v1.${body}.${fakeSigner.sign(body)}`
    expect(validateLiveUrlToken(fakeSigner, token, { runId: 'run-alpha', now: NOW }))
      .toEqual({ kind: 'refused', reason: 'malformed' })
  })

  it('CHECKS THE SIGNATURE BEFORE THE BODY: a malformed body with a bad signature is bad_signature', () => {
    // The ordering claim, and the reason it matters: a validator that parsed first would answer
    // `malformed` here and `bad_signature` only for a well-formed forgery — a free oracle telling
    // an attacker whether their claims body parsed.
    const body = encodeBase64Url('not json at all')
    const token = `v1.${body}.sig:WRONG`
    expect(validateLiveUrlToken(fakeSigner, token, { runId: 'run-alpha', now: NOW }))
      .toEqual({ kind: 'refused', reason: 'bad_signature' })
  })

  it('refuses an exp at or before now as expired', () => {
    for (const exp of [NOW, NOW - 1]) {
      const token = mintLiveUrlToken(fakeSigner, claims({ exp }))
      expect(validateLiveUrlToken(fakeSigner, token, { runId: 'run-alpha', now: NOW }))
        .toEqual({ kind: 'refused', reason: 'expired' })
    }
  })

  it('refuses another run id as scope_mismatch (cross-run scope confusion, T-403-03)', () => {
    const token = mintLiveUrlToken(fakeSigner, claims())
    expect(validateLiveUrlToken(fakeSigner, token, { runId: 'run-other', now: NOW }))
      .toEqual({ kind: 'refused', reason: 'scope_mismatch' })
  })

  it('refuses a non-view scope as scope_mismatch', () => {
    // A scope the union does not admit — minted through the `unknown` door on purpose, because
    // what is under test is the VALIDATOR's refusal of a token some other minter could produce.
    const token = mintLiveUrlToken(fakeSigner, { ...claims(), scope: 'control' } as unknown as LiveUrlClaims)
    expect(validateLiveUrlToken(fakeSigner, token, { runId: 'run-alpha', now: NOW }))
      .toEqual({ kind: 'refused', reason: 'scope_mismatch' })
  })

  it('puts the token in the FRAGMENT and nowhere else (D-04)', () => {
    const url = liveUrlOf('http://localhost:4321', 'run-alpha', 'v1.body.sig')
    expect(url).toBe('http://localhost:4321/live/run-alpha#v1.body.sig')
    expect(url.split('#')[0], 'no query, no path segment — the fragment is the only carriage')
      .not.toContain('v1.body.sig')
    expect(LIVE_EMBED_PATH_PREFIX).toBe('/live/')
  })
})

describe('the token names its subject, and a subject of one kind never opens the other (428 D-07)', () => {
  const runSubject = { kind: 'run', runId: 'shared', handle: 0 } as const
  const editorSubject = { kind: 'editor', sessionId: 'shared' } as const

  function subjectClaims(subject: LiveUrlClaims['subject']): LiveUrlClaims {
    return { subject, scope: LIVE_URL_SCOPE, iat: NOW, exp: NOW + 60_000 }
  }

  function signedBodyToken(body: unknown): string {
    const encoded = encodeBase64Url(JSON.stringify(body))
    return `v1.${encoded}.${fakeSigner.sign(encoded)}`
  }

  it('RUN-TOKEN-REFUSED-FOR-EDITOR-SUBJECT', () => {
    // The ids are byte-identical on purpose: only the signed kind can tell the two subjects apart.
    const token = mintLiveUrlToken(fakeSigner, subjectClaims(runSubject))
    expect(validateLiveUrlToken(fakeSigner, token, { subject: { kind: 'editor', id: 'shared' }, now: NOW }))
      .toEqual({ kind: 'refused', reason: 'scope_mismatch' })
    expect(
      validateLiveUrlToken(fakeSigner, token, { subject: { kind: 'run', id: 'shared' }, now: NOW }).kind,
      'the same token opens its own kind, so the refusal is the kind rule and not a parse failure',
    ).toBe('ok')
  })

  it('EDITOR-TOKEN-REFUSED-FOR-RUN-SUBJECT', () => {
    const token = mintLiveUrlToken(fakeSigner, subjectClaims(editorSubject))
    expect(validateLiveUrlToken(fakeSigner, token, { subject: { kind: 'run', id: 'shared' }, now: NOW }))
      .toEqual({ kind: 'refused', reason: 'scope_mismatch' })
    const own = validateLiveUrlToken(fakeSigner, token, { subject: { kind: 'editor', id: 'shared' }, now: NOW })
    expect(own).toEqual({ kind: 'ok', claims: subjectClaims(editorSubject) })
  })

  it('SUBJECT-BODY-FIELD-ORDER', () => {
    // A caller's object is never spread into the signed bytes: an extra or re-ordered key on the
    // way in must not change what is signed.
    const sloppy = { exp: NOW + 60_000, iat: NOW, scope: LIVE_URL_SCOPE, extra: 1, subject: { handle: 0, runId: 'shared', kind: 'run' } }
    const runBody = JSON.parse(
      decodeBase64Url(mintLiveUrlToken(fakeSigner, sloppy as unknown as LiveUrlClaims).split('.')[1] as string) as string,
    ) as Record<string, unknown>
    expect(Object.keys(runBody)).toEqual(['subject', 'scope', 'iat', 'exp'])
    expect(Object.keys(runBody.subject as object)).toEqual(['kind', 'runId', 'handle'])

    const editorBody = JSON.parse(
      decodeBase64Url(mintLiveUrlToken(fakeSigner, subjectClaims(editorSubject)).split('.')[1] as string) as string,
    ) as Record<string, unknown>
    expect(Object.keys(editorBody)).toEqual(['subject', 'scope', 'iat', 'exp'])
    expect(Object.keys(editorBody.subject as object)).toEqual(['kind', 'sessionId'])
  })

  it('UNKNOWN-SUBJECT-KIND-MALFORMED', () => {
    // Each body also carries the pre-428 top-level runId/handle, so a parser that still read the
    // old shape would accept it: only a subject-aware parser refuses these.
    const legacy = { runId: 'shared', handle: 0, scope: LIVE_URL_SCOPE, iat: NOW, exp: NOW + 60_000 }
    const unknownKind = { ...legacy, subject: { kind: 'suite', id: 'shared' } }
    const runWithoutHandle = { ...legacy, subject: { kind: 'run', runId: 'shared' } }
    for (const body of [unknownKind, runWithoutHandle]) {
      expect(validateLiveUrlToken(fakeSigner, signedBodyToken(body), { subject: { kind: 'run', id: 'shared' }, now: NOW }))
        .toEqual({ kind: 'refused', reason: 'malformed' })
      const unsigned = `v1.${encodeBase64Url(JSON.stringify(body))}.sig:WRONG`
      expect(
        validateLiveUrlToken(fakeSigner, unsigned, { subject: { kind: 'run', id: 'shared' }, now: NOW }),
        'the signature is still checked before the body is parsed',
      ).toEqual({ kind: 'refused', reason: 'bad_signature' })
    }
  })
})

describe('runs.liveurl through invokeFunction (403 D-03)', () => {
  it('returns a schema-parseable result whose liveUrl is origin + /live/ + fragment', async () => {
    const live = recordingLiveView()
    const result = RunsLiveUrlResultSchema.parse(
      await invokeFunction(registryWith(live.port), RUNS_LIVE_URL_FUNCTION_ID, { runId: 'run-alpha', handle: 0 }, CALLER),
    )
    expect(result.liveUrl.startsWith('http://localhost:4321/live/run-alpha#v1.')).toBe(true)
    expect(result.expiresAt - NOW).toBe(LIVE_URL_TTL_MS)
    expect(result.handle).toBe(0)
    expect(result.stream, 'the result ECHOES the declared capability, it does not guess')
      .toEqual({ kind: 'cdp-screencast' })
  })

  it('echoes an honest none capability rather than refusing', async () => {
    const live = recordingLiveView({ capability: { kind: 'none' } })
    const result = RunsLiveUrlResultSchema.parse(
      await invokeFunction(registryWith(live.port), RUNS_LIVE_URL_FUNCTION_ID, { runId: 'run-alpha' }, CALLER),
    )
    expect(result.stream).toEqual({ kind: 'none' })
  })

  it('refuses an unknown run by name', async () => {
    const live = recordingLiveView({ capability: undefined })
    await expect(
      invokeFunction(registryWith(live.port), RUNS_LIVE_URL_FUNCTION_ID, { runId: 'run-nope' }, CALLER),
    ).rejects.toBeInstanceOf(UnknownRunError)
  })

  it('refuses a host with no served origin by name', async () => {
    const live = recordingLiveView({ origin: undefined })
    await expect(
      invokeFunction(registryWith(live.port), RUNS_LIVE_URL_FUNCTION_ID, { runId: 'run-alpha' }, CALLER),
    ).rejects.toBeInstanceOf(LiveViewUnavailableError)
  })

  it('is unbound — refused by name — on a host with no live-view port at all', async () => {
    await expect(
      invokeFunction(registryWith(undefined), RUNS_LIVE_URL_FUNCTION_ID, { runId: 'run-alpha' }, CALLER),
    ).rejects.toBeInstanceOf(FunctionNotBoundError)
  })

  it('calls onMinted exactly once per mint, with the BARE token', async () => {
    const live = recordingLiveView()
    const registry = registryWith(live.port)
    const first = RunsLiveUrlResultSchema.parse(
      await invokeFunction(registry, RUNS_LIVE_URL_FUNCTION_ID, { runId: 'run-alpha' }, CALLER),
    )
    expect(live.minted).toHaveLength(1)
    expect(live.minted[0]).toBe(first.liveUrl.split('#')[1])
    await invokeFunction(registry, RUNS_LIVE_URL_FUNCTION_ID, { runId: 'run-alpha' }, CALLER)
    expect(live.minted, 'one registration per mint — no more, no fewer').toHaveLength(2)
  })

  it('NEVER puts the token or the URL in the classify outcome (LIVE-02, D-04)', async () => {
    const live = recordingLiveView()
    const result = RunsLiveUrlResultSchema.parse(
      await invokeFunction(registryWith(live.port), RUNS_LIVE_URL_FUNCTION_ID, { runId: 'run-alpha', handle: 3 }, CALLER),
    )
    const token = result.liveUrl.split('#')[1] as string
    const verdict = runsLiveUrlSpec.classify?.(result)
    expect(verdict?.outcome).toBe('liveUrl minted for handle 3')
    expect(verdict?.outcome, 'a clause verdict is printed into transcripts and audit rows')
      .not.toContain(token)
    expect(verdict?.outcome).not.toContain(result.liveUrl)
  })
})
