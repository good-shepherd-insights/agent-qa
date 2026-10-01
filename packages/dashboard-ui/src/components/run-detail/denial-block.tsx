// The dashboard renders a denial's plain reason only. 2026-10-01 (432-19, D-15): there is no remedy
// vocabulary to project, so the block has one line and no way to grow a suggested command.

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
