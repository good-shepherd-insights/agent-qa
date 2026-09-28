// 431-09 · D-19/D-20 · PXH-AGENT-02: one managed-block writer for every comment syntax.
//
// Everything outside a block's two marker lines is the user's, byte for byte: line endings,
// Unicode, and whether the file ends in a newline. A block that already exists is rewritten
// where it stands, never relocated. Malformed or ambiguous markers refuse before any text is
// produced, because a guess would rewrite bytes nobody handed over.

import { describe, expect, it } from 'vitest'

import {
  AGENT_QA_INIT_GITIGNORE_BLOCK,
  AGENT_QA_INIT_MARKDOWN_BLOCK,
  ManagedBlockRefusal,
  composeManagedBlock,
  managedBlockMarkers,
  type ManagedBlockContent,
  type ManagedBlockRefusalReason,
} from '../commands/managed-block.js'
import { composeManagedGitignore, managedGitignoreContent } from '../commands/scaffold-content.js'

interface Variant {
  readonly name: string
  readonly content: ManagedBlockContent
  readonly regenerated: ManagedBlockContent
  readonly otherSyntaxStart: string
}

const GITIGNORE: Variant = {
  name: 'hash (.gitignore)',
  content: {
    descriptor: AGENT_QA_INIT_GITIGNORE_BLOCK,
    body: ['# Runtime paths managed by agent-qa init.', '.agent-qa/', '.env'],
    target: 'target .gitignore',
  },
  regenerated: {
    descriptor: AGENT_QA_INIT_GITIGNORE_BLOCK,
    body: ['# Runtime paths managed by agent-qa init.', '.agent-qa/', '.env', 'node_modules/'],
    target: 'target .gitignore',
  },
  otherSyntaxStart: '<!-- agent-qa init:start -->',
}

const MARKDOWN: Variant = {
  name: 'html (AGENTS.md)',
  content: {
    descriptor: AGENT_QA_INIT_MARKDOWN_BLOCK,
    body: ['## agent-qa', 'This project is tested with agent-qa.'],
    target: 'AGENTS.md',
  },
  regenerated: {
    descriptor: AGENT_QA_INIT_MARKDOWN_BLOCK,
    body: [
      '## agent-qa',
      'This project is tested with agent-qa.',
      '- Runs: `agent-qa runs list`, then `agent-qa runs overview <runId>`',
    ],
    target: 'AGENTS.md',
  },
  otherSyntaxStart: '# agent-qa init:start',
}

const VARIANTS = [GITIGNORE, MARKDOWN] as const

function rendered(content: ManagedBlockContent): string {
  const { start, end } = managedBlockMarkers(content.descriptor)
  return [start, ...content.body, end].join('\n')
}

// Separator and final newline are the historic append rule: the original is an exact prefix.
const ABSENT_FIXTURES = [
  { name: 'empty file', original: '', separator: '' },
  { name: 'LF with final newline', original: 'first\nsecond\n', separator: '\n' },
  { name: 'no final newline', original: 'first\nno final newline', separator: '\n\n' },
  { name: 'CRLF', original: 'first\r\nsecond\r\n', separator: '\n' },
  { name: 'already blank-line terminated', original: 'first\n\n', separator: '' },
  {
    name: 'Unicode with BOM',
    original: '﻿titre ✓ 日本語 👩‍👩‍👧 é\n',
    separator: '\n',
  },
] as const

// Every fixture is prefix + old block + suffix. The suffix starts at the byte after the end
// marker's text, so it carries that line's own terminator or its absence.
function middleFixtures(variant: Variant): {
  name: string
  prefix: string
  block: string
  suffix: string
}[] {
  const { start, end } = managedBlockMarkers(variant.content.descriptor)
  return [
    {
      name: 'LF, block between user lines',
      prefix: '# user heading\nkeep this\n\n',
      block: [start, 'stale owned line', end].join('\n'),
      suffix: '\n\nuser text after the block\n',
    },
    {
      name: 'CRLF throughout',
      prefix: 'user line one\r\nuser line two\r\n',
      block: [start, 'stale owned line', end].join('\r\n'),
      suffix: '\r\nuser line three\r\n',
    },
    {
      name: 'block is the last line with no final newline',
      prefix: 'user line\n',
      block: [start, 'stale', end].join('\n'),
      suffix: '',
    },
    {
      name: 'Unicode prefix and suffix',
      prefix: '﻿# Überblick ✓ 日本語\n\n👩‍👩‍👧 family é\n',
      block: [start, 'ancien contenu ✓', end].join('\n'),
      suffix: '\n\n## Nächster Abschnitt 🚀\ntrailing',
    },
    {
      name: 'mixed endings kept exactly',
      prefix: 'lf line\ncrlf line\r\n',
      block: [start, end].join('\r\n'),
      suffix: '\ncr-free tail\r\n\n',
    },
  ]
}

function refusalOf(run: () => unknown): ManagedBlockRefusal {
  try {
    run()
  } catch (error) {
    if (error instanceof ManagedBlockRefusal) return error
    throw error
  }
  throw new Error('expected a ManagedBlockRefusal, but the composition succeeded')
}

describe('MANAGED-BYTES', () => {
  it('spells the D-19 markers for both comment syntaxes', () => {
    expect(managedBlockMarkers(AGENT_QA_INIT_GITIGNORE_BLOCK)).toEqual({
      start: '# agent-qa init:start',
      end: '# agent-qa init:end',
    })
    expect(managedBlockMarkers(AGENT_QA_INIT_MARKDOWN_BLOCK)).toEqual({
      start: '<!-- agent-qa init:start -->',
      end: '<!-- agent-qa init:end -->',
    })
  })

  describe.each(VARIANTS)('$name', (variant) => {
    it.each(ABSENT_FIXTURES)(
      'appends an absent block after the original bytes ($name)',
      ({ original, separator }) => {
        const composed = composeManagedBlock(original, variant.content)
        expect(composed).toBe(`${original}${separator}${rendered(variant.content)}\n`)
        expect(composed.startsWith(original)).toBe(true)
        expect(composeManagedBlock(composed, variant.content)).toBe(composed)
      },
    )

    it('replaces a middle block in place, keeping every outside byte and the block position', () => {
      for (const fixture of middleFixtures(variant)) {
        const input = `${fixture.prefix}${fixture.block}${fixture.suffix}`
        const composed = composeManagedBlock(input, variant.content)
        expect(composed, fixture.name).toBe(
          `${fixture.prefix}${rendered(variant.content)}${fixture.suffix}`,
        )
        const { start } = managedBlockMarkers(variant.content.descriptor)
        expect(composed.indexOf(start), fixture.name).toBe(fixture.prefix.length)
      }
    })

    it('returns the same bytes when composed a second time', () => {
      for (const fixture of middleFixtures(variant)) {
        const input = `${fixture.prefix}${fixture.block}${fixture.suffix}`
        const once = composeManagedBlock(input, variant.content)
        expect(composeManagedBlock(once, variant.content), fixture.name).toBe(once)
      }
    })

    it('regenerates owned content and changes nothing outside the markers', () => {
      for (const fixture of middleFixtures(variant)) {
        const input = `${fixture.prefix}${fixture.block}${fixture.suffix}`
        const first = composeManagedBlock(input, variant.content)
        const second = composeManagedBlock(first, variant.regenerated)
        expect(second, fixture.name).toBe(
          `${fixture.prefix}${rendered(variant.regenerated)}${fixture.suffix}`,
        )
        expect(composeManagedBlock(second, variant.content), fixture.name).toBe(first)
      }
    })

    it('leaves a differently named block of the same owner untouched', () => {
      const skills = {
        ...variant.content,
        descriptor: { ...variant.content.descriptor, blockName: 'skills' },
        body: ['skills owned line'],
      }
      const skillsBlock = rendered(skills)
      const input = `head\n${skillsBlock}\nmiddle\n`
      const withInit = composeManagedBlock(input, variant.content)
      expect(withInit).toBe(`${input}\n${rendered(variant.content)}\n`)
      const regenerated = composeManagedBlock(withInit, variant.regenerated)
      expect(regenerated.startsWith(`head\n${skillsBlock}\nmiddle\n`)).toBe(true)
      expect(composeManagedBlock(regenerated, skills)).toBe(regenerated)
    })
  })

  it('composes the .gitignore through the shared hash-comment writer', () => {
    const entries = ['.agent-qa/', 'node_modules/', '.env']
    const content = managedGitignoreContent(entries)
    expect(content.descriptor).toEqual(AGENT_QA_INIT_GITIGNORE_BLOCK)
    for (const original of ['', 'dist/\n', 'dist/\n# agent-qa init:start\nold\n# agent-qa init:end\ntail/\n']) {
      expect(composeManagedGitignore(original, entries)).toBe(
        composeManagedBlock(original, content),
      )
    }
    // The fresh bytes are the historic ones, so the scaffold proposal's goldens do not move.
    expect(composeManagedGitignore('dist/\n', entries)).toBe([
      'dist/',
      '',
      '# agent-qa init:start',
      '# Runtime, credential, dependency, and local-only paths managed by agent-qa init.',
      '.agent-qa/',
      'node_modules/',
      '.env',
      '# agent-qa init:end',
      '',
    ].join('\n'))
  })
})

describe('MANAGED-MARKERS', () => {
  describe.each(VARIANTS)('$name', (variant) => {
    const { start, end } = managedBlockMarkers(variant.content.descriptor)
    const cases: { name: string, input: string, reason: ManagedBlockRefusalReason }[] = [
      { name: 'start marker only', input: `a\n${start}\nb\n`, reason: 'unbalanced' },
      { name: 'end marker only', input: `a\n${end}\nb\n`, reason: 'unbalanced' },
      {
        name: 'two starts and one end',
        input: `${start}\n${start}\nx\n${end}\n`,
        reason: 'unbalanced',
      },
      {
        name: 'two complete blocks',
        input: `${start}\none\n${end}\nuser\n${start}\ntwo\n${end}\n`,
        reason: 'duplicate',
      },
      { name: 'inverted pair', input: `${end}\nuser\n${start}\n`, reason: 'inverted' },
      { name: 'indented marker', input: `  ${start}\nx\n${end}\n`, reason: 'ambiguous-marker' },
      {
        name: 'marker with trailing text',
        input: `${start} extra\nx\n${end}\n`,
        reason: 'ambiguous-marker',
      },
      {
        name: 'marker mid-line',
        input: `see ${start} here\n`,
        reason: 'ambiguous-marker',
      },
      {
        name: 'marker followed by a lone carriage return',
        input: `${start}\rx\n${end}\n`,
        reason: 'ambiguous-marker',
      },
      {
        name: 'the other comment syntax spelling this block',
        input: `${variant.otherSyntaxStart}\nx\n`,
        reason: 'ambiguous-marker',
      },
    ]

    it.each(cases)('refuses $name', ({ input, reason }) => {
      const before = `${input}`
      const refusal = refusalOf(() => composeManagedBlock(input, variant.content))
      expect(refusal.reason).toBe(reason)
      expect(refusal.message.startsWith(`Refusing malformed ${variant.content.target}: `)).toBe(true)
      expect(input).toBe(before)
    })

    it('refuses a body that spells its own marker', () => {
      const poisoned = { ...variant.content, body: ['fine', end] }
      expect(refusalOf(() => composeManagedBlock('user\n', poisoned)).reason)
        .toBe('ambiguous-marker')
    })
  })

  it('keeps the historic .gitignore refusal sentences', () => {
    const content = GITIGNORE.content
    expect(() => composeManagedBlock('# agent-qa init:start\n', content)).toThrow(
      'Refusing malformed target .gitignore: expected at most one complete '
      + 'agent-qa init managed block',
    )
    expect(() => composeManagedBlock('# agent-qa init:end\nx\n# agent-qa init:start\n', content))
      .toThrow(
        'Refusing malformed target .gitignore: the agent-qa init managed '
        + 'end marker precedes its start marker',
      )
  })
})
