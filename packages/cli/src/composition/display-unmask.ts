// THE DISPLAY-UNMASK SEAM — the restore half of D-08 (Phase 405 plan 10 · DETL-02).
//
// WHAT PROBLEM THIS SOLVES. A run's masking map is in-memory and run-scoped by spec
// (spec/v2/execution-safety.md §4), so the process that could turn `<SECRET_3>` back into a value
// is gone by the time somebody opens that run's detail page tomorrow. 405-02 wrote the durable half
// of the answer — a per-run `masking-digests.json` recording `HMAC(hostKey, value)` per placeholder,
// never the value. This module is the other half: at a human-facing emit it RE-DERIVES candidate
// values from the host's CURRENT sources and restores a placeholder only when a candidate's digest
// equals the one the run recorded.
//
// IDENTITY, NEVER INDEX. `<SECRET_n>` is minted in registration order, so a secret added, removed or
// rotated since the run shifts every later index. A seam that restored by index would show
// `<SECRET_2>` as whatever happens to be second in today's config — a disclosure that looks exactly
// like a correct page. Every restoration here is a keyed-digest match on the VALUE, and the
// index-shift cell in `__tests__/display-unmask.test.ts` is what holds that.
//
// WHAT CANNOT BE RESTORED BECOMES A TYPED MARKER, NEVER A RAW PLACEHOLDER (D-10). No sidecar, no
// key, a rotated-away value, a digest mismatch, a crafted file, or any `<EMAIL_n>` — all of them
// become `maskedMarker(category)` from `@vostride/agent-qa-schema`, which 405-11's chip parser
// splits on. The marker spelling is IMPORTED and never written here: two spellings of one literal
// across two packages is a drift that fails silently and in the worst direction.
//
// A SCOPE-LESS CALL IS THE IDENTITY, AND THAT IS A DECISION RATHER THAN AN OVERSIGHT. Chat calls
// `host.unmaskForDisplay(text)` with no run scope: a chat turn is not about one run, so there is no
// sidecar to match against, and `chat-transcript.tsx` has no chip renderer — a marker emitted there
// would put a raw U+241F in front of a person, which is the very thing D-10 forbids. So chat's
// display posture is byte-for-byte what 400-06 shipped, and giving chat a scope (or a renderer) is
// the later owner's move, not a silent one taken here.
//
// NOTHING HERE PERSISTS, LOGS OR ECHOES A VALUE. The candidate set is built, matched and dropped
// inside the call. The only file this module WRITES is the host key, and only because
// `resolveMaskingHostKey` mints one on first use; the sidecar and the response are read-only to it.

import { timingSafeEqual } from 'node:crypto'

import {
  buildRunMaskingContext,
  digestMaskedValue,
  readMaskingDigests,
  resolveMaskingHostKey,
} from '@vostride/agent-qa-agent-local'
import { PLACEHOLDER_PATTERN, maskedMarker } from '@vostride/agent-qa-schema'
import type { MaskedCategory } from '@vostride/agent-qa-schema'

/** The shape every masking secret store in this process publishes. */
export interface DisplayUnmaskSecretStore {
  forEachSecret(cb: (name: string, value: string) => void): void
}

export interface DisplayUnmaskerInput {
  /** The runtime root the sidecar and the host key live under (`<configDir>/.agent-qa`). */
  readonly agentQaRoot: string
  /**
   * The stores this host holds, READ PER CALL rather than captured.
   *
   * A FACTORY over an ITERABLE for the reason the door's own `maskingSecrets` is one (402-06,
   * T-403-16): more than one composer binds a store, they bind at different moments, and a set
   * captured at composition time would be whichever ones existed first.
   */
  readonly secretStores: () => Iterable<DisplayUnmaskSecretStore>
  /** The environment, read per call — the sensitive slice is selected by name inside the seed. */
  readonly env: () => NodeJS.ProcessEnv
  /** Best-effort auth-state payloads; an empty list is the honest answer for a host with none. */
  readonly authStatePayloads: () => readonly unknown[]
}

/** The seam's signature: additive optional scope, scope-less is the identity. */
export type DisplayUnmask = (text: string, scope?: { runId: string }) => string

/** Lowercase 64-hex — the exact shape `digestMaskedValue` produces. Anything else is not a digest. */
const DIGEST_HEX_RE = /^[0-9a-f]{64}$/

/** The placeholder category vocabulary mapped onto the marker vocabulary. */
const MARKER_CATEGORY: Record<string, MaskedCategory> = { SECRET: 'secret', EMAIL: 'email' }

/**
 * Rewrite every remaining placeholder into its typed marker.
 *
 * RUNS LAST AND OVER EVERYTHING LEFT, so the string `<SECRET_` cannot survive a scoped call
 * whatever the sidecar said. An unrecognised category is impossible by `PLACEHOLDER_PATTERN`'s own
 * closed alternation, and the `?? 'secret'` below is the fail-closed reading rather than a case.
 */
function markUnrestorable(text: string): string {
  return text.replaceAll(
    PLACEHOLDER_PATTERN,
    (_match, category: string) => maskedMarker(MARKER_CATEGORY[category] ?? 'secret'),
  )
}

/** A 32-byte digest buffer, or nothing for bytes that are not a digest at all (T-405-37). */
function digestBuffer(hex: string): Buffer | undefined {
  return DIGEST_HEX_RE.test(hex) ? Buffer.from(hex, 'hex') : undefined
}

export function createDisplayUnmasker(input: DisplayUnmaskerInput): DisplayUnmask {
  // CACHED PER UNMASKER, because `resolveMaskingHostKey` mints the file on first use and a
  // per-emit read would be a file read on every string of every response. The sidecar is NOT
  // cached: a run's file can appear after this host started, and it is one small read per emit.
  let hostKey: Buffer | undefined

  return (text: string, scope?: { runId: string }): string => {
    // THE SCOPE-LESS PATH, FIRST AND UNCONDITIONALLY. Chat (`chat-routes.ts`'s one-argument call)
    // is the caller this arm exists for — see the header. Byte-for-byte identity, no read, no throw.
    if (scope === undefined) return text

    const digests = readMaskingDigests({ root: input.agentQaRoot, runId: scope.runId })
    if (digests === undefined) return markUnrestorable(text)

    hostKey ??= resolveMaskingHostKey(input.agentQaRoot)
    const key = hostKey

    // THE CANDIDATE SET IS THE RUN'S OWN SEED PIPELINE, NOT A SECOND REGISTRATION RULE.
    // `buildRunMaskingContext` IS `createMaskingContext()` + one `seedMaskingContext` over the
    // three sources in their order, with the same `minRegisteredLength` floor — the same call the
    // in-process run drive makes. Re-implementing the enumeration here would be a second answer to
    // "what does this host consider a secret", free to disagree with the run that wrote the sidecar.
    //
    // The store below adapts an ITERABLE of stores onto the single-store parameter. It is not a
    // second `mergedSecretStore`: that helper lives in `in-process-run-execution.ts`, which imports
    // `commands/run.ts` statically, and a static edge to it from a module the dashboard host
    // composes would close an ESM cycle at evaluation time.
    const candidateContext = buildRunMaskingContext({
      secretStore: {
        forEachSecret(cb): void {
          for (const store of input.secretStores()) store.forEachSecret(cb)
        },
      },
      env: input.env(),
      authStatePayloads: [...input.authStatePayloads()],
    })

    try {
      const candidates = candidateContext
        .snapshotRegistered()
        .map(({ value }) => ({ value, digest: Buffer.from(digestMaskedValue(key, value), 'hex') }))

      // placeholder → the value whose digest the run recorded for it.
      const restore = new Map<string, string>()
      for (const [placeholder, recorded] of Object.entries(digests.entries)) {
        const expected = digestBuffer(recorded)
        if (expected === undefined) continue
        for (const candidate of candidates) {
          // FULL 32 BYTES THROUGH `timingSafeEqual` (T-405-36). Never a truncated prefix — that
          // loses precision and can match a different value — and never `===` on hex strings,
          // which short-circuits on the first differing character and leaks a comparison profile.
          // The length guard is required by `timingSafeEqual` itself, which THROWS on a mismatch;
          // both sides are 32 bytes by construction here, so it can only ever be true.
          if (
            candidate.digest.length === expected.length
            && timingSafeEqual(candidate.digest, expected)
          ) {
            restore.set(placeholder, candidate.value)
            break
          }
        }
      }

      // LONGEST PLACEHOLDER FIRST. `>` already terminates the token, so `<SECRET_1>` cannot match
      // inside `<SECRET_10>` — this ordering is the second guard, for the case where a RESTORED
      // value itself contains something placeholder-shaped.
      let out = text
      for (const placeholder of [...restore.keys()].sort((a, b) => b.length - a.length)) {
        out = out.split(placeholder).join(restore.get(placeholder) as string)
      }

      return markUnrestorable(out)
    } finally {
      // The candidate map dies with the call. A context held across emits would be a resolved
      // secret map alive for the lifetime of a server process, for no gain.
      candidateContext.dispose()
    }
  }
}
