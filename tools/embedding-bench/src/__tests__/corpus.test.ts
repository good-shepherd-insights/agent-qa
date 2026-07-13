import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

import { buildCorpus } from '../corpus'

const FIXTURE_DIR = fileURLToPath(new URL('./fixtures/', import.meta.url))
const NO_GOLD_FIXTURE = join(FIXTURE_DIR, 'example-no-gold.json')
const GOLD_FIXTURE = join(FIXTURE_DIR, 'example-gold.json')
const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  )
})

describe('buildCorpus', () => {
  it('is byte-identical across input order and deduplicates repeated renderings', async () => {
    const first = await buildCorpus({ cassettePaths: [NO_GOLD_FIXTURE, GOLD_FIXTURE] })
    const second = await buildCorpus({ cassettePaths: [GOLD_FIXTURE, NO_GOLD_FIXTURE] })

    expect(Buffer.from(JSON.stringify(first))).toEqual(Buffer.from(JSON.stringify(second)))
    expect(first.documents).toHaveLength(3)
    expect(first.recordedQueries).toHaveLength(1)
  })

  it('maps the gold anchor and every equivalence member to document ids', async () => {
    const corpus = await buildCorpus({ cassettePaths: [GOLD_FIXTURE] })
    const query = corpus.recordedQueries[0]
    const link = corpus.documents.find((document) => document.text.startsWith('link "Learn more"'))
    const heading = corpus.documents.find((document) =>
      document.text.startsWith('heading "Example Domain"'),
    )

    expect(query?.query).toBe('Click on "Learn More"')
    expect(query?.goldDocIds).toEqual([heading?.id, link?.id].sort())
  })

  it('rejects a gold equivalence member absent from its recorded screen', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'embedding-corpus-'))
    temporaryDirectories.push(directory)
    const cassette = JSON.parse(await readFile(GOLD_FIXTURE, 'utf8')) as {
      sidecar: { equivalenceSet: unknown[] }
    }
    cassette.sidecar.equivalenceSet.push({
      role: 'button',
      nameNormalized: 'not on this screen',
      ordinal: 0,
    })
    const invalidPath = join(directory, 'missing-gold.json')
    await writeFile(invalidPath, `${JSON.stringify(cassette, null, 2)}\n`)

    await expect(buildCorpus({ cassettePaths: [invalidPath] })).rejects.toThrow(
      /gold member.*not on this screen/i,
    )
  })
})
