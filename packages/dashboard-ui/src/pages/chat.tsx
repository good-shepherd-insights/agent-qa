// The `/chat` page — one of the fourth door's two mounts (Phase 400 plan 06, D-13).
//
// IT CONTAINS NO TRANSCRIPT LOGIC AND THAT IS THE POINT. Everything a person sees below the header
// is `<ChatTranscript />`, the shared component; this file supplies a page frame and nothing else.
// The panel mount (`components/chat-panel.tsx`) contains the same one element for the same reason —
// DASH-01's "one registry-driven render channel, never a second hardcoded entry", enforced by there
// being nothing here to diverge.

import { ChatTranscript } from "@/chat/chat-transcript"

export default function ChatPage() {
  return (
    <div data-chat-page className="flex min-h-0 flex-1 flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Chat</h1>
        <p className="text-sm text-muted-foreground">
          Ask the QA agent. Every capability runs through the same gated function layer the CLI
          uses — receipts, results and refusals are the same facts, rendered here.
        </p>
      </header>
      <ChatTranscript />
    </div>
  )
}
