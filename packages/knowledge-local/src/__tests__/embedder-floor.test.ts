import { createHash } from 'node:crypto'
import {
  closeSync,
  copyFileSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

import {
  FloorAssetLoadError,
  FloorEmbeddingError,
  createFloorEmbedder,
  loadFloorAssets,
} from '../embedder-floor.js'

interface GoldenVectors {
  dimension: number
  cases: { text: string; vector: number[] }[]
}

const ASSETS_DIR = fileURLToPath(
  new URL('../../assets/potion-retrieval-32m/', import.meta.url),
)
const ASSET_FILES = [
  'potion-retrieval-32m.i8bin',
  'tokenizer.json',
  'golden-vectors.json',
  'manifest.json',
] as const

const temporaryRoots: string[] = []

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

function cosine(left: ArrayLike<number>, right: ArrayLike<number>): number {
  expect(left.length).toBe(right.length)
  let dot = 0
  let leftSquared = 0
  let rightSquared = 0
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index]!
    const rightValue = right[index]!
    dot += leftValue * rightValue
    leftSquared += leftValue * leftValue
    rightSquared += rightValue * rightValue
  }
  return dot / Math.sqrt(leftSquared * rightSquared)
}

function copyAssets(): string {
  const root = mkdtempSync(join(tmpdir(), 'knowledge-floor-assets-'))
  temporaryRoots.push(root)
  const assetsDir = join(root, 'assets')
  mkdirSync(assetsDir)
  for (const file of ASSET_FILES) {
    copyFileSync(join(ASSETS_DIR, file), join(assetsDir, file))
  }
  return assetsDir
}

describe('static floor embedder', () => {
  it('matches every committed fp32 golden vector for both embedding legs', async () => {
    const golden = JSON.parse(
      readFileSync(join(ASSETS_DIR, 'golden-vectors.json'), 'utf8'),
    ) as GoldenVectors
    const embedder = createFloorEmbedder()

    expect(golden.cases.length).toBeGreaterThanOrEqual(8)
    expect(golden.dimension).toBe(512)
    for (const testCase of golden.cases) {
      expect(testCase.vector).toHaveLength(golden.dimension)
      const [document, query] = await Promise.all([
        embedder.embedDocument(testCase.text),
        embedder.embedQuery(testCase.text),
      ])

      expect(document).toHaveLength(golden.dimension)
      expect(query).toEqual(document)
      expect(cosine(document, testCase.vector)).toBeGreaterThanOrEqual(0.99)
      expect(cosine(document, document)).toBeCloseTo(1, 6)
    }
  })

  it('memoizes verified default assets for the process lifetime', () => {
    const first = loadFloorAssets()
    const second = loadFloorAssets()

    expect(second).toBe(first)
    expect(first).toMatchObject({ vocabularySize: 63_091, dimension: 512 })
  })

  it('refuses a digest-corrupt binary with a typed load error', () => {
    const assetsDir = copyAssets()
    const binaryPath = join(assetsDir, 'potion-retrieval-32m.i8bin')
    const file = openSync(binaryPath, 'r+')
    try {
      const byte = Buffer.alloc(1)
      const offset = statSync(binaryPath).size - 1
      readSync(file, byte, 0, 1, offset)
      byte[0] = byte[0]! ^ 0xff
      writeSync(file, byte, 0, 1, offset)
    } finally {
      closeSync(file)
    }

    expect(() => loadFloorAssets({ assetsDir })).toThrowError(FloorAssetLoadError)
    expect(() => loadFloorAssets({ assetsDir })).toThrow(
      expect.objectContaining({ code: 'digest-mismatch' }),
    )
  })

  it('rejects an invalid fixed-layout header even when its digest is updated', () => {
    const assetsDir = copyAssets()
    const binaryName = 'potion-retrieval-32m.i8bin'
    const binaryPath = join(assetsDir, binaryName)
    const bytes = readFileSync(binaryPath)
    bytes.write('NOPE', 0, 'ascii')
    writeFileSync(binaryPath, bytes)

    const manifestPath = join(assetsDir, 'manifest.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      files: Record<string, { bytes: number; sha256: string }>
    }
    manifest.files[binaryName]!.sha256 = createHash('sha256').update(bytes).digest('hex')
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

    expect(() => loadFloorAssets({ assetsDir })).toThrow(
      expect.objectContaining({ code: 'binary-invalid' }),
    )
  })

  it('reports an empty tokenizer result as a typed embedding error', async () => {
    await expect(createFloorEmbedder().embedDocument('   ')).rejects.toEqual(
      expect.objectContaining({
        name: FloorEmbeddingError.name,
        code: 'empty-token-set',
      }),
    )
  })
})
