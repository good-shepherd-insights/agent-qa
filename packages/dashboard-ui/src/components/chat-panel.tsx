// The global chat panel — the fourth door's SECOND MOUNT (Phase 400 plan 06, D-13).
//
// A MOUNT, NEVER A SECOND RENDERER. This file's whole job is a surface that can be opened from
// anywhere in the dashboard; what it puts inside that surface is `<ChatTranscript />` — the exact
// module `pages/chat.tsx` renders — and it owns not one line of receipt, payload, remedy or confirm
// rendering. A per-placement renderer is what DASH-01 calls the forbidden second entry, and the
// reason it is forbidden is not tidiness: two renderers of one contract agree until somebody edits
// one of them, and the one nobody looks at is the one that goes stale.
//
// THE CONVERSATION IS THE SAME ONE THE PAGE SHOWS. Both mounts read `useChatSession`, so opening
// this panel mid-conversation shows the transcript already in progress rather than an empty box,
// and a turn started here is visible on `/chat` without a reload.

import { MessageSquare } from "lucide-react"
import { Dialog } from "radix-ui"
import { useLocation } from "react-router"

import { ChatTranscript } from "@/chat/chat-transcript"
import { useChatSession } from "@/chat/chat-session-context"
import { routes } from "@/lib/routes"

/**
 * THE AFFORDANCE THAT OPENS IT (400-09, Rule 2 deviation).
 *
 * This panel shipped in 400-06 with `setPanelOpen` published on the chat session context and NO
 * caller anywhere in the application — the sidebar's own comment says "the side panel is reachable
 * from anywhere" and nothing made that true. A second mount nothing can open is not a second mount;
 * it is dead code that every cell about it would have been asserting into. So the trigger lives
 * HERE, in the file that owns the panel, rather than in a navigation file that would then have to
 * know about panel state.
 *
 * A LAUNCHER RATHER THAN A NAV ITEM, because the claim is "from anywhere": the sidebar already
 * carries the `/chat` PAGE mount, and putting the panel there too would offer a person two links
 * with one destination. It is hidden while the panel is open — the panel is the thing it opens.
 *
 * AND IT IS HIDDEN ON `/chat`, WHICH THE BROWSER FOUND RATHER THAN A REVIEWER. The first draft was
 * `fixed bottom-4 right-4` everywhere, and plan 400-09's real-browser cell could not send a turn:
 * the launcher sat exactly on top of the transcript's own Send button and intercepted every click.
 * The fix is not a z-index — it is that the page which already shows this conversation full height
 * has no use for a button that opens a smaller view of the same conversation.
 */
export function ChatPanel() {
  const { panelOpen, setPanelOpen } = useChatSession()
  const { pathname } = useLocation()
  const onChatPage = pathname === routes.chat
  return (
    <Dialog.Root open={panelOpen} onOpenChange={setPanelOpen}>
      {panelOpen || onChatPage ? null : (
        <Dialog.Trigger
          data-chat-panel-open
          data-testid="chat-panel-launcher"
          aria-label="Open chat panel"
          className="fixed bottom-4 right-4 z-40 rounded-full border border-border bg-background/95 p-3 text-muted-foreground shadow-md hover:bg-accent hover:text-foreground"
        >
          <MessageSquare className="size-4" aria-hidden />
        </Dialog.Trigger>
      )}
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/20" />
        <Dialog.Content
          data-chat-panel
          className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col gap-3 border-l border-border bg-background p-4 shadow-lg"
          aria-describedby={undefined}
        >
          <Dialog.Title className="text-sm font-semibold">Chat</Dialog.Title>
          <ChatTranscript />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
