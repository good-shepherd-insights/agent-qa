// `editor.liveurl` — the editor subject's view token (428 D-07).

import { EditorLiveUrlInputSchema, EditorLiveUrlResultSchema } from '@vostride/agent-qa-schema'
import type { EditorLiveUrlInput, EditorLiveUrlResult } from '@vostride/agent-qa-schema'

import type { ClauseVerdict, FunctionSpec } from '../spec.js'

export const EDITOR_LIVE_URL_FUNCTION_ID = 'editor.liveurl'

export class UnknownLiveEditorSessionError extends Error {
  constructor(readonly sessionId: string) {
    super(`unknown_session: no live editor session ${sessionId}`)
    this.name = 'UnknownLiveEditorSessionError'
  }
}

export const editorLiveUrlSpec: FunctionSpec<EditorLiveUrlInput, EditorLiveUrlResult> = {
  id: EDITOR_LIVE_URL_FUNCTION_ID,
  summary: 'Mint a short-lived, view-scoped live-view URL for one live editor session.',
  requiredScopes: ['read'],
  resultKind: 'unary',
  boundThrough: 'liveView',
  input: EditorLiveUrlInputSchema,
  output: EditorLiveUrlResultSchema,
  risk: { name: `fn:${EDITOR_LIVE_URL_FUNCTION_ID}`, recognized: true, readOnly: true },
  classify(): ClauseVerdict {
    return { status: 'executed', outcome: 'liveUrl minted for a live editor session' }
  },
  async invoke(): Promise<EditorLiveUrlResult> {
    return { liveUrl: '', expiresAt: 0, stream: { kind: 'none' } }
  },
}
