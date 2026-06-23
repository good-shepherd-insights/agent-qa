import { describe, expect, it } from 'vitest'
import { relevantEnvDigest } from '../determinism/env-digest'
import type { RedactedEnvVar } from '../determinism/env-digest'

const envVars: RedactedEnvVar[] = [
  { name: 'AGENT_QA_TOKEN', present: true, kind: 'token-shaped', lengthBucket: 4 },
  { name: 'AGENT_QA_BASE_URL', present: true, kind: 'url', lengthBucket: 3 },
  { name: 'AGENT_QA_OPTIONAL', present: false, kind: 'missing' },
]

describe('relevantEnvDigest', () => {
  it('is stable for the same redacted env metadata and salt', () => {
    expect(relevantEnvDigest(envVars, 'project-a')).toBe(relevantEnvDigest(envVars, 'project-a'))
    expect(relevantEnvDigest(envVars, 'project-a')).toMatch(/^[0-9a-f]{64}$/)
  })

  it('sorts names before hashing', () => {
    const reordered = [envVars[2], envVars[0], envVars[1]]

    expect(relevantEnvDigest(envVars, 'project-a')).toBe(relevantEnvDigest(reordered, 'project-a'))
  })

  it('uses the caller supplied salt for domain separation', () => {
    expect(relevantEnvDigest(envVars, 'project-a')).not.toBe(relevantEnvDigest(envVars, 'project-b'))
  })

  it('is fully determined by redacted shape metadata and has no raw-value field', () => {
    const first: RedactedEnvVar = {
      name: 'AGENT_QA_PASSWORD',
      present: true,
      kind: 'token-shaped',
      lengthBucket: 4,
    }
    const second: RedactedEnvVar = {
      name: 'AGENT_QA_PASSWORD',
      present: true,
      kind: 'token-shaped',
      lengthBucket: 4,
    }

    expect(Object.keys(first)).toEqual(['name', 'present', 'kind', 'lengthBucket'])
    expect(relevantEnvDigest([first], 'project-a')).toBe(relevantEnvDigest([second], 'project-a'))
  })
})
