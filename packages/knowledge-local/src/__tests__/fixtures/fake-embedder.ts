import { createHash } from 'node:crypto'

import { DEFAULT_EMBEDDING_PROFILE } from '@vostride/agent-qa-schema'

import type { EmbedderPort } from '../../embedder-port.js'

function sha256(value: string): Buffer {
  return createHash('sha256').update(value).digest()
}

function deterministicUnitVector(rendering: string, dim: number): Float32Array {
  if (!Number.isInteger(dim) || dim <= 0) {
    throw new TypeError('fake embedder dimension must be a positive integer')
  }

  const seed = createHash('sha256').update(rendering).digest('hex')
  const vector = new Float32Array(dim)
  let squaredLength = 0

  for (let offset = 0, blockIndex = 0; offset < dim; blockIndex += 1) {
    const block = sha256(`${seed}:${blockIndex}`)
    for (const byte of block) {
      if (offset >= dim) break
      const value = byte / 127.5 - 1
      vector[offset] = value
      squaredLength += value * value
      offset += 1
    }
  }

  const length = Math.sqrt(squaredLength)
  if (length === 0) throw new Error('fake embedder produced a zero-length vector')
  for (let index = 0; index < vector.length; index += 1) {
    vector[index] = vector[index]! / length
  }
  return vector
}

/** Deterministic sha256-seeded, L2-normalized EmbedderPort fixture for index tests. */
export function makeFakeEmbedder(
  dim: number = DEFAULT_EMBEDDING_PROFILE.dim,
): EmbedderPort {
  return {
    async embedDocument(rendering: string): Promise<Float32Array> {
      return deterministicUnitVector(rendering, dim)
    },
    async embedQuery(rendering: string): Promise<Float32Array> {
      return deterministicUnitVector(rendering, dim)
    },
  }
}
