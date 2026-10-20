// C446-RECIPE (446-08, D-10): the coding-agent recipes name only shipped commands and safe timeouts
// C446-RECIPE-LINKS (446-09, D-10, D-28): every starting point links the recipe page within its bounds

import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parse } from 'yaml'

import { AGENT_QA_MCP_INSTRUCTIONS } from '@vostride/agent-qa-mcp'

import {
  buildAgentInstructionPointer,
  buildKnowledgeAgentGuide,
} from '../../commands/knowledge-guide.js'
import { AGENT_QA_INIT_MARKDOWN_BLOCK, renderManagedBlock } from '../../commands/managed-block.js'
import { buildScaffoldConfig } from '../../commands/scaffold-content.js'
import { agentQaRoot } from './catalog.js'
import {
  agentQaArgv,
  commandFindings,
  createHelpReader,
  shellLines,
  type HelpReader,
} from './cli-help.js'
import {
  ANCHORED_BUILDS,
  CLI_PACKAGE_ROOT,
  REBUILD_INSTRUCTION,
  buildFreshness,
  cleanupTempRoots,
  trackTempRoot,
} from './spawned-chat.js'

const PAGE = resolve(CLI_PACKAGE_ROOT, '..', '..', 'docs', 'coding-agents.md')
const SERVER_URL = 'http://127.0.0.1:3471/mcp'
const SERVER_LINE = 'npx agent-qa mcp --http'
const COPY_SOURCE = 'node_modules/agent-qa/skills/agent-qa-*'
const HOST_SKILL_FOLDERS = [['Claude Code', '.claude/skills'], ['Codex', '.agents/skills']] as const
const FACTS = {
  llmEntries: [],
  usesSubscriptionAuth: false,
  cacheDir: '.agent-qa/cache',
  authStatesDir: '.agent-qa/auth-states',
}
const LEG_ONLY = [
  '--allowedTools',
  'bypassPermissions',
  '--permission-mode',
  '--dangerously-bypass',
  'default_tools_approval_mode',
]
const HOST_SETTINGS_FILES = ['settings.json', 'settings.local.json']
const HELP_BUDGET_MS = 180_000
const RECIPE_URL = 'https://github.com/vostride/agent-qa/blob/main/docs/coding-agents.md'
const INIT_COMMAND = /\bagent-qa\s+init\b/u

interface Block {
  readonly info: string
  readonly lines: readonly string[]
}

const scene: { commands: string[]; limitMs?: number; codexMs?: number; claudeMs?: number } = {
  commands: [],
}
let helpOf: HelpReader

function readPage(): string {
  return readFileSync(PAGE, 'utf8')
}

function sectionOf(page: string, heading: string): string {
  return page.split(/^## /mu).find((part) => part.startsWith(`${heading}\n`)) ?? ''
}

function blocksIn(markdown: string): Block[] {
  return [...markdown.matchAll(/^```(\S*)\n([\s\S]*?)^```$/gmu)].map((match) => ({
    info: match[1]!,
    lines: match[2]!.split('\n').map((line) => line.trim()).filter((line) => line !== ''),
  }))
}

function afterIntroduction(page: string): string {
  const lines = page.split('\n')
  const first = lines.findIndex((line) => line.startsWith('## '))
  return first === -1 ? '' : lines.slice(first).join('\n')
}

function inlineSpans(markdown: string): string[] {
  const spans: string[] = []
  let fenced = false
  for (const line of markdown.split('\n')) {
    if (/^\s*```/u.test(line)) fenced = !fenced
    else if (!fenced) spans.push(...[...line.matchAll(/`([^`]+)`/gu)].map((match) => match[1]!))
  }
  return spans
}

// 2026-10-21 (446-15, D-32): the pointer starts with `## agent-qa`, so a fence-aware read ends the section
function rawSectionOf(page: string, heading: string): string[] {
  const lines = page.split('\n')
  const start = lines.indexOf(`## ${heading}`)
  if (start === -1) return []
  const section: string[] = []
  let fenced = false
  for (const line of lines.slice(start + 1)) {
    if (/^```/u.test(line)) fenced = !fenced
    else if (!fenced && line.startsWith('## ')) break
    section.push(line)
  }
  return section
}

function rawBlocksIn(lines: readonly string[]): { info: string; lines: string[] }[] {
  const blocks: { info: string; lines: string[] }[] = []
  let open: { info: string; lines: string[] } | undefined
  for (const line of lines) {
    const fence = /^```(\S*)$/u.exec(line)
    if (open === undefined) {
      if (fence !== null) open = { info: fence[1]!, lines: [] }
    } else if (fence !== null && fence[1] === '') {
      blocks.push(open)
      open = undefined
    } else {
      open.lines.push(line)
    }
  }
  return blocks
}

function proseSentences(page: string): string[] {
  return page.replace(/^```[^\n]*\n[\s\S]*?^```$/gmu, '')
    .split(/\n\s*\n/u)
    .flatMap((paragraph) => paragraph.replace(/\s*\n\s*/gu, ' ').split(/(?<=[.!?])\s+/u))
}

function msOf(duration: string): number {
  const match = /^(\d+)(ms|s|m|h)$/u.exec(duration)
  if (match === null) throw new Error(`not a duration: ${duration}`)
  const unit = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000 }[match[2] as 'ms' | 's' | 'm' | 'h']
  return Number(match[1]) * unit
}

function aboveLimitFindings(ms: number, limitMs: number, label: string): string[] {
  return ms > limitMs ? [] : [`${label}: ${ms} ms is not above the per-test limit of ${limitMs} ms`]
}

function perTestLimitMs(): number {
  const config = buildScaffoldConfig('web', FACTS) as { use: { timeout: { test: string } } }
  return msOf(config.use.timeout.test)
}

function claudeServer(page: string): Record<string, unknown> {
  const lines = blocksIn(sectionOf(page, 'Claude Code'))
    .filter((block) => block.info === 'sh')
    .flatMap((block) => block.lines)
    .filter((line) => line.startsWith('claude mcp add-json '))
  expect(lines.length, 'the Claude Code block has one claude mcp add-json line').toBe(1)
  const json = /'([^']*)'/u.exec(lines[0]!)
  expect(json, 'the claude mcp add-json line has a single-quoted JSON argument').not.toBeNull()
  return JSON.parse(json![1]!) as Record<string, unknown>
}

function skillFolders(): string[] {
  return readdirSync(join(agentQaRoot(), 'skills'))
    .filter((name) => name.startsWith('agent-qa-'))
    .sort()
}

function assertFreshBuild(): void {
  const freshness = buildFreshness(ANCHORED_BUILDS)
  expect({ missing: freshness.missing, stale: freshness.stale },
    `these cells drive the built CLI: ${REBUILD_INSTRUCTION}`).toEqual({ missing: [], stale: [] })
}

beforeAll(() => {
  if (process.platform === 'win32') throw new Error('POSIX run lifecycle required; never skip')
  helpOf = createHelpReader(trackTempRoot(mkdtempSync(join(tmpdir(), 'agent-qa-446-recipe-'))))
})

afterAll(() => {
  console.info(`C446-RECIPE scene: ${JSON.stringify(scene, null, 2)}`)
  cleanupTempRoots()
})

describe('C446-RECIPE', () => {
  it('every agent-qa command and flag the recipe page names exists in the shipped help', () => {
    assertFreshBuild()
    const commands = shellLines(readPage()).flatMap((line) => {
      const argv = agentQaArgv(line)
      return argv === undefined ? [] : [{ line, argv }]
    })
    scene.commands = commands.map((command) => command.line)
    expect(commands.length, 'the page names agent-qa commands').toBeGreaterThanOrEqual(2)
    for (const command of commands) {
      expect(commandFindings(command.argv, helpOf), command.line).toEqual([])
    }
  }, HELP_BUDGET_MS)

  it('the Codex tool_timeout_sec and the Claude Code timeout are each above the scaffold per-test limit', () => {
    const page = readPage()
    const limitMs = perTestLimitMs()
    expect(limitMs, 'the scaffold sets a per-test limit').toBeGreaterThan(0)

    const toml = blocksIn(sectionOf(page, 'Codex')).filter((block) => block.info === 'toml')
    expect(toml.length, 'the Codex section has one toml block').toBe(1)
    const seconds = toml[0]!.lines.flatMap((line) => {
      const match = /^tool_timeout_sec\s*=\s*(\d+)$/u.exec(line)
      return match === null ? [] : [Number(match[1])]
    })
    expect(seconds.length, 'the toml block sets tool_timeout_sec once').toBe(1)
    const claude = claudeServer(page)
    expect(typeof claude.timeout, 'the Claude Code JSON sets a numeric timeout').toBe('number')

    scene.limitMs = limitMs
    scene.codexMs = seconds[0]! * 1000
    scene.claudeMs = claude.timeout as number
    expect([
      ...aboveLimitFindings(scene.codexMs, limitMs, 'Codex tool_timeout_sec'),
      ...aboveLimitFindings(scene.claudeMs, limitMs, 'Claude Code timeout'),
    ]).toEqual([])

    expect(aboveLimitFindings(limitMs, limitMs, 'planted'))
      .toEqual([`planted: ${limitMs} ms is not above the per-test limit of ${limitMs} ms`])
    expect(aboveLimitFindings(limitMs + 1, limitMs, 'planted')).toEqual([])
  })

  it('npx agent-qa mcp --http alone serves http://127.0.0.1:3471/mcp, the URL every skill openai.yaml names', () => {
    const page = readPage()
    const codex = blocksIn(sectionOf(page, 'Codex'))
    const sh = codex.filter((block) => block.info === 'sh')
    expect(sh.length, 'the Codex section has two sh blocks').toBe(2)
    expect(sh[1]!.lines, 'the second Codex sh block starts the server alone').toEqual([SERVER_LINE])
    expect(sh[0]!.lines.filter((line) => line.startsWith('codex mcp add ')))
      .toEqual([`codex mcp add agent-qa --url ${SERVER_URL}`])
    const urls = codex.filter((block) => block.info === 'toml').flatMap((block) => block.lines)
      .flatMap((line) => {
        const match = /^url\s*=\s*"([^"]*)"$/u.exec(line)
        return match === null ? [] : [match[1]!]
      })
    expect(urls, 'the toml block names the server URL').toEqual([SERVER_URL])

    const folders = skillFolders()
    expect(folders.length, 'the shipped skill folders').toBe(4)
    for (const folder of folders) {
      const metadata = parse(
        readFileSync(join(agentQaRoot(), 'skills', folder, 'agents', 'openai.yaml'), 'utf8'),
      ) as { dependencies?: { tools?: { url?: string }[] } }
      const declared = (metadata.dependencies?.tools ?? []).map((tool) => tool.url)
      expect(declared, `${folder}/agents/openai.yaml`).toEqual([SERVER_URL])
    }

    const claude = claudeServer(page)
    expect({ type: claude.type, command: claude.command, args: claude.args })
      .toEqual({ type: 'stdio', command: 'npx', args: ['agent-qa', 'mcp'] })
    expect(
      proseSentences(page).filter((sentence) =>
        sentence.includes('3471') && sentence.includes(`\`${SERVER_LINE}\``)).length,
      'no sentence names npx agent-qa mcp --http as the owner of port 3471',
    ).toBeGreaterThan(0)
  })

  it('the page copies the four skills into .claude/skills and .agents/skills after mkdir -p and prompts each host with a skill name', () => {
    const page = readPage()
    for (const [heading, folder] of HOST_SKILL_FOLDERS) {
      const lines = blocksIn(sectionOf(page, heading))
        .filter((block) => block.info === 'sh')
        .flatMap((block) => block.lines)
      const mkdir = lines.indexOf(`mkdir -p ${folder}`)
      const copy = lines.indexOf(`cp -R ${COPY_SOURCE} ${folder}/`)
      expect(mkdir, `${heading} creates ${folder}`).toBeGreaterThanOrEqual(0)
      expect(copy, `${heading} copies the skills into ${folder} after mkdir -p`).toBeGreaterThan(mkdir)
    }

    const folders = skillFolders()
    expect(folders.length, 'the shipped skill folders').toBe(4)
    const named = [...page.matchAll(/(?<![\w.-])([/$])(agent-qa-[a-z][a-z-]*)/gu)]
    expect(named.filter((match) => match[1] === '/').length, 'no /agent-qa- prompt for Claude Code')
      .toBeGreaterThan(0)
    expect(named.filter((match) => match[1] === '$').length, 'no $agent-qa- prompt for Codex')
      .toBeGreaterThan(0)
    expect(named.map((match) => match[2]!).filter((name) => !folders.includes(name)),
      'a prompt names a skill the package does not ship').toEqual([])
  })

  it('the page names npm only, no CLAUDE.md step, no host settings file and none of the unattended leg flags', () => {
    const page = readPage()
    const lines = shellLines(page)
    expect(lines.length, 'the page has shell lines').toBeGreaterThan(0)
    expect(lines.filter((line) => /^(?:pnpm|yarn|bun|bunx)(?:\s|$)/u.test(line))).toEqual([])
    expect(lines.filter((line) => /CLAUDE\.md|AGENTS\.md|\.gitignore/u.test(line))).toEqual([])
    expect([...LEG_ONLY, ...HOST_SETTINGS_FILES].filter((text) => page.includes(text))).toEqual([])
    expect(page.split('--write-agent-instructions').length - 1,
      'the page names --write-agent-instructions once').toBe(1)
  })

  it('the page names no agent-qa init command, since each one does nothing or rebuilds the config in the initialized workspace it starts from', () => {
    const body = afterIntroduction(readPage())
    const lines = shellLines(body)
    const spans = inlineSpans(body)
    expect(lines.length, 'the page has shell lines after its introduction').toBeGreaterThan(0)
    expect(spans.length, 'the page has inline code spans after its introduction').toBeGreaterThan(0)
    expect([...lines, ...spans].filter((text) => INIT_COMMAND.test(text)),
      'the page names an agent-qa init command').toEqual([])
  })

  it('the page shows the AGENTS.md pointer block init prints, line for line', () => {
    const section = rawSectionOf(readPage(), 'AGENTS.md')
    expect(section.length, 'the page has an AGENTS.md section').toBeGreaterThan(0)
    const md = rawBlocksIn(section).filter((block) => block.info === 'md')
    expect(md.length, 'the AGENTS.md section has one md block').toBe(1)
    expect(md[0]!.lines).toEqual(renderManagedBlock({
      descriptor: AGENT_QA_INIT_MARKDOWN_BLOCK,
      body: buildAgentInstructionPointer(),
      target: 'AGENTS.md',
    }).split('\n'))
  })
})

describe('C446-RECIPE-LINKS', () => {
  it('getting-started, both READMEs, the pointer and the guide each link the recipe page', () => {
    const read = (path: string): string => readFileSync(join(agentQaRoot(), path), 'utf8')
    expect(existsSync(PAGE), 'docs/coding-agents.md exists').toBe(true)
    const subjects: [string, string, string][] = [
      ['docs/getting-started.md', read('docs/getting-started.md'), '](coding-agents.md)'],
      ['README.md', read('README.md'), '](docs/coding-agents.md)'],
      ['packages/cli/README.md', read('packages/cli/README.md'), RECIPE_URL],
      ['the root pointer', buildAgentInstructionPointer().join('\n'), RECIPE_URL],
      ['the generated guide', buildKnowledgeAgentGuide(), RECIPE_URL],
    ]
    expect(subjects.every(([, text]) => text.length > 0), 'every subject has text').toBe(true)
    expect(subjects.filter(([, text, link]) => !text.includes(link))
      .map(([label, , link]) => `${label} does not link ${link}`)).toEqual([])
  })

  it('the pointer keeps at most 9 lines and the guide at most 50 with the link, and the MCP instructions carry none', () => {
    expect(buildAgentInstructionPointer().length, 'pointer lines').toBeLessThanOrEqual(9)
    expect(buildKnowledgeAgentGuide().split('\n').length, 'guide lines').toBeLessThanOrEqual(50)
    expect(AGENT_QA_MCP_INSTRUCTIONS.length, 'the MCP instructions have text').toBeGreaterThan(0)
    expect(AGENT_QA_MCP_INSTRUCTIONS).not.toContain('coding-agents')
  })
})
