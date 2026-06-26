import { describe, expect, it } from 'vitest'

import { AGENT_QA_MODEL_PACKAGE_CLASSES, toolSchemaMiddleware } from '../index.js'

describe('model package ownership contract', () => {
  it('declares model owner and storage-neutral classes', () => {
    expect(AGENT_QA_MODEL_PACKAGE_CLASSES).toEqual(['modelOwner', 'storageNeutral'])
  })
})

describe('toolSchemaMiddleware', () => {
  it('strips $schema and defaults missing function tool schema type', async () => {
    const params = {
      tools: [
        {
          type: 'function' as const,
          name: 'click',
          inputSchema: {
            $schema: 'http://json-schema.org/draft-07/schema#',
            properties: { ref: { type: 'string' } },
          },
        },
      ],
    }

    const result = await toolSchemaMiddleware.transformParams!({
      type: 'generate',
      params: params as any,
      model: {} as any,
    })

    const tool = (result as any).tools[0]
    expect(tool.inputSchema).not.toHaveProperty('$schema')
    expect(tool.inputSchema.type).toBe('object')
    expect(tool.inputSchema.properties).toEqual({ ref: { type: 'string' } })
  })

  it('leaves non-function tools untouched', async () => {
    const params = {
      tools: [
        {
          type: 'provider' as const,
          name: 'web_search',
          id: 'web_search',
        },
      ],
    }

    const result = await toolSchemaMiddleware.transformParams!({
      type: 'generate',
      params: params as any,
      model: {} as any,
    })

    expect((result as any).tools[0]).toEqual(params.tools[0])
  })
})
