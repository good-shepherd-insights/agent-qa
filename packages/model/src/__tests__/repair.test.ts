import { wrapLanguageModel } from 'ai'
import { describe, expect, it } from 'vitest'

import { repairMiddleware } from '../middleware/repair.js'
import { stubModel } from './stub-model.js'

const prompt = { prompt: [] }

describe('repairMiddleware', () => {
  it('repairs malformed tool-call JSON input', async () => {
    const model = wrapLanguageModel({
      model: stubModel({
        content: [
          {
            type: 'tool-call',
            toolCallId: 'call-1',
            toolName: 'click',
            input: '{"ref":"button"',
          },
        ],
      }),
      middleware: repairMiddleware(),
    })

    const result = await model.doGenerate(prompt)

    expect(result.content[0]).toMatchObject({
      type: 'tool-call',
      toolCallId: 'call-1',
      toolName: 'click',
      input: '{"ref":"button"}',
    })
  })

  it('leaves valid tool-call JSON byte-identical', async () => {
    const input = '{ "ref" : "button" }'
    const model = wrapLanguageModel({
      model: stubModel({
        content: [
          {
            type: 'tool-call',
            toolCallId: 'call-1',
            toolName: 'click',
            input,
          },
        ],
      }),
      middleware: repairMiddleware(),
    })

    const result = await model.doGenerate(prompt)

    expect(result.content[0]).toMatchObject({ type: 'tool-call', input })
  })

  it('leaves failed parses untouched', async () => {
    const input = 'not json'
    const model = wrapLanguageModel({
      model: stubModel({
        content: [
          {
            type: 'tool-call',
            toolCallId: 'call-1',
            toolName: 'click',
            input,
          },
        ],
      }),
      middleware: repairMiddleware(),
    })

    const result = await model.doGenerate(prompt)

    expect(result.content[0]).toMatchObject({ type: 'tool-call', input })
  })

  it('passes non-tool-call content through unchanged', async () => {
    const text = { type: 'text' as const, text: 'hello' }
    const model = wrapLanguageModel({
      model: stubModel({ content: [text] }),
      middleware: repairMiddleware(),
    })

    const result = await model.doGenerate(prompt)

    expect(result.content[0]).toBe(text)
  })
})
