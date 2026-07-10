// Neutral port type re-exports anchor the eval workspace dependency declared by this package.
export type { ArtifactSource, HandoffSource } from '@vostride/agent-qa-eval'

export { FsHandoffSource } from './handoff-source.js'
export type { FsHandoffSourceConfig } from './handoff-source.js'

export { DirArtifactSource, absentArtifactSource } from './artifact-source.js'
export type { DirArtifactSourceConfig } from './artifact-source.js'
