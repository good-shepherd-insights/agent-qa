// 2026-09-07 (418 D-11): the bundle half of the validity compare, as DATA. Reads only.
import { basename } from 'node:path'

import { distilledScreenStateDigest } from '@vostride/agent-qa-schema'

import { loadBundle, verifyBundleIntegrity } from './bundle-read.js'
import { enumerateBundleDirs } from './bundle-scan.js'

export type CanonicalBundleStateDigests =
  | { kind: 'found'; digests: string[] }
  | { kind: 'not-found' }

export function readCanonicalBundleStateDigests(input: {
  knowledgeRoot: string
  candidateId: string
}): CanonicalBundleStateDigests {
  const found = enumerateBundleDirs(input.knowledgeRoot)
    .find(({ dir }) => basename(dir) === input.candidateId)
  if (found === undefined) return { kind: 'not-found' }
  const loaded = loadBundle(found.dir)
  if (loaded.kind !== 'loaded'
    || loaded.bundle.manifest.id !== input.candidateId
    || !verifyBundleIntegrity(found.dir).ok) return { kind: 'not-found' }
  return {
    kind: 'found',
    digests: loaded.bundle.screenStates.map((state) => distilledScreenStateDigest(state)),
  }
}
