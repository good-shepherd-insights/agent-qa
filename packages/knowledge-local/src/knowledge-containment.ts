/**
 * Containment of knowledge-root writes (261003-lgd CR-01, generalised by 261003-mqc).
 *
 * The knowledge root is a git repository people share and pull, and a tracked symlink is checked
 * out even under an ignored directory, so `memory/`, `memory/queue/`, `memory/index/`, a product
 * directory or `policies/` can point anywhere. Every writer checks the directory it is about to
 * create, write, rename into or delete from before it touches it: each component of that
 * directory that already exists must resolve inside the knowledge root's own real path. A link
 * that stays inside the root is fine; one that leaves it, or resolves nowhere, is refused by name.
 * A component that does not exist yet is created by the writer as a real directory.
 *
 * What this does not close: a local process that swaps a component for a link between this check
 * and the write. The threat this answers is a link committed into the shared repository.
 */
import { lstatSync, realpathSync } from 'node:fs'
import { isAbsolute, join, relative, sep } from 'node:path'

export class KnowledgeRootContainmentError extends Error {
  override readonly name = 'KnowledgeRootContainmentError'
  readonly path: string
  readonly resolvedTo: string | undefined
  readonly knowledgeRoot: string

  constructor(path: string, resolvedTo: string | undefined, knowledgeRoot: string) {
    const where = resolvedTo === undefined
      ? 'is a link that resolves nowhere'
      : `resolves to ${resolvedTo}`
    super(
      `knowledge write refused: ${path} ${where}, outside the knowledge root `
        + `${knowledgeRoot}. Remove the link ${path} and retry.`,
    )
    this.path = path
    this.resolvedTo = resolvedTo
    this.knowledgeRoot = knowledgeRoot
  }
}

function errnoOf(error: unknown): string {
  return (error as NodeJS.ErrnoException).code ?? ''
}

/**
 * Refuse, before any write, a directory under the knowledge root that leaves it through a link.
 *
 * `directory` is the directory the caller writes in (or creates, renames into, or deletes from);
 * it must name a path under `knowledgeRoot`.
 */
export function assertWithinKnowledgeRoot(knowledgeRoot: string, directory: string): void {
  const rel = relative(knowledgeRoot, directory)
  if (rel === '') return
  if (rel.startsWith(`..${sep}`) || rel === '..' || isAbsolute(rel)) {
    throw new KnowledgeRootContainmentError(directory, directory, knowledgeRoot)
  }
  let realRoot: string
  try {
    realRoot = realpathSync(knowledgeRoot)
  } catch (error) {
    if (errnoOf(error) === 'ENOENT') return
    throw error
  }
  let current = knowledgeRoot
  for (const part of rel.split(sep)) {
    current = join(current, part)
    try {
      lstatSync(current)
    } catch (error) {
      if (errnoOf(error) === 'ENOENT') return
      throw error
    }
    let real: string | undefined
    try {
      real = realpathSync(current)
    } catch (error) {
      if (errnoOf(error) !== 'ENOENT' && errnoOf(error) !== 'ELOOP') throw error
    }
    if (real === undefined || (real !== realRoot && !real.startsWith(`${realRoot}${sep}`))) {
      throw new KnowledgeRootContainmentError(current, real, knowledgeRoot)
    }
  }
}
