import { randomUUID } from 'node:crypto'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createAuthoringReader } from '@vostride/agent-qa-knowledge-local'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { discoverAuthoringKnownTests } from '../curation/authoring-test-discovery.js'

const PRODUCT = 'cli-authoring-discovery'
const SCOPE = { tier: 'product', key: PRODUCT } as const

describe('discoverAuthoringKnownTests', () => {
  let root: string
  let firstFile: string
  let secondFile: string
  let malformedFile: string

  beforeEach(() => {
    root = join(tmpdir(), `authoring-test-discovery-${randomUUID()}`)
    mkdirSync(root, { recursive: true })
    firstFile = join(root, 'checkout.yaml')
    secondFile = join(root, 'receipt.yml')
    malformedFile = join(root, 'malformed.yaml')
    writeFileSync(firstFile, `test-id: t_amber-birch-coral-delta-ember-falcon-garden-harbor-island-jungle
name: Checkout with a saved card
target: shop-app
steps:
  - Open the checkout page
  - Submit the saved card
---
test-id: t_aster-bloom-cloud-drift-ember-field-glade-hollow-ivory-jasper
name: Checkout with store credit
target: shop-app
steps:
  - Open the checkout page
  - Apply store credit
`, 'utf8')
    writeFileSync(secondFile, `test-id: t_anchor-breeze-cinder-dawn-elm-frost-grove-hill-iris-jade
name: Review the checkout receipt
target: shop-app
steps:
  - Open the receipt page
  - Verify the checkout total
`, 'utf8')
    writeFileSync(malformedFile, `name: Broken checkout test
steps: this must be an array
`, 'utf8')
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('returns only three file and test-name identities and skips parse-error files', () => {
    const refs = discoverAuthoringKnownTests([firstFile, malformedFile, secondFile])

    expect(refs).toEqual([
      { filePath: firstFile, testName: 'Checkout with a saved card' },
      { filePath: firstFile, testName: 'Checkout with store credit' },
      { filePath: secondFile, testName: 'Review the checkout receipt' },
    ])
    expect(refs.every((ref) => (
      Object.keys(ref).sort().join(',') === 'filePath,testName'
    ))).toBe(true)
  })

  it('feeds the real filesystem inventory through an empty production reader', async () => {
    const reader = createAuthoringReader(
      {
        knowledgeRoot: join(root, 'missing-agent-qa-knowledge'),
        product: PRODUCT,
      },
      {
        discoverKnownTests: () => discoverAuthoringKnownTests([firstFile, secondFile]),
      },
    )

    const brief = await reader.getAuthoringBrief('checkout with saved card', SCOPE)

    expect(brief.exemplars).toContainEqual(expect.objectContaining({
      filePath: firstFile,
      testName: 'Checkout with a saved card',
      unverifiedOutcomes: true,
    }))
  })
})
