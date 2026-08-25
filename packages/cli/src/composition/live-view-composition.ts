// The live-view COMPOSITION (403 D-03/D-04, Q4(b)) — the one place a signer, a live run registry
// and the function layer's validator are joined.
//
// WHAT IT PRODUCES, AND WHY THREE THINGS RATHER THAN ONE. `liveView` is the mint-side port the
// function layer needs; `validate` is the read-side the dashboard's frame proxy binds BY REFERENCE
// (so there is exactly one parse of a `liveUrl` token in this system); `mintedSecretStore` is the
// masking half. Both directions are composed together deliberately — a mint whose validator was
// composed elsewhere is a token system with two opinions about what a valid token is.

import { validateLiveUrlToken } from '@vostride/agent-qa-agent'
import type { LiveViewPort } from '@vostride/agent-qa-agent'
import type { LiveStreamDeclaration, LiveUrlSigner, LiveUrlVerdict } from '@vostride/agent-qa-schema'

import { createEphemeralLiveUrlSigner } from './live-url-signer.js'
import type { RunServiceSessionRegistry } from './run-service-session-registry.js'
// TYPE-ONLY, and it must stay type-only: `commands/dashboard.ts` imports this module's VALUE, so
// a value edge back would close a cycle at module-evaluation time.
import type { DashboardRunDoor } from '../commands/dashboard.js'

/** How many minted tokens the masking store remembers. FIFO past the cap — bounded, not a leak. */
export const MINTED_LIVE_URL_TOKEN_CAP = 256

export interface ComposeLiveViewInput {
  readonly sessions: RunServiceSessionRegistry
  readonly origin: () => string | undefined
  /** Narrowed to the ONE member this composer uses: it binds ITS OWN store, so the command never has to. */
  readonly door: Pick<DashboardRunDoor, 'bindMaskingSecrets'>
  readonly signer?: LiveUrlSigner
  readonly now?: () => number
}

export interface ComposedLiveView {
  /** The mint-side port `FunctionDeps.liveView` binds to. */
  readonly liveView: LiveViewPort
  /** The read side — the function layer's own validator, closed over the same signer. */
  validate(token: string, expect: { runId: string; now: number }): LiveUrlVerdict
  /** Every token this composition has minted, as a masking secret store. */
  readonly mintedSecretStore: { forEachSecret(cb: (name: string, value: string) => void): void }
}

export function composeLiveView(input: ComposeLiveViewInput): ComposedLiveView {
  const signer = input.signer ?? createEphemeralLiveUrlSigner()
  const now = input.now ?? ((): number => Date.now())

  /**
   * 2026-08-25 (403, Q4(b) + Pitfall 2): tokens are registered for MASKING, with a known limit.
   *
   * `safety/src/masking/seed.ts:17` walks `forEachSecret` ONCE, at run start — so a token minted
   * mid-run is not masked by THAT run's masker, only by runs started afterwards. This store is
   * therefore the second line, not the guarantee. The guarantee is structural: the token rides a
   * URL fragment (never sent to a server), the frame socket's first message (never logged), and
   * the op's `classify` refuses to interpolate it — which is what `live-view-anchors.test.ts`'s
   * log-scan measures on the shipped binary.
   */
  const minted: string[] = []
  const mintedSecretStore = {
    forEachSecret(cb: (name: string, value: string) => void): void {
      minted.forEach((token, index) => cb(`liveUrl#${index}`, token))
    },
  }
  // THE COMPOSER BINDS ITS OWN STORE (402-06's law, `dashboard.ts:1380-1387`): every composition
  // that goes through the shipped composer is seeded, including the conformance suites'. The
  // command never calls `bindMaskingSecrets` for us — that is how a binder gets forgotten.
  input.door.bindMaskingSecrets(mintedSecretStore)

  const liveView: LiveViewPort = {
    signer,
    origin: input.origin,
    now,
    capabilityOf(runId: string, handle: number): LiveStreamDeclaration | undefined {
      const session = input.sessions.attach(runId)
      if (!session) return undefined
      return session.streamCapabilityOf(handle)
    },
    onMinted(token: string): void {
      minted.push(token)
      while (minted.length > MINTED_LIVE_URL_TOKEN_CAP) minted.shift()
    },
  }

  return {
    liveView,
    // BY REFERENCE, not re-implemented. The dashboard-server holds no parse of its own (LIVE-02).
    validate: (token, expect) => validateLiveUrlToken(signer, token, expect),
    mintedSecretStore,
  }
}
