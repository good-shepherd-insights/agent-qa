// A PROJECTION STRING, RENDERED (405-11 · DETL-02, D-10, T-405-40).
//
// EVERY STRING THE RUN-DETAIL PAGE SHOWS A PERSON GOES THROUGH HERE. The plan text, the planned
// action, the recorded result, the step error and the failure summary all come from a producer and
// travel through the display-unmask seam, which rewrites any placeholder it could not restore into
// a typed marker. Rendering one of those strings directly would put `<SECRET_1>` — or worse, the
// marker itself — into a text node a person reads.
//
// TEXT NODES AND ELEMENTS, NEVER MARKUP. There is no `dangerouslySetInnerHTML` in this file or in
// the chip beside it; React escapes every text segment on the way into the DOM. That is the whole
// mitigation for a server-controlled string reaching the page.

import { Fragment } from "react"

import { MaskedChip } from "@/components/run-detail/masked-chip"
import { splitMaskedText } from "@/lib/masked-text"

/**
 * Render a producer string with its masked markers painted as chips.
 *
 * The segments are keyed by ORDINAL rather than by content: two identical markers in one sentence
 * are two different redactions in two different places, and a content key would collapse them.
 */
export function MaskedText({ text }: { text: string }) {
  return (
    <>
      {splitMaskedText(text).map((segment, index) => (
        <Fragment key={index}>
          {segment.kind === "text" ? segment.text : <MaskedChip category={segment.category} />}
        </Fragment>
      ))}
    </>
  )
}
