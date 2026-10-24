import { Badge } from "@/components/ui/badge"
import { statusBadgeLook } from "@/lib/status"

export function RunStatusBadge({ status }: { status: string }) {
  const { label, ...look } = statusBadgeLook(status)
  return <Badge {...look}>{label}</Badge>
}
