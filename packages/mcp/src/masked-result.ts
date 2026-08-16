// ONE MASKED SERIALIZATION, TWO CHANNELS (Phase 396 plan 06 · T-396-01 / RESEARCH Pitfall 9).
//
// WHY THIS MODULE EXISTS, measured rather than reasoned. Every tool result this package returns has
// TWO output channels: `content`, the prose a person might read, and `structuredContent`, the object
// a model reads and a host logs. Until 396-06 drove the wire, only the first was masked:
//
//     content:           [{ type: 'text', text: maskText(JSON.stringify(output)) }]
//     structuredContent: output          <-- the raw op output, unmasked
//
// A credential this host had DECLARED — its own bearer token — reached the wire verbatim through
// that second field while the text beside it read `<SECRET_0>`. Observed 2026-08-16 in
// `packages/cli/src/__tests__/mcp-credential-surface.test.ts` (B1b):
//
//     AssertionError: structuredContent carried the plant — the machine channel a person never
//     reads: expected 'prop_qxr' to be undefined
//
// That is RESEARCH Pitfall 9's own sentence, which named `structuredContent` as the channel and was
// filed before anyone had driven it: *"the new projection returns op outputs as `structuredContent`
// — an unmasked serialization can carry planted values to a machine surface a person never sees."*
//
// THE FIX IS ONE SERIALIZATION, NOT TWO MASKINGS. Masking the object separately would be a second
// implementation of the same rule, free to disagree with the first — and the disagreement would be
// invisible, because nobody diffs the two channels of a result. So the output is serialized once,
// masked once, and PARSED BACK: the two channels are then the same bytes by construction, and a
// value hidden from one cannot survive in the other.
//
// IT FAILS CLOSED. If the masked document does not parse — which requires a mask that broke JSON,
// not merely one that replaced a value — the result becomes a tool error naming the condition. The
// alternative is returning the unmasked object, which is the defect this module exists to close.
//
// THE COST, STATED — and the reason it is a REAL cost rather than a theoretical one: SEP-2106
// loosened `inputSchema`/`outputSchema` to full JSON Schema 2020-12, so an advertised output
// contract can now say things precise enough for a masked value to violate them (a `format`, a
// `pattern`, a `minLength`). A masked value can therefore violate the tool's advertised
// `outputSchema`, and the SDK
// then refuses the result. That is the correct direction. An op output that contains a declared
// credential is a leak; turning a leak into a refusal a caller can see is a better answer than
// serving it, and it happens only when a legitimate value is byte-equal to a credential this host
// was told about.

import type { CallToolResult } from '@modelcontextprotocol/server'

/**
 * Serialize once, mask once, and answer both channels from the same bytes.
 *
 * `structuredContent` is set from the PARSED masked document rather than from `output`, which is
 * the whole point: the object a machine reads and the text a person reads cannot disagree about
 * what was hidden.
 */
export function maskedToolResult(
  output: unknown,
  maskText: (text: string) => string,
): CallToolResult {
  // `JSON.stringify` answers `undefined` for `undefined` and for a bare function; `'null'` is the
  // honest serialization of "the op answered nothing", and it parses.
  const serialized = JSON.stringify(output) ?? 'null'
  const text = maskText(serialized)

  let structuredContent: unknown
  try {
    structuredContent = JSON.parse(text)
  } catch {
    return {
      content: [
        {
          type: 'text' as const,
          text:
            'This result could not be returned: masking its output produced a document that is no '
            + 'longer valid JSON, so the unmasked object was withheld rather than served.',
        },
      ],
      isError: true,
    }
  }

  return {
    content: [{ type: 'text' as const, text }],
    structuredContent: structuredContent as CallToolResult['structuredContent'],
  }
}

/**
 * The masked error result every handler in this package answers a refusal with.
 *
 * A refusal is a RESULT the caller can read, not a transport failure — and the message is masked
 * because an error string is the channel 395's credential disclosure actually travelled down
 * (T-395-R5-10). Kept beside `maskedToolResult` so the two halves of one handler's output posture
 * are one thing to read and one thing to change.
 */
export function maskedToolError(err: unknown, maskText: (text: string) => string): CallToolResult {
  return {
    content: [
      {
        type: 'text' as const,
        text: maskText(err instanceof Error ? err.message : String(err)),
      },
    ],
    isError: true,
  }
}
