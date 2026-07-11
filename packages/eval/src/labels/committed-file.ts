import { canonicalValue } from '../canonical-json'

/**
 * The ONE serializer for every committed text file; canonical key order is
 * what makes the committed store's byte-compare idempotence (D-17) hold
 * across re-seeds. Two semantically-equal values serialize to identical
 * bytes regardless of key insertion order; output is pretty-printed JSON
 * with exactly one trailing newline.
 */
export function committedFileText(value: unknown): string {
  return `${JSON.stringify(canonicalValue(value), null, 2)}\n`
}
