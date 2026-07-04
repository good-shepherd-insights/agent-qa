import type { ModelMessage, ToolResultPart } from 'ai'
import { describe, expect, it } from 'vitest'

import { degrade } from '../degrade.js'
import {
  FIXTURE_IMAGE_DATA,
  assistantReasoning,
  assistantText,
  makeModelMessages,
  screenshotOutput,
  systemMessage,
  textOutput,
  toolExchange,
  userText,
} from './message-fixtures.js'

const HYGIENE_ONLY = { budget: Number.MAX_SAFE_INTEGER }

function reasoningTexts(message: ModelMessage): string[] {
  if (!Array.isArray(message.content)) return []
  const texts: string[] = []
  for (const part of message.content) {
    if (part.type === 'reasoning') texts.push(part.text)
  }
  return texts
}

function toolResults(message: ModelMessage): ToolResultPart[] {
  if (message.role !== 'tool') return []
  return message.content.filter((part): part is ToolResultPart => part.type === 'tool-result')
}

describe('degrade — hygiene pass (D-08)', () => {
  it('strips reasoning from historical assistant turns while preserving message order', () => {
    const messages: ModelMessage[] = [
      systemMessage(),
      userText('first'),
      assistantReasoning('early thinking', 'early answer'),
      userText('second'),
      assistantText('later answer'),
    ]

    const outcome = degrade(messages, HYGIENE_ONLY)
    expect(outcome.ok).toBe(true)

    const result = outcome.messages
    // Order preserved, roles unchanged.
    expect(result.map(m => m.role)).toEqual(['system', 'user', 'assistant', 'user', 'assistant'])
    // The historical assistant reasoning is gone; the text survives.
    expect(reasoningTexts(result[2])).toEqual([])
    expect(Array.isArray(result[2].content) && result[2].content.some(p => p.type === 'text')).toBe(true)
  })

  it("keeps the last message's reasoning (reasoning: 'before-last-message')", () => {
    const messages: ModelMessage[] = [
      systemMessage(),
      userText('go'),
      assistantReasoning('final thinking', 'final answer'),
    ]

    const result = degrade(messages, HYGIENE_ONLY).messages
    const last = result[result.length - 1]
    expect(reasoningTexts(last)).toContain('final thinking')
  })

  it('strips base64 from a historical image-data tool result, keeping the most recent verbatim', () => {
    const messages: ModelMessage[] = [
      systemMessage(),
      userText('inspect'),
      ...toolExchange([{ toolCallId: 'hist-shot', toolName: 'screenshot', output: screenshotOutput() }]),
      userText('again'),
      ...toolExchange([{ toolCallId: 'recent-shot', toolName: 'screenshot', output: screenshotOutput() }]),
    ]

    const result = degrade(messages, HYGIENE_ONLY).messages

    // Historical screenshot: base64 gone.
    const historical = result.flatMap(toolResults).find(r => r.toolCallId === 'hist-shot')!
    const serialized = JSON.stringify(historical)
    expect(serialized).not.toContain(FIXTURE_IMAGE_DATA)
    expect(serialized).toContain('historical screenshot omitted')

    // Most recent screenshot: preserved verbatim (base64 intact).
    const recent = result.flatMap(toolResults).find(r => r.toolCallId === 'recent-shot')!
    expect(JSON.stringify(recent)).toContain(FIXTURE_IMAGE_DATA)
  })

  it('hash-dedups content-identical historical tool results down to a one-liner', () => {
    const messages: ModelMessage[] = [
      systemMessage(),
      userText('a'),
      ...toolExchange([{ toolCallId: 'dup-1', toolName: 'inspect', output: textOutput('IDENTICAL PAYLOAD') }]),
      userText('b'),
      ...toolExchange([{ toolCallId: 'dup-2', toolName: 'inspect', output: textOutput('IDENTICAL PAYLOAD') }]),
      userText('c'),
      // A final tool message so both dup exchanges are historical.
      ...toolExchange([{ toolCallId: 'final', toolName: 'inspect', output: textOutput('final') }]),
    ]

    const result = degrade(messages, HYGIENE_ONLY).messages
    const all = result.flatMap(toolResults)
    const second = all.find(r => r.toolCallId === 'dup-2')!
    expect(second.output).toEqual({ type: 'text', value: '…[duplicate tool result elided]' })
  })

  it('removes messages emptied by pruning while preserving the rest', () => {
    const messages: ModelMessage[] = [
      systemMessage(),
      userText('keep me'),
      { role: 'assistant', content: [{ type: 'reasoning', text: 'only reasoning, becomes empty' }] },
      userText('final'),
    ]

    const result = degrade(messages, HYGIENE_ONLY).messages
    // The reasoning-only assistant message collapses to empty and is removed.
    expect(result.map(m => m.role)).toEqual(['system', 'user', 'user'])
  })
})

describe('degrade — determinism (D-08 / T-354-03)', () => {
  it('same input twice ⇒ deep-equal output', () => {
    const first = degrade(makeModelMessages(), HYGIENE_ONLY)
    const second = degrade(makeModelMessages(), HYGIENE_ONLY)
    expect(first).toEqual(second)
  })

  it('does not mutate its input', () => {
    const input = makeModelMessages()
    const snapshot = JSON.stringify(input)
    degrade(input, HYGIENE_ONLY)
    expect(JSON.stringify(input)).toEqual(snapshot)
  })
})
