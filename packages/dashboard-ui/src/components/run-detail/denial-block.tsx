// The dashboard renders a denial's neutral reason only; its remedy projection is declared empty.
// The gate's canonical prose never reaches the DOM.

export function DenialBlock({ neutralReason }: { neutralReason: string }) {
  return (
    <div
      data-entry="denial"
      className="flex flex-col gap-1 rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-sm"
    >
      <p className="text-foreground">{neutralReason}</p>
    </div>
  )
}
