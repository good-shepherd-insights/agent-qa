// ONE SIGN-IN FLOW (429-26 · D-15, D-17 · UI-SPEC S4, S5, E5 · PXH-CONF-03). RED stub.

export type SignInState = "idle" | "waiting" | "awaiting-code" | "completed" | "timed-out" | "failed"

export type SignInMode = "browser-poll" | "manual-code"

export interface SignInCompletion {
  provider: string
  name: string
  created: boolean
}

export interface SignInFlowOptions {
  onCompleted?: (completion: SignInCompletion) => void
}

export interface SignInFlow {
  state: SignInState
  mode?: SignInMode
  reason?: string
  code?: string
  created?: boolean
  exchanging: boolean
  start: (provider: string, name: string) => Promise<void>
  submitCode: (code: string) => Promise<void>
  cancel: () => void
}

export const SIGN_IN_POLL_INTERVAL_MS = 2000
export const SIGN_IN_TIMEOUT_MS = 5 * 60 * 1000

export function useSignInFlow(_options: SignInFlowOptions = {}): SignInFlow {
  return {
    state: "idle",
    exchanging: false,
    start: async () => {},
    submitCode: async () => {},
    cancel: () => {},
  }
}
