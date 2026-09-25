// THE PREVIEW'S CHROME ROW (428 D-02): it renders only when it has something to hold.

import { Children, type ReactNode } from 'react'

export function PreviewChrome({ children }: { children?: ReactNode }) {
  const content = Children.toArray(children)
  if (content.length === 0) return null
  return (
    <div data-preview-chrome className="flex h-9 shrink-0 items-center gap-2 border-b px-2 text-xs">
      {content}
    </div>
  )
}
