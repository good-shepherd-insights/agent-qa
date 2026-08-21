// ONE conversation, two places to see it (Phase 400 plan 06, D-13).
//
// WHY THIS PROVIDER EXISTS AT ALL. D-13 widened the surface to a dedicated `/chat` page AND a global
// side panel, and it did so with a condition attached: they are two MOUNTS of one shared transcript
// component, never two renderers. A shared component alone does not get you there — two mounts of
// one component that each called `useChatTurn` would hold two `EventSource` connections, two
// session ids and two transcripts of what a person experiences as one conversation. Opening the
// panel mid-way through a chat on the page would show them an empty box. So the HOOK is called
// once, here, at the shell, and both mounts read this context.
//
// THE SESSION IS THE CONVERSATION AND THE ROUTE IS NOT. Navigating from `/chat` to `/runs` with the
// panel open must not restart anything: this provider sits above the router's `Outlet`, so its
// state survives every navigation the way the sidebar does.
//
// THE PANEL'S OPEN/CLOSE LIVES HERE TOO, for the same reason and one more: the panel is opened from
// a control that is not inside it (the sidebar, a keyboard shortcut), so the flag has to live where
// both the opener and the panel can see it. It is deliberately NOT persisted — a chat panel that
// reopened itself on every page load would be a surface a person cannot dismiss.

import { createContext, use, useEffect, useMemo, useState, type ReactNode } from "react"

import { useChatTurn, type ChatTranscriptState, type ChatTurnStatus } from "@/chat/use-chat-turn"
import {
  fetchChatCapabilityCatalog,
  type ChatCapabilityRow,
  type ChatConfirmAnswer,
} from "@/lib/api"

/**
 * The prompts a first-time transcript offers.
 *
 * `/help` IS THE FIRST ONE ON PURPOSE. It routes to the resolver table's own help directive, which
 * projects the committed capability catalog — the same artifact the CLI's `/help` and completer
 * read, served to this browser over the door's catalog route. So the first thing a person can click
 * is the product's own answer to "what can this do", rather than a list somebody wrote here.
 */
const CHAT_STARTERS: readonly string[] = Object.freeze([
  "/help",
  "status",
  "what changed in my last run?",
  "/fn config.get {}",
])

export interface ChatSessionValue {
  state: ChatTranscriptState
  status: ChatTurnStatus
  sessionId?: string
  starters: readonly string[]
  /**
   * The committed catalog's rows, for the browser's completion of `/fn <op>` (RESEARCH Open Q4).
   *
   * SCOPED DELIBERATELY. 400 gives the browser starter prompts and `/help` and stops there — full
   * completer parity with the terminal is not what DASH-01 claims, and a half-built completer that
   * suggested a capability this door could not reach would be worse than none. `/help` itself is
   * answered by the SERVER through the resolver table, so the two projections of this artifact
   * cannot disagree about what exists.
   */
  capabilities: readonly ChatCapabilityRow[]
  panelOpen: boolean
  setPanelOpen: (open: boolean) => void
  sendTurn: (message: string) => void
  answerConfirm: (confirmId: string, answer: ChatConfirmAnswer) => void
}

const ChatSessionContext = createContext<ChatSessionValue | undefined>(undefined)

export function ChatSessionProvider({ children }: { children: ReactNode }) {
  const turn = useChatTurn()
  const [panelOpen, setPanelOpen] = useState(false)
  const [capabilities, setCapabilities] = useState<readonly ChatCapabilityRow[]>([])

  useEffect(() => {
    let cancelled = false
    // READ ONCE, FAIL QUIET. The catalog is a committed artifact and does not change while a page
    // is open. A server composed without a loader answers 501, and the honest response to that is
    // a transcript with no completions rather than an error a person cannot act on — the chat
    // itself works either way, and `/help` is answered by the turn.
    void fetchChatCapabilityCatalog()
      .then((catalog) => { if (!cancelled) setCapabilities(catalog.rows) })
      .catch(() => { if (!cancelled) setCapabilities([]) })
    return () => { cancelled = true }
  }, [])
  const value = useMemo<ChatSessionValue>(() => ({
    state: turn.state,
    status: turn.status,
    ...(turn.sessionId === undefined ? {} : { sessionId: turn.sessionId }),
    starters: CHAT_STARTERS,
    capabilities,
    panelOpen,
    setPanelOpen,
    sendTurn: turn.sendTurn,
    answerConfirm: turn.answerConfirm,
  }), [
    turn.state, turn.status, turn.sessionId, turn.sendTurn, turn.answerConfirm,
    capabilities, panelOpen,
  ])

  return <ChatSessionContext value={value}>{children}</ChatSessionContext>
}

/**
 * Read the one conversation.
 *
 * THROWS RATHER THAN DEFAULTING. A context default here would let a mount render a transcript that
 * silently belongs to nothing — no stream, no session, no turns — which looks exactly like a
 * conversation nobody has spoken in yet. A missing provider is a wiring mistake and should read as
 * one.
 */
export function useChatSession(): ChatSessionValue {
  const value = use(ChatSessionContext)
  if (value === undefined) {
    throw new Error("useChatSession was called outside <ChatSessionProvider>")
  }
  return value
}
