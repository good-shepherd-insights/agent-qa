// THE ONE diff/digest primitive both halves of a config proposal call (Phase 395, D-17 / D-19).
//
// RAW BYTES IN, RENDERED BYTES OUT. Construction (in `agent`) renders the diff a person reads and
// records the digests a later apply will re-check; the apply (in `cli`) recomputes both from the
// file as it stands and byte-compares. Those are two halves of ONE contract, and the whole reason
// this is a single exported function rather than a shared convention is the history written into
// `local-agent-host.ts:1650-1657`:
//
//   BYTES, NOT TEXT — ON BOTH SIDES (394-23 WR-04, completed by 394-29 CR-02). … at the base BOTH
//   halves hashed the UTF-8 decoding and therefore AGREED … what the round-trip genuinely destroyed
//   was the rollback, which wrote U+FFFD back over every sequence the decoder could not read.
//
// WHERE THE DECODE IS, AND WHERE IT IS NOT. Every digest here is taken over the `Uint8Array` the
// caller handed in, untouched. The decode happens ONLY on the rendering path, because a unified
// diff is text by definition and there is nothing else it could be — a person cannot review bytes.
// So a file whose bytes are not valid UTF-8 renders with replacement characters and still digests,
// compares and applies as itself. The two claims stay separate, which is what CR-02 cost.
//
// SORTED BY PATH, ALWAYS. The rendered bytes are compared for equality across two processes and two
// moments, so their order may not depend on the order a caller happened to enumerate a file set in.
//
// THE HUNK VOCABULARY IS `schema/src/patch/`'s (394 D-06 reserved it for this phase). The renderer
// emits `FileChange`/`Hunk` values and then serializes THOSE, so the structure a surface can read
// and the bytes a person reads are one artifact rather than two renderings of one change.

import { sha256hexBytes } from '../determinism/sha256'
import type { FileChange, Hunk } from '../patch/patch'
import { DIFF_CONTEXT_LINES, toUnifiedHunks } from './line-diff'
import { utf8Decode, utf8Encode } from './utf8'

/** One file's before/after RAW bytes. Absent `oldBytes` is an add; absent `newBytes` is a delete. */
export interface ConfigDiffFileInput {
  readonly path: string
  readonly oldBytes?: Uint8Array
  readonly newBytes?: Uint8Array
}

/** What one file hashed to on each side. Absent where that side has no file at all. */
export interface ConfigFileDigest {
  readonly path: string
  readonly oldDigest?: string
  readonly newDigest?: string
}

export interface ConfigDiffResult {
  /** The rendered unified diff, as the exact bytes a proposal stores and an apply compares. */
  readonly diffBytes: Uint8Array
  /** sha256 over exactly {@link ConfigDiffResult.diffBytes}. */
  readonly diffDigest: string
  readonly perFileDigests: readonly ConfigFileDigest[]
  /** The same change in the reserved `patch/` vocabulary, for surfaces that read structure. */
  readonly changes: readonly FileChange[]
}

/**
 * A file with no bytes on either side is not a change and must not be one.
 *
 * Refused BY NAME rather than rendered as an empty section: a caller that handed neither side is
 * either enumerating a file set it cannot read or has lost a byte payload somewhere upstream, and a
 * proposal listing a file with no content on either side would be a decision about nothing.
 */
export class EmptyConfigDiffFileError extends TypeError {
  constructor(readonly path: string) {
    super(
      `refusing to diff ${JSON.stringify(path)}: neither old nor new bytes were supplied, so there `
      + 'is no change to render and nothing to digest.',
    )
    this.name = 'EmptyConfigDiffFileError'
  }
}

function changeKindFor(file: ConfigDiffFileInput): FileChange['changeKind'] {
  if (file.oldBytes === undefined && file.newBytes === undefined) {
    throw new EmptyConfigDiffFileError(file.path)
  }
  if (file.oldBytes === undefined) return 'add'
  if (file.newBytes === undefined) return 'delete'
  return 'modify'
}

function hunksFor(file: ConfigDiffFileInput, context: number): Hunk[] {
  const oldText = file.oldBytes === undefined ? '' : utf8Decode(file.oldBytes)
  const newText = file.newBytes === undefined ? '' : utf8Decode(file.newBytes)
  return toUnifiedHunks(oldText, newText, context).map((hunk) => ({
    header: `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`,
    lines: [...hunk.lines],
  }))
}

/**
 * The `---`/`+++` pair, with `/dev/null` on the side that has no file — git's own spelling.
 *
 * The prefixes are `a/` and `b/` for the same reason: the bytes this renders are what a person
 * reviews in a chat window before saying yes, and a diff that did not look like a diff would be a
 * new artifact class for them to learn.
 */
function fileHeaderLines(file: ConfigDiffFileInput, changeKind: FileChange['changeKind']): string[] {
  return [
    changeKind === 'add' ? '--- /dev/null' : `--- a/${file.path}`,
    changeKind === 'delete' ? '+++ /dev/null' : `+++ b/${file.path}`,
  ]
}

/**
 * Render the diff and take the digests, for one file set, in one pass.
 *
 * The `perFileDigests` and the `diffBytes` come out of the SAME call because they are one claim:
 * "this diff is what these bytes produce". A caller that could ask for one without the other would
 * be able to store a digest taken at one moment beside a diff rendered at another, which is the
 * disagreement the whole freshness contract exists to make impossible.
 */
export function renderConfigDiff(
  files: readonly ConfigDiffFileInput[],
  options: { readonly context?: number } = {},
): ConfigDiffResult {
  const context = options.context ?? DIFF_CONTEXT_LINES
  const ordered = [...files].sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))

  const changes: FileChange[] = []
  const perFileDigests: ConfigFileDigest[] = []
  const lines: string[] = []

  for (const file of ordered) {
    const changeKind = changeKindFor(file)
    const hunks = hunksFor(file, context)
    changes.push({ path: file.path, changeKind, hunks })
    perFileDigests.push({
      path: file.path,
      // RAW BYTES, NEVER THE DECODING ABOVE. The decode two lines up feeds the render and nothing
      // else; these two digests are the values an apply re-checks against a file on disk.
      ...(file.oldBytes === undefined ? {} : { oldDigest: sha256hexBytes(file.oldBytes) }),
      ...(file.newBytes === undefined ? {} : { newDigest: sha256hexBytes(file.newBytes) }),
    })

    if (hunks.length === 0) continue
    lines.push(...fileHeaderLines(file, changeKind))
    for (const hunk of hunks) {
      lines.push(hunk.header)
      lines.push(...hunk.lines)
    }
  }

  // A trailing newline exactly when there is anything at all, so an empty diff is zero bytes rather
  // than one newline — the difference between "nothing changed" and "something rendered emptily".
  const diffBytes = utf8Encode(lines.length === 0 ? '' : `${lines.join('\n')}\n`)

  return {
    diffBytes,
    diffDigest: sha256hexBytes(diffBytes),
    perFileDigests,
    changes,
  }
}
