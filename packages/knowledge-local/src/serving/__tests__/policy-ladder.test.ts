import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { readPolicyLadder } from '../policy-ladder.js'

describe('authored policy ladder', () => {
  let knowledgeRoot: string

  beforeEach(() => {
    knowledgeRoot = mkdtempSync(join(tmpdir(), 'knowledge-policy-ladder-'))
  })

  afterEach(() => {
    rmSync(knowledgeRoot, { recursive: true, force: true })
  })

  function writePolicy(relativePath: string, text: string): string {
    const file = join(knowledgeRoot, relativePath)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, text, 'utf8')
    return file
  }

  it('serves global then product policy with each file byte-verbatim', () => {
    const globalText = 'Always preserve CRLF.\r\nKeep trailing spaces.  '
    const productText = 'Product rule → preserve UTF-8\nSecond rule'
    const globalFile = writePolicy('policies/global.md', globalText)
    const productFile = writePolicy('policies/acme.md', productText)

    const result = readPolicyLadder(knowledgeRoot, 'acme')
    const globalSlice = result.text.slice(0, globalText.length)
    const productSlice = result.text.slice(-productText.length)

    expect(Buffer.from(globalSlice)).toEqual(readFileSync(globalFile))
    expect(Buffer.from(productSlice)).toEqual(readFileSync(productFile))
    expect(result.text.slice(globalText.length, -productText.length)).toBe(
      '\n--- POLICY SOURCE: policies/acme.md ---\n',
    )
    expect(result.files).toEqual(['policies/global.md', 'policies/acme.md'])
  })

  it('silently omits missing policy rungs', () => {
    const globalText = 'Global rule only\n'
    writePolicy('policies/global.md', globalText)

    expect(readPolicyLadder(knowledgeRoot, 'missing')).toEqual({
      text: globalText,
      files: ['policies/global.md'],
      oversized: [],
    })

    rmSync(join(knowledgeRoot, 'policies', 'global.md'))
    expect(readPolicyLadder(knowledgeRoot, 'missing')).toEqual({
      text: '',
      files: [],
      oversized: [],
    })
  })

  it('returns an oversized policy whole and reports its approximate token count', () => {
    const oversizedText = `Never truncate this rule: ${'x'.repeat(100_000)}\n`
    writePolicy('policies/global.md', oversizedText)

    const result = readPolicyLadder(knowledgeRoot)

    expect(result.text).toBe(oversizedText)
    expect(result.text.length).toBe(oversizedText.length)
    expect(result.oversized).toEqual([
      {
        file: 'policies/global.md',
        approxTokens: Math.ceil(oversizedText.length / 4),
      },
    ])
  })

  it('returns byte-identical output for an unchanged ladder', () => {
    writePolicy('policies/global.md', 'Global\n')
    writePolicy('policies/acme.md', 'Acme\n')

    expect(readPolicyLadder(knowledgeRoot, 'acme')).toEqual(
      readPolicyLadder(knowledgeRoot, 'acme'),
    )
  })

  it('keeps product lookup within the policies directory', () => {
    writePolicy('outside.md', 'must not serve')

    expect(readPolicyLadder(knowledgeRoot, '../outside')).toEqual({
      text: '',
      files: [],
      oversized: [],
    })
  })
})
