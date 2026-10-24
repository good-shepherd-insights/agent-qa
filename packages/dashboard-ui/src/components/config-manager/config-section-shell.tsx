import { type ComponentProps } from "react"

import { cn } from "@/lib/utils"

export function ConfigLineNotice({
  className,
  ...props
}: ComponentProps<"div">) {
  return (
    <div
      data-config-line-notice
      className={cn(
        "border border-border bg-transparent rounded-none px-4 py-3 text-sm text-muted-foreground",
        className,
      )}
      {...props}
    />
  )
}
