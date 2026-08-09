// Chat's prompt rides the ONE builder (Phase 392 plan 04 — 389 D-04, the 392-EXTENDS contract).
//
// The claim under test is not "the prompt reads well". It is that chat EXTENDS the shipped tiered
// builder by passing richer blocks and its own `agent_context`, rather than minting a second
// renderer beside it. Two prompt idioms is precisely the refactor 389 D-04 exists to prevent, and
// the way that failure actually arrives is a caller who needed one more section and wrote its own
// assembly rather than one more block.
//
// So the assertions are structural: the module's source calls the builder exactly once and names
// `agent_context`; the output is the two TEXT legs and nothing else; identical inputs produce
// byte-identical bytes. That last one is what a provider prompt cache depends on — a clock, a
// random id or a Set iteration anywhere in the assembly would make the stable prefix novel on
// every turn, and it would never show up as a failing behaviour, only as a bill.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { CHAT_AGENT_CONTEXT, buildChatPrompt } from '../chat-prompt.js'
import type { ChatPromptInput } from '../chat-prompt.js'

const moduleDir = dirname(fileURLToPath(import.meta.url))
const CHAT_PROMPT_SOURCE = readFileSync(join(moduleDir, '..', 'chat-prompt.ts'), 'utf8')

function input(overrides: Partial<ChatPromptInput> = {}): ChatPromptInput {
  return {
    utterance: 'run test 42 and write a test for 2FA',
    clauses: [
      { text: 'run test 42', index: 0 },
      { text: 'write a test for 2FA', index: 1 },
    ],
    activeModel: 'anthropic/claude-sonnet-4',
    ...overrides,
  }
}

describe('buildChatPrompt: one builder, chat blocks (392-EXTENDS)', () => {
  it('calls buildTieredPrompt exactly once — no sibling renderer, no second assembly', () => {
    const calls = CHAT_PROMPT_SOURCE.match(/buildTieredPrompt\(/g) ?? []
    expect(calls).toHaveLength(1)
  })

  it('passes chat its own agent_context, which is what the ONE builder is parameterized by', () => {
    expect(CHAT_PROMPT_SOURCE).toContain('agent_context')
    expect(buildChatPrompt(input()).system).toContain(CHAT_AGENT_CONTEXT)
  })

  it('answers the TEXT legs only — system and prompt, no third key', () => {
    const request = buildChatPrompt(input())
    expect(Object.keys(request).sort()).toEqual(['prompt', 'system'])
    expect(typeof request.system).toBe('string')
    expect(typeof request.prompt).toBe('string')
  })

  it('is byte-deterministic: identical inputs produce identical bytes', () => {
    const first = buildChatPrompt(input())
    const second = buildChatPrompt(input())
    expect(first.system).toBe(second.system)
    expect(first.prompt).toBe(second.prompt)
    // Spelled as bytes rather than as deep equality, because a cache hit is a byte comparison and
    // two strings that differ by a timestamp still pass a shape check.
    expect(JSON.stringify(first)).toBe(JSON.stringify(second))
  })

  it('keeps the volatile tier volatile: a different utterance moves only the prompt leg', () => {
    const base = buildChatPrompt(input())
    const other = buildChatPrompt(input({ utterance: 'show me the proposals' }))
    expect(other.system).toBe(base.system)
    expect(other.prompt).not.toBe(base.prompt)
  })

  it('states the planning discipline the reconciler and the ceiling both measure', () => {
    const system = buildChatPrompt(input()).system ?? ''
    // One call per clause, in utterance order; answer_only for informational turns; mark_unhandled
    // naming the clause when nothing available can do it. These three sentences are what CHAT-03's
    // ceiling is a measurement OF, so their presence is asserted rather than assumed.
    expect(system).toContain('answer_only')
    expect(system).toContain('mark_unhandled')
    expect(system.toLowerCase()).toContain('utterance order')
  })

  it('carries the clauses verbatim, so the model answers about what the splitter produced', () => {
    const { prompt } = buildChatPrompt(input())
    expect(prompt).toContain('run test 42')
    expect(prompt).toContain('write a test for 2FA')
  })

  it('names the model in force in the context tier', () => {
    expect(buildChatPrompt(input()).prompt).toContain('anthropic/claude-sonnet-4')
  })

  it('carries supplied session facts as one-liners, and nothing when none were supplied', () => {
    const withFacts = buildChatPrompt(input({ facts: ['3 proposals pending'] }))
    expect(withFacts.prompt).toContain('3 proposals pending')
    // D-18's refs-not-payloads applied to the prompt: a fact is a sentence a person could read,
    // never a serialized result. The absence case exists so a host with nothing to say adds no
    // empty header — structure exists only where content does.
    const withoutFacts = buildChatPrompt(input())
    expect(withoutFacts.prompt).not.toContain('Session facts')
  })

  it('renders the prior conversation before the current utterance', () => {
    const { prompt } = buildChatPrompt(
      input({
        conversation: [
          { role: 'user', text: 'show me the proposals', turnId: 't1' },
          { role: 'assistant', text: 'proposals.list completed', turnId: 't1' },
        ],
      }),
    )
    expect(prompt.indexOf('show me the proposals')).toBeLessThan(
      prompt.indexOf('run test 42 and write a test for 2FA'),
    )
  })

  it('never assembles prompt text outside the builder', () => {
    // The failure this catches is the quiet one: a caller that returns `{ system, prompt }` built
    // by hand still type-checks as a JobModelRequest and still reads fine, and the tier law is
    // gone. If this module ever returns something the builder did not produce, the single-call
    // assertion above and this one disagree, and the build says so.
    expect(CHAT_PROMPT_SOURCE).not.toMatch(/return\s*\{\s*system/)
  })
})
