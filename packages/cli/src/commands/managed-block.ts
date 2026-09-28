// RED skeleton (431-09): the pre-existing .gitignore strip-then-append algorithm, generalized
// over the descriptor so the byte contract below reds on assertions rather than on a load error.

export type ManagedBlockCommentSyntax = 'hash' | 'html'

export interface ManagedBlockDescriptor {
  readonly owner: string
  readonly blockName: string
  readonly syntax: ManagedBlockCommentSyntax
}

export interface ManagedBlockContent {
  readonly descriptor: ManagedBlockDescriptor
  readonly body: readonly string[]
  readonly target: string
}

export type ManagedBlockRefusalReason = 'ambiguous-marker' | 'unbalanced' | 'duplicate' | 'inverted'

export class ManagedBlockRefusal extends Error {
  readonly reason: ManagedBlockRefusalReason

  constructor(reason: ManagedBlockRefusalReason, message: string) {
    super(message)
    this.name = 'ManagedBlockRefusal'
    this.reason = reason
  }
}

export const AGENT_QA_INIT_GITIGNORE_BLOCK: ManagedBlockDescriptor = {
  owner: 'agent-qa',
  blockName: 'init',
  syntax: 'hash',
}

export const AGENT_QA_INIT_MARKDOWN_BLOCK: ManagedBlockDescriptor = {
  owner: 'agent-qa',
  blockName: 'init',
  syntax: 'html',
}

export function managedBlockMarkers(
  descriptor: ManagedBlockDescriptor,
): { readonly start: string, readonly end: string } {
  const token = (edge: string): string => `${descriptor.owner} ${descriptor.blockName}:${edge}`
  return descriptor.syntax === 'hash'
    ? { start: `# ${token('start')}`, end: `# ${token('end')}` }
    : { start: `<!-- ${token('start')} -->`, end: `<!-- ${token('end')} -->` }
}

export function composeManagedBlock(existing: string, content: ManagedBlockContent): string {
  const { start: startMarker, end: endMarker } = managedBlockMarkers(content.descriptor)
  const label = `${content.descriptor.owner} ${content.descriptor.blockName}`
  const startCount = existing.split(startMarker).length - 1
  const endCount = existing.split(endMarker).length - 1
  if (startCount !== endCount || startCount > 1) {
    throw new ManagedBlockRefusal(
      startCount !== endCount ? 'unbalanced' : 'duplicate',
      `Refusing malformed ${content.target}: expected at most one complete `
      + `${label} managed block`,
    )
  }
  let stripped = existing
  if (startCount === 1) {
    const start = existing.indexOf(startMarker)
    const endAt = existing.indexOf(endMarker, start)
    if (endAt === -1) {
      throw new ManagedBlockRefusal(
        'inverted',
        `Refusing malformed ${content.target}: the ${label} managed `
        + 'end marker precedes its start marker',
      )
    }
    let end = endAt + endMarker.length
    if (existing.slice(end, end + 2) === '\r\n') end += 2
    else if (existing[end] === '\n') end += 1
    stripped = existing.slice(0, start) + existing.slice(end)
  }
  const block = `${[startMarker, ...content.body, endMarker].join('\n')}\n`
  if (stripped.length === 0) return block
  const separator = stripped.endsWith('\n\n') ? '' : stripped.endsWith('\n') ? '\n' : '\n\n'
  return `${stripped}${separator}${block}`
}
