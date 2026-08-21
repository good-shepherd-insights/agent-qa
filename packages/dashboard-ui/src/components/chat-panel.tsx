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

import { Dialog } from "radix-ui"

import { ChatTranscript } from "@/chat/chat-transcript"
import { useChatSession } from "@/chat/chat-session-context"

export function ChatPanel() {
  const { panelOpen, setPanelOpen } = useChatSession()
  return (
    <Dialog.Root open={panelOpen} onOpenChange={setPanelOpen}>
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
