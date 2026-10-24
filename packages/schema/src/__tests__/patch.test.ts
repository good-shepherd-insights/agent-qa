import { describe, expect, it } from 'vitest'
import { patchSchema } from '../patch/patch'

describe('patchSchema', () => {
  it('accepts a patch carrying file changes with hunks', () => {
    const result = patchSchema.safeParse({
      id: 'patch_1',
      status: 'proposed',
      summary: 'Update checkout target config',
      changes: [
        {
          path: 'agent-qa.config.yaml',
          changeKind: 'modify',
          hunks: [
            {
              header: '@@ -1,1 +1,1 @@',
              lines: ['-baseUrl: https://old.example', '+baseUrl: https://new.example'],
            },
          ],
        },
      ],
      payloadHash: 'sha256:abc123',
    })

    expect(result.success).toBe(true)
  })

  it('rejects an unknown top-level key', () => {
    const result = patchSchema.safeParse({
      id: 'patch_1',
      status: 'proposed',
      summary: 'Update checkout target config',
      changes: [
        {
          path: 'agent-qa.config.yaml',
          changeKind: 'modify',
          hunks: [{ header: '@@', lines: ['+x'] }],
        },
      ],
      extra: 1,
    })

    expect(result.success).toBe(false)
  })

  it('rejects a file change without hunks', () => {
    const result = patchSchema.safeParse({
      id: 'patch_1',
      status: 'proposed',
      summary: 'Update checkout target config',
      changes: [
        {
          path: 'agent-qa.config.yaml',
          changeKind: 'modify',
        },
      ],
    })

    expect(result.success).toBe(false)
  })
})
