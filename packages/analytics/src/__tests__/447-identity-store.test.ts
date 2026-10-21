// C447 (447-02, D-01..D-05, D-11, D-12): one installation id, shared, race-safe; CI personless

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { resolveAnalyticsIdentity } from '../identity.js'

const LOCAL_ID = /^u_([a-z]+-){9}[a-z]+$/
const VALID_ID = 'u_able-baker-cedar-delta-eagle-fable-gamma-hotel-india-juliet'

const roots: string[] = []

afterAll(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function tempDataHome(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'agent-qa-analytics-447-'))
  roots.push(root)
  return root
}

function recordPath(home: string): string {
  return join(home, 'agent-qa', 'analytics.json')
}

async function writeRecord(home: string, bytes: string): Promise<void> {
  await mkdir(join(home, 'agent-qa'), { recursive: true })
  await writeFile(recordPath(home), bytes, { mode: 0o600 })
}

async function readStoredRecord(home: string): Promise<Record<string, unknown> | null> {
  try {
    const parsed = JSON.parse(await readFile(recordPath(home), 'utf8')) as unknown
    return parsed !== null && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

describe('C447-IDENTITY-RACE', () => {
  it('five concurrent first resolutions on a fresh home all return the one stored id', async () => {
    const home = await tempDataHome()
    const env = { XDG_DATA_HOME: home }

    const results = await Promise.all(
      Array.from({ length: 5 }, () => resolveAnalyticsIdentity({ env })),
    )
    const stored = await readStoredRecord(home)

    expect(new Set(results.map((result) => result.distinctId))).toEqual(
      new Set([stored?.distinctId]),
    )
    expect(Object.keys(stored ?? {}).sort()).toEqual(['distinctId', 'is_internal'])
    expect(stored?.distinctId).toMatch(LOCAL_ID)
  })
})

describe('C447-IDENTITY-ADOPT', () => {
  it('a valid record without is_internal is adopted with its bytes unchanged', async () => {
    const home = await tempDataHome()
    const bytes = `{"distinctId":"${VALID_ID}"}`
    await writeRecord(home, bytes)

    const resolved = await resolveAnalyticsIdentity({ env: { XDG_DATA_HOME: home } })

    expect(resolved.distinctId).toBe(VALID_ID)
    expect(resolved.isInternal).toBe(false)
    expect(await readFile(recordPath(home), 'utf8')).toBe(bytes)
  })
})

describe('C447-IDENTITY-INVALID', () => {
  it('a record that is not a valid id is replaced by a valid one that is read back', async () => {
    const fixtures = ['', '{', '{"distinctId":"u_not-the-scheme"}']
    let checked = 0

    for (const bytes of fixtures) {
      const home = await tempDataHome()
      await writeRecord(home, bytes)

      const resolved = await resolveAnalyticsIdentity({ env: { XDG_DATA_HOME: home } })
      const stored = await readStoredRecord(home)

      expect(resolved.distinctId).toMatch(LOCAL_ID)
      expect(resolved.distinctId).not.toBe('u_not-the-scheme')
      expect(stored?.distinctId).toBe(resolved.distinctId)
      checked += 1
    }

    expect(checked).toBe(fixtures.length)
  })
})
